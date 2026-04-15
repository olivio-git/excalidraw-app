import type { AIToolDefinition } from "../providers/types";

export const DIAGRAM_TOOLS: AIToolDefinition[] = [
  {
    name: "draw_elements",
    description: "Draw or replace elements on the Excalidraw canvas",
    inputSchema: {
      type: "object",
      properties: {
        elements: { type: "array", description: "Array of Excalidraw element objects" },
      },
      required: ["elements"],
    },
  },
  {
    name: "get_elements",
    description: "Get all current elements from the canvas",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "clear_canvas",
    description: "Clear all elements from the canvas",
    inputSchema: {
      type: "object",
      properties: { confirm: { type: "boolean" } },
      required: ["confirm"],
    },
  },
  {
    name: "update_element",
    description: "Update a single element by ID",
    inputSchema: {
      type: "object",
      properties: {
        elementId: { type: "string" },
        updates: { type: "object" },
      },
      required: ["elementId", "updates"],
    },
  },
];
