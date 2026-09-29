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

export function applyLayout(doc: FlowDocument): FlowDocument {
  const positions = autoLayout(doc);
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
