import { NODE_KINDS, nodeDuration, type FlowDocument } from "./model";

/**
 * Playback of a flow as a deterministic timeline: when each step runs and
 * when data travels along each edge. Precomputed once per document so the
 * renderer only samples it (no simulation work per frame) and seeking is free.
 */

export interface TimelineSpan {
  id: string;
  start: number;
  end: number;
}

export interface Timeline {
  nodes: TimelineSpan[];
  edges: TimelineSpan[];
  /** Node ids in the order they start. */
  order: string[];
  duration: number;
}

export interface TimelineOptions {
  /** Seconds a packet takes to travel an edge. */
  edgeDuration?: number;
}

export const DEFAULT_EDGE_DURATION = 0.9;

/**
 * Runs from every start node (triggers, or nodes nothing points to). A node
 * runs once, when the first packet reaches it; condition nodes only follow
 * their chosen branch; notes never run. Cycles stop at visited nodes.
 */
export function buildTimeline(doc: FlowDocument, options: TimelineOptions = {}): Timeline {
  const edgeDuration = options.edgeDuration ?? DEFAULT_EDGE_DURATION;
  const nodes = new Map(doc.nodes.filter((n) => NODE_KINDS[n.kind].executes).map((n) => [n.id, n]));
  const outgoing = new Map<string, typeof doc.edges>();
  const incoming = new Set<string>();
  for (const edge of doc.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.add(edge.to);
  }
  const triggers = [...nodes.values()].filter((n) => n.kind === "trigger");
  const starts =
    triggers.length > 0 ? triggers : [...nodes.values()].filter((n) => !incoming.has(n.id));

  // Earliest-arrival search (Dijkstra over time); queues are tiny, a sorted array is enough.
  const queue: Array<{ id: string; at: number }> = starts.map((n) => ({ id: n.id, at: 0 }));
  const visited = new Set<string>();
  const nodeSpans: TimelineSpan[] = [];
  const edgeSpans: TimelineSpan[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => a.at - b.at);
    const { id, at } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.get(id)!;
    const end = at + nodeDuration(node);
    nodeSpans.push({ id, start: at, end });
    let next = outgoing.get(id) ?? [];
    if (node.kind === "condition" && next.length > 1) {
      next = [next.find((e) => e.id === node.branch) ?? next[0]];
    }
    for (const edge of next) {
      edgeSpans.push({ id: edge.id, start: end, end: end + edgeDuration });
      if (!visited.has(edge.to)) queue.push({ id: edge.to, at: end + edgeDuration });
    }
  }
  const duration = Math.max(0, ...nodeSpans.map((s) => s.end), ...edgeSpans.map((s) => s.end));
  return { nodes: nodeSpans, edges: edgeSpans, order: nodeSpans.map((s) => s.id), duration };
}

export type NodePhase = "idle" | "active" | "done";

export interface NodeSample {
  phase: NodePhase;
  /** 0..1 while active. */
  progress: number;
}

/** State of one node at `time`. */
export function sampleNode(span: TimelineSpan | undefined, time: number): NodeSample {
  // At the very start nothing has run yet (a stopped flow shows everything idle).
  if (!span || time < span.start || time === 0) return { phase: "idle", progress: 0 };
  if (time >= span.end) return { phase: "done", progress: 1 };
  // A step of a real run that hasn't finished yet: loop the pulse every second.
  if (!Number.isFinite(span.end)) return { phase: "active", progress: (time - span.start) % 1 };
  const length = span.end - span.start;
  return { phase: "active", progress: length > 0 ? (time - span.start) / length : 1 };
}

/** Packet position along an edge at `time`: null before/after travelling. */
export function sampleEdge(span: TimelineSpan | undefined, time: number): number | null {
  if (!span || time < span.start || time > span.end) return null;
  const length = span.end - span.start;
  return length > 0 ? (time - span.start) / length : 1;
}

/** The node the camera should follow at `time`: the latest one that started. */
export function currentNode(timeline: Timeline, time: number): string | null {
  let current: string | null = null;
  let latest = -Infinity;
  for (const span of timeline.nodes) {
    if (span.start <= time && span.start >= latest) {
      latest = span.start;
      current = span.id;
    }
  }
  return current;
}

export function indexSpans(spans: TimelineSpan[]): Map<string, TimelineSpan> {
  return new Map(spans.map((span) => [span.id, span]));
}
