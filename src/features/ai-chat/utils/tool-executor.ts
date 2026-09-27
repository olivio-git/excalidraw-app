import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { DiagramController } from "@/core/diagram/DiagramController";
import { getDocumentController } from "@/features/document-editor/documentController.singleton";
import { getDocumentCodec } from "@/features/document-editor/note-codec";
import { projectDocument, type DocumentBlock } from "@/features/document-editor/note-format";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { fileHandlerRegistry } from "@/core/shell/panels/file-handler-registry";
import { createFileReference } from "@/core/shell/services/file-navigation";
import { diagramFileService } from "@/core/diagram/services/diagram-file.service";
import {
  copyFile,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
} from "@tauri-apps/plugin-fs";
import { dirname, join } from "@tauri-apps/api/path";
import type { AIToolResult } from "../providers/types";
import type { AIChatContext } from "./context-resolver";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

interface FlatFileEntry {
  path: string;
  name: string;
  isDir: boolean;
}

function isAbsolutePath(path: string) {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}

async function resolveWorkspaceFilePath(filePath: string): Promise<string> {
  if (isAbsolutePath(filePath)) return filePath;
  const workspaceDir = useWorkspaceStore.getState().workspaceDir;
  return workspaceDir ? join(workspaceDir, filePath) : filePath;
}

function normalizeDiagramSkeletonElements(elements: unknown[]): unknown[] {
  return elements.map((element) => {
    if (!element || typeof element !== "object" || Array.isArray(element)) return element;
    const record = element as Record<string, unknown>;
    if (typeof record.label !== "string") return element;
    return { ...record, label: { text: record.label } };
  });
}

function safeFileStem(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._ -]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "diagram"
  );
}

async function resolveGeneratedDiagramPath(input: {
  diagramPath?: string;
  diagramName?: string;
  caption?: string;
}): Promise<string> {
  if (input.diagramPath) return resolveWorkspaceFilePath(input.diagramPath);
  const workspaceDir = useWorkspaceStore.getState().workspaceDir;
  if (!workspaceDir)
    throw new Error("No workspace directory set. Provide diagramPath or open a workspace.");
  const stem = safeFileStem(input.diagramName || input.caption || "generated-diagram");
  return join(workspaceDir, "diagrams", stem.endsWith(".excalidraw") ? stem : `${stem}.excalidraw`);
}

function insertDiagramEmbedBlock(targetPath: string, diagramRef: string, caption: string): boolean {
  const doc = useDocumentStore.getState().documents[targetPath];
  if (!doc) return false;
  const codec = getDocumentCodec();
  const blocks = doc.blocks ?? codec.tryParseMarkdownToBlocks(doc.content);
  const diagramBlock = {
    id: crypto.randomUUID(),
    type: "diagramEmbed",
    props: { diagramPath: diagramRef, caption },
    children: [],
  } as DocumentBlock;
  const nextBlocks = [...blocks, diagramBlock];
  useDocumentStore
    .getState()
    .setExternalContent(targetPath, projectDocument(codec, nextBlocks), nextBlocks);
  return true;
}

async function flattenDir(dir: string, prefix: string): Promise<FlatFileEntry[]> {
  const entries = await readDir(dir);
  const result: FlatFileEntry[] = [];
  for (const entry of entries) {
    if (!entry.name) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    result.push({ path: relativePath, name: entry.name, isDir: entry.isDirectory });
    if (entry.isDirectory) {
      const absoluteChild = await join(dir, entry.name);
      const children = await flattenDir(absoluteChild, relativePath);
      result.push(...children);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Diagram tool executor (internal)
// ---------------------------------------------------------------------------

async function executeDiagramTool(
  toolName: string,
  toolInput: unknown,
  instanceId: string | undefined
): Promise<AIToolResult> {
  if (!instanceId) {
    return {
      toolCallId: "",
      result: "No active diagram canvas. Open a diagram tab first.",
      isError: true,
    };
  }

  if (toolName === "get_elements") {
    const api = DiagramController.getApi(instanceId);
    if (api) {
      const elements = DiagramController.getElements(instanceId);
      return { toolCallId: "", result: JSON.stringify(elements), isError: false };
    }

    try {
      const diagram = await diagramFileService.readDiagram(instanceId);
      return {
        toolCallId: "",
        result: JSON.stringify({
          source: "file",
          instanceId,
          elementCount: diagram.elements.length,
          elements: diagram.elements,
        }),
        isError: false,
      };
    } catch {
      return {
        toolCallId: "",
        result: JSON.stringify({
          ok: false,
          errorCode: "CANVAS_NOT_READY",
          message: `Canvas not ready and file fallback failed for instanceId: ${instanceId}`,
          retryable: true,
          suggestedAction:
            "Use workspace_read_diagram with the diagram file path or open the file and retry.",
        }),
        isError: true,
      };
    }
  }

  let api = DiagramController.getApi(instanceId);
  if (!api) {
    try {
      api = await DiagramController.waitForInstance(instanceId, 8000);
    } catch {
      return {
        toolCallId: "",
        result: JSON.stringify({
          ok: false,
          errorCode: "CANVAS_NOT_READY",
          message: `Canvas not ready (instanceId: ${instanceId}).`,
          retryable: true,
          suggestedAction: "Open the diagram, wait for it to load, then retry.",
        }),
        isError: true,
      };
    }
  }

  try {
    switch (toolName) {
      case "draw_elements": {
        const input = toolInput as { elements?: unknown[] };
        if (!Array.isArray(input.elements)) {
          return {
            toolCallId: "",
            result: "Invalid input: elements must be an array.",
            isError: true,
          };
        }

        // Separate pseudo-elements from real elements
        const deleteOp = input.elements.find((el) => (el as { type: string }).type === "delete") as
          | { type: "delete"; ids: string }
          | undefined;
        const cameraUpdate = input.elements.find(
          (el) => (el as { type: string }).type === "cameraUpdate"
        ) as
          | { type: "cameraUpdate"; x?: number; y?: number; width?: number; height?: number }
          | undefined;
        const realElements = input.elements.filter(
          (el) => !["cameraUpdate", "delete"].includes((el as { type: string }).type)
        );

        // Handle delete pseudo-element: remove ids from existing scene
        let existing = [...api.getSceneElements()];
        if (deleteOp?.ids) {
          const toDelete = new Set(deleteOp.ids.split(",").map((s) => s.trim()));
          existing = existing.filter((el) => !toDelete.has(el.id));
        }

        // Convert skeleton elements (with label, etc.) to proper Excalidraw elements.
        // convertToExcalidrawElements handles text positioning for labeled containers internally.

        const normalized = convertToExcalidrawElements(
          normalizeDiagramSkeletonElements(realElements) as any
        ) as ExcalidrawElement[];

        if (realElements.length > 0 && normalized.length === 0) {
          return {
            toolCallId: "",
            result: `convertToExcalidrawElements returned 0 elements from ${realElements.length} input. Elements may be malformed. Ensure each has at minimum: type, x, y, width, height.`,
            isError: true,
          };
        }

        // Merge additively with existing (minus deleted)
        type AnyEl = Parameters<typeof DiagramController.updateScene>[1]["elements"];
        api.updateScene({ elements: [...existing, ...(normalized as AnyEl)] });

        if (cameraUpdate) {
          api.updateScene({
            appState: {
              scrollX: -(cameraUpdate.x ?? 0),
              scrollY: -(cameraUpdate.y ?? 0),
            },
          });
        }

        // Scroll canvas to show new content when no explicit camera update was requested
        if (!cameraUpdate && normalized.length > 0) {
          setTimeout(() => api.scrollToContent(), 150);
        }

        return {
          toolCallId: "",
          result: `Drew ${normalized.length} element(s) (${realElements.length} input → ${normalized.length} converted).`,
          isError: false,
        };
      }

      case "set_elements": {
        const input = toolInput as { elements?: unknown[] };
        if (!Array.isArray(input.elements)) {
          return {
            toolCallId: "",
            result: "Invalid input: elements must be an array.",
            isError: true,
          };
        }

        const normalized = convertToExcalidrawElements(
          normalizeDiagramSkeletonElements(input.elements) as any
        ) as ExcalidrawElement[];
        api.updateScene({
          elements: normalized as Parameters<typeof DiagramController.updateScene>[1]["elements"],
        });
        return { toolCallId: "", result: `Set ${normalized.length} element(s).`, isError: false };
      }

      case "export_svg": {
        const svg = await DiagramController.exportToSVG(instanceId);
        if (!svg) return { toolCallId: "", result: "Export failed.", isError: true };
        return {
          toolCallId: "",
          result: new XMLSerializer().serializeToString(svg),
          isError: false,
        };
      }

      case "save_diagram": {
        await diagramFileService.writeDiagram(instanceId, {
          elements: api.getSceneElements(),
          appState: api.getAppState(),
          files: api.getFiles(),
        });
        return { toolCallId: "", result: `Saved diagram: ${instanceId}`, isError: false };
      }

      case "clear_canvas": {
        const input = toolInput as { confirm?: boolean };
        if (!input.confirm) {
          return {
            toolCallId: "",
            result: "Must pass confirm: true to clear canvas.",
            isError: true,
          };
        }
        api.updateScene({ elements: [] });
        return { toolCallId: "", result: "Canvas cleared.", isError: false };
      }

      case "update_element": {
        const input = toolInput as {
          elementId?: string;
          updates?: Record<string, unknown>;
        };
        if (!input.elementId || !input.updates) {
          return {
            toolCallId: "",
            result: "Invalid input: elementId and updates required.",
            isError: true,
          };
        }
        const elements = api.getSceneElements();
        const updated = elements.map((el) =>
          el.id === input.elementId ? { ...el, ...input.updates } : el
        );
        api.updateScene({ elements: updated as typeof elements });
        return {
          toolCallId: "",
          result: `Updated element ${input.elementId}.`,
          isError: false,
        };
      }

      default:
        return {
          toolCallId: "",
          result: `Unknown tool: ${toolName}`,
          isError: true,
        };
    }
  } catch (err) {
    return { toolCallId: "", result: String(err), isError: true };
  }
}

// ---------------------------------------------------------------------------
// Document tool executor (internal)
// ---------------------------------------------------------------------------

async function executeDocumentTool(
  toolName: string,
  toolInput: unknown,
  filePath: string
): Promise<AIToolResult> {
  const inputWithPath = toolInput as { filePath?: string };
  const targetPath = inputWithPath.filePath
    ? await resolveWorkspaceFilePath(inputWithPath.filePath)
    : filePath;
  const store = useDocumentStore.getState();
  const controller = getDocumentController();

  const ensureOpen = async () => {
    if (!store.documents[targetPath]) await controller.openDocument(targetPath, false);
    const doc = useDocumentStore.getState().documents[targetPath];
    if (!doc) throw new Error(`Document not found in store: ${targetPath}`);
    return doc;
  };

  try {
    switch (toolName) {
      case "document_create_visual_report": {
        const input = toolInput as {
          title?: string;
          markdown?: string;
          diagrams?: Array<{
            diagramPath?: string;
            diagramName?: string;
            caption?: string;
            elements?: unknown[];
          }>;
        };
        if (!input.title) return { toolCallId: "", result: "title is required.", isError: true };
        if (input.markdown === undefined) {
          return { toolCallId: "", result: "markdown is required.", isError: true };
        }
        const createdPath = await controller.createDocument(input.title);
        await controller.setContent(createdPath, input.markdown);

        const inserted: string[] = [];
        for (const diagram of input.diagrams ?? []) {
          if (!Array.isArray(diagram.elements)) continue;

          const normalized = convertToExcalidrawElements(
            normalizeDiagramSkeletonElements(diagram.elements) as any
          ) as ExcalidrawElement[];
          if (diagram.elements.length > 0 && normalized.length === 0) continue;

          const diagramPath = await resolveGeneratedDiagramPath({
            diagramPath: diagram.diagramPath,
            diagramName: diagram.diagramName,
            caption: diagram.caption,
          });
          await mkdir(await dirname(diagramPath), { recursive: true });
          await diagramFileService.writeDiagram(diagramPath, {
            elements: normalized,
            appState: { viewBackgroundColor: "#ffffff" },
            files: {},
          });

          const diagramRef = createFileReference(
            diagramPath,
            useWorkspaceStore.getState().workspaceDir
          );
          insertDiagramEmbedBlock(
            createdPath,
            diagramRef,
            diagram.caption || diagram.diagramName || "Diagram"
          );
          inserted.push(diagramPath);
        }

        await controller.saveDocument(createdPath);
        return {
          toolCallId: "",
          result: JSON.stringify({
            filePath: createdPath,
            diagramCount: inserted.length,
            diagrams: inserted,
          }),
          isError: false,
        };
      }

      case "document_create": {
        const input = toolInput as { title?: string };
        if (!input.title) return { toolCallId: "", result: "title is required.", isError: true };
        const created = await controller.createDocument(input.title);
        return { toolCallId: "", result: JSON.stringify({ filePath: created }), isError: false };
      }

      case "document_open": {
        await controller.openDocument(targetPath);
        return { toolCallId: "", result: `Opened document: ${targetPath}`, isError: false };
      }

      case "document_list":
        return {
          toolCallId: "",
          result: JSON.stringify(await controller.listDocuments()),
          isError: false,
        };

      case "document_read": {
        const doc = await ensureOpen();
        const input = toolInput as { includeDataUrls?: boolean; offset?: number; limit?: number };
        let content = input.includeDataUrls
          ? doc.content
          : doc.content.replace(/!\[([^\]]*)\]\(data:[^)]{20,}\)/g, "![$1]([embedded-image])");
        if (typeof input.offset === "number" || typeof input.limit === "number") {
          const lines = content.split("\n");
          const offset = input.offset ?? 0;
          const sliced =
            typeof input.limit === "number"
              ? lines.slice(offset, offset + input.limit)
              : lines.slice(offset);
          content = JSON.stringify({
            content: sliced.join("\n"),
            offset,
            total: lines.length,
            hasMore: offset + sliced.length < lines.length,
          });
        }
        return { toolCallId: "", result: content, isError: false };
      }

      case "document_get_sections": {
        await ensureOpen();
        const input = toolInput as { headingsOnly?: boolean; includeDataUrls?: boolean };
        const sections = controller.getSections(targetPath);
        const result = input.headingsOnly
          ? sections.map(({ id, heading, level }) => ({ id, heading, level }))
          : input.includeDataUrls
            ? sections
            : sections.map((s) => ({
                ...s,
                content: s.content.replace(
                  /!\[([^\]]*)\]\(data:[^)]{20,}\)/g,
                  "![$1]([embedded-image])"
                ),
              }));
        return { toolCallId: "", result: JSON.stringify(result), isError: false };
      }

      case "document_set_content": {
        const input = toolInput as { content?: string };
        if (input.content === undefined)
          return { toolCallId: "", result: "content is required.", isError: true };
        await ensureOpen();
        await controller.setContent(targetPath, input.content);
        return { toolCallId: "", result: `Set content for ${targetPath}.`, isError: false };
      }

      case "document_replace_section": {
        const input = toolInput as {
          heading?: string;
          sectionId?: string;
          newContent?: string;
          content?: string;
        };
        const newContent = input.newContent ?? input.content;
        if ((!input.heading && !input.sectionId) || newContent === undefined) {
          return {
            toolCallId: "",
            result: "Invalid input: sectionId or heading, and content/newContent required.",
            isError: true,
          };
        }
        // Resolve heading text → sectionId via getSections
        await ensureOpen();
        const sections = controller.getSections(targetPath);
        const target = input.sectionId
          ? sections.find((s) => s.id === input.sectionId)
          : sections.find((s) => s.heading === input.heading);
        if (!target) {
          return {
            toolCallId: "",
            result: `Section not found: "${input.heading}". Call document_get_sections to see available headings.`,
            isError: true,
          };
        }
        await controller.replaceSection(targetPath, target.id, newContent);
        return {
          toolCallId: "",
          result: `Section "${input.heading}" replaced.`,
          isError: false,
        };
      }

      case "document_insert_after_section": {
        const input = toolInput as { heading?: string; sectionId?: string; content?: string };
        if ((!input.heading && !input.sectionId) || !input.content) {
          return {
            toolCallId: "",
            result: "Invalid input: sectionId or heading, and content required.",
            isError: true,
          };
        }
        await ensureOpen();
        if (input.sectionId)
          await controller.insertAfterSection(targetPath, input.sectionId, input.content);
        else await controller.insertAfterHeading(targetPath, input.heading!, input.content);
        return {
          toolCallId: "",
          result: `Content inserted after "${input.heading}".`,
          isError: false,
        };
      }

      case "document_append": {
        const input = toolInput as { content?: string };
        if (!input.content) {
          return {
            toolCallId: "",
            result: "Invalid input: content required.",
            isError: true,
          };
        }
        await ensureOpen();
        await controller.appendContent(targetPath, input.content);
        return { toolCallId: "", result: "Content appended.", isError: false };
      }

      case "document_delete_section": {
        const input = toolInput as { sectionId?: string };
        if (!input.sectionId)
          return { toolCallId: "", result: "sectionId is required.", isError: true };
        await ensureOpen();
        await controller.deleteSection(targetPath, input.sectionId);
        return { toolCallId: "", result: `Deleted section ${input.sectionId}.`, isError: false };
      }

      case "document_insert_diagram": {
        const input = toolInput as { diagramPath?: string; caption?: string; sectionId?: string };
        if (!input.diagramPath)
          return { toolCallId: "", result: "diagramPath is required.", isError: true };
        await ensureOpen();

        const diagramPath = await resolveWorkspaceFilePath(input.diagramPath);
        const workspaceDir = useWorkspaceStore.getState().workspaceDir;
        const diagramRef = createFileReference(diagramPath, workspaceDir);
        const caption = input.caption || "Diagram";

        // Keep the linked preview accurate: if the diagram is open, persist the
        // current canvas before the document block renders from the .excalidraw file.
        const api = DiagramController.getApi(diagramPath);
        if (api) {
          await diagramFileService.writeDiagram(diagramPath, {
            elements: api.getSceneElements(),
            appState: api.getAppState(),
            files: api.getFiles(),
          });
        } else {
          // Validate that the referenced diagram exists/readable. The preview renderer
          // will export it to a blob URL in the editor; no fragile data: SVG is needed.
          await diagramFileService.readDiagram(diagramPath);
        }

        // Prefer the native linked-diagram block for the live editor. Markdown data:
        // SVGs are unreliable in BlockNote/Tauri (they can become blank image cards),
        // while this block renders a fresh SVG preview from the editable .excalidraw.
        if (!input.sectionId && insertDiagramEmbedBlock(targetPath, diagramRef, caption)) {
          return {
            toolCallId: "",
            result: "Linked diagram preview inserted in document.",
            isError: false,
          };
        }

        const linkMarkdown = `[${caption}](${diagramRef})`;
        if (input.sectionId)
          await controller.replaceSection(targetPath, input.sectionId, linkMarkdown);
        else await controller.insertDiagram(targetPath, diagramRef, caption);
        return { toolCallId: "", result: "Diagram link inserted in document.", isError: false };
      }

      case "document_insert_generated_diagram": {
        const input = toolInput as {
          filePath?: string;
          diagramPath?: string;
          diagramName?: string;
          caption?: string;
          elements?: unknown[];
          sectionId?: string;
        };
        if (!Array.isArray(input.elements)) {
          return { toolCallId: "", result: "elements must be an array.", isError: true };
        }
        await ensureOpen();

        const normalized = convertToExcalidrawElements(
          normalizeDiagramSkeletonElements(input.elements) as any
        ) as ExcalidrawElement[];
        if (input.elements.length > 0 && normalized.length === 0) {
          return {
            toolCallId: "",
            result:
              "convertToExcalidrawElements returned 0 elements. Use valid Excalidraw skeleton elements with type, x, y, width, and height.",
            isError: true,
          };
        }

        const diagramPath = await resolveGeneratedDiagramPath(input);
        await mkdir(await dirname(diagramPath), { recursive: true });
        await diagramFileService.writeDiagram(diagramPath, {
          elements: normalized,
          appState: { viewBackgroundColor: "#ffffff" },
          files: {},
        });

        const workspaceDir = useWorkspaceStore.getState().workspaceDir;
        const diagramRef = createFileReference(diagramPath, workspaceDir);
        const caption = input.caption || input.diagramName || "Diagram";

        if (!input.sectionId && insertDiagramEmbedBlock(targetPath, diagramRef, caption)) {
          return {
            toolCallId: "",
            result: `Generated diagram (${normalized.length} elements) and inserted linked preview: ${diagramPath}`,
            isError: false,
          };
        }

        const linkMarkdown = `[${caption}](${diagramRef})`;
        if (input.sectionId)
          await controller.replaceSection(targetPath, input.sectionId, linkMarkdown);
        else await controller.insertDiagram(targetPath, diagramRef, caption);
        return {
          toolCallId: "",
          result: `Generated diagram (${normalized.length} elements) and inserted link: ${diagramPath}`,
          isError: false,
        };
      }

      case "document_save": {
        await ensureOpen();
        await controller.saveDocument(targetPath);
        return { toolCallId: "", result: "Document saved.", isError: false };
      }

      case "document_delete": {
        const input = toolInput as { confirm?: boolean };
        if (!input.confirm)
          return { toolCallId: "", result: "confirm: true is required.", isError: true };
        await controller.deleteDocument(targetPath);
        return { toolCallId: "", result: `Deleted document: ${targetPath}`, isError: false };
      }

      default:
        return {
          toolCallId: "",
          result: `Unknown document tool: ${toolName}`,
          isError: true,
        };
    }
  } catch (err) {
    return { toolCallId: "", result: String(err), isError: true };
  }
}

// ---------------------------------------------------------------------------
// Workspace tool executor (context: none)
// ---------------------------------------------------------------------------

async function executeWorkspaceTool(toolName: string, toolInput: unknown): Promise<AIToolResult> {
  const workspaceDir = useWorkspaceStore.getState().workspaceDir;

  try {
    switch (toolName) {
      case "workspace_list_files": {
        if (!workspaceDir) {
          return { toolCallId: "", result: "No workspace directory set.", isError: true };
        }
        const flatList = await flattenDir(workspaceDir, "");
        return { toolCallId: "", result: JSON.stringify(flatList), isError: false };
      }

      case "workspace_read_file": {
        const input = toolInput as { filePath?: string };
        if (!input.filePath) {
          return { toolCallId: "", result: "filePath is required.", isError: true };
        }
        const filePath = await resolveWorkspaceFilePath(input.filePath);
        const content = await readTextFile(filePath);
        return {
          toolCallId: "",
          result: JSON.stringify({ filePath, bytes: content.length, content }),
          isError: false,
        };
      }

      case "workspace_read_diagram": {
        const input = toolInput as { filePath?: string };
        if (!input.filePath) {
          return { toolCallId: "", result: "filePath is required.", isError: true };
        }
        const filePath = await resolveWorkspaceFilePath(input.filePath);
        const diagram = await diagramFileService.readDiagram(filePath);
        return {
          toolCallId: "",
          result: JSON.stringify({
            filePath,
            elementCount: diagram.elements.length,
            appState: diagram.appState,
            files: diagram.files,
            elements: diagram.elements,
          }),
          isError: false,
        };
      }

      case "workspace_stat_file": {
        const input = toolInput as { filePath?: string };
        if (!input.filePath)
          return { toolCallId: "", result: "filePath is required.", isError: true };
        const filePath = await resolveWorkspaceFilePath(input.filePath);
        return { toolCallId: "", result: JSON.stringify(await stat(filePath)), isError: false };
      }

      case "workspace_create_folder": {
        const input = toolInput as { path?: string };
        if (!input.path) return { toolCallId: "", result: "path is required.", isError: true };
        const dir = await resolveWorkspaceFilePath(input.path);
        await mkdir(dir, { recursive: true });
        return { toolCallId: "", result: `Created folder: ${dir}`, isError: false };
      }

      case "workspace_copy_file": {
        const input = toolInput as { from?: string; to?: string };
        if (!input.from || !input.to)
          return { toolCallId: "", result: "from and to are required.", isError: true };
        const from = await resolveWorkspaceFilePath(input.from);
        const to = await resolveWorkspaceFilePath(input.to);
        await copyFile(from, to);
        return { toolCallId: "", result: `Copied ${from} to ${to}.`, isError: false };
      }

      case "workspace_rename_file": {
        const input = toolInput as { from?: string; to?: string };
        if (!input.from || !input.to)
          return { toolCallId: "", result: "from and to are required.", isError: true };
        const from = await resolveWorkspaceFilePath(input.from);
        const to = await resolveWorkspaceFilePath(input.to);
        await rename(from, to);
        return { toolCallId: "", result: `Renamed ${from} to ${to}.`, isError: false };
      }

      case "workspace_delete_file": {
        const input = toolInput as { filePath?: string; confirm?: boolean };
        if (!input.filePath)
          return { toolCallId: "", result: "filePath is required.", isError: true };
        if (!input.confirm)
          return { toolCallId: "", result: "confirm: true is required.", isError: true };
        const filePath = await resolveWorkspaceFilePath(input.filePath);
        await remove(filePath, { recursive: true });
        return { toolCallId: "", result: `Deleted: ${filePath}`, isError: false };
      }

      case "workspace_create_diagram": {
        if (!workspaceDir) {
          return { toolCallId: "", result: "No workspace directory set.", isError: true };
        }
        const input = toolInput as { name?: string };
        if (!input.name) {
          return { toolCallId: "", result: "name is required.", isError: true };
        }
        const name = input.name.endsWith(".excalidraw") ? input.name : `${input.name}.excalidraw`;
        const filePath = await diagramFileService.createNewDiagram(workspaceDir, input.name);
        const handler = fileHandlerRegistry.resolveOrDefault(name);
        const title = handler.displayName ? handler.displayName(name) : name;
        useTabStore.getState().addTab({
          routeId: handler.routeId,
          path: `/${handler.routeId}`,
          title,
          instanceId: filePath,
          metadata: { filePath },
        });
        return {
          toolCallId: "",
          result: `Created and opened diagram: ${filePath}. The diagram is now the active tab — you can now draw on it.`,
          isError: false,
        };
      }

      case "workspace_create_document": {
        const input = toolInput as { title?: string };
        if (!input.title) {
          return { toolCallId: "", result: "title is required.", isError: true };
        }
        const filePath = await getDocumentController().createDocument(input.title);
        const handler = fileHandlerRegistry.resolveOrDefault(`${input.title}.md`);
        useTabStore.getState().addTab({
          routeId: handler.routeId,
          path: `/${handler.routeId}`,
          title: input.title,
          instanceId: filePath,
          metadata: { filePath },
        });
        return {
          toolCallId: "",
          result: `Created and opened document: ${filePath}. The document is now the active tab — you can now write to it.`,
          isError: false,
        };
      }

      case "workspace_open_file": {
        const input = toolInput as { filePath?: string };
        if (!input.filePath) {
          return { toolCallId: "", result: "filePath is required.", isError: true };
        }
        const filePath = await resolveWorkspaceFilePath(input.filePath);
        const name = filePath.split(/[\\/]/).pop() ?? filePath;
        const handler = fileHandlerRegistry.resolveOrDefault(name);
        const routePath = `/${handler.routeId}`;
        const existing = useTabStore.getState().findTabByPath(routePath, filePath);
        if (existing) {
          useTabStore.getState().setActiveTab(existing.id);
        } else {
          const title = handler.displayName ? handler.displayName(name) : name;
          useTabStore.getState().addTab({
            routeId: handler.routeId,
            path: routePath,
            title,
            instanceId: filePath,
            metadata: { filePath },
          });
        }

        if (handler.routeId === "diagram") {
          try {
            await DiagramController.waitForInstance(filePath, 10000);
          } catch {
            return {
              toolCallId: "",
              result: `Opened ${name}, but the diagram canvas is not ready yet. Wait a moment and retry reading the canvas.`,
              isError: true,
            };
          }
        }

        return {
          toolCallId: "",
          result: `${existing ? "Focused existing tab" : "Opened"} ${name}.`,
          isError: false,
        };
      }

      default:
        return { toolCallId: "", result: `Unknown workspace tool: ${toolName}`, isError: true };
    }
  } catch (err) {
    return { toolCallId: "", result: String(err), isError: true };
  }
}

// ---------------------------------------------------------------------------
// Public dispatcher
// ---------------------------------------------------------------------------

async function executeAppTool(toolName: string, toolInput: unknown): Promise<AIToolResult> {
  const store = useTabStore.getState();
  try {
    switch (toolName) {
      case "get_active_tab": {
        const active = store.tabs.find((t) => t.id === store.activeTabId) ?? null;
        return {
          toolCallId: "",
          result: JSON.stringify({ activeTab: active, tabs: store.tabs }),
          isError: false,
        };
      }
      case "activate_tab": {
        const input = toolInput as { tabId?: string };
        if (!input.tabId) return { toolCallId: "", result: "tabId is required.", isError: true };
        store.setActiveTab(input.tabId);
        return { toolCallId: "", result: `Activated tab ${input.tabId}.`, isError: false };
      }
      case "close_tab": {
        const input = toolInput as { tabId?: string };
        if (!input.tabId) return { toolCallId: "", result: "tabId is required.", isError: true };
        store.removeTab(input.tabId);
        return { toolCallId: "", result: `Closed tab ${input.tabId}.`, isError: false };
      }
      case "list_open_diagrams":
        return {
          toolCallId: "",
          result: JSON.stringify(store.tabs.filter((t) => t.routeId === "diagram")),
          isError: false,
        };
      case "get_tab_metadata": {
        const input = toolInput as { tabId?: string };
        const tab = store.tabs.find((t) => t.id === input.tabId);
        if (!tab) return { toolCallId: "", result: `Tab not found: ${input.tabId}`, isError: true };
        return { toolCallId: "", result: JSON.stringify(tab), isError: false };
      }
      case "save_all_diagrams": {
        let count = 0;
        for (const tab of store.tabs.filter((t) => t.routeId === "diagram" && t.instanceId)) {
          const api = DiagramController.getApi(tab.instanceId!);
          if (!api) continue;
          await diagramFileService.writeDiagram(tab.instanceId!, {
            elements: api.getSceneElements(),
            appState: api.getAppState(),
            files: api.getFiles(),
          });
          count++;
        }
        return { toolCallId: "", result: `Saved ${count} diagram(s).`, isError: false };
      }
      default:
        return { toolCallId: "", result: `Unknown app tool: ${toolName}`, isError: true };
    }
  } catch (err) {
    return { toolCallId: "", result: String(err), isError: true };
  }
}

const DOCUMENT_TOOL_NAMES = new Set([
  "document_create_visual_report",
  "document_create",
  "document_open",
  "document_list",
  "document_read",
  "document_get_sections",
  "document_set_content",
  "document_replace_section",
  "document_insert_after_section",
  "document_delete_section",
  "document_insert_diagram",
  "document_insert_generated_diagram",
  "document_append",
  "document_save",
  "document_delete",
]);

const APP_TOOL_NAMES = new Set([
  "get_active_tab",
  "activate_tab",
  "close_tab",
  "list_open_diagrams",
  "get_tab_metadata",
  "save_all_diagrams",
]);

const WORKSPACE_TOOL_NAMES = new Set([
  "workspace_list_files",
  "workspace_read_file",
  "workspace_read_diagram",
  "workspace_create_diagram",
  "workspace_create_document",
  "workspace_open_file",
  "workspace_stat_file",
  "workspace_create_folder",
  "workspace_copy_file",
  "workspace_rename_file",
  "workspace_delete_file",
]);

export async function executeAITool(
  toolName: string,
  toolInput: unknown,
  context: AIChatContext
): Promise<AIToolResult> {
  // App and workspace tools are available in all contexts
  if (APP_TOOL_NAMES.has(toolName)) {
    return executeAppTool(toolName, toolInput);
  }

  if (WORKSPACE_TOOL_NAMES.has(toolName)) {
    return executeWorkspaceTool(toolName, toolInput);
  }

  if (DOCUMENT_TOOL_NAMES.has(toolName)) {
    const input = toolInput as { filePath?: string };
    const activeDocumentPath = useDocumentStore.getState().activeDocumentId;
    if (
      context.kind === "document" ||
      input.filePath ||
      (toolName === "document_save" && activeDocumentPath) ||
      [
        "document_create_visual_report",
        "document_create",
        "document_open",
        "document_list",
      ].includes(toolName)
    ) {
      return executeDocumentTool(
        toolName,
        toolInput,
        context.kind === "document"
          ? context.filePath
          : (input.filePath ?? activeDocumentPath ?? "")
      );
    }
  }

  switch (context.kind) {
    case "diagram":
      return executeDiagramTool(toolName, toolInput, context.instanceId);
    case "document":
      return executeDocumentTool(toolName, toolInput, context.filePath);
    case "none":
      return { toolCallId: "", result: `Unknown tool: ${toolName}`, isError: true };
  }
}
