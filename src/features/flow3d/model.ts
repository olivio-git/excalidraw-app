/**
 * Flow 3D documents (`.flow3d`): nodes placed in 3D space joined by directed
 * edges, like an n8n workflow you can orbit around and play back.
 */

export type Vec3 = [number, number, number];

export type FlowNodeKind =
  | "trigger"
  | "action"
  | "condition"
  | "transform"
  | "ai"
  | "output"
  | "note";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  description?: string;
  position: Vec3;
  /** CSS color overriding the kind's color. */
  color?: string;
  /** Seconds the step takes during playback (default per kind). */
  duration?: number;
  /** Linked file (workspace-relative reference): note, markdown, diagram or flow. */
  link?: string;
  /** Condition nodes: the outgoing edge taken during playback (default: the first). */
  branch?: string;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface FlowDocument {
  type: "qori-flow3d";
  version: 1;
  name?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Excalidraw file this flow was converted from, for re-syncing. */
  source?: string;
  settings?: { speed?: number };
}

export interface NodeKindInfo {
  label: string;
  color: string;
  /** Default playback seconds. */
  duration: number;
  /** Whether playback runs through it (notes are annotations). */
  executes: boolean;
}

export const NODE_KINDS: Record<FlowNodeKind, NodeKindInfo> = {
  trigger: { label: "Disparador", color: "#10b981", duration: 0.6, executes: true },
  action: { label: "Acción", color: "#0ea5e9", duration: 1, executes: true },
  condition: { label: "Condición", color: "#f59e0b", duration: 0.7, executes: true },
  transform: { label: "Transformación", color: "#8b5cf6", duration: 0.8, executes: true },
  ai: { label: "IA", color: "#ec4899", duration: 1.4, executes: true },
  output: { label: "Salida", color: "#f43f5e", duration: 0.8, executes: true },
  note: { label: "Nota", color: "#94a3b8", duration: 0, executes: false },
};

export const NODE_KIND_ORDER: FlowNodeKind[] = [
  "trigger",
  "action",
  "condition",
  "transform",
  "ai",
  "output",
  "note",
];

export function nodeColor(node: Pick<FlowNode, "kind" | "color">): string {
  return node.color || NODE_KINDS[node.kind].color;
}

export function nodeDuration(node: Pick<FlowNode, "kind" | "duration">): number {
  const value = node.duration ?? NODE_KINDS[node.kind].duration;
  return Number.isFinite(value) && value >= 0 ? value : NODE_KINDS[node.kind].duration;
}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function emptyFlow(name?: string): FlowDocument {
  return { type: "qori-flow3d", version: 1, name, nodes: [], edges: [] };
}

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => typeof n === "number" && Number.isFinite(n));

/**
 * Parse a `.flow3d` file. Unknown kinds become actions, broken edges and
 * duplicated ids are dropped, so a hand-edited file still opens.
 */
export function parseFlow(text: string): FlowDocument {
  if (!text.trim()) return emptyFlow();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`El archivo no es un flujo válido: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("El archivo no es un flujo válido: se esperaba un objeto.");
  }
  const data = raw as Record<string, unknown>;
  const nodes: FlowNode[] = [];
  const ids = new Set<string>();
  for (const item of Array.isArray(data.nodes) ? data.nodes : []) {
    if (!item || typeof item !== "object") continue;
    const node = item as Record<string, unknown>;
    const id = typeof node.id === "string" && node.id ? node.id : newId("node");
    if (ids.has(id)) continue;
    ids.add(id);
    const kind = (
      typeof node.kind === "string" && node.kind in NODE_KINDS ? node.kind : "action"
    ) as FlowNodeKind;
    nodes.push({
      id,
      kind,
      label: typeof node.label === "string" ? node.label : NODE_KINDS[kind].label,
      description: typeof node.description === "string" ? node.description : undefined,
      position: isVec3(node.position) ? node.position : [nodes.length * 4, 0, 0],
      color: typeof node.color === "string" ? node.color : undefined,
      duration: typeof node.duration === "number" ? node.duration : undefined,
      link: typeof node.link === "string" && node.link ? node.link : undefined,
      branch: typeof node.branch === "string" ? node.branch : undefined,
    });
  }
  const edges: FlowEdge[] = [];
  const edgeIds = new Set<string>();
  for (const item of Array.isArray(data.edges) ? data.edges : []) {
    if (!item || typeof item !== "object") continue;
    const edge = item as Record<string, unknown>;
    if (typeof edge.from !== "string" || typeof edge.to !== "string") continue;
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) continue;
    const id =
      typeof edge.id === "string" && edge.id && !edgeIds.has(edge.id) ? edge.id : newId("edge");
    edgeIds.add(id);
    edges.push({
      id,
      from: edge.from,
      to: edge.to,
      label: typeof edge.label === "string" && edge.label ? edge.label : undefined,
    });
  }
  const settings =
    data.settings && typeof data.settings === "object"
      ? { speed: Number((data.settings as Record<string, unknown>).speed) || undefined }
      : undefined;
  return {
    type: "qori-flow3d",
    version: 1,
    name: typeof data.name === "string" ? data.name : undefined,
    nodes,
    edges,
    source: typeof data.source === "string" ? data.source : undefined,
    settings,
  };
}

export function serializeFlow(doc: FlowDocument): string {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const clean: FlowDocument = {
    ...doc,
    nodes: doc.nodes.map((node) => ({
      ...node,
      position: node.position.map(round) as Vec3,
    })),
  };
  return `${JSON.stringify(clean, null, 2)}\n`;
}

/** Starter flow for new files: shows every kind of step and a branch. */
export function sampleFlow(name = "Nuevo flujo"): FlowDocument {
  const node = (
    id: string,
    kind: FlowNodeKind,
    label: string,
    x: number,
    z: number,
    description?: string
  ): FlowNode => ({
    id,
    kind,
    label,
    description,
    position: [x, 0, z],
  });
  return {
    type: "qori-flow3d",
    version: 1,
    name,
    nodes: [
      node("webhook", "trigger", "Webhook", 0, 0, "Llega un pedido nuevo"),
      node("validate", "condition", "¿Pedido válido?", 4.5, 0, "Revisa stock y datos"),
      node("enrich", "ai", "Clasificar con IA", 9, -1.6, "Prioridad y categoría"),
      node("format", "transform", "Formatear", 13.5, -1.6),
      node("notify", "output", "Avisar al equipo", 18, -1.6, "Mensaje en el canal"),
      node("reject", "action", "Responder error", 9, 2.2, "Devuelve el motivo"),
    ],
    edges: [
      { id: "e1", from: "webhook", to: "validate" },
      { id: "e2", from: "validate", to: "enrich", label: "sí" },
      { id: "e3", from: "validate", to: "reject", label: "no" },
      { id: "e4", from: "enrich", to: "format" },
      { id: "e5", from: "format", to: "notify" },
    ],
  };
}
