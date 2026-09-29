import type { AIToolDefinition } from "../providers/types";

const FLOW_INPUT = {
  nodes: {
    type: "array",
    description:
      "Steps: { id, kind: trigger|action|condition|transform|ai|output|note, label, description?, config? }. config.type: manual|schedule|fileWatch|http|command|appCommand|ai|writeNote|template|condition (see flow3d_read for examples). Text fields accept {{input.x}}, {{steps.id.output.x}}, {{item}}, {{secrets.NAME}}.",
    items: { type: "object" },
  },
  edges: {
    type: "array",
    description: 'Connections: { id, from, to, label? } — label "sí"/"no" on condition branches.',
    items: { type: "object" },
  },
};

/** Tools to create, read and change 3D flows (.flow3d) from the chat. */
export const FLOW3D_TOOLS: AIToolDefinition[] = [
  {
    name: "flow3d_create",
    description:
      "Create an executable automation flow (.flow3d) in the workspace and open it in the 3D editor. Start with one trigger; the layout is automatic.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Flow name, also used for the file name" },
        folder: { type: "string", description: "Workspace-relative folder (optional)" },
        ...FLOW_INPUT,
      },
      required: ["name", "nodes", "edges"],
    },
  },
  {
    name: "flow3d_read",
    description:
      "Read a flow: its steps and connections, the result of its last run (status, errors, outputs) and the format reference. Without filePath, reads the flow open in the active tab.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Workspace-relative or absolute path" },
      },
    },
  },
  {
    name: "flow3d_update",
    description:
      "Replace the steps and connections of a flow (keeps its name and settings). In an open editor the change can be undone with Ctrl+Z. Without filePath, changes the flow open in the active tab.",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, ...FLOW_INPUT },
      required: ["nodes", "edges"],
    },
  },
];

export const FLOW3D_TOOL_NAMES: ReadonlySet<string> = new Set(FLOW3D_TOOLS.map((t) => t.name));
