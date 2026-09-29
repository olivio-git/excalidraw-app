import type { FlowDocument, FlowEdge, FlowNode, FlowNodeKind, Vec3 } from "./model";

/**
 * Turns an Excalidraw diagram into a 3D flow: shapes become steps (diamonds
 * are conditions, ellipses are start/end points), arrows become edges (by
 * their bindings, or the nearest shape to each end), and bound texts become
 * labels. The drawing's layout is kept, mapped onto the ground plane.
 */

interface ExcalidrawLike {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  backgroundColor?: string;
  points?: Array<[number, number]>;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  boundElements?: Array<{ id: string; type: string }> | null;
}

const SHAPES = new Set(["rectangle", "diamond", "ellipse"]);
/** Excalidraw pixels per 3D unit. */
const SCALE = 55;
/** How far (px) an unbound arrow end may be from a shape to attach to it. */
const SNAP = 60;

const center = (el: ExcalidrawLike) => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });

function distanceToBox(el: ExcalidrawLike, px: number, py: number): number {
  const dx = Math.max(el.x - px, 0, px - (el.x + el.width));
  const dy = Math.max(el.y - py, 0, py - (el.y + el.height));
  return Math.hypot(dx, dy);
}

export function excalidrawToFlow(data: unknown, name?: string, source?: string): FlowDocument {
  const elements = (
    data && typeof data === "object" && Array.isArray((data as { elements?: unknown }).elements)
      ? (data as { elements: ExcalidrawLike[] }).elements
      : []
  ).filter((el) => el && !el.isDeleted);

  const texts = new Map<string, string>();
  for (const el of elements) {
    if (el.type === "text" && el.containerId) {
      texts.set(el.containerId, (el.originalText ?? el.text ?? "").trim());
    }
  }
  const shapes = elements.filter((el) => SHAPES.has(el.type));
  const shapeIds = new Set(shapes.map((s) => s.id));

  // Free text lying inside a shape without bound text labels it too.
  for (const el of elements) {
    if (el.type !== "text" || el.containerId) continue;
    const c = center(el);
    const host = shapes.find((s) => !texts.has(s.id) && distanceToBox(s, c.x, c.y) === 0);
    if (host) texts.set(host.id, (el.originalText ?? el.text ?? "").trim());
  }

  const nearest = (px: number, py: number): string | null => {
    let best: string | null = null;
    let bestDistance = SNAP;
    for (const shape of shapes) {
      const d = distanceToBox(shape, px, py);
      if (d <= bestDistance) {
        bestDistance = d;
        best = shape.id;
      }
    }
    return best;
  };

  const edges: FlowEdge[] = [];
  for (const el of elements) {
    if (el.type !== "arrow" && el.type !== "line") continue;
    const points = el.points?.length
      ? el.points
      : [
          [0, 0],
          [el.width, el.height],
        ];
    const first = points[0];
    const last = points[points.length - 1];
    const from =
      (el.startBinding && shapeIds.has(el.startBinding.elementId) && el.startBinding.elementId) ||
      nearest(el.x + first[0], el.y + first[1]);
    const to =
      (el.endBinding && shapeIds.has(el.endBinding.elementId) && el.endBinding.elementId) ||
      nearest(el.x + last[0], el.y + last[1]);
    if (!from || !to || from === to) continue;
    if (edges.some((e) => e.from === from && e.to === to)) continue;
    edges.push({ id: `edge-${el.id}`, from, to, label: texts.get(el.id) || undefined });
  }

  const hasIncoming = new Set(edges.map((e) => e.to));
  const hasOutgoing = new Set(edges.map((e) => e.from));
  const kindOf = (shape: ExcalidrawLike): FlowNodeKind => {
    if (shape.type === "diamond") return "condition";
    const connected = hasIncoming.has(shape.id) || hasOutgoing.has(shape.id);
    if (!connected) return "note";
    if (!hasIncoming.has(shape.id)) return "trigger";
    if (!hasOutgoing.has(shape.id)) return "output";
    return "action";
  };

  const minX = Math.min(...shapes.map((s) => center(s).x));
  const maxX = Math.max(...shapes.map((s) => center(s).x));
  const minY = Math.min(...shapes.map((s) => center(s).y));
  const maxY = Math.max(...shapes.map((s) => center(s).y));
  const offsetX = (minX + maxX) / 2;
  const offsetY = (minY + maxY) / 2;

  const nodes: FlowNode[] = shapes.map((shape) => {
    const c = center(shape);
    const kind = kindOf(shape);
    const position: Vec3 = [
      (c.x - offsetX) / SCALE,
      kind === "note" ? 1.6 : 0,
      (c.y - offsetY) / SCALE,
    ];
    const color =
      shape.backgroundColor && shape.backgroundColor !== "transparent"
        ? shape.backgroundColor
        : undefined;
    return {
      id: shape.id,
      kind,
      label: texts.get(shape.id) || (kind === "condition" ? "Condición" : "Paso"),
      position,
      color,
    };
  });

  return {
    type: "qori-flow3d",
    version: 1,
    name,
    source,
    nodes,
    edges,
  };
}
