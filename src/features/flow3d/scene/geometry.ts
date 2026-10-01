import { CubicBezierCurve3, Vector3 } from "three";
import type { EdgeStyle, FlowNode, NodeShape, Vec3 } from "../model";

/** Card size (world units): width (x), height (y), depth (z). */
export const NODE_SIZE = { width: 2.6, height: 1.1, depth: 0.42 } as const;
export const NOTE_SIZE = { width: 2.8, height: 1.3, depth: 0.08 } as const;
/** Distance from the node center to its ports. */
export const PORT_OFFSET = NODE_SIZE.width / 2 + 0.12;

export function outPort(position: Vec3): Vector3 {
  return new Vector3(position[0] + PORT_OFFSET, position[1], position[2]);
}

export function inPort(position: Vec3): Vector3 {
  return new Vector3(position[0] - PORT_OFFSET, position[1], position[2]);
}

/**
 * The curve an edge follows: leaves the source's right port and enters the
 * target's left port horizontally (n8n style), bending through depth and
 * height when the nodes are apart in those axes too.
 */
export function edgeCurve(from: Vec3, to: Vec3): CubicBezierCurve3 {
  const start = outPort(from);
  const end = inPort(to);
  const reach = Math.max(1.2, Math.abs(end.x - start.x) * 0.5, start.distanceTo(end) * 0.25);
  return new CubicBezierCurve3(
    start,
    new Vector3(start.x + reach, start.y, start.z),
    new Vector3(end.x - reach, end.y, end.z),
    end
  );
}

/** Default size [width, height, depth] of each shape (world units). */
export const SHAPE_SIZES: Record<NodeShape, Vec3> = {
  card: [NODE_SIZE.width, NODE_SIZE.height, NODE_SIZE.depth],
  box: [1.3, 1.3, 1.3],
  sphere: [1, 1, 1],
  cylinder: [1, 1.3, 1],
  cone: [1.1, 1.4, 1.1],
  capsule: [0.8, 1.6, 0.8],
  torus: [1.4, 1.4, 0.4],
  diamond: [1.2, 1.4, 1.2],
  gem: [1.2, 1.2, 1.2],
  disc: [1.4, 0.24, 1.4],
  plane: [2.4, 1.6, 0.06],
};

export function nodeShape(node: Pick<FlowNode, "kind" | "style">): NodeShape {
  return node.style?.shape ?? "card";
}

/** World size of a node: its style's size, a scale of the shape's default, or the default. */
export function nodeSize(node: Pick<FlowNode, "kind" | "style">): Vec3 {
  if (node.kind === "note" && !node.style?.shape)
    return [NOTE_SIZE.width, NOTE_SIZE.height, NOTE_SIZE.depth];
  const base = SHAPE_SIZES[nodeShape(node)];
  const size = node.style?.size;
  if (Array.isArray(size)) return size;
  if (typeof size === "number") return base.map((n) => n * size) as Vec3;
  return base;
}

/** Distance from a node's center to its surface along a unit direction (ellipsoid approximation). */
function surfaceDistance(node: Pick<FlowNode, "kind" | "style">, direction: Vector3): number {
  const [w, h, d] = nodeSize(node);
  const inv = Math.hypot(direction.x / (w / 2), direction.y / (h / 2), direction.z / (d / 2));
  return inv > 0 ? 1 / inv : 0;
}

const isCard = (node: Pick<FlowNode, "kind" | "style">) => nodeShape(node) === "card";

/** Where a new connection starts when dragging from a node. */
export function outPortFor(node: FlowNode): Vector3 {
  if (isCard(node)) {
    const scale = nodeSize(node)[0] / NODE_SIZE.width;
    return new Vector3(node.position[0] + PORT_OFFSET * scale, node.position[1], node.position[2]);
  }
  const [w] = nodeSize(node);
  return new Vector3(node.position[0] + w / 2 + 0.12, node.position[1], node.position[2]);
}

/**
 * The curve of an edge between two nodes: classic port-to-port bend between
 * cards, otherwise from surface to surface (straight by default, or a gentle
 * arc with `curve: "smooth"`), so stacks, rings and layers read clearly.
 */
export function edgeCurveBetween(
  from: FlowNode,
  to: FlowNode,
  style?: EdgeStyle
): CubicBezierCurve3 {
  const curve = style?.curve ?? "auto";
  if (curve !== "straight" && isCard(from) && isCard(to) && style?.curve !== "smooth") {
    const fromScale = nodeSize(from)[0] / NODE_SIZE.width;
    const toScale = nodeSize(to)[0] / NODE_SIZE.width;
    const start = new Vector3(
      from.position[0] + PORT_OFFSET * fromScale,
      from.position[1],
      from.position[2]
    );
    const end = new Vector3(to.position[0] - PORT_OFFSET * toScale, to.position[1], to.position[2]);
    const reach = Math.max(1.2, Math.abs(end.x - start.x) * 0.5, start.distanceTo(end) * 0.25);
    return new CubicBezierCurve3(
      start,
      new Vector3(start.x + reach, start.y, start.z),
      new Vector3(end.x - reach, end.y, end.z),
      end
    );
  }
  const a = new Vector3(...from.position);
  const b = new Vector3(...to.position);
  const direction = b.clone().sub(a);
  const length = direction.length() || 1;
  direction.divideScalar(length);
  const start = a.clone().addScaledVector(direction, surfaceDistance(from, direction) + 0.05);
  const end = b.clone().addScaledVector(direction, -(surfaceDistance(to, direction) + 0.05));
  const span = end.clone().sub(start);
  // Smooth: bow upwards (or sideways for vertical edges) by a fraction of the length.
  const bow =
    curve === "smooth"
      ? (Math.abs(direction.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).multiplyScalar(
          span.length() * 0.18
        )
      : new Vector3();
  return new CubicBezierCurve3(
    start,
    start
      .clone()
      .addScaledVector(span, 1 / 3)
      .add(bow),
    start
      .clone()
      .addScaledVector(span, 2 / 3)
      .add(bow),
    end
  );
}

/** Nodes whose card contains the point (x/z, with a small tolerance). */
export function nodeAt(nodes: FlowNode[], point: Vector3, exclude?: string): FlowNode | undefined {
  let best: FlowNode | undefined;
  let bestDistance = Infinity;
  for (const node of nodes) {
    if (node.id === exclude) continue;
    const [w, h, d] = nodeSize(node);
    const dx = Math.abs(point.x - node.position[0]);
    const dy = Math.abs(point.y - node.position[1]);
    const dz = Math.abs(point.z - node.position[2]);
    if (dx > w / 2 + 0.4 || dz > Math.max(1.1, d / 2 + 0.4) || dy > Math.max(1.5, h / 2 + 0.6))
      continue;
    const distance = dx + dz + dy * 0.5;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

/** Smooth start/stop for packets and camera moves. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
