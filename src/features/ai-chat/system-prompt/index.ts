import type { AIChatContext } from "../utils/context-resolver";
import { buildExcalidrawSystemPrompt } from "./diagram";
import { buildDocumentSystemPrompt } from "./document";

export { buildExcalidrawSystemPrompt } from "./diagram";

type Theme = "light" | "dark";

export interface DiagramContextInfo {
  elementCount: number;
  elementTypes: Record<string, number>;
}

export interface DocumentContextInfo {
  title: string;
  sectionCount: number;
  charCount: number;
}

export interface SystemPromptOptions {
  theme?: Theme;
  customInstructions?: string;
  diagramContext?: DiagramContextInfo;
  documentContext?: DocumentContextInfo;
}

function buildContextSection(
  opts: SystemPromptOptions,
  contextKind: AIChatContext["kind"]
): string {
  const parts: string[] = [];

  if (contextKind === "diagram" && opts.diagramContext) {
    const { elementCount, elementTypes } = opts.diagramContext;
    if (elementCount === 0) {
      parts.push("## CURRENT CANVAS STATE\nCanvas is empty.");
    } else {
      const breakdown = Object.entries(elementTypes)
        .map(([type, count]) => `${type}: ${count}`)
        .join(", ");
      parts.push(`## CURRENT CANVAS STATE\nElements on canvas: ${elementCount} (${breakdown})`);
    }
  }

  if (contextKind === "document" && opts.documentContext) {
    const { title, sectionCount, charCount } = opts.documentContext;
    parts.push(
      `## ACTIVE DOCUMENT\nTitle: "${title}" · ${sectionCount} section${sectionCount !== 1 ? "s" : ""} · ~${charCount.toLocaleString()} characters`
    );
  }

  if (opts.customInstructions?.trim()) {
    parts.push(`## USER INSTRUCTIONS\n${opts.customInstructions.trim()}`);
  }

  return parts.length > 0 ? `\n\n---\n\n${parts.join("\n\n")}` : "";
}

/** Appended to every prompt: flows are available from any context. */
const FLOWS_SECTION = `

---

## AUTOMATION FLOWS (.flow3d)

Flows are executable automations shown in a 3D editor. Tools: **flow3d_create(name, nodes, edges)** creates and opens one; **flow3d_read(filePath?)** returns the flow open in the active tab (or a given file), the result of its last run and the format reference; **flow3d_update(filePath?, nodes, edges)** replaces its steps (undoable in the editor).
When the user asks for an automation ("every morning…", "when a file changes…", "call this API and…"), create a flow. When they mention "this flow", a failing step or a run, call flow3d_read first and fix the configuration with flow3d_update.`;

export function buildSystemPrompt(context: AIChatContext, opts: SystemPromptOptions = {}): string {
  return buildBasePrompt(context, opts) + FLOWS_SECTION;
}

function buildBasePrompt(context: AIChatContext, opts: SystemPromptOptions): string {
  const theme = opts.theme ?? "dark";
  const suffix = buildContextSection(opts, context.kind);

  switch (context.kind) {
    case "diagram":
      return buildExcalidrawSystemPrompt(theme) + suffix;
    case "document":
      return buildDocumentSystemPrompt() + suffix;
    case "none":
      return `You are a helpful assistant integrated into an Excalidraw workspace. No diagram or document tab is currently active.

## AVAILABLE TOOLS

You have workspace tools to create and open files:

- **workspace_list_files** — list all files in the workspace
- **workspace_read_file(filePath)** — read a text file directly from disk
- **workspace_read_diagram(filePath)** — read an Excalidraw diagram directly from disk without opening the canvas
- **workspace_create_diagram(name)** — create a new diagram and open it
- **workspace_create_document(title)** — create a new markdown document and open it
- **workspace_open_file(filePath)** — open an existing file
- **document_create_visual_report(title, markdown, diagrams)** — create a complete markdown document and generated editable Excalidraw diagrams without opening diagram tabs

## WORKFLOW

When the user asks to create a diagram or document: call the appropriate tool immediately — do NOT ask for confirmation.
When the user asks for a document/report/guide with visuals, architecture, flows, processes, journeys, onboarding, authentication, system design, or diagrams: prefer document_create_visual_report in one call.
When the user asks to open a file: call workspace_list_files first if you don't know the path, then workspace_open_file.
After creating or opening a file, it becomes the active tab and document/diagram editing tools become available. IMMEDIATELY continue and use those tools to fulfill the original request — do NOT stop and tell the user to ask you again.

## IMPORTANT

- Act first, explain after. Never describe what you are about to do before doing it.
- Never put Mermaid, PlantUML, PUML, Graphviz, or ASCII diagrams in a QoriApp document unless explicitly requested. Use editable Excalidraw diagrams via document_create_visual_report.
- After a file is opened, the next message will have the full diagram or document editing tools available.`;
  }
}
