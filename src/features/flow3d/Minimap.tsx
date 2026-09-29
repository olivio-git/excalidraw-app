import { useMemo } from "react";
import { nodeColor } from "./model";
import { useFlowEditor, type FlowEditorStore } from "./editor-store";

const WIDTH = 168;
const HEIGHT = 104;
const PAD = 10;

/**
 * Plan view of the whole flow. Shows where the camera looks, the selection
 * and the last run (failed steps in red); click to move the camera there.
 */
export function Minimap({ store }: { store: FlowEditorStore }) {
  const doc = useFlowEditor(store, (s) => s.doc);
  const target = useFlowEditor(store, (s) => s.cameraTarget);
  const selected = useFlowEditor(store, (s) => s.selectedNodes);
  const run = useFlowEditor(store, (s) => (s.runStale ? null : s.run));

  const frame = useMemo(() => {
    if (doc.nodes.length === 0) return null;
    const xs = doc.nodes.map((n) => n.position[0]);
    const zs = doc.nodes.map((n) => n.position[2]);
    const minX = Math.min(...xs) - 2;
    const maxX = Math.max(...xs) + 2;
    const minZ = Math.min(...zs) - 2;
    const maxZ = Math.max(...zs) + 2;
    const scale = Math.min((WIDTH - PAD * 2) / (maxX - minX), (HEIGHT - PAD * 2) / (maxZ - minZ));
    const offsetX = (WIDTH - (maxX - minX) * scale) / 2;
    const offsetZ = (HEIGHT - (maxZ - minZ) * scale) / 2;
    return {
      toMap: (x: number, z: number): [number, number] => [
        offsetX + (x - minX) * scale,
        offsetZ + (z - minZ) * scale,
      ],
      toWorld: (px: number, py: number): [number, number] => [
        (px - offsetX) / scale + minX,
        (py - offsetZ) / scale + minZ,
      ],
      scale,
    };
  }, [doc.nodes]);

  if (!frame) return null;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const selectedSet = new Set(selected);
  const [tx, tz] = frame.toMap(target[0], target[1]);

  return (
    <svg
      role="img"
      aria-label="Minimapa del flujo (clic para mover la cámara)"
      data-flow3d-minimap
      width={WIDTH}
      height={HEIGHT}
      className="pointer-events-auto cursor-pointer rounded-lg border border-border bg-popover/90 shadow-md backdrop-blur"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const [x, z] = frame.toWorld(event.clientX - rect.left, event.clientY - rect.top);
        store.getState().focusPoint([x, 0, z]);
      }}
    >
      {doc.edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        const [x1, y1] = frame.toMap(from.position[0], from.position[2]);
        const [x2, y2] = frame.toMap(to.position[0], to.position[2]);
        return (
          <line
            key={edge.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            className="text-muted-foreground/50"
            strokeWidth={1}
          />
        );
      })}
      {doc.nodes.map((node) => {
        const [x, y] = frame.toMap(node.position[0], node.position[2]);
        const step = run?.steps[node.id];
        const w = Math.max(6, 2.6 * frame.scale);
        const h = Math.max(3, 1.1 * frame.scale * 0.6);
        return (
          <rect
            key={node.id}
            x={x - w / 2}
            y={y - h / 2}
            width={w}
            height={h}
            rx={1.5}
            fill={step?.status === "error" ? "#ef4444" : nodeColor(node)}
            opacity={node.kind === "note" ? 0.5 : step?.status === "skipped" ? 0.35 : 1}
            stroke={selectedSet.has(node.id) ? "currentColor" : "none"}
            className="text-foreground"
            strokeWidth={1.5}
          />
        );
      })}
      <circle
        cx={tx}
        cy={tz}
        r={4}
        fill="none"
        stroke="currentColor"
        className="text-primary"
        strokeWidth={1.5}
      />
      <circle cx={tx} cy={tz} r={1.2} fill="currentColor" className="text-primary" />
    </svg>
  );
}
