import { describe, expect, it } from "vitest";
import { applyLayout, gridLayout, layersLayout, radialLayout } from "./layout";
import {
  parseEdgeStyle,
  parseFlow,
  parseNodeStyle,
  type FlowDocument,
  type FlowNode,
} from "./model";
import { flowFromAI } from "./ai-flow";
import { edgeCurveBetween, nodeSize } from "./scene/geometry";

const node = (id: string, extra: Partial<FlowNode> = {}): FlowNode => ({
  id,
  kind: "element",
  label: id,
  position: [0, 0, 0],
  ...extra,
});
const doc = (nodes: FlowNode[], edges: FlowDocument["edges"] = []): FlowDocument => ({
  type: "qori-flow3d",
  version: 1,
  nodes,
  edges,
});

describe("3D layouts", () => {
  it("layers: columns along x, each a vertical stack centered on y = 0", () => {
    const positions = layersLayout(
      doc([node("a", { layer: 0 }), node("b", { layer: 0 }), node("c", { layer: 1 })]),
      { gap: 4, spacing: 2 }
    );
    expect(positions.a).toEqual([0, 1, 0]);
    expect(positions.b).toEqual([0, -1, 0]);
    expect(positions.c).toEqual([4, 0, 0]);
  });

  it("layers: without layer numbers, follows the edges", () => {
    const positions = layersLayout(
      doc(
        [node("a"), node("b"), node("c")],
        [
          { id: "1", from: "a", to: "b" },
          { id: "2", from: "b", to: "c" },
        ]
      )
    );
    expect(positions.a[0]).toBeLessThan(positions.b[0]);
    expect(positions.b[0]).toBeLessThan(positions.c[0]);
  });

  it("grid: rows of N on the xy plane, layers pushed back in z", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => node(id));
    nodes.push(node("e", { layer: 1 }));
    const positions = gridLayout(doc(nodes), { columns: 2, gap: 2 });
    expect(positions.a).toEqual([0, -0, -0]);
    expect(positions.b).toEqual([2, -0, -0]);
    expect(positions.c).toEqual([0, -2, -0]);
    expect(positions.e[2]).toBeLessThan(0);
  });

  it("radial: a hub in the middle and a ring around it", () => {
    const positions = radialLayout(doc([node("hub"), node("a"), node("b"), node("c")]), {
      center: "hub",
      radius: 3,
    });
    expect(positions.hub).toEqual([0, 0, 0]);
    for (const id of ["a", "b", "c"])
      expect(Math.hypot(positions[id][0], positions[id][2])).toBeCloseTo(3);
  });

  it("manual keeps positions", () => {
    const laid = applyLayout(doc([node("a", { position: [1, 2, 3] })]), "manual");
    expect(laid.nodes[0].position).toEqual([1, 2, 3]);
  });
});

describe("agent output", () => {
  it("keeps the positions the model gives (towers, matrices…)", () => {
    const flow = flowFromAI({
      nodes: [
        { id: "a", kind: "element", label: "A", position: [0, 0, 0] },
        { id: "b", kind: "element", label: "B", position: [0, 1.5, -2] },
      ],
      edges: [],
    });
    expect(flow.nodes.map((n) => n.position)).toEqual([
      [0, 0, 0],
      [0, 1.5, -2],
    ]);
  });

  it("lays out when positions are missing, or with an explicit layout", () => {
    const auto = flowFromAI({
      nodes: [
        { id: "a", kind: "trigger", label: "A" },
        { id: "b", kind: "action", label: "B" },
      ],
      edges: [{ id: "e", from: "a", to: "b" }],
    });
    expect(auto.nodes[1].position[0]).toBeGreaterThan(auto.nodes[0].position[0]);
    const layered = flowFromAI(
      {
        nodes: [
          { id: "a", kind: "element", layer: 0, position: [9, 9, 9] },
          { id: "b", kind: "element", layer: 0, position: [9, 9, 9] },
        ],
        edges: [],
      },
      undefined,
      "layers"
    );
    expect(layered.nodes[0].position[1]).not.toBe(layered.nodes[1].position[1]);
  });
});

describe("styles", () => {
  it("keeps valid style fields and drops the rest", () => {
    expect(
      parseNodeStyle({
        shape: "sphere",
        size: [1, 2, 3],
        icon: "🧠🧠🧠🧠",
        opacity: 5,
        label: "nowhere",
        glow: true,
      })
    ).toEqual({ shape: "sphere", size: [1, 2, 3], icon: "🧠🧠🧠", opacity: 1, glow: true });
    expect(parseNodeStyle({ shape: "blob" })).toBeUndefined();
    expect(parseEdgeStyle({ width: 99, curve: "straight", arrow: false })).toEqual({
      width: 8,
      curve: "straight",
      arrow: false,
    });
  });

  it("round-trips through the file format", () => {
    const flow = parseFlow(
      JSON.stringify({
        nodes: [
          {
            id: "a",
            kind: "element",
            position: [0, 0, 0],
            layer: 2,
            style: { shape: "box", size: 2 },
          },
        ],
        edges: [],
      })
    );
    expect(flow.nodes[0]).toMatchObject({ layer: 2, style: { shape: "box", size: 2 } });
    expect(nodeSize(flow.nodes[0])).toEqual([2.6, 2.6, 2.6]);
  });

  it("connects shapes surface to surface with a straight line", () => {
    const a = node("a", { style: { shape: "sphere" }, position: [0, 0, 0] });
    const b = node("b", { style: { shape: "sphere" }, position: [0, 4, 0] });
    const curve = edgeCurveBetween(a, b);
    expect(curve.getPoint(0).y).toBeCloseTo(0.55);
    expect(curve.getPoint(1).y).toBeCloseTo(3.45);
    expect(curve.getPoint(0.5).x).toBeCloseTo(0);
  });
});
