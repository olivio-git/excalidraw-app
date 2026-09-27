import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const filePath = z.string().min(1).describe("Absolute path inside the current workspace.");
const groupId = z.enum(["primary", "secondary"]);
const target = { tabId: z.string().min(1).optional(), filePath: filePath.optional() };
const revision = {
  filePath,
  expectedRevision: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Opaque revision token from document_get_blocks. Echo it unchanged; stale edits and stale buffer generations are rejected."
    ),
};
const placement = {
  parentId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Parent block ID, or null/omitted for the root."),
  index: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Insertion index in the destination children; defaults to append. For moves, measured after removal."
    ),
};
const block = z
  .record(z.string(), z.unknown())
  .describe(
    "BlockNote block: type, optional id, props, content, children. Call document_get_schema for allowed types/properties."
  );
interface Definition {
  description: string;
  input: z.ZodRawShape;
  readOnly?: boolean;
}

export const automationDefinitions: Record<string, Definition> = {
  workspace_get_state: {
    description:
      "Inspect both editor groups, visible/focused tabs, dirty state, split direction/ratio and navigation availability.",
    input: {},
    readOnly: true,
  },
  workspace_set_layout: {
    description:
      "Set horizontal (side-by-side) or vertical (stacked) layout. null merges groups without closing files. ratio is the first pane's percentage (20–80).",
    input: {
      direction: z.enum(["horizontal", "vertical"]).nullable().optional(),
      ratio: z.number().min(20).max(80).optional(),
    },
  },
  workspace_focus_group: {
    description:
      "Focus an existing group, including an empty pane. Discover IDs with workspace_get_state.",
    input: { groupId },
  },
  workspace_move_tab: {
    description:
      "Move an existing editor to a group without duplicating/remounting it. Supply tabId or filePath; if both, they must match.",
    input: { ...target, groupId },
  },
  workspace_close_group: {
    description:
      "Save and close a group's tabs, then collapse the empty pane. Reports pinned/blocked/save failures. force explicitly discards unsaved edits, never bypassing pinned or last-tab settings.",
    input: { groupId, force: z.boolean().optional() },
  },
  workspace_navigate: {
    description:
      "Navigate a group's open-tab history. Omitted groupId uses the currently focused group.",
    input: { direction: z.enum(["back", "forward"]), groupId: groupId.optional() },
  },
  open_to_side: {
    description:
      "Open or move a file to the opposite group. groupId is the SOURCE group; omitted uses current focus. One live editor is retained per file.",
    input: { filePath, groupId: groupId.optional(), anchor: z.string().min(1).optional() },
  },
  list_tabs: {
    description:
      "List every open tab (documents and diagrams), including groupId, visibility, active state and accurate dirty status.",
    input: {},
    readOnly: true,
  },
  save_tab: {
    description:
      "Save an explicit document or diagram tab. Supply tabId or filePath; omit both for the focused tab. Reports newer unsaved edits.",
    input: target,
  },
  save_all_tabs: {
    description:
      "Save dirty documents and diagrams, or the supplied tab IDs. Returns saved/failed counts and per-tab errors.",
    input: { tabIds: z.array(z.string().min(1)).optional() },
  },
  set_tab_pinned: {
    description: "Pin or unpin a tab. Supply tabId or filePath.",
    input: { ...target, pinned: z.boolean() },
  },
  document_create_rich: {
    description:
      "Create a new .note with lossless native blocks. Supply blocks OR markdown, optionally open in a group. Creates parents; never overwrites. Returns native blocks/IDs/revision.",
    input: {
      filePath,
      blocks: z.array(block).optional(),
      markdown: z.string().optional(),
      open: z.boolean().optional(),
      groupId: groupId.optional(),
    },
  },
  document_get_schema: {
    description: "Discover supported native block types, properties and defaults for rich notes.",
    input: {},
    readOnly: true,
  },
  document_get_blocks: {
    description:
      "Read native blocks, persistent IDs and an opaque revision token of a .note without focusing it. Pages top-level blocks (default 100, max 200); includes total/offset/hasMore. Embedded data URLs are replaced with [embedded-image] unless includeDataUrls=true. Do not write placeholders back. Echo revision as expectedRevision on edits.",
    input: {
      filePath,
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      includeDataUrls: z.boolean().optional(),
    },
    readOnly: true,
  },
  document_get_outline: {
    description: "Read a .note heading outline with stable native block IDs, titles and levels.",
    input: { filePath },
    readOnly: true,
  },
  document_insert_blocks: {
    description:
      "Insert native blocks into a .note at the root or a parent's children. IDs may be supplied or generated. Validates the full candidate before committing and saves automatically.",
    input: { ...revision, ...placement, blocks: z.array(block).min(1) },
  },
  document_update_block: {
    description:
      "Update one native block by ID: type, props, content or children. ID cannot change; properties merge for unchanged type. Saves automatically.",
    input: { ...revision, blockId: z.string().min(1), changes: z.record(z.string(), z.unknown()) },
  },
  document_delete_blocks: {
    description:
      "Remove named blocks and descendants from a .note. Unknown IDs reject the operation. An empty document retains a blank paragraph. Saves automatically.",
    input: { ...revision, blockIds: z.array(z.string().min(1)).min(1) },
  },
  document_move_block: {
    description:
      "Move a block within a .note, preserving ID/content. Rejects moves into itself/descendants. index refers to destination after removal. Saves automatically.",
    input: { ...revision, ...placement, blockId: z.string().min(1) },
  },
  document_insert_linked_diagram: {
    description:
      "Insert a LIVE linked diagramEmbed into a .note (not a static SVG snapshot). The diagram need not be open; preview refreshes on saved changes. Saves automatically.",
    input: { ...revision, ...placement, diagramPath: filePath, caption: z.string().optional() },
  },
  reference_create: {
    description:
      "Create an app-internal link to a workspace file, optionally a native block ID, heading slug or diagram element ID.",
    input: { filePath, anchor: z.string().min(1).optional() },
    readOnly: true,
  },
  open_reference: {
    description:
      "Resolve and open a local reference relative to sourcePath, optionally beside a source group. Supports workspace/file references and block/element anchors.",
    input: {
      href: z.string().min(1),
      sourcePath: filePath,
      beside: z.boolean().optional(),
      groupId: groupId.optional(),
    },
  },
  references_refresh: {
    description:
      "Start a background workspace reference scan; returns immediately with jobId/status. Poll references_status or references_get until ready. Refresh after edits for a new snapshot; partial scans are reported.",
    input: { maxFiles: z.number().int().min(1).max(1000).optional() },
    readOnly: true,
  },
  references_status: {
    description:
      "Get the current reference scan's jobId, status, indexed-file count, failures, truncation and timestamps.",
    input: {},
    readOnly: true,
  },
  references_get: {
    description:
      "Query incoming/outgoing local references for a file from the latest index snapshot. Starts a scan if absent. running is NOT an empty result; poll until ready. Optional jobId rejects superseded scans.",
    input: {
      filePath,
      direction: z.enum(["incoming", "outgoing", "both"]).optional(),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      jobId: z.string().min(1).optional(),
    },
    readOnly: true,
  },
};

export function registerAutomationTools(
  server: McpServer,
  bridge: (
    tool: string,
    input: Record<string, unknown>
  ) => Promise<{ result: unknown; error: string | null }>
) {
  for (const [name, definition] of Object.entries(automationDefinitions)) {
    server.registerTool(
      name,
      {
        description: definition.description,
        inputSchema: z.strictObject(definition.input),
        annotations: { readOnlyHint: definition.readOnly ?? false },
      },
      async (input) => {
        const response = await bridge(name, input);
        const output = response.error
          ? { error: response.error, details: response.result }
          : response.result;
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
          ...(response.error ? { isError: true } : {}),
        };
      }
    );
  }
}
