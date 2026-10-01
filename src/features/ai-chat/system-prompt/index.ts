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

export interface FlowContextInfo {
  filePath: string;
  name: string;
  stepCount: number;
  /** Status of the last run, when there is one. */
  lastRun?: string;
}

export interface SystemPromptOptions {
  theme?: Theme;
  customInstructions?: string;
  diagramContext?: DiagramContextInfo;
  documentContext?: DocumentContextInfo;
  flowContext?: FlowContextInfo;
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

  if (contextKind === "flow" && opts.flowContext) {
    const { filePath, name, stepCount, lastRun } = opts.flowContext;
    parts.push(
      `## ACTIVE FLOW\nFile: ${filePath}\nName: "${name}" · ${stepCount === 0 ? "empty (no steps yet)" : `${stepCount} steps`}${lastRun ? ` · last run: ${lastRun}` : ""}`
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

Flows are executable automations shown in a 3D editor. Tools: **flow3d_create(name, nodes, edges)** creates and opens one; **flow3d_read(filePath?)** returns the flow open in the active tab (or a given file), the result of its last run and the format reference; **flow3d_update(filePath?, nodes, edges)** replaces its steps (undoable in the editor); **flow3d_run(filePath?, payload?)** runs it for real and returns how each step went.
When the user asks for an automation ("every morning…", "when a file changes…", "call this API and…"), create a flow. When they mention "this flow", a failing step or a run, call flow3d_read first and fix the configuration with flow3d_update.
Flows are also full 3D diagrams: when the user asks to visualize something (a neural network, an architecture, a matrix, a stack, a city, a LEGO build), use kind "element" nodes with shapes (sphere, box, cylinder…), icons, colors and sizes, and place them in all three axes — explicit positions [x, y, z] or a layout (layers, grid, radial). Never line everything up along x unless it is a sequence; make it spatial and readable.`;

export function buildSystemPrompt(context: AIChatContext, opts: SystemPromptOptions = {}): string {
  return buildBasePrompt(context, opts) + FLOWS_SECTION;
}

const FLOW_AGENT_PROMPT = `You are the flow agent of QoriApp. The user is looking at an automation flow (.flow3d) in the 3D editor; "this flow" means the active one.

## HOW TO WORK

1. Call **flow3d_read** (no filePath) before changing anything: it returns the steps, the connections, the last run and the full format reference.
2. Change the flow with **flow3d_update** (no filePath): send the complete list of nodes and edges, keeping the ids of steps you don't change. The editor shows it at once and Ctrl+Z undoes it.
3. For visual diagrams use kind "element", shapes, icons, colors and real 3D placement (positions or layouts layers/grid/radial) — never a single line unless it is a sequence.
4. When the user asks to try it, or to fix a failure, call **flow3d_run** and read its result; if a step fails, fix its configuration and run again (at most 3 times).
5. Use the workspace tools to look at files the flow reads or writes, and **workspace_search** to find notes, diagrams or code it should use.

## STYLE

- If the request is unclear (what triggers it, where data comes from), ask one short question first; otherwise act.
- Answer in the user's language, briefly: what you built or changed and why, step by step names in bold.
- Never paste the flow JSON in the chat: the editor already shows it.`;

function buildBasePrompt(context: AIChatContext, opts: SystemPromptOptions): string {
  const theme = opts.theme ?? "dark";
  const suffix = buildContextSection(opts, context.kind);

  switch (context.kind) {
    case "diagram":
      return buildExcalidrawSystemPrompt(theme) + suffix;
    case "document":
      return buildDocumentSystemPrompt() + suffix;
    case "flow":
      return FLOW_AGENT_PROMPT + suffix;
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
- **workspace_search(query)** — find text in notes, diagrams, flows and code
- **notes_list(tag?, status?, notebook?, query?)** — the notes with title, tags, status and date
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
