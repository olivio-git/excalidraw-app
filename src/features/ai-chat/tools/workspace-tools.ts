import type { AIToolDefinition } from "../providers/types";

export const WORKSPACE_TOOLS: AIToolDefinition[] = [
  {
    name: "workspace_list_files",
    description:
      "List all files and folders in the workspace. Use this to discover what exists before creating or opening files.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "workspace_read_file",
    description:
      "Read a text file from the workspace. Use for markdown, JSON, source code, or other UTF-8 text files.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description:
            "Path to read. Can be workspace-relative path returned by workspace_list_files or an absolute path.",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "workspace_read_diagram",
    description:
      "Read an Excalidraw diagram file directly from disk without requiring the canvas UI to be open or ready.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description:
            "Path to the .excalidraw file. Can be workspace-relative path returned by workspace_list_files or an absolute path.",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "workspace_stat_file",
    description: "Get metadata/stat for a workspace file",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" } },
      required: ["filePath"],
    },
  },
  {
    name: "workspace_create_folder",
    description: "Create a folder in the workspace",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "workspace_copy_file",
    description: "Copy a workspace file",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
  },
  {
    name: "workspace_rename_file",
    description: "Rename or move a workspace file",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
  },
  {
    name: "workspace_delete_file",
    description: "Delete a workspace file or folder. Requires confirm true.",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, confirm: { type: "boolean" } },
      required: ["filePath", "confirm"],
    },
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
          description:
            "Path to the file to open. Can be a workspace-relative path returned by workspace_list_files or an absolute path.",
        },
      },
      required: ["filePath"],
    },
  },
];
