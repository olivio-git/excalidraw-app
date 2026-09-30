import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useDocumentStore } from "@/stores/documentStore";
import type { AIToolResult } from "../providers/types";

const ok = (result: unknown): AIToolResult => ({
  toolCallId: "",
  result: JSON.stringify(result),
  isError: false,
});
const fail = (message: string): AIToolResult => ({
  toolCallId: "",
  result: message,
  isError: true,
});

const clamp = (value: unknown, fallback: number, max: number) =>
  typeof value === "number" && value > 0 ? Math.min(Math.floor(value), max) : fallback;

const relative = (root: string, path: string) =>
  path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]/, "") : path;

/** Runs workspace_search and notes_list (search and notes index loaded on demand). */
export async function executeKnowledgeTool(
  toolName: string,
  toolInput: unknown
): Promise<AIToolResult> {
  const input = (toolInput ?? {}) as Record<string, unknown>;
  const root = useWorkspaceStore.getState().workspaceDir;
  if (!root) return fail("No workspace folder is open.");
  try {
    switch (toolName) {
      case "workspace_search": {
        const query = typeof input.query === "string" ? input.query : "";
        if (!query.trim()) return fail("query is required.");
        const { searchWorkspace } = await import("@/core/shell/services/workspace-search");
        const maxResults = clamp(input.maxResults, 50, 200);
        const summary = await searchWorkspace(
          root,
          query,
          AbortSignal.timeout(20_000),
          useDocumentStore.getState().documents,
          {
            regex: input.regex === true,
            caseSensitive: input.caseSensitive === true,
            wholeWord: input.wholeWord === true,
            maxResults,
          }
        );
        return ok({
          total: summary.total,
          truncated: summary.truncated,
          files: summary.files.map((file) => ({
            path: file.path,
            relativePath: relative(root, file.path),
            matches: file.matches.slice(0, 10).map((match) => ({
              text: match.text.length > 240 ? `${match.text.slice(0, 240)}…` : match.text,
              anchor: match.anchor,
              line: match.line,
              context: match.context,
            })),
          })),
        });
      }
      case "notes_list": {
        const { indexNotes, sortNotes } = await import("@/features/notes-list/notes-index");
        const { useConfigStore } = await import("@/core/config/config-store");
        const { notes: settings } = useConfigStore.getState().config;
        const tag = typeof input.tag === "string" ? input.tag.toLowerCase() : "";
        const text = typeof input.query === "string" ? input.query.toLowerCase() : "";
        const notebook =
          typeof input.notebook === "string" ? input.notebook.replace(/^\.?[\\/]|[\\/]$/g, "") : "";
        const all = await indexNotes(root, AbortSignal.timeout(20_000));
        const matching = all.filter(
          (note) =>
            (!tag || note.tags.some((t) => t.toLowerCase() === tag)) &&
            (!input.status || note.status === input.status) &&
            (!notebook || note.notebook.replaceAll("\\", "/").startsWith(notebook)) &&
            (!text || `${note.title}\n${note.snippet}`.toLowerCase().includes(text))
        );
        const sort = input.sort === "title" ? "title" : "updated";
        const limit = clamp(input.limit, 50, 500);
        return ok({
          total: matching.length,
          notes: sortNotes(matching, sort, settings.pinned)
            .slice(0, limit)
            .map((note) => ({
              ...note,
              relativePath: relative(root, note.path),
              updated: note.updated ? new Date(note.updated).toISOString() : null,
            })),
        });
      }
      default:
        return fail(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
