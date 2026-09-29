import { beforeEach, describe, expect, it, vi } from "vitest";
import { posix } from "node:path";
import { readDir, readTextFile, stat, type DirEntry } from "@tauri-apps/plugin-fs";
import { encodeDocument } from "@/features/document-editor/note-format";
import { buildMatcher, extractSegments, findMatches, searchWorkspace } from "./workspace-search";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => posix.join(...parts),
}));
const entry = (name: string, isDirectory = false): DirEntry => ({
  name,
  isFile: !isDirectory,
  isDirectory,
  isSymlink: false,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(stat).mockResolvedValue({ size: 100 } as Awaited<ReturnType<typeof stat>>);
});

describe("workspace search", () => {
  it("builds matchers for plain text, whole words and regular expressions", () => {
    expect(buildMatcher("a.b")!.test("axb")).toBe(false);
    expect(buildMatcher("a.b", { regex: true })!.test("axb")).toBe(true);
    expect(buildMatcher("(", { regex: true })).toBeNull();
    const word = buildMatcher("pedido", { wholeWord: true })!;
    expect("un pedido nuevo".match(word)).toHaveLength(1);
    expect("pedidos".match(word)).toBeNull();
    expect(buildMatcher("Hola", { caseSensitive: true })!.test("hola")).toBe(false);
  });

  it("reads each kind of file by what a person sees, with anchors", () => {
    const md = extractSegments("/a.md", "# Intro\ntexto\n```\ncódigo\n```\n## Otra\nmás");
    expect(md.find((s) => s.text === "texto")).toMatchObject({
      anchor: "intro",
      line: 2,
      context: "Intro",
    });
    expect(md.find((s) => s.text === "más")).toMatchObject({ anchor: "otra" });

    const drawing = JSON.stringify({
      elements: [
        { id: "t1", type: "text", text: "Servidor\nAPI" },
        { id: "r1", type: "rectangle" },
        { id: "t2", type: "text", text: "borrado", isDeleted: true },
      ],
    });
    expect(extractSegments("/d.excalidraw", drawing)).toEqual([
      { text: "Servidor API", anchor: "t1" },
    ]);

    const flow = JSON.stringify({
      nodes: [
        {
          id: "api",
          label: "Llamar API",
          description: "trae pedidos",
          config: { type: "http", url: "https://x/pedidos" },
        },
      ],
    });
    const steps = extractSegments("/f.flow3d", flow);
    expect(steps.map((s) => [s.text, s.anchor])).toEqual([
      ["Llamar API", "api"],
      ["trae pedidos", "api"],
      ["https://x/pedidos", "api"],
    ]);

    const note = encodeDocument("/n.note", {
      content: "",
      documentId: "d",
      blocks: [
        {
          id: "b1",
          type: "heading",
          props: { level: 1 },
          content: [{ type: "text", text: "Plan", styles: {} }],
          children: [],
        },
        {
          id: "b2",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "revisar pedidos", styles: {} }],
          children: [],
        },
      ],
    } as never);
    const blocks = extractSegments("/n.note", note);
    expect(blocks.find((s) => s.text === "revisar pedidos")).toMatchObject({
      anchor: "b2",
      context: "Plan",
    });
  });

  it("returns snippets around matches in long lines", () => {
    const text = `${"x".repeat(200)} aguja ${"y".repeat(300)}`;
    const [match] = findMatches([{ text, anchor: "" }], buildMatcher("aguja")!, 10);
    expect(match.text.startsWith("…")).toBe(true);
    expect(match.text.slice(match.start, match.end)).toBe("aguja");
    expect(match.text.length).toBeLessThan(200);
  });

  it("searches the workspace, skipping dependencies and big files", async () => {
    vi.mocked(readDir).mockImplementation(async (dir) =>
      String(dir) === "/ws"
        ? [
            entry("notas.md"),
            entry("flujo.flow3d"),
            entry("foto.png"),
            entry("node_modules", true),
            entry("src", true),
            entry("big.txt"),
          ]
        : String(dir) === "/ws/src"
          ? [entry("app.ts")]
          : [entry("lib.md")]
    );
    vi.mocked(stat).mockImplementation(
      async (path) =>
        ({ size: String(path).endsWith("big.txt") ? 5_000_000 : 10 }) as Awaited<
          ReturnType<typeof stat>
        >
    );
    vi.mocked(readTextFile).mockImplementation(async (path) => {
      if (String(path).endsWith(".md")) return "# Pedidos\nEl pedido llega";
      if (String(path).endsWith(".flow3d"))
        return JSON.stringify({ nodes: [{ id: "p", label: "Validar pedido" }] });
      if (String(path).endsWith(".ts")) return "const pedido = 1;\nconst otro = 2;";
      return "pedido";
    });
    const result = await searchWorkspace("/ws", "pedido", new AbortController().signal);
    expect(result.files.map((f) => f.path).sort()).toEqual([
      "/ws/flujo.flow3d",
      "/ws/notas.md",
      "/ws/src/app.ts",
    ]);
    expect(result.files.find((f) => f.path.endsWith("app.ts"))!.matches[0]).toMatchObject({
      line: 1,
    });
    expect(result.files.find((f) => f.path.endsWith("flow3d"))!.matches[0].anchor).toBe("p");
    // "Pedidos" heading + "pedido" line.
    expect(result.files.find((f) => f.path.endsWith("notas.md"))!.matches).toHaveLength(2);
    expect(readDir).not.toHaveBeenCalledWith("/ws/node_modules");
  });
});
