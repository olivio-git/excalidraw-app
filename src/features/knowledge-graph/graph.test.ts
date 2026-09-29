import { describe, expect, it } from "vitest";
import { buildGraph, kindOf, layoutGraph, neighbours } from "./graph";

const ref = (sourcePath: string, targetPath: string) => ({
  sourcePath,
  targetPath,
  sourceAnchor: "",
  targetAnchor: "",
  label: "",
});

describe("knowledge graph", () => {
  const graph = buildGraph([
    ref("/ws/a.note", "/ws/b.md"),
    ref("/ws/a.note", "/ws/b.md"),
    ref("/ws/b.md", "/ws/c.excalidraw"),
    ref("/ws/d.flow3d", "/ws/a.note"),
    ref("C:\\ws\\x.md", "C:\\ws\\x.md"),
  ]);

  it("merges repeated links into weighted edges and counts degrees", () => {
    expect(graph.nodes.map((n) => [n.label, n.kind, n.degree])).toEqual([
      ["a", "note", 2],
      ["b", "markdown", 2],
      ["c", "diagram", 1],
      ["d", "flow", 1],
      ["x", "markdown", 0],
    ]);
    expect(graph.edges[0]).toEqual({ from: "/ws/a.note", to: "/ws/b.md", weight: 2 });
    expect(graph.edges).toHaveLength(3);
    expect([...neighbours(graph, "/ws/a.note")].sort()).toEqual(["/ws/b.md", "/ws/d.flow3d"]);
    expect(kindOf("x.png")).toBe("other");
  });

  it("lays out deterministically, with linked files closer than unrelated ones", () => {
    const first = layoutGraph(graph);
    expect(layoutGraph(graph)).toEqual(first);
    const dist = (a: string, b: string) => Math.hypot(...first[a].map((v, i) => v - first[b][i]));
    expect(dist("/ws/a.note", "/ws/b.md")).toBeLessThan(dist("/ws/c.excalidraw", "/ws/d.flow3d"));
    for (const position of Object.values(first)) expect(position.every(Number.isFinite)).toBe(true);
  });
});
