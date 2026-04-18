import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { DiagramController } from "@/core/diagram/DiagramController";
import { getDocumentController } from "@/features/document-editor/documentController.singleton";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { fileHandlerRegistry } from "@/core/shell/panels/file-handler-registry";
import { diagramFileService } from "@/core/diagram/services/diagram-file.service";
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
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

  let api = DiagramController.getApi(instanceId);
  if (!api) {
    try {
      api = await DiagramController.waitForInstance(instanceId, 3000);
    } catch {
      return {
        toolCallId: "",
        result: `Canvas not ready (instanceId: ${instanceId}). Try again in a moment.`,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const normalized = convertToExcalidrawElements(realElements as any) as ExcalidrawElement[];

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

        // Scroll canvas to show new content
        if (normalized.length > 0) {
          setTimeout(() => api.scrollToContent(), 150);
        }

        return {
          toolCallId: "",
          result: `Drew ${normalized.length} element(s) (${realElements.length} input → ${normalized.length} converted).`,
          isError: false,
        };
      }

      case "get_elements": {
        const elements = DiagramController.getElements(instanceId);
        return { toolCallId: "", result: JSON.stringify(elements), isError: false };
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
  const store = useDocumentStore.getState();
  const doc = store.documents[filePath];

  if (!doc) {
    return {
      toolCallId: "",
      result: `Document not found in store: ${filePath}`,
      isError: true,
    };
  }

  const controller = getDocumentController();

  try {
    switch (toolName) {
      case "document_read":
        return { toolCallId: "", result: doc.content, isError: false };

      case "document_get_sections": {
        // getSections is synchronous — returns Section[] directly
        const sections = controller.getSections(filePath);
        return { toolCallId: "", result: JSON.stringify(sections), isError: false };
      }

      case "document_replace_section": {
        const input = toolInput as { heading?: string; newContent?: string };
        if (!input.heading || input.newContent === undefined) {
          return {
            toolCallId: "",
            result: "Invalid input: heading and newContent required.",
            isError: true,
          };
        }
        // Resolve heading text → sectionId via getSections
        const sections = controller.getSections(filePath);
        const target = sections.find((s) => s.heading === input.heading);
        if (!target) {
          return {
            toolCallId: "",
            result: `Section not found: "${input.heading}". Call document_get_sections to see available headings.`,
            isError: true,
          };
        }
        await controller.replaceSection(filePath, target.id, input.newContent);
        return {
          toolCallId: "",
          result: `Section "${input.heading}" replaced.`,
          isError: false,
        };
      }

      case "document_insert_after_section": {
        const input = toolInput as { heading?: string; content?: string };
        if (!input.heading || !input.content) {
          return {
            toolCallId: "",
            result: "Invalid input: heading and content required.",
            isError: true,
          };
        }
        // insertAfterHeading accepts heading text directly and falls back to append if not found
        await controller.insertAfterHeading(filePath, input.heading, input.content);
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
        await controller.appendContent(filePath, input.content);
        return { toolCallId: "", result: "Content appended.", isError: false };
      }

      case "document_save": {
        await controller.saveDocument(filePath);
        return { toolCallId: "", result: "Document saved.", isError: false };
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
        const filePath = input.filePath;
        const name = filePath.split(/[\\/]/).pop() ?? filePath;
        const handler = fileHandlerRegistry.resolveOrDefault(name);
        const routePath = `/${handler.routeId}`;
        const existing = useTabStore.getState().findTabByPath(routePath, filePath);
        if (existing) {
          useTabStore.getState().setActiveTab(existing.id);
          return { toolCallId: "", result: `Focused existing tab: ${name}`, isError: false };
        }
        const title = handler.displayName ? handler.displayName(name) : name;
        useTabStore.getState().addTab({
          routeId: handler.routeId,
          path: routePath,
          title,
          instanceId: filePath,
          metadata: { filePath },
        });
        return { toolCallId: "", result: `Opened ${name}.`, isError: false };
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

const WORKSPACE_TOOL_NAMES = new Set([
  "workspace_list_files",
  "workspace_create_diagram",
  "workspace_create_document",
  "workspace_open_file",
]);

export async function executeAITool(
  toolName: string,
  toolInput: unknown,
  context: AIChatContext
): Promise<AIToolResult> {
  // Workspace tools are available in all contexts
  if (WORKSPACE_TOOL_NAMES.has(toolName)) {
    return executeWorkspaceTool(toolName, toolInput);
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
