import type { AIToolDefinition } from "../providers/types";

export const DOCUMENT_TOOLS: AIToolDefinition[] = [
  {
    name: "document_create_visual_report",
    description:
      "Create a complete markdown document with generated editable Excalidraw diagrams inserted as visible linked previews. Best tool for requests like 'create a document/report/guide with diagrams'. Do not use Mermaid/PlantUML when this tool can create real diagrams.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        markdown: { type: "string" },
        diagrams: {
          type: "array",
          items: {
            type: "object",
            properties: {
              diagramPath: { type: "string" },
              diagramName: { type: "string" },
              caption: { type: "string" },
              elements: { type: "array", items: { type: "object" } },
            },
            required: ["elements"],
          },
        },
      },
      required: ["title", "markdown"],
    },
  },
  {
    name: "document_create",
    description: "Create and open a new markdown document",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  },
  {
    name: "document_open",
    description: "Open a markdown document by filePath",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" } },
      required: ["filePath"],
    },
  },
  {
    name: "document_list",
    description: "List markdown documents in the workspace",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "document_read",
    description: "Read markdown content of the current document or provided filePath",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        includeDataUrls: { type: "boolean" },
        offset: { type: "number" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "document_get_sections",
    description: "Get sections/headings for the current document or provided filePath",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        headingsOnly: { type: "boolean" },
        includeDataUrls: { type: "boolean" },
      },
    },
  },
  {
    name: "document_set_content",
    description: "Replace full markdown content of the current document or provided filePath",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, content: { type: "string" } },
      required: ["content"],
    },
  },
  {
    name: "document_replace_section",
    description: "Replace a section by sectionId or heading",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        sectionId: { type: "string" },
        heading: { type: "string" },
        content: { type: "string" },
        newContent: { type: "string" },
      },
    },
  },
  {
    name: "document_insert_after_section",
    description: "Insert content after a section by sectionId or heading",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        sectionId: { type: "string" },
        heading: { type: "string" },
        content: { type: "string" },
      },
      required: ["content"],
    },
  },
  {
    name: "document_delete_section",
    description: "Delete a section by sectionId",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, sectionId: { type: "string" } },
      required: ["sectionId"],
    },
  },
  {
    name: "document_insert_diagram",
    description:
      "Insert a visible linked diagram preview into the document, keeping the .excalidraw file editable",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        diagramPath: { type: "string" },
        caption: { type: "string" },
        sectionId: { type: "string" },
      },
      required: ["diagramPath"],
    },
  },
  {
    name: "document_insert_generated_diagram",
    description:
      "Generate an editable .excalidraw diagram headlessly from Excalidraw skeleton elements and insert a visible linked preview into the document. Use this for visual documents instead of Mermaid/PlantUML/PUML.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        diagramPath: { type: "string" },
        diagramName: { type: "string" },
        caption: { type: "string" },
        elements: { type: "array", items: { type: "object" } },
        sectionId: { type: "string" },
      },
      required: ["elements"],
    },
  },
  {
    name: "document_append",
    description: "Append markdown content to the current document or provided filePath",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, content: { type: "string" } },
      required: ["content"],
    },
  },
  {
    name: "document_save",
    description: "Save the current document or provided filePath to disk",
    inputSchema: { type: "object", properties: { filePath: { type: "string" } } },
  },
  {
    name: "document_delete",
    description: "Delete a document file. Requires confirm true.",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, confirm: { type: "boolean" } },
      required: ["filePath", "confirm"],
    },
  },
];
