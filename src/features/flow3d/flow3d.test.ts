import { describe, expect, it } from "vitest";
import { parseFlow, sampleFlow, serializeFlow, type FlowDocument } from "./model";
import { buildTimeline, currentNode, indexSpans, sampleEdge, sampleNode } from "./timeline";
import { autoLayout, COLUMN_GAP } from "./layout";
import { excalidrawToFlow } from "./excalidraw-import";

const flow = (nodes: FlowDocument["nodes"], edges: FlowDocument["edges"]): FlowDocument => ({
  type: "qori-flow3d",
  version: 1,
  nodes,
  edges,
});
const n = (id: string, kind: FlowDocument["nodes"][number]["kind"] = "action", extra = {}) => ({
  id,
  kind,
  label: id,
  position: [0, 0, 0] as [number, number, number],
  ...extra,
});

describe("flow files", () => {
  it("round-trips and repairs hand-edited files", () => {
    const doc = sampleFlow("Pedidos");
    expect(parseFlow(serializeFlow(doc))).toEqual(doc);

    const repaired = parseFlow(
      JSON.stringify({
        nodes: [
          { id: "a", kind: "rocket", label: "A", position: [1, 2, 3] },
          { id: "a", kind: "action" },
          { id: "b", position: "nope" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "missing" },
          { from: "b", to: "b" },
        ],
      })
    );
    expect(repaired.nodes.map((node) => [node.id, node.kind])).toEqual([
      ["a", "action"],
      ["b", "action"],
    ]);
    expect(repaired.nodes[1].position).toHaveLength(3);
    expect(repaired.edges).toHaveLength(1);
    expect(parseFlow("").nodes).toEqual([]);
    expect(() => parseFlow("{nope")).toThrow("no es un flujo válido");
  });
});

describe("timeline", () => {
  it("runs from triggers, takes one branch of a condition and skips notes", () => {
    const doc = flow(
      [
        n("start", "trigger", { duration: 1 }),
        n("check", "condition", { duration: 1, branch: "no" }),
        n("yes", "action", { duration: 1 }),
        n("nope", "action", { duration: 2 }),
        n("memo", "note"),
      ],
      [
        { id: "go", from: "start", to: "check" },
        { id: "si", from: "check", to: "yes" },
        { id: "no", from: "check", to: "nope" },
        { id: "m", from: "memo", to: "start" },
      ]
    );
    const timeline = buildTimeline(doc, { edgeDuration: 0.5 });
    expect(timeline.order).toEqual(["start", "check", "nope"]);
    expect(timeline.edges.map((e) => e.id)).toEqual(["go", "no"]);
    const nodes = indexSpans(timeline.nodes);
    expect(nodes.get("check")).toEqual({ id: "check", start: 1.5, end: 2.5 });
    expect(timeline.duration).toBe(5);

    expect(sampleNode(nodes.get("check"), 1)).toEqual({ phase: "idle", progress: 0 });
    expect(sampleNode(nodes.get("check"), 2)).toEqual({ phase: "active", progress: 0.5 });
    expect(sampleNode(nodes.get("check"), 3).phase).toBe("done");
    const edges = indexSpans(timeline.edges);
    expect(sampleEdge(edges.get("go"), 1.25)).toBeCloseTo(0.5);
    expect(sampleEdge(edges.get("go"), 2)).toBeNull();
    expect(currentNode(timeline, 2)).toBe("check");
  });

  it("starts at nodes without inputs when there is no trigger, and survives cycles", () => {
    const doc = flow(
      [n("a"), n("b"), n("c")],
      [
        { id: "ab", from: "a", to: "b" },
        { id: "bc", from: "b", to: "c" },
        { id: "ca", from: "c", to: "a" },
      ]
    );
    // Every node has an input: nothing starts.
    expect(buildTimeline(doc).order).toEqual([]);
    const open = { ...doc, edges: doc.edges.slice(0, 2) };
    expect(buildTimeline(open).order).toEqual(["a", "b", "c"]);
    const looped = { ...doc, nodes: [n("a", "trigger"), n("b"), n("c")] };
    expect(buildTimeline(looped).order).toEqual(["a", "b", "c"]);
  });

  it("reaches merge nodes once, at the earliest arrival", () => {
    const doc = flow(
      [
        n("t", "trigger", { duration: 0 }),
        n("fast", "action", { duration: 0.1 }),
        n("slow", "action", { duration: 3 }),
        n("join"),
      ],
      [
        { id: "1", from: "t", to: "fast" },
        { id: "2", from: "t", to: "slow" },
        { id: "3", from: "fast", to: "join" },
        { id: "4", from: "slow", to: "join" },
      ]
    );
    const timeline = buildTimeline(doc, { edgeDuration: 1 });
    expect(timeline.nodes.filter((s) => s.id === "join")).toEqual([
      { id: "join", start: 2.1, end: 3.1 },
    ]);
    // The slow branch still animates its packet into the already-run node.
    expect(timeline.edges.map((e) => e.id).sort()).toEqual(["1", "2", "3", "4"]);
  });
});

describe("auto layout", () => {
  it("places columns by depth and spreads branches", () => {
    const positions = autoLayout(sampleFlow());
    expect(positions.webhook[0]).toBe(0);
    expect(positions.validate[0]).toBe(COLUMN_GAP);
    expect(positions.enrich[0]).toBe(2 * COLUMN_GAP);
    expect(positions.reject[0]).toBe(2 * COLUMN_GAP);
    expect(positions.enrich[2]).not.toBe(positions.reject[2]);
    expect(positions.notify[0]).toBe(4 * COLUMN_GAP);
  });
});

describe("excalidraw import", () => {
  it("maps shapes, bound texts and arrows to a flow", () => {
    const shape = (id: string, type: string, x: number, y: number, extra = {}) => ({
      id,
      type,
      x,
      y,
      width: 100,
      height: 60,
      ...extra,
    });
    const doc = excalidrawToFlow(
      {
        elements: [
          shape("s", "ellipse", 0, 0),
          {
            id: "st",
            type: "text",
            x: 10,
            y: 10,
            width: 40,
            height: 20,
            text: "Inicio",
            containerId: "s",
          },
          shape("d", "diamond", 300, 0, { backgroundColor: "#ffec99" }),
          {
            id: "dt",
            type: "text",
            x: 320,
            y: 20,
            width: 40,
            height: 20,
            text: "¿OK?",
            containerId: "d",
          },
          shape("r", "rectangle", 600, 0),
          { id: "free", type: "text", x: 620, y: 20, width: 40, height: 20, text: "Guardar" },
          shape("lonely", "rectangle", 0, 400),
          {
            id: "a1",
            type: "arrow",
            x: 100,
            y: 30,
            width: 200,
            height: 0,
            points: [
              [0, 0],
              [200, 0],
            ],
            startBinding: { elementId: "s" },
            endBinding: { elementId: "d" },
          },
          // Unbound arrow: attached to the nearest shapes.
          {
            id: "a2",
            type: "arrow",
            x: 405,
            y: 30,
            width: 190,
            height: 0,
            points: [
              [0, 0],
              [190, 0],
            ],
          },
          {
            id: "a2t",
            type: "text",
            x: 450,
            y: 10,
            width: 20,
            height: 20,
            text: "sí",
            containerId: "a2",
          },
          { id: "gone", type: "rectangle", x: 0, y: 0, width: 1, height: 1, isDeleted: true },
        ],
      },
      "demo",
      "demo.excalidraw"
    );
    const byId = Object.fromEntries(doc.nodes.map((node) => [node.id, node]));
    expect(Object.keys(byId).sort()).toEqual(["d", "lonely", "r", "s"]);
    expect(byId.s).toMatchObject({ kind: "trigger", label: "Inicio" });
    expect(byId.d).toMatchObject({ kind: "condition", label: "¿OK?", color: "#ffec99" });
    expect(byId.r).toMatchObject({ kind: "output", label: "Guardar" });
    expect(byId.lonely.kind).toBe("note");
    expect(doc.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ["s", "d", undefined],
      ["d", "r", "sí"],
    ]);
    expect(byId.s.position[0]).toBeLessThan(byId.r.position[0]);
    expect(doc.source).toBe("demo.excalidraw");
  });
});

describe("editor store", () => {
  it("adds steps after the selection, connects, removes and undoes", async () => {
    const { createFlowEditorStore } = await import("./editor-store");
    const store = createFlowEditorStore(sampleFlow());
    const s = () => store.getState();
    s().select({ type: "node", id: "notify" });
    const id = s().addNode("action");
    expect(s().selection).toEqual({ type: "node", id });
    expect(s().doc.edges.some((e) => e.from === "notify" && e.to === id)).toBe(true);
    const added = s().doc.nodes.find((n) => n.id === id)!;
    expect(added.position[0]).toBeGreaterThan(18);

    s().connect("reject", id);
    s().connect("reject", id); // no duplicates
    s().connect(id, id); // no self loops
    expect(s().doc.edges.filter((e) => e.to === id)).toHaveLength(2);

    s().removeSelection();
    expect(s().doc.nodes.some((n) => n.id === id)).toBe(false);
    expect(s().doc.edges.some((e) => e.from === id || e.to === id)).toBe(false);
    s().undo();
    expect(s().doc.nodes.some((n) => n.id === id)).toBe(true);
    s().redo();
    expect(s().doc.nodes.some((n) => n.id === id)).toBe(false);
  });

  it("records one undo step per drag and plays within the timeline", async () => {
    const { createFlowEditorStore } = await import("./editor-store");
    const store = createFlowEditorStore(sampleFlow());
    const s = () => store.getState();
    const before = s().past.length;
    s().beginGesture();
    s().moveNode("webhook", [1, 0, 1]);
    s().moveNode("webhook", [2, 0, 2]);
    expect(s().past.length).toBe(before + 1);
    s().undo();
    expect(s().doc.nodes.find((n) => n.id === "webhook")!.position).toEqual([0, 0, 0]);

    s().seek(999);
    expect(s().clock.time).toBe(s().timeline.duration);
    s().play(); // at the end: restarts from zero
    expect(s().playing).toBe(true);
    expect(s().clock.time).toBe(0);
    s().seek(1.5);
    s().pause();
    expect(s().displayTime).toBe(1.5);
    s().stop();
    expect([s().playing, s().clock.time]).toEqual([false, 0]);
  });

  it("re-syncs from Excalidraw keeping what was edited in 3D", async () => {
    const { mergeImported } = await import("./excalidraw-bridge");
    const current: FlowDocument = flow(
      [
        n("a", "trigger", { description: "nota", link: "/@workspace/a.md", position: [0, 3, 0] }),
        n("b"),
      ],
      [{ id: "keep", from: "a", to: "b", label: "viejo" }]
    );
    const imported: FlowDocument = flow(
      [n("a", "trigger", { label: "A2", position: [5, 0, 5] }), n("c", "output")],
      [
        { id: "new1", from: "a", to: "c" },
        { id: "new2", from: "a", to: "b" },
      ]
    );
    const merged = mergeImported(current, imported);
    expect(merged.nodes.map((node) => node.id)).toEqual(["a", "c"]);
    expect(merged.nodes[0]).toMatchObject({
      label: "A2",
      description: "nota",
      link: "/@workspace/a.md",
      position: [5, 3, 5],
    });
    expect(merged.edges.find((e) => e.to === "b")).toMatchObject({ id: "keep", label: "viejo" });
  });
});

describe("integration", () => {
  it("exports to Excalidraw and converts back to the same steps", async () => {
    const { flowToExcalidraw } = await import("./excalidraw-export");
    const doc = sampleFlow("Pedidos");
    const drawing = flowToExcalidraw(doc) as { elements: Array<Record<string, unknown>> };
    const arrows = drawing.elements.filter((e) => e.type === "arrow");
    expect(arrows).toHaveLength(doc.edges.length);
    expect(arrows[0]).toMatchObject({
      startBinding: { elementId: "webhook" },
      endBinding: { elementId: "validate" },
    });
    expect(drawing.elements.find((e) => e.id === "validate")?.type).toBe("diamond");

    const back = excalidrawToFlow(drawing, "Pedidos");
    expect(back.nodes.map((n) => n.id).sort()).toEqual(doc.nodes.map((n) => n.id).sort());
    const label = (id: string) => back.nodes.find((n) => n.id === id)?.label;
    expect(label("enrich")).toBe("Clasificar con IA");
    expect(back.edges.map((e) => [e.from, e.to, e.label ?? ""]).sort()).toEqual(
      doc.edges.map((e) => [e.from, e.to, e.label ?? ""]).sort()
    );
    // Same layout (relative positions) after the round trip.
    const x = (d: FlowDocument, id: string) => d.nodes.find((n) => n.id === id)!.position[0];
    expect(x(back, "notify") - x(back, "webhook")).toBeCloseTo(
      x(doc, "notify") - x(doc, "webhook"),
      1
    );
  });

  it("keeps step configuration and groups when re-syncing from the drawing", async () => {
    const { mergeImported } = await import("./excalidraw-bridge");
    const current: FlowDocument = {
      ...flow([n("a", "action", { config: { type: "command", command: "ls" }, group: "g" })], []),
      groups: [{ id: "g", label: "Grupo" }],
    };
    const merged = mergeImported(current, flow([n("a", "action", { label: "A" })], []));
    expect(merged.nodes[0]).toMatchObject({ label: "A", config: { type: "command" }, group: "g" });
    expect(merged.groups).toEqual(current.groups);
  });

  it("finds the step of a link by id or by name", async () => {
    const { findStep } = await import("./model");
    const doc = sampleFlow();
    expect(findStep(doc, "validate")?.id).toBe("validate");
    expect(findStep(doc, "pedido-valido")?.id).toBe("validate");
    expect(findStep(doc, "¿Pedido VÁLIDO?")?.id).toBe("validate");
    expect(findStep(doc, "nope")).toBeUndefined();
    expect(findStep(doc, "")).toBeUndefined();
  });

  it("parses step config and groups, dropping broken ones", () => {
    const doc = parseFlow(
      JSON.stringify({
        nodes: [
          {
            id: "a",
            kind: "action",
            config: { type: "http", url: "https://x", evil: { a: 1 } },
            group: "g",
          },
          { id: "b", kind: "action", config: { type: "rm -rf" }, group: "missing" },
        ],
        groups: [{ id: "g", label: "G", collapsed: true }, { id: "g" }, { label: "sin id" }],
      })
    );
    expect(doc.nodes[0].config).toEqual({ type: "http", url: "https://x" });
    expect(doc.nodes[0].group).toBe("g");
    expect(doc.nodes[1].config).toBeUndefined();
    expect(doc.nodes[1].group).toBeUndefined();
    expect(doc.groups).toEqual([{ id: "g", label: "G", color: undefined, collapsed: true }]);
  });
});
