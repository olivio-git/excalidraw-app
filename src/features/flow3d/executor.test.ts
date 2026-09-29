import { describe, expect, it, vi } from "vitest";
import type { FlowDocument, FlowNode } from "./model";
import {
  conditionEdge,
  evaluateCondition,
  executeFlow,
  renderTemplate,
  runTimeline,
  sideEffectSteps,
  type ExecutorServices,
} from "./executor";
import { createFlowEditorStore } from "./editor-store";

const node = (id: string, kind: FlowNode["kind"], config?: FlowNode["config"]): FlowNode => ({
  id,
  kind,
  label: id,
  position: [0, 0, 0],
  config,
});

const flow = (nodes: FlowNode[], edges: FlowDocument["edges"]): FlowDocument => ({
  type: "qori-flow3d",
  version: 1,
  nodes,
  edges,
});

function fakeServices(overrides: Partial<ExecutorServices> = {}): ExecutorServices {
  return {
    http: vi.fn(async ({ url }) => ({ status: 200, headers: {}, body: { url, ok: true } })),
    shell: vi.fn(async ({ command }) => ({ stdout: `ran ${command}\n`, stderr: "", code: 0 })),
    appCommand: vi.fn(async () => {}),
    ai: vi.fn(async ({ prompt }) => `IA: ${prompt}`),
    writeFile: vi.fn(async ({ path }) => `/work/${path}`),
    ...overrides,
  };
}

// Deterministic time: sleeping advances a fake clock instead of waiting.
function fakeTime() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += Math.max(0, ms);
    },
  };
}

describe("templates and conditions", () => {
  const scope = {
    input: { user: { name: "Ana", tags: ["a", "b"] }, count: 3, raw: '{"x":1}' },
    steps: { first: { output: { id: 42 } } },
  };

  it("fills placeholders in text and keeps JSON valid", () => {
    expect(renderTemplate("Hola {{input.user.name}} #{{steps.first.output.id}}", scope)).toBe(
      "Hola Ana #42"
    );
    expect(renderTemplate("{{input.raw.x}}", scope)).toBe("1");
    const json = renderTemplate(
      '{"who": "{{input.user}}", "text": "dijo \\"{{input.user.name}}\\""}',
      scope,
      "json"
    );
    expect(JSON.parse(json)).toEqual({
      who: { name: "Ana", tags: ["a", "b"] },
      text: 'dijo "Ana"',
    });
    expect(JSON.parse(renderTemplate('{"n": "{{input.missing}}"}', scope, "json"))).toEqual({
      n: null,
    });
  });

  it("evaluates operators and picks the labelled branch", () => {
    const check = (operator: never, field: string, value?: string) =>
      evaluateCondition({ type: "condition", operator, field, value }, scope.input);
    expect(check("==" as never, "user.name", "Ana")).toBe(true);
    expect(check(">" as never, "count", "2")).toBe(true);
    expect(check("contains" as never, "user.tags", "b")).toBe(true);
    expect(check("exists" as never, "nope")).toBe(false);

    const edges = [
      { id: "a", from: "c", to: "x", label: "no" },
      { id: "b", from: "c", to: "y", label: "Sí" },
    ];
    expect(conditionEdge(edges, true)?.id).toBe("b");
    expect(conditionEdge(edges, false)?.id).toBe("a");
    const unlabeled = [
      { id: "1", from: "c", to: "x" },
      { id: "2", from: "c", to: "y" },
    ];
    expect([conditionEdge(unlabeled, true)?.id, conditionEdge(unlabeled, false)?.id]).toEqual([
      "1",
      "2",
    ]);
  });
});

describe("executeFlow", () => {
  it("passes data between steps, follows the condition and records every step", async () => {
    const doc = flow(
      [
        node("start", "trigger", { type: "manual", payload: '{"status": 200, "name": "pedido"}' }),
        node("check", "condition", {
          type: "condition",
          field: "status",
          operator: "==",
          value: "200",
        }),
        node("api", "action", {
          type: "http",
          method: "POST",
          url: "https://api.test/{{input.name}}",
          body: '{"n": "{{input.name}}"}',
        }),
        node("sh", "action", { type: "command", command: "echo {{steps.start.output.name}}" }),
        node("ai", "ai", { type: "ai", prompt: "Resume {{input.body.url}}" }),
        node("save", "output", {
          type: "writeNote",
          path: "log.md",
          content: "{{input}}",
          append: true,
        }),
        node("fail", "action", { type: "command", command: "never" }),
        node("memo", "note"),
      ],
      [
        { id: "e1", from: "start", to: "check" },
        { id: "yes", from: "check", to: "api", label: "sí" },
        { id: "no", from: "check", to: "fail", label: "no" },
        { id: "e3", from: "api", to: "sh" },
        { id: "e3b", from: "api", to: "ai" },
        { id: "e4", from: "ai", to: "save" },
      ]
    );
    const services = fakeServices();
    const updates: string[] = [];
    const run = await executeFlow(doc, {
      services,
      ...fakeTime(),
      onUpdate: (r) => updates.push(r.status),
    });

    expect(run.status).toBe("done");
    expect(run.steps.fail.status).toBe("skipped");
    expect(run.steps.memo).toBeUndefined();
    expect(run.steps.check.via).toEqual(["yes"]);
    expect(services.http).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "https://api.test/pedido",
        body: '{"n": "pedido"}',
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(run.steps.sh.output).toMatchObject({ stdout: "ran echo pedido\n", code: 0 });
    expect(run.steps.ai.output).toBe("IA: Resume https://api.test/pedido");
    expect(services.writeFile).toHaveBeenCalledWith({
      path: "log.md",
      content: "IA: Resume https://api.test/pedido",
      append: true,
    });
    expect(run.steps.save.input).toBe("IA: Resume https://api.test/pedido");
    expect(updates.at(-1)).toBe("done");

    // The run is also a timeline: steps in order, packets between them.
    const timeline = runTimeline(run);
    expect(timeline.order.slice(0, 3)).toEqual(["start", "check", "api"]);
    expect(timeline.edges.map((e) => e.id)).toContain("yes");
    expect(timeline.edges.map((e) => e.id)).not.toContain("no");
    expect(Number.isFinite(timeline.duration)).toBe(true);
    const check = timeline.nodes.find((s) => s.id === "check")!;
    const api = timeline.nodes.find((s) => s.id === "api")!;
    expect(api.start).toBeGreaterThan(check.end);
  });

  it("marks the failing step, stops its branch and keeps the others running", async () => {
    const doc = flow(
      [
        node("t", "trigger"),
        node("bad", "action", { type: "command", command: "exit 2" }),
        node("after", "action"),
        node("good", "action", { type: "http", method: "GET", url: "https://ok.test" }),
      ],
      [
        { id: "1", from: "t", to: "bad" },
        { id: "2", from: "bad", to: "after" },
        { id: "3", from: "t", to: "good" },
      ]
    );
    const services = fakeServices({
      shell: async () => ({ stdout: "", stderr: "boom", code: 2 }),
    });
    const run = await executeFlow(doc, { services, ...fakeTime() });
    expect(run.status).toBe("error");
    expect(run.steps.bad).toMatchObject({ status: "error", error: "Salió con código 2: boom" });
    expect(run.steps.after.status).toBe("skipped");
    expect(run.steps.good.status).toBe("done");
    expect(run.error).toContain("boom");
  });

  it("can be cancelled", async () => {
    const controller = new AbortController();
    const doc = flow(
      [
        node("t", "trigger"),
        node("slow", "ai", { type: "ai", prompt: "x" }),
        node("end", "output"),
      ],
      [
        { id: "1", from: "t", to: "slow" },
        { id: "2", from: "slow", to: "end" },
      ]
    );
    const services = fakeServices({
      ai: async () => {
        controller.abort();
        return "tarde";
      },
    });
    const run = await executeFlow(doc, { services, signal: controller.signal, ...fakeTime() });
    expect(run.status).toBe("cancelled");
    expect(run.steps.end.status).toBe("skipped");
  });

  it("lists steps with side effects (GET requests are safe)", () => {
    const doc = flow(
      [
        node("get", "action", { type: "http", method: "GET", url: "https://x" }),
        node("post", "action", { type: "http", method: "POST", url: "https://x" }),
        node("sh", "action", { type: "command", command: "ls" }),
        node("tpl", "transform", { type: "template", template: "{}" }),
      ],
      []
    );
    expect(sideEffectSteps(doc).map((n) => n.id)).toEqual(["post", "sh"]);
  });
});

describe("editor store: execution, selection and groups", () => {
  it("runs through the store, then marks results stale after an edit", async () => {
    const doc = flow(
      [
        node("t", "trigger", { type: "manual", payload: '{"a":1}' }),
        node("x", "transform", { type: "template", template: '{"b": "{{input.a}}"}' }),
      ],
      [{ id: "e", from: "t", to: "x" }]
    );
    const store = createFlowEditorStore(doc);
    const run = await store.getState().execute(fakeServices(), { timing: fakeTime() });
    expect(run.status).toBe("done");
    expect(store.getState().run?.steps.x.output).toEqual({ b: 1 });
    expect(store.getState().timeline.order).toEqual(["t", "x"]);
    store.getState().updateNode("x", { label: "otro" });
    expect(store.getState().runStale).toBe(true);
    store.getState().setMode("simulate");
    expect(store.getState().run).toBeNull();
  });

  it("multi-selects, copies, pastes and groups steps", () => {
    const doc = flow(
      [node("a", "trigger"), node("b", "action"), node("c", "action")],
      [
        { id: "ab", from: "a", to: "b" },
        { id: "bc", from: "b", to: "c" },
      ]
    );
    const store = createFlowEditorStore(doc);
    const s = () => store.getState();
    s().select({ type: "node", id: "a" });
    s().toggleNode("b");
    expect(s().selectedNodes).toEqual(["a", "b"]);
    const clip = s().copySelection()!;
    expect(clip.edges.map((e) => e.id)).toEqual(["ab"]);
    const pasted = s().paste(clip);
    expect(pasted).toHaveLength(2);
    expect(s().doc.nodes).toHaveLength(5);
    expect(
      s().doc.edges.filter((e) => pasted.includes(e.from) && pasted.includes(e.to))
    ).toHaveLength(1);
    expect(s().selectedNodes).toEqual(pasted);

    s().selectNodes(["b", "c"]);
    const group = s().groupSelection("Envío")!;
    expect(s().doc.groups).toEqual([{ id: group, label: "Envío" }]);
    s().setGroupHeight(group, 4);
    expect(
      s()
        .doc.nodes.filter((n) => n.group === group)
        .map((n) => n.position[1])
    ).toEqual([4, 4]);
    s().toggleGroup(group);
    expect(s().doc.groups?.[0].collapsed).toBe(true);
    s().ungroup(group);
    expect(s().doc.groups).toBeUndefined();
    expect(s().doc.nodes.some((n) => n.group)).toBe(false);

    s().selectNodes(["a", "b"]);
    s().removeSelection();
    expect(s().doc.nodes.map((n) => n.id)).not.toContain("a");
    expect(s().doc.edges.some((e) => e.from === "a" || e.to === "b")).toBe(false);
  });
});
