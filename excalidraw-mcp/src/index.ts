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

// ─── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
