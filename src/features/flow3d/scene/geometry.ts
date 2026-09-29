import { CubicBezierCurve3, Vector3 } from "three";
import type { FlowNode, Vec3 } from "../model";

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

/** Nodes whose card contains the point (x/z, with a small tolerance). */
export function nodeAt(nodes: FlowNode[], point: Vector3, exclude?: string): FlowNode | undefined {
  let best: FlowNode | undefined;
  let bestDistance = Infinity;
  for (const node of nodes) {
    if (node.id === exclude) continue;
    const dx = Math.abs(point.x - node.position[0]);
    const dz = Math.abs(point.z - node.position[2]);
    if (dx > NODE_SIZE.width / 2 + 0.4 || dz > 1.1) continue;
    const distance = dx + dz;
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
