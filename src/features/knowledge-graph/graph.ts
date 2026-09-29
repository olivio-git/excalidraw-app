import type { WorkspaceReference } from "@/core/shell/services/workspace-references";

/**
 * The workspace as a graph: files are nodes, links between them are edges.
 * Laid out in 3D with a small force simulation (deterministic: the same
 * workspace always gets the same shape).
 */

export type GraphNodeKind = "note" | "markdown" | "diagram" | "flow" | "other";

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  /** Links in + out. */
  degree: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** How many links join the two files. */
  weight: number;
}

export interface WorkspaceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const KIND_COLORS: Record<GraphNodeKind, string> = {
  note: "#3b82f6",
  markdown: "#64748b",
  diagram: "#a855f7",
  flow: "#10b981",
  other: "#f59e0b",
};

export function kindOf(path: string): GraphNodeKind {
  if (/\.note$/i.test(path)) return "note";
  if (/\.(md|markdown)$/i.test(path)) return "markdown";
  if (/\.excalidraw$/i.test(path)) return "diagram";
  if (/\.flow3d$/i.test(path)) return "flow";
  return "other";
}

const key = (path: string) => path.replaceAll("\\", "/");

export function buildGraph(references: WorkspaceReference[]): WorkspaceGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const touch = (path: string) => {
    const id = key(path);
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        label: (id.split("/").pop() ?? id).replace(/\.[^.]+$/, ""),
        kind: kindOf(id),
        degree: 0,
      };
      nodes.set(id, node);
    }
    return node;
  };
  for (const ref of references) {
    const from = touch(ref.sourcePath);
    const to = touch(ref.targetPath);
    if (from.id === to.id) continue;
    const edgeKey = `${from.id}\u0000${to.id}`;
    const edge = edges.get(edgeKey);
    if (edge) edge.weight++;
    else {
      edges.set(edgeKey, { from: from.id, to: to.id, weight: 1 });
      from.degree++;
      to.degree++;
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

type Vec3 = [number, number, number];

/** Small seeded generator: the same graph always lands in the same place. */
function random(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/** 3D force layout: nodes repel, links pull, everything drifts to the centre. */
export function layoutGraph(
  graph: WorkspaceGraph,
  options: { iterations?: number; seed?: number } = {}
): Record<string, Vec3> {
  const next = random(options.seed ?? 7);
  const ids = graph.nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const count = ids.length;
  const pos = ids.map(() => [next() - 0.5, next() - 0.5, next() - 0.5].map((v) => v * 10) as Vec3);
  const iterations = options.iterations ?? (count > 300 ? 150 : 300);
  const spring = 3.2;
  for (let step = 0; step < iterations; step++) {
    const cooling = 1 - step / iterations;
    const force = pos.map(() => [0, 0, 0] as Vec3);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const d = [0, 1, 2].map((k) => pos[i][k] - pos[j][k]);
        const dist2 = Math.max(0.05, d[0] ** 2 + d[1] ** 2 + d[2] ** 2);
        const push = 6 / dist2;
        for (let k = 0; k < 3; k++) {
          force[i][k] += d[k] * push;
          force[j][k] -= d[k] * push;
        }
      }
    }
    for (const edge of graph.edges) {
      const a = index.get(edge.from)!;
      const b = index.get(edge.to)!;
      const d = [0, 1, 2].map((k) => pos[b][k] - pos[a][k]);
      const dist = Math.max(0.01, Math.hypot(d[0], d[1], d[2]));
      const pull = ((dist - spring) / dist) * 0.08 * Math.min(3, edge.weight);
      for (let k = 0; k < 3; k++) {
        force[a][k] += d[k] * pull;
        force[b][k] -= d[k] * pull;
      }
    }
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) {
        force[i][k] -= pos[i][k] * 0.01;
        const move = Math.max(-1.5, Math.min(1.5, force[i][k])) * cooling;
        pos[i][k] += move;
      }
    }
  }
  // Centred on the origin (the camera looks there), flattened a little: easier to read than a sphere.
  const centre = [0, 1, 2].map((k) => pos.reduce((sum, p) => sum + p[k], 0) / Math.max(1, count));
  return Object.fromEntries(
    ids.map((id, i) => [
      id,
      [pos[i][0] - centre[0], (pos[i][1] - centre[1]) * 0.6, pos[i][2] - centre[2]] as Vec3,
    ])
  );
}

/** Files directly linked to `id`. */
export function neighbours(graph: WorkspaceGraph, id: string): Set<string> {
  const result = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === id) result.add(edge.to);
    if (edge.to === id) result.add(edge.from);
  }
  return result;
}
