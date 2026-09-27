import type { AIToolDefinition } from "../providers/types";

export const APP_TOOLS: AIToolDefinition[] = [
  {
    name: "get_active_tab",
    description: "Get the active tab and all open tabs",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "activate_tab",
    description: "Activate/focus an open tab by tabId",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, required: ["tabId"] },
  },
  {
    name: "close_tab",
    description: "Close an open tab by tabId",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, required: ["tabId"] },
  },
  {
    name: "list_open_diagrams",
    description: "List open diagram tabs",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_tab_metadata",
    description: "Get metadata for a tab",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, required: ["tabId"] },
  },
  {
    name: "save_all_diagrams",
    description: "Save all open diagram tabs to disk",
    inputSchema: { type: "object", properties: {} },
  },
];
