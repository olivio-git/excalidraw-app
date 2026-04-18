import type { AIToolDefinition } from "../providers/types";

export const DOCUMENT_TOOLS: AIToolDefinition[] = [
  {
    name: "document_read",
    description: "Read the full markdown content of the current document",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "document_get_sections",
    description: "Get a list of sections (headings) in the current document",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "document_replace_section",
    description: "Replace the content of a section identified by its heading text",
    inputSchema: {
      type: "object",
      properties: {
        heading: { type: "string", description: "Exact heading text of the section to replace" },
        newContent: {
          type: "string",
          description: "New markdown content for the section (without the heading line)",
        },
      },
      required: ["heading", "newContent"],
    },
  },
  {
    name: "document_insert_after_section",
    description: "Insert markdown content after a section identified by its heading text",
    inputSchema: {
      type: "object",
      properties: {
        heading: {
          type: "string",
          description: "Exact heading text of the section after which to insert",
        },
        content: { type: "string", description: "Markdown content to insert" },
      },
      required: ["heading", "content"],
    },
  },
  {
    name: "document_append",
    description: "Append markdown content to the end of the document",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Markdown content to append" },
      },
      required: ["content"],
    },
  },
  {
    name: "document_save",
    description: "Save the current document to disk",
    inputSchema: { type: "object", properties: {} },
  },
];
