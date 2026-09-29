import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowDocument, FlowNode } from "./model";
import { FlowAutomation, nextDailyRun, planAutomations, describePlan } from "./automation";
import { executeFlow, redact, type ExecutorServices } from "./executor";
import {
  createRunHistory,
  flowSignature,
  relativeTime,
  toHistoryEntry,
  trimValue,
} from "./run-history";
import { createSecretStore } from "./secrets";
import { createFlowEditorStore } from "./editor-store";

const node = (id: string, kind: FlowNode["kind"], config?: FlowNode["config"]): FlowNode => ({
  id,
  kind,
  label: id,
  position: [0, 0, 0],
  config,
});
const flow = (
  nodes: FlowNode[],
  edges: FlowDocument["edges"] = [],
  automation = false
): FlowDocument => ({
  type: "qori-flow3d",
  version: 1,
  name: "Demo",
  nodes,
  edges,
  settings: automation ? { automation: true } : undefined,
});

const fakeTime = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += Math.max(0, ms)) };
};
const services = (overrides: Partial<ExecutorServices> = {}): ExecutorServices => ({
  http: vi.fn(async ({ url, headers }) => ({ status: 200, headers: {}, body: { url, headers } })),
  shell: vi.fn(async ({ command }) => ({ stdout: command, stderr: "", code: 0 })),
  appCommand: vi.fn(async () => {}),
  ai: vi.fn(async () => "ok"),
  writeFile: vi.fn(async ({ path }) => path),
  ...overrides,
});
const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
};

describe("loops, retries and secrets", () => {
  it("repeats a step for every element and exposes item and index", async () => {
    const doc = flow(
      [
        node("t", "trigger", { type: "manual", payload: '{"users": ["ana", "luis"]}' }),
        node("each", "action", {
          type: "http",
          method: "GET",
          url: "https://api.test/{{index}}/{{item}}",
          forEach: "users",
        }),
      ],
      [{ id: "e", from: "t", to: "each" }]
    );
    const run = await executeFlow(doc, { services: services(), ...fakeTime() });
    expect(run.status).toBe("done");
    const output = run.steps.each.output as Array<{ body: { url: string } }>;
    expect(output.map((r) => r.body.url)).toEqual([
      "https://api.test/0/ana",
      "https://api.test/1/luis",
    ]);
  });

  it("fails clearly when the list isn't a list", async () => {
    const doc = flow(
      [
        node("t", "trigger"),
        node("each", "action", { type: "command", command: "x", forEach: "nope" }),
      ],
      [{ id: "e", from: "t", to: "each" }]
    );
    const run = await executeFlow(doc, { services: services(), ...fakeTime() });
    expect(run.steps.each.error).toBe("«nope» no es una lista");
  });

  it("retries a failing step and records the attempts", async () => {
    let calls = 0;
    const shell = vi.fn(async () => {
      calls++;
      return calls < 3
        ? { stdout: "", stderr: "ocupado", code: 1 }
        : { stdout: "listo", stderr: "", code: 0 };
    });
    const doc = flow(
      [
        node("t", "trigger"),
        node("sh", "action", { type: "command", command: "x", retries: 3, retryDelay: 1 }),
      ],
      [{ id: "e", from: "t", to: "sh" }]
    );
    const time = fakeTime();
    const run = await executeFlow(doc, { services: services({ shell }), ...time });
    expect(run.steps.sh).toMatchObject({ status: "done", attempts: 3 });
    expect(shell).toHaveBeenCalledTimes(3);

    calls = -10;
    const failed = await executeFlow(doc, { services: services({ shell }), ...fakeTime() });
    expect(failed.steps.sh).toMatchObject({ status: "error", attempts: 4 });
  });

  it("uses secrets in steps but hides them in the recorded data", async () => {
    const doc = flow(
      [
        node("t", "trigger"),
        node("api", "action", {
          type: "http",
          method: "GET",
          url: "https://api.test",
          headers: "Authorization: Bearer {{secrets.TOKEN}}",
        }),
      ],
      [{ id: "e", from: "t", to: "api" }]
    );
    const http = vi.fn(async ({ headers }) => ({
      status: 200,
      headers: {},
      body: { echo: headers },
    }));
    const run = await executeFlow(doc, {
      services: services({ http }),
      secrets: { TOKEN: "s3cr3t-value" },
      ...fakeTime(),
    });
    expect(http.mock.calls[0][0].headers.Authorization).toBe("Bearer s3cr3t-value");
    expect(JSON.stringify(run.steps)).not.toContain("s3cr3t-value");
    expect(JSON.stringify(run.steps.api.output)).toContain("Bearer ••••");

    const missing = await executeFlow(doc, { services: services(), ...fakeTime() });
    expect(missing.steps.api.error).toContain("Falta el secreto «TOKEN»");
    expect(redact({ a: ["xx-key-xx"] }, ["key"])).toEqual({ a: ["xx-••••-xx"] });
  });

  it("starts only from the chosen trigger", async () => {
    const doc = flow([node("a", "trigger"), node("b", "trigger")]);
    const run = await executeFlow(doc, { services: services(), startAt: ["b"], ...fakeTime() });
    expect(run.steps.a.status).toBe("skipped");
    expect(run.steps.b.status).toBe("done");
  });
});

describe("automation planning", () => {
  const triggers = [
    node("every", "trigger", { type: "schedule", every: 15 }),
    node("daily", "trigger", { type: "schedule", at: "08:30" }),
    node("bad", "trigger", { type: "schedule", at: "25:99" }),
    node("files", "trigger", { type: "fileWatch", path: "notas/" }),
    node("manual", "trigger", { type: "manual" }),
  ];

  it("arms only flows that opted in, with valid triggers", () => {
    expect(planAutomations(flow(triggers))).toEqual([]);
    const plans = planAutomations(flow(triggers, [], true));
    expect(plans.map((p) => [p.nodeId, p.kind])).toEqual([
      ["every", "interval"],
      ["daily", "daily"],
      ["files", "watch"],
    ]);
    expect(plans.map(describePlan)).toEqual([
      "cada 15 minutos",
      "todos los días a las 08:30",
      "al cambiar notas/",
    ]);
  });

  it("computes the next daily run", () => {
    const morning = new Date(2026, 8, 29, 7, 0);
    expect(nextDailyRun("08:30", morning)).toEqual(new Date(2026, 8, 29, 8, 30));
    const evening = new Date(2026, 8, 29, 20, 0);
    expect(nextDailyRun("08:30", evening)).toEqual(new Date(2026, 8, 30, 8, 30));
  });
});

describe("automation service", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs on schedule and on file changes, but not on its own writes or while paused", async () => {
    const doc = flow(
      [
        node("tick", "trigger", { type: "schedule", every: 5 }),
        node("watch", "trigger", { type: "fileWatch", path: "in" }),
      ],
      [],
      true
    );
    const watchers = new Map<string, (paths: string[]) => void>();
    const run = vi.fn(async (..._args: unknown[]) => {});
    const automation = new FlowAutomation({
      listFlows: async () => ["/ws/a.flow3d", "/ws/off.flow3d"],
      readFlow: async (path) =>
        path.includes("off") ? flow([node("x", "trigger", { type: "schedule", every: 1 })]) : doc,
      watch: async (path, onChange) => {
        watchers.set(path, onChange);
        return () => watchers.delete(path);
      },
      resolvePath: (path) => `/ws/${path}`,
      run,
      quietMs: 2000,
    });
    await automation.start("/ws");
    expect(automation.list().map((f) => f.path)).toEqual(["/ws/a.flow3d"]);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]).toEqual([
      "/ws/a.flow3d",
      doc,
      "tick",
      "schedule",
      expect.objectContaining({ trigger: "schedule" }),
    ]);

    // Right after a run its own file changes are ignored…
    watchers.get("/ws/in")!(["/ws/in/out.md"]);
    await vi.advanceTimersByTimeAsync(600);
    expect(run).toHaveBeenCalledTimes(1);
    // …later changes trigger it.
    await vi.advanceTimersByTimeAsync(3000);
    watchers.get("/ws/in")!(["/ws/in/new.csv"]);
    await vi.advanceTimersByTimeAsync(600);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][3]).toBe("file");
    expect(run.mock.calls[1][4]).toMatchObject({ path: "/ws/in/new.csv" });

    automation.paused = true;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(run).toHaveBeenCalledTimes(2);

    await automation.stop();
    expect(automation.list()).toEqual([]);
    expect(watchers.size).toBe(0);
  });
});

describe("history and secrets storage", () => {
  it("keeps the latest runs per flow, trimmed, and notifies listeners", async () => {
    const storage = memoryStorage();
    const history = createRunHistory(storage);
    const doc = flow([node("t", "trigger")]);
    const run = await executeFlow(doc, {
      services: services(),
      payload: { big: "x".repeat(20_000) },
      ...fakeTime(),
    });
    const seen: number[] = [];
    history.subscribe("/a.flow3d", (entries) => seen.push(entries.length));
    for (let i = 0; i < 25; i++)
      await history.add(toHistoryEntry("/a.flow3d", run, flowSignature(doc)));
    const entries = await history.list("/a.flow3d");
    expect(entries).toHaveLength(20);
    expect(String(entries[0].run.steps.t.input)).toContain("recortado");
    expect(seen.at(-1)).toBe(20);
    // Survives a restart (fresh instance on the same storage).
    expect(await createRunHistory(storage).list("/a.flow3d")).toHaveLength(20);
    expect(trimValue({ small: 1 })).toEqual({ small: 1 });
    expect(relativeTime(Date.now() - 5 * 60_000)).toBe("hace 5 min");
  });

  it("shows a past run and marks it stale once the flow changed", async () => {
    const doc = flow(
      [node("t", "trigger"), node("a", "action")],
      [{ id: "e", from: "t", to: "a" }]
    );
    const run = await executeFlow(doc, { services: services(), ...fakeTime() });
    const entry = toHistoryEntry("/a.flow3d", run, flowSignature(doc));
    const store = createFlowEditorStore(doc);
    store.getState().showRun(entry);
    expect(store.getState()).toMatchObject({ runStale: false, shownRunId: entry.id, mode: "run" });
    expect(store.getState().timeline.order).toEqual(["t", "a"]);
    store.getState().connect("a", "t");
    store.getState().showRun(entry);
    expect(store.getState().runStale).toBe(true);
  });

  it("stores secrets by valid name", async () => {
    const secrets = createSecretStore(memoryStorage());
    await secrets.set("API_KEY", "abc");
    await expect(secrets.set("mal nombre", "x")).rejects.toThrow("sin espacios");
    expect(await secrets.names()).toEqual(["API_KEY"]);
    expect(await secrets.all()).toEqual({ API_KEY: "abc" });
    await secrets.remove("API_KEY");
    expect(await secrets.names()).toEqual([]);
  });
});
