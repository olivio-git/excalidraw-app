import { describe, expect, it, vi } from "vitest";
import { diagnoseStep, extractJson, flowFromAI, generateFlow, summarizeRun } from "./ai-flow";
import { executeFlow } from "./executor";
import type { FlowDocument } from "./model";

describe("AI and flows", () => {
  it("reads the JSON out of chatty or fenced answers", () => {
    expect(extractJson('Aquí tienes:\n```json\n{"a": 1}\n```\nListo')).toEqual({ a: 1 });
    expect(() => extractJson("no sé")).toThrow("no devolvió un flujo");
    expect(() => extractJson("{ roto")).toThrow();
  });

  it("repairs and lays out what the model proposes", () => {
    const doc = flowFromAI(
      {
        nodes: [
          { id: "t", kind: "trigger", label: "Inicio", config: { type: "schedule", every: 5 } },
          { id: "x", kind: "robot", label: "Raro" },
          { id: "y", kind: "action", label: "Fin", config: { type: "nope" } },
        ],
        edges: [
          { id: "1", from: "t", to: "x" },
          { id: "2", from: "x", to: "y" },
          { id: "3", from: "y", to: "ghost" },
        ],
      },
      "Demo"
    );
    expect(doc.name).toBe("Demo");
    expect(doc.nodes.map((n) => n.kind)).toEqual(["trigger", "action", "action"]);
    expect(doc.nodes[2].config).toBeUndefined();
    expect(doc.edges).toHaveLength(2);
    // Laid out left to right.
    expect(doc.nodes[0].position[0]).toBeLessThan(doc.nodes[2].position[0]);
    expect(() => flowFromAI({ nodes: [] })).toThrow("ningún paso");
  });

  it("asks the model with the format guide and builds the flow", async () => {
    const ask = vi.fn(async () =>
      JSON.stringify({
        name: "Commits",
        nodes: [
          {
            id: "t",
            kind: "trigger",
            label: "Cada día",
            config: { type: "schedule", at: "09:00" },
          },
          {
            id: "g",
            kind: "action",
            label: "git log",
            config: { type: "command", command: "git log" },
          },
        ],
        edges: [{ id: "e", from: "t", to: "g" }],
      })
    );
    const doc = await generateFlow("resume mis commits cada mañana", ask);
    expect(ask.mock.calls[0][0].system).toContain('"schedule"');
    expect(ask.mock.calls[0][0].prompt).toBe("resume mis commits cada mañana");
    expect(doc.nodes.map((n) => n.config?.type)).toEqual(["schedule", "command"]);
  });

  it("gives the model the failing step's config, input and error", async () => {
    const doc: FlowDocument = {
      type: "qori-flow3d",
      version: 1,
      nodes: [
        {
          id: "t",
          kind: "trigger",
          label: "Inicio",
          position: [0, 0, 0],
          config: { type: "manual", payload: '{"id": 7}' },
        },
        {
          id: "api",
          kind: "action",
          label: "Llamar API",
          position: [4, 0, 0],
          config: { type: "http", method: "GET", url: "ftp://x/{{input.id}}" },
        },
      ],
      edges: [{ id: "e", from: "t", to: "api" }],
    };
    const run = await executeFlow(doc, {
      services: {} as never,
      now: () => 0,
      sleep: async () => {},
    });
    const ask = vi.fn(async () => "La URL debe empezar por https://");
    const answer = await diagnoseStep(doc, run, "api", ask);
    expect(answer).toBe("La URL debe empezar por https://");
    const prompt = ask.mock.calls[0][0].prompt;
    expect(prompt).toContain("Llamar API");
    expect(prompt).toContain("ftp://x/{{input.id}}");
    expect(prompt).toContain('"id": 7');
    expect(prompt).toContain("URL no válida");
    expect(summarizeRun(doc, run)).toContain("Llamar API [api]: error");
    expect(summarizeRun(doc, null)).toContain("no se ha ejecutado");
  });
});
