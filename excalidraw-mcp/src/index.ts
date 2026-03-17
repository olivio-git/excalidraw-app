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
  "Get all elements from the active Excalidraw diagram canvas. Returns a JSON array of Excalidraw elements.",
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
  "Add Excalidraw elements to the active canvas. Supports the full Excalidraw element format including labeled shapes, arrows with bindings, and pseudo-elements (delete, cameraUpdate).",
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
  "Replace ALL elements on the active canvas with the provided elements. Use draw_elements to add without replacing.",
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
server.tool("export_svg", "Export the current diagram as an SVG string.", {}, async () => {
  const res = await callBridge("export_svg", {});
  if (res.error) return { content: [{ type: "text", text: `Error: ${res.error}` }], isError: true };
  return { content: [{ type: "text", text: toText(res.result) }] };
});

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
  "Create a new empty .excalidraw diagram file in the workspace and open it in a new tab. Fails if the file already exists.",
  {
    name: z
      .string()
      .describe("File name (with or without .excalidraw extension), relative to workspace root"),
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

// ─── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
