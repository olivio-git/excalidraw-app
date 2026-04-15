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

export function buildSystemPrompt(context: AIChatContext, opts: SystemPromptOptions = {}): string {
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
- **workspace_create_diagram(name)** — create a new diagram and open it
- **workspace_create_document(title)** — create a new markdown document and open it
- **workspace_open_file(filePath)** — open an existing file

## WORKFLOW

When the user asks to create a diagram or document: call the appropriate tool immediately — do NOT ask for confirmation.
When the user asks to open a file: call workspace_list_files first if you don't know the path, then workspace_open_file.
After creating or opening a file, it becomes the active tab. Tell the user they can now ask you to draw or write content.

## IMPORTANT

- Act first, explain after. Never describe what you are about to do before doing it.
- After a file is opened, the next message will have the full diagram or document editing tools available.`;
  }
}
