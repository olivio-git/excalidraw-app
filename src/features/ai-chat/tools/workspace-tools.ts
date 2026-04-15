import type { AIToolDefinition } from "../providers/types";

export const WORKSPACE_TOOLS: AIToolDefinition[] = [
  {
    name: "workspace_list_files",
    description:
      "List all files and folders in the workspace. Use this to discover what exists before creating or opening files.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "workspace_create_diagram",
    description:
      "Create a new Excalidraw diagram file and open it in a tab. After creation, the diagram will be the active context for drawing.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "File name without extension (e.g. 'my-diagram'). Subdirectories allowed (e.g. 'designs/flowchart').",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "workspace_create_document",
    description:
      "Create a new markdown document and open it in a tab. After creation, the document will be the active context for editing.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Document title (used as filename without .md extension).",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "workspace_open_file",
    description:
      "Open an existing file from the workspace in a tab. Use workspace_list_files first to get valid paths.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the file to open.",
        },
      },
      required: ["filePath"],
    },
  },
];
