import type { AIToolDefinition } from "../providers/types";

/** Finding things in the workspace: text search and the notes list. Read-only. */
export const KNOWLEDGE_TOOLS: AIToolDefinition[] = [
  {
    name: "workspace_search",
    description:
      "Search text across the whole workspace: note blocks, Markdown, diagram texts, flow steps and code. Returns files with the matching lines and an anchor (block, heading, shape or step id) you can open with open_reference or workspace_open_file.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text (or regular expression with regex: true)" },
        regex: { type: "boolean" },
        caseSensitive: { type: "boolean" },
        wholeWord: { type: "boolean" },
        maxResults: { type: "number", description: "Default 50, at most 200" },
      },
      required: ["query"],
    },
  },
  {
    name: "notes_list",
    description:
      "List the workspace notes (.md and .note) like the Notes view: title, first line, notebook (folder), tags, status and last change. Filter by tag, status, notebook or text in the title.",
    inputSchema: {
      type: "object",
      properties: {
        sort: { type: "string", enum: ["updated", "title"], description: "Default: updated" },
        tag: { type: "string" },
        status: { type: "string", enum: ["active", "onhold", "completed", "dropped"] },
        notebook: { type: "string", description: "Workspace-relative folder" },
        query: { type: "string", description: "Text in the title or first line" },
        limit: { type: "number", description: "Default 50, at most 500" },
      },
    },
  },
];

export const KNOWLEDGE_TOOL_NAMES: ReadonlySet<string> = new Set(
  KNOWLEDGE_TOOLS.map((t) => t.name)
);
