import { NODE_KINDS, type FlowDocument, type Vec3 } from "./model";

export const COLUMN_GAP = 4.5;
export const ROW_GAP = 2.8;

/**
 * Layered layout (left to right, like n8n): each node goes one column after
 * its furthest predecessor; nodes in a column are ordered by the average row
 * of their predecessors to reduce crossings and spread along the depth axis.
 * Notes float above the node they annotate (or keep their place).
 */
export function autoLayout(doc: FlowDocument): Record<string, Vec3> {
  const nodes = doc.nodes.filter((n) => NODE_KINDS[n.kind].executes);
  const ids = new Set(nodes.map((n) => n.id));
  const preds = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const succs = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const edge of doc.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    succs.get(edge.from)!.push(edge.to);
    preds.get(edge.to)!.push(edge.from);
  }

  // Drop back edges (DFS) so cycles don't loop the ranking.
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const next of succs.get(id)!) {
      if (state.get(next) === 1) back.add(`${id}>${next}`);
      else if (!state.has(next)) visit(next);
    }
    state.set(id, 2);
  };
  const roots = nodes.filter((n) => preds.get(n.id)!.length === 0 || n.kind === "trigger");
  for (const node of [...roots, ...nodes]) if (!state.has(node.id)) visit(node.id);

  const rank = new Map<string, number>();
  const rankOf = (id: string, stack = new Set<string>()): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    const incoming = preds.get(id)!.filter((p) => !back.has(`${p}>${id}`));
    const value =
      incoming.length === 0 ? 0 : Math.max(...incoming.map((p) => rankOf(p, stack) + 1));
    rank.set(id, value);
    return value;
  };
  for (const node of nodes) rankOf(node.id);

  const columns: string[][] = [];
  for (const node of nodes) {
    const r = rank.get(node.id)!;
    (columns[r] ??= []).push(node.id);
  }
  const row = new Map<string, number>();
  columns.forEach((column, r) => {
    if (r > 0) {
      const score = (id: string) => {
        const rows = preds
          .get(id)!
          .map((p) => row.get(p))
          .filter((v): v is number => v !== undefined);
        return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0;
      };
      column.sort((a, b) => score(a) - score(b));
    }
    column.forEach((id, i) => row.set(id, i - (column.length - 1) / 2));
  });

  const positions: Record<string, Vec3> = {};
  for (const node of nodes) {
    positions[node.id] = [rank.get(node.id)! * COLUMN_GAP, 0, row.get(node.id)! * ROW_GAP];
  }
  for (const note of doc.nodes.filter((n) => !NODE_KINDS[n.kind].executes)) {
    const target = doc.edges.find((e) => e.from === note.id || e.to === note.id);
    const anchor = target && positions[target.from === note.id ? target.to : target.from];
    positions[note.id] = anchor ? [anchor[0], 2.2, anchor[2]] : note.position;
  }
  return positions;
}

/** How nodes are placed. `manual` keeps the positions they already have. */
export type FlowLayout = "auto" | "layers" | "grid" | "radial" | "manual";

export const FLOW_LAYOUTS: FlowLayout[] = ["auto", "layers", "grid", "radial", "manual"];

export interface LayoutOptions {
  /** Distance between layers / columns (x). */
  gap?: number;
  /** Distance between nodes inside a layer, or between grid rows (y). */
  spacing?: number;
  /** grid: nodes per row. */
  columns?: number;
  /** radial: circle radius; `center`: node id placed in the middle. */
  radius?: number;
  center?: string;
  /** radial: the circle lies flat (xz, default) or stands up (xy). */
  plane?: "xz" | "xy";
}

/** Layer of each node: its `layer` field, else its rank along the edges (sources first). */
function layerIndex(doc: FlowDocument): Map<string, number> {
  const result = new Map<string, number>();
  const explicit = doc.nodes.filter((n) => n.layer !== undefined);
  if (explicit.length === doc.nodes.length) {
    for (const node of doc.nodes) result.set(node.id, node.layer!);
    return result;
  }
  const preds = new Map<string, string[]>(doc.nodes.map((n) => [n.id, []]));
  for (const edge of doc.edges) preds.get(edge.to)?.push(edge.from);
  const rankOf = (id: string, stack = new Set<string>()): number => {
    if (result.has(id)) return result.get(id)!;
    const node = doc.nodes.find((n) => n.id === id);
    if (node?.layer !== undefined) {
      result.set(id, node.layer);
      return node.layer;
    }
    if (stack.has(id)) return 0;
    stack.add(id);
    const incoming = preds.get(id) ?? [];
    const value = incoming.length ? Math.max(...incoming.map((p) => rankOf(p, stack) + 1)) : 0;
    result.set(id, value);
    return value;
  };
  for (const node of doc.nodes) rankOf(node.id);
  return result;
}

/**
 * Layers side by side along x, each one a vertical column centered on y = 0:
 * neural networks (inputs, hidden layers, outputs), pipelines, architectures.
 */
export function layersLayout(doc: FlowDocument, options: LayoutOptions = {}): Record<string, Vec3> {
  const gap = options.gap ?? 4;
  const spacing = options.spacing ?? 1.6;
  const layers = layerIndex(doc);
  const columns = new Map<number, string[]>();
  for (const node of doc.nodes) {
    const layer = layers.get(node.id) ?? 0;
    columns.set(layer, [...(columns.get(layer) ?? []), node.id]);
  }
  const order = [...columns.keys()].sort((a, b) => a - b);
  const positions: Record<string, Vec3> = {};
  order.forEach((layer, index) => {
    const ids = columns.get(layer)!;
    ids.forEach((id, i) => {
      positions[id] = [index * gap, ((ids.length - 1) / 2 - i) * spacing, 0];
    });
  });
  return positions;
}

/**
 * A matrix: rows of `columns` nodes on the xy plane (first row on top); nodes
 * with a `layer` go back in depth (z), so layers of a grid stack like slices.
 */
export function gridLayout(doc: FlowDocument, options: LayoutOptions = {}): Record<string, Vec3> {
  const gap = options.gap ?? 2;
  const spacing = options.spacing ?? gap;
  const columns = Math.max(
    1,
    Math.round(options.columns ?? Math.ceil(Math.sqrt(doc.nodes.length)))
  );
  const positions: Record<string, Vec3> = {};
  const perLayer = new Map<number, number>();
  for (const node of doc.nodes) {
    const layer = node.layer ?? 0;
    const index = perLayer.get(layer) ?? 0;
    perLayer.set(layer, index + 1);
    positions[node.id] = [
      (index % columns) * gap,
      -Math.floor(index / columns) * spacing,
      -layer * gap * 1.5,
    ];
  }
  return positions;
}

/** Nodes on a circle (hub in the middle if `center` names one). */
export function radialLayout(doc: FlowDocument, options: LayoutOptions = {}): Record<string, Vec3> {
  const ring = doc.nodes.filter((n) => n.id !== options.center);
  const radius = options.radius ?? Math.max(3, (ring.length * 2.2) / (2 * Math.PI));
  const positions: Record<string, Vec3> = {};
  if (options.center && doc.nodes.some((n) => n.id === options.center))
    positions[options.center] = [0, 0, 0];
  ring.forEach((node, i) => {
    const angle = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
    const a = Math.cos(angle) * radius;
    const b = Math.sin(angle) * radius;
    positions[node.id] = options.plane === "xy" ? [a, -b, 0] : [a, 0, b];
  });
  return positions;
}

export function layoutPositions(
  doc: FlowDocument,
  layout: FlowLayout = "auto",
  options: LayoutOptions = {}
): Record<string, Vec3> {
  switch (layout) {
    case "layers":
      return layersLayout(doc, options);
    case "grid":
      return gridLayout(doc, options);
    case "radial":
      return radialLayout(doc, options);
    case "manual":
      return Object.fromEntries(doc.nodes.map((n) => [n.id, n.position]));
    default:
      return autoLayout(doc);
  }
}

export function applyLayout(
  doc: FlowDocument,
  layout: FlowLayout = "auto",
  options: LayoutOptions = {}
): FlowDocument {
  const positions = layoutPositions(doc, layout, options);
  return {
    ...doc,
    nodes: doc.nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
  };
}

/** Axis-aligned bounds of the nodes (for fitting the camera). */
export function flowBounds(doc: FlowDocument): { min: Vec3; max: Vec3 } {
  if (doc.nodes.length === 0) return { min: [-3, -1, -3], max: [3, 1, 3] };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const node of doc.nodes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], node.position[i]);
      max[i] = Math.max(max[i], node.position[i]);
    }
  }
  return { min, max };
}
