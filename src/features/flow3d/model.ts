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
  /** What the step does when the flow is executed (not simulated). */
  config?: StepConfig;
  /** Group (subflow) the node belongs to. */
  group?: string;
}

export type ConditionOperator =
  | "=="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "contains"
  | "exists"
  | "truthy";

/**
 * Executable step. Text fields accept `{{input.x}}` and `{{steps.<id>.output.x}}`
 * placeholders filled with the data flowing through the run.
 */
/** Options every executable step accepts. */
export interface StepCommon {
  /** Run the step once per element of this list (path in the input, e.g. `body.items`). */
  forEach?: string;
  /** Extra attempts when the step fails. */
  retries?: number;
  /** Seconds between attempts. */
  retryDelay?: number;
}

export type StepConfig = StepCommon &
  (
    | { type: "manual"; payload?: string }
    /** Trigger: runs by itself every `every` minutes, or daily at `at` (HH:MM). */
    | { type: "schedule"; every?: number; at?: string }
    /** Trigger: runs when a file or folder (relative to the flow) changes. */
    | { type: "fileWatch"; path?: string }
    | {
        type: "http";
        method?: string;
        url?: string;
        /** One `Name: value` per line. */
        headers?: string;
        body?: string;
        allowErrors?: boolean;
      }
    | { type: "command"; command?: string; cwd?: string; timeout?: number; allowErrors?: boolean }
    | { type: "appCommand"; command?: string }
    | { type: "ai"; prompt?: string; system?: string; json?: boolean }
    | { type: "writeNote"; path?: string; content?: string; append?: boolean }
    | { type: "template"; template?: string }
    | { type: "condition"; field?: string; operator?: ConditionOperator; value?: string }
  );

/** Color of groups that don't set one. */
export const DEFAULT_GROUP_COLOR = "#6366f1";

export const STEP_CONFIG_TYPES: StepConfig["type"][] = [
  "manual",
  "schedule",
  "fileWatch",
  "http",
  "command",
  "appCommand",
  "ai",
  "writeNote",
  "template",
  "condition",
];

/** A collapsible group of steps (subflow). Collapsed groups show as one block. */
export interface FlowGroup {
  id: string;
  label: string;
  color?: string;
  collapsed?: boolean;
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
  groups?: FlowGroup[];
  /** Excalidraw file this flow was converted from, for re-syncing. */
  source?: string;
  settings?: {
    speed?: number;
    /** Scheduled and file triggers run the flow by themselves (the user opted in). */
    automation?: boolean;
  };
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

function parseConfig(value: unknown): StepConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!STEP_CONFIG_TYPES.includes(raw.type as StepConfig["type"])) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(raw)) {
    if (typeof item === "string" || typeof item === "boolean") clean[key] = item;
    else if (typeof item === "number" && Number.isFinite(item)) clean[key] = item;
  }
  return clean as unknown as StepConfig;
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
      config: parseConfig(node.config),
      group: typeof node.group === "string" && node.group ? node.group : undefined,
    });
  }
  const groups: FlowGroup[] = [];
  for (const item of Array.isArray(data.groups) ? data.groups : []) {
    if (!item || typeof item !== "object") continue;
    const group = item as Record<string, unknown>;
    if (typeof group.id !== "string" || !group.id || groups.some((g) => g.id === group.id))
      continue;
    groups.push({
      id: group.id,
      label: typeof group.label === "string" ? group.label : "Grupo",
      color: typeof group.color === "string" ? group.color : undefined,
      collapsed: group.collapsed === true ? true : undefined,
    });
  }
  const groupIds = new Set(groups.map((g) => g.id));
  for (const node of nodes) if (node.group && !groupIds.has(node.group)) node.group = undefined;
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
      ? {
          speed: Number((data.settings as Record<string, unknown>).speed) || undefined,
          automation: (data.settings as Record<string, unknown>).automation === true || undefined,
        }
      : undefined;
  return {
    type: "qori-flow3d",
    version: 1,
    name: typeof data.name === "string" ? data.name : undefined,
    nodes,
    edges,
    groups: groups.length > 0 ? groups : undefined,
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

const slug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * The step a link points to (`pedidos.flow3d#validar`): by id, or by name
 * ignoring case, accents and punctuation.
 */
export function findStep(doc: FlowDocument, anchor: string): FlowNode | undefined {
  const wanted = anchor.trim();
  if (!wanted) return undefined;
  return (
    doc.nodes.find((n) => n.id === wanted) ??
    doc.nodes.find((n) => slug(n.label) === slug(wanted) && slug(wanted) !== "")
  );
}
