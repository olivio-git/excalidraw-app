import type { AIToolDefinition } from "../providers/types";

const FLOW_INPUT = {
  nodes: {
    type: "array",
    description:
      'Nodes: { id, kind: trigger|action|condition|transform|ai|output|note|element, label, description?, config?, position?: [x,y,z] (y = up, z = depth), layer?: number, color?, style?: { shape: card|box|sphere|cylinder|cone|capsule|torus|diamond|gem|disc|plane, size: [w,h,d]|scale, icon: emoji/short text, image: path or URL, opacity, label: auto|above|below|inside|hidden, glow } }. kind "element" = visual piece (neuron, server, brick). config.type: manual|schedule|fileWatch|http|command|appCommand|ai|writeNote|template|condition (see flow3d_read). Text fields accept {{input.x}}, {{steps.id.output.x}}, {{item}}, {{secrets.NAME}}.',
    items: { type: "object" },
  },
  edges: {
    type: "array",
    description:
      'Connections: { id, from, to, label?, style?: { color, dashed, width, curve: auto|straight|smooth, arrow } } — label "sí"/"no" on condition branches.',
    items: { type: "object" },
  },
  layout: {
    type: "string",
    enum: ["auto", "layers", "grid", "radial", "manual"],
    description:
      "How to place nodes. Default: manual when every node has a position, otherwise auto (left-to-right). layers = vertical columns by node.layer (neural networks); grid = matrix (layoutOptions.columns); radial = ring.",
  },
  layoutOptions: {
    type: "object",
    description:
      "{ gap (between layers/columns), spacing (inside a layer / between rows), columns (grid), radius and center (radial), plane: xz|xy (radial) }",
  },
};

/** Tools to create, read and change 3D flows (.flow3d) from the chat. */
export const FLOW3D_TOOLS: AIToolDefinition[] = [
  {
    name: "flow3d_create",
    description:
      "Create a .flow3d in the workspace and open it in the 3D editor: an executable automation (start with one trigger) or a visual 3D diagram (kind element, shapes, positions in x/y/z, layouts layers/grid/radial). Read the visual guide in flow3d_read's format reference.",
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
      "Replace the nodes and connections of a flow (keeps its name and settings), with their positions, shapes and styles. In an open editor the change can be undone with Ctrl+Z. Without filePath, changes the flow open in the active tab.",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, ...FLOW_INPUT },
      required: ["nodes", "edges"],
    },
  },
  {
    name: "flow3d_run",
    description:
      "Run a flow for real (its commands, HTTP calls, AI steps and notes) and return how each step went: status, output and error. Use it to test a flow after building or fixing it. In an open editor the run is shown step by step. Without filePath, runs the flow open in the active tab.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Workspace-relative or absolute path" },
        payload: {
          type: "object",
          description:
            "Starting data for the trigger (optional; defaults to its configured payload)",
        },
      },
    },
  },
];

export const FLOW3D_TOOL_NAMES: ReadonlySet<string> = new Set(FLOW3D_TOOLS.map((t) => t.name));
