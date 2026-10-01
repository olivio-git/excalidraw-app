import { describe, expect, it, vi } from "vitest";
import { exists } from "@tauri-apps/plugin-fs";
import { parseFlow } from "@/features/flow3d/model";
import { excalidrawToFlow } from "@/features/flow3d/excalidraw-import";
import { buildTemplate, TEMPLATES } from "./templates";
import { freePath } from "./create";

vi.mock("@tauri-apps/plugin-fs", () => ({ exists: vi.fn(), writeTextFile: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));

describe("templates", () => {
  it("has notes, diagrams and flows in both languages", () => {
    const kinds = new Set(TEMPLATES.map((t) => t.kind));
    expect([...kinds].sort()).toEqual(["diagram", "flow", "note"]);
    for (const template of TEMPLATES) {
      expect(template.title.es && template.title.en).toBeTruthy();
      expect(template.description.es && template.description.en).toBeTruthy();
    }
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))("%s builds a valid file", (_, template) => {
    for (const lang of ["es", "en"] as const) {
      const content = buildTemplate(template, lang, "Mi archivo");
      if (template.kind === "note") {
        expect(content.startsWith("# Mi archivo")).toBe(true);
      } else if (template.kind === "flow") {
        const flow = parseFlow(content);
        expect(flow.name).toBe("Mi archivo");
        if (template.id.startsWith("visual-")) {
          // Visual diagrams: real shapes spread over more than one axis.
          expect(flow.nodes.some((n) => n.style?.shape && n.style.shape !== "card")).toBe(true);
          const spread = (axis: 0 | 1 | 2) =>
            new Set(flow.nodes.map((n) => Math.round(n.position[axis] * 10))).size > 1;
          expect([spread(0), spread(1), spread(2)].filter(Boolean).length).toBeGreaterThan(1);
        } else {
          expect(flow.nodes.filter((n) => n.kind === "trigger")).toHaveLength(1);
          expect(
            flow.nodes.every((n) => n.kind === "note" || n.config || n.kind === "action")
          ).toBe(true);
          expect(flow.edges.length).toBeGreaterThan(0);
        }
      } else {
        const drawing = JSON.parse(content);
        expect(drawing.type).toBe("excalidraw");
        const back = excalidrawToFlow(drawing);
        expect(back.nodes.length).toBeGreaterThan(2);
        expect(back.edges.length).toBeGreaterThan(1);
      }
    }
  });

  it("uses the language of the app for labels", () => {
    const monitor = TEMPLATES.find((t) => t.id === "flow-monitor")!;
    expect(parseFlow(buildTemplate(monitor, "es", "x")).edges.map((e) => e.label)).toContain("sí");
    expect(parseFlow(buildTemplate(monitor, "en", "x")).edges.map((e) => e.label)).toContain("yes");
  });

  it("never overwrites an existing file", async () => {
    vi.mocked(exists).mockImplementation(
      async (path) => String(path).endsWith("Acta.md") || String(path).endsWith("Acta-2.md")
    );
    expect(await freePath("/ws", "Acta", "md")).toBe("/ws/Acta-3.md");
    expect(await freePath("/ws", "a/b:c?", "md")).toBe("/ws/abc.md");
  });
});
