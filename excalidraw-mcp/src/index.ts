import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PORT = process.env.MCP_PORT ?? "7888";
const BRIDGE_URL = `http://127.0.0.1:${PORT}/api/tool`;

interface BridgeResponse {
  result: unknown;
  error: string | null;
}

async function callBridge(tool: string, input: Record<string, unknown>): Promise<BridgeResponse> {
  try {
    const res = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, input }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      return { result: null, error: (body as BridgeResponse).error ?? res.statusText };
    }

    return (await res.json()) as BridgeResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      return { result: null, error: "Excalidraw app is not running. Start the app first." };
    }
    return { result: null, error: msg };
  }
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

const server = new McpServer({
  name: "excalidraw",
  version: "0.1.0",
});

// ─── get_elements ─────────────────────────────────────────────────────────────
server.tool(
  "get_elements",
  [
    "Get all elements from the active Excalidraw diagram canvas. Returns a JSON array of Excalidraw elements.",
    "ONLY works when the active tab is an Excalidraw diagram (routeId: 'excalidraw').",
    "If the active tab is a document editor or any other route, this returns an error — use get_active_tab to check first.",
  ].join(" "),
  {},
  async () => {
    const res = await callBridge("get_elements", {});
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── draw_elements ────────────────────────────────────────────────────────────
server.tool(
  "draw_elements",
  [
    "Add Excalidraw elements to the active canvas without replacing existing content.",
    "PREFERRED for building diagrams: call multiple times for different sections (e.g. one call per layer or subsystem).",
    "Supports labeled shapes, arrows with bindings, and pseudo-elements (delete, cameraUpdate).",
    "For labeled shapes (rectangles, ellipses, etc.), use the 'label' property instead of a separate text element — Excalidraw handles positioning automatically.",
    "Diagrams are saved to disk automatically after each call.",
  ].join(" "),
  {
    elements: z
      .array(z.record(z.string(), z.unknown()))
      .describe("Array of Excalidraw skeleton elements to draw"),
  },
  async ({ elements }) => {
    const res = await callBridge("draw_elements", { elements });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── set_elements ─────────────────────────────────────────────────────────────
server.tool(
  "set_elements",
  [
    "Replace ALL elements on the active canvas with the provided elements.",
    "Use draw_elements instead when building a diagram incrementally — it is faster and avoids generating the entire diagram JSON in one shot.",
    "Reserve set_elements for replacing or restoring a known complete canvas state.",
    "For labeled shapes (rectangles, ellipses, etc.), use the 'label' property instead of a separate text element — Excalidraw handles positioning automatically.",
    "Diagram is saved to disk automatically after the call.",
  ].join(" "),
  {
    elements: z
      .array(z.record(z.string(), z.unknown()))
      .describe("Array of Excalidraw elements that will replace the current canvas"),
  },
  async ({ elements }) => {
    const res = await callBridge("set_elements", { elements });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── clear_canvas ─────────────────────────────────────────────────────────────
server.tool(
  "clear_canvas",
  "Remove all elements from the active canvas. Requires explicit confirmation to prevent accidental clears.",
  {
    confirm: z.boolean().describe("Must be true to proceed with clearing the canvas"),
  },
  async ({ confirm }) => {
    const res = await callBridge("clear_canvas", { confirm });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── update_element ───────────────────────────────────────────────────────────
server.tool(
  "update_element",
  "Apply partial property updates to a specific element on the canvas identified by its id.",
  {
    elementId: z.string().describe("The id of the element to update"),
    updates: z
      .record(z.string(), z.unknown())
      .describe("Partial element properties to merge into the element"),
  },
  async ({ elementId, updates }) => {
    const res = await callBridge("update_element", { elementId, updates });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── export_svg ───────────────────────────────────────────────────────────────
server.tool(
  "export_svg",
  [
    "Export the current diagram as an SVG string. Intended for external use (saving to disk, clipboard, etc.).",
    "WARNING: The SVG includes embedded base64 font data and can be very large (10k+ tokens).",
    "If your goal is to embed the diagram into a markdown document, use document_insert_diagram instead —",
    "it handles the SVG export and base64 embedding automatically without consuming context.",
  ].join(" "),
  {},
  async () => {
    const res = await callBridge("export_svg", {});
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── open_file ────────────────────────────────────────────────────────────────
server.tool(
  "open_file",
  "Open a .excalidraw file in a new tab in the running app.",
  {
    filePath: z.string().describe("Absolute path to the .excalidraw file to open"),
  },
  async ({ filePath }) => {
    const res = await callBridge("open_file", { filePath });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── get_active_tab ───────────────────────────────────────────────────────────
server.tool(
  "get_active_tab",
  "Get metadata about the currently active tab in the app (tabId, routeId, title, path, instanceId).",
  {},
  async () => {
    const res = await callBridge("get_active_tab", {});
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── get_workspace_dir ────────────────────────────────────────────────────────
server.tool(
  "get_workspace_dir",
  "Get the current workspace directory path configured in the app.",
  {},
  async () => {
    const res = await callBridge("get_workspace_dir", {});
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── list_workspace ───────────────────────────────────────────────────────────
server.tool(
  "list_workspace",
  "List all files and folders in the current workspace directory. Returns a flat JSON array of objects with { path: string, name: string, isDir: boolean } relative to the workspace root.",
  {},
  async () => {
    const res = await callBridge("list_workspace", {});
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── create_diagram ───────────────────────────────────────────────────────────
server.tool(
  "create_diagram",
  [
    "Create a new empty .excalidraw diagram file in the workspace and open it in a new tab. Fails if the file already exists.",
    "The name is relative to the workspace root — do NOT include the workspace path in the name.",
    "Examples: 'my-diagram', 'subfolder/my-diagram'. Parent directories are created automatically.",
    "Use get_workspace_dir to check the workspace root before choosing a name.",
  ].join(" "),
  {
    name: z
      .string()
      .describe(
        "File name relative to workspace root (e.g. 'my-diagram' or 'subfolder/my-diagram'). Do NOT include the workspace directory path — just the name within it."
      ),
  },
  async ({ name }) => {
    const res = await callBridge("create_diagram", { name });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── save_diagram ─────────────────────────────────────────────────────────────
server.tool(
  "save_diagram",
  "Persist the current in-memory state of an open diagram tab to disk. Returns bytes written.",
  {
    instanceId: z
      .string()
      .describe("The instanceId of the open diagram tab — equals the absolute file path"),
  },
  async ({ instanceId }) => {
    const res = await callBridge("save_diagram", { instanceId });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── create_folder ────────────────────────────────────────────────────────────
server.tool(
  "create_folder",
  "Create a new folder inside the workspace. Creates intermediate directories as needed.",
  {
    path: z
      .string()
      .describe("Relative path from workspace root for the new folder (e.g. 'subdir/nested')"),
  },
  async ({ path }) => {
    const res = await callBridge("create_folder", { path });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── rename_file ──────────────────────────────────────────────────────────────
server.tool(
  "rename_file",
  "Rename or move a file or folder within the workspace. If the file is open in a tab, the tab's instanceId and title are updated automatically.",
  {
    oldPath: z.string().describe("Current relative path from workspace root"),
    newPath: z.string().describe("New relative path from workspace root"),
  },
  async ({ oldPath, newPath }) => {
    const res = await callBridge("rename_file", { oldPath, newPath });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── delete_file ──────────────────────────────────────────────────────────────
server.tool(
  "delete_file",
  "Permanently delete a file or folder from the workspace. Requires confirm: true. If the file is open in a tab, the tab is closed first.",
  {
    path: z.string().describe("Relative path from workspace root of the file or folder to delete"),
    confirm: z.boolean().describe("Must be true to proceed — prevents accidental deletion"),
  },
  async ({ path, confirm }) => {
    const res = await callBridge("delete_file", { path, confirm });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── open_file_or_focus ───────────────────────────────────────────────────────
server.tool(
  "open_file_or_focus",
  "Open a file in a new tab, or focus it if already open",
  {
    filePath: z.string().describe("Absolute path to the file"),
  },
  async ({ filePath }) => {
    const res = await callBridge("open_file_or_focus", { filePath });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── list_open_diagrams ───────────────────────────────────────────────────────
server.tool(
  "list_open_diagrams",
  "List all currently open diagram tabs with their state",
  {},
  async () => {
    const res = await callBridge("list_open_diagrams", {});
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── activate_tab ─────────────────────────────────────────────────────────────
server.tool(
  "activate_tab",
  "Switch focus to an already-open tab by file path or tab ID. At least one of filePath or tabId must be provided.",
  {
    filePath: z.string().optional().describe("Absolute path of the file whose tab to activate"),
    tabId: z.string().optional().describe("The tab ID to activate"),
  },
  async ({ filePath, tabId }) => {
    const res = await callBridge("activate_tab", { filePath, tabId });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── close_tab ────────────────────────────────────────────────────────────────
server.tool(
  "close_tab",
  "Close an open tab. Pinned tabs cannot be closed. Use force=true to close tabs with unsaved changes.",
  {
    filePath: z.string().optional().describe("Absolute path of the file whose tab to close"),
    tabId: z.string().optional().describe("The tab ID to close"),
    force: z.boolean().optional().describe("Force close even if there are unsaved changes"),
  },
  async ({ filePath, tabId, force }) => {
    const res = await callBridge("close_tab", { filePath, tabId, force });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── get_tab_metadata ─────────────────────────────────────────────────────────
server.tool(
  "get_tab_metadata",
  "Get metadata for a specific open tab including dirty state",
  {
    filePath: z.string().optional().describe("Absolute path of the file to get metadata for"),
    tabId: z.string().optional().describe("The tab ID to get metadata for"),
  },
  async ({ filePath, tabId }) => {
    const res = await callBridge("get_tab_metadata", { filePath, tabId });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── save_all_diagrams ────────────────────────────────────────────────────────
server.tool(
  "save_all_diagrams",
  "Save all dirty open diagrams to disk, or a specific subset by instanceId",
  {
    instanceIds: z
      .array(z.string())
      .optional()
      .describe("Specific instance IDs to save. If omitted, saves all dirty diagrams."),
  },
  async ({ instanceIds }) => {
    const res = await callBridge("save_all_diagrams", { instanceIds });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── stat_file ────────────────────────────────────────────────────────────────
server.tool(
  "stat_file",
  "Get metadata for a file or directory: name, isFile, isDir, size (bytes), mtime (Unix ms timestamp or null).",
  {
    filePath: z.string().describe("Absolute path to the file or directory"),
  },
  async ({ filePath }) => {
    const res = await callBridge("stat_file", { filePath });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── copy_file ────────────────────────────────────────────────────────────────
server.tool(
  "copy_file",
  "Copy a file or directory to a new path. For directories, copies recursively. If destPath already exists and overwrite is false (default), returns an error.",
  {
    srcPath: z.string().describe("Absolute source path"),
    destPath: z.string().describe("Absolute destination path"),
    overwrite: z
      .boolean()
      .optional()
      .describe("Overwrite destination if it exists (default: false)"),
  },
  async ({ srcPath, destPath, overwrite }) => {
    const res = await callBridge("copy_file", { srcPath, destPath, overwrite });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── list_directory ───────────────────────────────────────────────────────────
server.tool(
  "list_directory",
  "List the contents of a directory. More powerful than list_workspace: supports absolute paths, recursive mode, and dotfile visibility. dirPath defaults to the workspace root.",
  {
    dirPath: z
      .string()
      .optional()
      .describe("Absolute path of the directory to list. Defaults to workspace root."),
    recursive: z.boolean().optional().describe("Recurse into subdirectories (default: false)"),
    showDotfiles: z
      .boolean()
      .optional()
      .describe("Include entries whose names start with '.' (default: false)"),
  },
  async ({ dirPath, recursive, showDotfiles }) => {
    const res = await callBridge("list_directory", { dirPath, recursive, showDotfiles });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── get_explorer_state ───────────────────────────────────────────────────────
server.tool(
  "get_explorer_state",
  "Get the current state of the file explorer: sortOrder, showDotfiles setting, and currently selected paths.",
  {},
  async () => {
    const res = await callBridge("get_explorer_state", {});
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── set_explorer_state ───────────────────────────────────────────────────────
server.tool(
  "set_explorer_state",
  "Update explorer display settings. All fields are optional — only provided fields are changed.",
  {
    sortOrder: z
      .enum(["type-first", "name-asc", "name-desc"])
      .optional()
      .describe("File sort order"),
    showDotfiles: z
      .boolean()
      .optional()
      .describe("Show files and folders whose names start with '.'"),
  },
  async ({ sortOrder, showDotfiles }) => {
    const res = await callBridge("set_explorer_state", { sortOrder, showDotfiles });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── toggle_folder ────────────────────────────────────────────────────────────
server.tool(
  "toggle_folder",
  "Expand or collapse a folder node in the explorer tree. If expand is omitted, the current state is toggled.",
  {
    folderPath: z.string().describe("Absolute path of the folder to expand or collapse"),
    expand: z.boolean().optional().describe("true = expand, false = collapse, omit = toggle"),
  },
  async ({ folderPath, expand }) => {
    const res = await callBridge("toggle_folder", { folderPath, expand });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── get_selected_files ───────────────────────────────────────────────────────
server.tool(
  "get_selected_files",
  "Get the list of currently selected file/folder paths in the explorer.",
  {},
  async () => {
    const res = await callBridge("get_selected_files", {});
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── set_selected_files ───────────────────────────────────────────────────────
server.tool(
  "set_selected_files",
  "Programmatically set the selection in the file explorer. Replaces the current selection entirely.",
  {
    paths: z.array(z.string()).describe("Array of absolute paths to select in the explorer"),
  },
  async ({ paths }) => {
    const res = await callBridge("set_selected_files", { paths });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_create ──────────────────────────────────────────────────────────
server.tool(
  "document_create",
  "Create a new markdown document",
  {
    title: z.string().describe("Title of the new document (used as filename without extension)"),
  },
  async ({ title }) => {
    const res = await callBridge("document_create", { title });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_open ────────────────────────────────────────────────────────────
server.tool(
  "document_open",
  "Open a markdown document in a tab",
  {
    filePath: z.string().describe("Absolute path to the markdown document to open"),
  },
  async ({ filePath }) => {
    const res = await callBridge("document_open", { filePath });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_get_content ─────────────────────────────────────────────────────
server.tool(
  "document_get_content",
  [
    "Get the markdown content of an open document.",
    "IMPORTANT: filePath must be an absolute path obtained from document_list or document_create — never guess or construct the path.",
    "Embedded base64 images are replaced with '[embedded-image]' placeholders by default to avoid token overflow — pass includeDataUrls: true only when you need the raw bytes.",
    "For large documents, use offset and limit to paginate by line number.",
    "The response includes { content, offset, total, hasMore } when paginating.",
    "When hasMore is true, fetch the next page with offset = offset + limit.",
  ].join(" "),
  {
    filePath: z
      .string()
      .describe(
        "Absolute path to the open document. Obtain this from document_list or document_create — do NOT guess or infer the path."
      ),
    includeDataUrls: z
      .boolean()
      .optional()
      .describe(
        "If true, return raw base64 data: URLs instead of '[embedded-image]' placeholders. WARNING: can exceed token limits on documents with embedded diagrams. Only use if you need the actual image bytes."
      ),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Line number to start reading from (0-based). Omit to read from the beginning."),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of lines to return. Omit to return all lines from offset."),
  },
  async ({ filePath, includeDataUrls, offset, limit }) => {
    const res = await callBridge("document_get_content", {
      filePath,
      includeDataUrls,
      offset,
      limit,
    });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_get_sections ────────────────────────────────────────────────────
server.tool(
  "document_get_sections",
  [
    "Get the section tree of an open document.",
    "Each section has: id, heading, level, content (body text).",
    "Embedded base64 images in section bodies are replaced with '[embedded-image]' placeholders by default.",
    "Use headingsOnly: true to get only id/heading/level — sufficient for finding a section ID before replace/insert/delete.",
  ].join(" "),
  {
    filePath: z
      .string()
      .describe(
        "Absolute path to the open document. Obtain this from document_list or document_create — do NOT guess or infer the path."
      ),
    headingsOnly: z
      .boolean()
      .optional()
      .describe(
        "If true, omit section body content (returns only id, heading, level). Use for large documents."
      ),
    includeDataUrls: z
      .boolean()
      .optional()
      .describe(
        "If true, return raw base64 data: URLs in section bodies instead of placeholders. WARNING: can exceed token limits."
      ),
  },
  async ({ filePath, headingsOnly, includeDataUrls }) => {
    const res = await callBridge("document_get_sections", {
      filePath,
      headingsOnly,
      includeDataUrls,
    });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_set_content ─────────────────────────────────────────────────────
server.tool(
  "document_set_content",
  "Replace the full content of an open document",
  {
    filePath: z
      .string()
      .describe(
        "Absolute path to the open document. Obtain this from document_list or document_create — do NOT guess or infer the path."
      ),
    content: z.string().describe("New markdown content to set"),
  },
  async ({ filePath, content }) => {
    const res = await callBridge("document_set_content", { filePath, content });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_append ──────────────────────────────────────────────────────────
server.tool(
  "document_append",
  "Append markdown content to the end of a document",
  {
    filePath: z
      .string()
      .describe(
        "Absolute path to the open document. Obtain this from document_list or document_create — do NOT guess or infer the path."
      ),
    content: z.string().describe("Markdown content to append"),
  },
  async ({ filePath, content }) => {
    const res = await callBridge("document_append", { filePath, content });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_insert_after_section ────────────────────────────────────────────
server.tool(
  "document_insert_after_section",
  "Insert content after a section identified by ID",
  {
    filePath: z
      .string()
      .describe(
        "Absolute path to the open document. Obtain this from document_list or document_create — do NOT guess or infer the path."
      ),
    sectionId: z.string().describe("The section ID to insert after (from document_get_sections)"),
    content: z.string().describe("Markdown content to insert"),
  },
  async ({ filePath, sectionId, content }) => {
    const res = await callBridge("document_insert_after_section", { filePath, sectionId, content });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_insert_after_heading ────────────────────────────────────────────
server.tool(
  "document_insert_after_heading",
  "Insert content after a section identified by heading text",
  {
    filePath: z
      .string()
      .describe(
        "Absolute path to the open document. Obtain this from document_list or document_create — do NOT guess or infer the path."
      ),
    heading: z.string().describe("The heading text to insert after"),
    content: z.string().describe("Markdown content to insert"),
  },
  async ({ filePath, heading, content }) => {
    const res = await callBridge("document_insert_after_heading", { filePath, heading, content });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_replace_section ─────────────────────────────────────────────────
server.tool(
  "document_replace_section",
  [
    "Replace the BODY of a section — the text directly under its heading, up to the next heading of any level.",
    "ATOMIC: sub-sections (nested headings) are NEVER touched. Only the immediate body text is replaced.",
    "To rename the heading itself, use document_set_content to rewrite the full document.",
    "Get sectionId from document_get_sections.",
  ].join(" "),
  {
    filePath: z
      .string()
      .describe(
        "Absolute path to the open document. Obtain this from document_list or document_create — do NOT guess or infer the path."
      ),
    sectionId: z.string().describe("The section ID to replace (from document_get_sections)"),
    content: z
      .string()
      .describe("New markdown content for the section body (excluding the heading line itself)"),
  },
  async ({ filePath, sectionId, content }) => {
    const res = await callBridge("document_replace_section", { filePath, sectionId, content });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_delete_section ──────────────────────────────────────────────────
server.tool(
  "document_delete_section",
  [
    "Delete a section's heading and its IMMEDIATE body — the text directly under it, up to the next heading of any level.",
    "ATOMIC: sub-sections (nested headings) are NOT deleted, they are promoted up.",
    "Get sectionId from document_get_sections.",
  ].join(" "),
  {
    filePath: z
      .string()
      .describe(
        "Absolute path to the open document. Obtain this from document_list or document_create — do NOT guess or infer the path."
      ),
    sectionId: z.string().describe("The section ID to delete (from document_get_sections)"),
  },
  async ({ filePath, sectionId }) => {
    const res = await callBridge("document_delete_section", { filePath, sectionId });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_insert_diagram ──────────────────────────────────────────────────
server.tool(
  "document_insert_diagram",
  [
    "Export an open Excalidraw diagram as SVG and embed it into a document as an inline image.",
    "The SVG is embedded as a base64 data URL — no external files needed, no manual encoding required.",
    "IMPORTANT: the diagram must be open in a tab before calling this tool.",
    "Workflow: 1) open_file_or_focus the .excalidraw file, 2) draw or verify the diagram, 3) call this tool.",
    "Use sectionId to REPLACE an existing section with the diagram (from document_get_sections).",
    "Omit sectionId to APPEND the diagram at the end of the document.",
    "NEVER use export_svg + manual base64 encoding for this — always use this tool instead.",
  ].join(" "),
  {
    filePath: z.string().describe("Absolute path to the target .md document"),
    diagramPath: z
      .string()
      .describe("Absolute path to the .excalidraw file — must be open in a tab"),
    caption: z.string().optional().describe("Optional caption displayed below the diagram"),
    sectionId: z
      .string()
      .optional()
      .describe(
        "If provided, replaces the body of this section with the embedded diagram instead of appending. Get the ID from document_get_sections."
      ),
  },
  async ({ filePath, diagramPath, caption, sectionId }) => {
    const res = await callBridge("document_insert_diagram", {
      filePath,
      diagramPath,
      caption,
      sectionId,
    });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_save ────────────────────────────────────────────────────────────
server.tool(
  "document_save",
  "Save a document to disk",
  {
    filePath: z
      .string()
      .describe(
        "Absolute path to the open document to save. Obtain this from document_list — do NOT guess or infer the path."
      ),
  },
  async ({ filePath }) => {
    const res = await callBridge("document_save", { filePath });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_list ────────────────────────────────────────────────────────────
server.tool(
  "document_list",
  "List all currently open documents. Returns an array of { filePath, title, isDirty } objects. Use this to obtain filePath values before calling any other document tool.",
  {},
  async () => {
    const res = await callBridge("document_list", {});
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── document_delete ──────────────────────────────────────────────────────────
server.tool(
  "document_delete",
  "Delete a document file and close its tab",
  {
    filePath: z
      .string()
      .describe(
        "Absolute path to the document to delete. Obtain this from document_list — do NOT guess or infer the path."
      ),
    confirm: z
      .boolean()
      .describe("Must be true to confirm deletion. This action cannot be undone."),
  },
  async ({ filePath, confirm }) => {
    const res = await callBridge("document_delete", { filePath, confirm });
    if (res.error)
      return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
    return { content: [{ type: "text", text: toText(res.result) }] };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
