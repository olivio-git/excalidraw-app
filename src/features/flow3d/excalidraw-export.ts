import { NODE_KINDS, nodeColor, type FlowDocument, type FlowNode } from "./model";

/**
 * Flow → Excalidraw diagram (the way back of `excalidrawToFlow`). Steps keep
 * their ids as shape ids and arrows are bound to them, so converting the
 * drawing again (the flow's re-sync) matches every step and keeps what was
 * edited in 3D. Positions use the same scale as the import.
 */

const SCALE = 55;
const WIDTH = 170;
const HEIGHT = 72;
const MARGIN = 80;

type Element = Record<string, unknown>;

let seedCounter = 1;
const seed = () => {
  seedCounter = (seedCounter * 16807) % 2147483647;
  return seedCounter;
};

function base(
  id: string,
  type: string,
  x: number,
  y: number,
  width: number,
  height: number
): Element {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: seed(),
    version: 1,
    versionNonce: seed(),
    isDeleted: false,
    boundElements: [] as Array<{ id: string; type: string }>,
    updated: 1,
    link: null,
    locked: false,
  };
}

function text(
  id: string,
  value: string,
  container: Element | null,
  x: number,
  y: number,
  size = 18
): Element {
  const lines = value.split("\n");
  const width = Math.max(...lines.map((l) => l.length)) * size * 0.55;
  const height = lines.length * size * 1.25;
  return {
    ...base(id, "text", x - width / 2, y - height / 2, width, height),
    text: value,
    originalText: value,
    fontSize: size,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: container ? container.id : null,
    autoResize: true,
    lineHeight: 1.25,
  };
}

const shapeType = (node: FlowNode) =>
  node.kind === "trigger" ? "ellipse" : node.kind === "condition" ? "diamond" : "rectangle";

export function flowToExcalidraw(doc: FlowDocument): Record<string, unknown> {
  seedCounter = 1;
  const minX = Math.min(0, ...doc.nodes.map((n) => n.position[0]));
  const minZ = Math.min(0, ...doc.nodes.map((n) => n.position[2]));
  const center = (node: FlowNode): [number, number] => [
    MARGIN + WIDTH / 2 + (node.position[0] - minX) * SCALE,
    MARGIN + HEIGHT / 2 + (node.position[2] - minZ) * SCALE,
  ];
  const elements: Element[] = [];
  const shapes = new Map<string, Element>();

  for (const node of doc.nodes) {
    const [cx, cy] = center(node);
    const isNote = node.kind === "note";
    const width = shapeType(node) === "diamond" ? WIDTH + 30 : WIDTH;
    const height = shapeType(node) === "diamond" ? HEIGHT + 30 : HEIGHT;
    const shape: Element = {
      ...base(node.id, shapeType(node), cx - width / 2, cy - height / 2, width, height),
      strokeColor: isNote ? "#868e96" : nodeColor(node),
      backgroundColor: node.color ?? "transparent",
      strokeStyle: isNote ? "dashed" : "solid",
      roundness: shapeType(node) === "rectangle" ? { type: 3 } : { type: 2 },
    };
    const label = node.label || NODE_KINDS[node.kind].label;
    const content = isNote && node.description ? `${label}\n${node.description}` : label;
    const caption = text(`${node.id}-label`, content, shape, cx, cy, isNote ? 16 : 18);
    (shape.boundElements as Array<{ id: string; type: string }>).push({
      id: caption.id as string,
      type: "text",
    });
    shapes.set(node.id, shape);
    elements.push(shape, caption);
  }

  for (const edge of doc.edges) {
    const from = shapes.get(edge.from);
    const to = shapes.get(edge.to);
    if (!from || !to) continue;
    const start: [number, number] = [
      (from.x as number) + (from.width as number),
      (from.y as number) + (from.height as number) / 2,
    ];
    const end: [number, number] = [to.x as number, (to.y as number) + (to.height as number) / 2];
    const arrow: Element = {
      ...base(
        edge.id,
        "arrow",
        start[0],
        start[1],
        Math.abs(end[0] - start[0]),
        Math.abs(end[1] - start[1])
      ),
      strokeColor: from.strokeColor,
      roundness: { type: 2 },
      points: [
        [0, 0],
        [end[0] - start[0], end[1] - start[1]],
      ],
      lastCommittedPoint: null,
      startBinding: { elementId: from.id, focus: 0, gap: 6 },
      endBinding: { elementId: to.id, focus: 0, gap: 6 },
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
    };
    (from.boundElements as Array<{ id: string; type: string }>).push({
      id: edge.id,
      type: "arrow",
    });
    (to.boundElements as Array<{ id: string; type: string }>).push({ id: edge.id, type: "arrow" });
    elements.push(arrow);
    if (edge.label) {
      const caption = text(
        `${edge.id}-label`,
        edge.label,
        arrow,
        (start[0] + end[0]) / 2,
        (start[1] + end[1]) / 2,
        16
      );
      (arrow.boundElements as Array<{ id: string; type: string }>).push({
        id: caption.id as string,
        type: "text",
      });
      elements.push(caption);
    }
  }

  return {
    type: "excalidraw",
    version: 2,
    source: "qori-flow3d",
    elements,
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    files: {},
  };
}
