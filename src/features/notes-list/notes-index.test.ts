import { describe, expect, it, vi } from "vitest";
import { readDir, readTextFile, stat, type DirEntry } from "@tauri-apps/plugin-fs";
import { encodeDocument } from "@/features/document-editor/note-format";
import { frontMatter, indexNotes, sortNotes, summarize, type NoteSummary } from "./notes-index";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));

const entry = (name: string, isDirectory = false): DirEntry => ({
  name,
  isDirectory,
  isFile: !isDirectory,
  isSymlink: false,
});

describe("notes list", () => {
  it("reads title, first line, tags and status from Markdown", () => {
    const note = summarize(
      "/ws/idea.md",
      "---\ntags: [AI, Bug]\nstatus: Active\n---\n# Mejorar el arranque\n\n```js\nconst x = 1\n```\n- [ ] Medir **TTI** con [la guía](http://x)\n"
    );
    expect(note).toEqual({
      title: "Mejorar el arranque",
      snippet: "Medir TTI con la guía",
      tags: ["AI", "Bug"],
      status: "active",
    });
    expect(summarize("/ws/sin-titulo.md", "").title).toBe("sin-titulo");
    expect(frontMatter("sin front matter").data).toEqual({});
  });

  it("reads title and text from rich notes", () => {
    const raw = encodeDocument("/ws/plan.note", {
      content: "",
      documentId: "d",
      blocks: [
        {
          id: "1",
          type: "heading",
          props: { level: 1 },
          content: [{ type: "text", text: "Plan Q4", styles: {} }],
          children: [],
        },
        {
          id: "2",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "Lanzar la beta", styles: {} }],
          children: [],
        },
      ],
    } as never);
    expect(summarize("/ws/plan.note", raw)).toMatchObject({
      title: "Plan Q4",
      snippet: "Lanzar la beta",
    });
  });

  it("puts pinned notes first, then newest or by title", () => {
    const note = (path: string, title: string, updated: number): NoteSummary => ({
      path,
      title,
      snippet: "",
      notebook: "",
      updated,
      tags: [],
    });
    const notes = [
      note("/ws/a.md", "Zeta", 1),
      note("/ws/b.md", "Alfa", 3),
      note("/ws/docs/c.md", "Beta", 2),
    ];
    expect(sortNotes(notes, "updated").map((n) => n.title)).toEqual(["Alfa", "Beta", "Zeta"]);
    expect(sortNotes(notes, "title").map((n) => n.title)).toEqual(["Alfa", "Beta", "Zeta"]);
    expect(sortNotes(notes, "updated", ["docs/c.md", "a.md"]).map((n) => n.title)).toEqual([
      "Beta",
      "Zeta",
      "Alfa",
    ]);
  });

  it("indexes the workspace with folders as notebooks", async () => {
    vi.mocked(readDir).mockImplementation(async (dir) =>
      String(dir) === "/ws"
        ? [entry("hoy.md"), entry("Blog", true), entry("node_modules", true), entry("foto.png")]
        : [entry("post.md")]
    );
    vi.mocked(readTextFile).mockImplementation(
      async (path) => `# ${String(path).split("/").pop()}\ntexto`
    );
    vi.mocked(stat).mockResolvedValue({ mtime: new Date(1000) } as Awaited<
      ReturnType<typeof stat>
    >);
    const notes = await indexNotes("/ws", new AbortController().signal);
    expect(notes.map((n) => [n.title, n.notebook, n.updated])).toEqual([
      ["hoy.md", "", 1000],
      ["post.md", "Blog", 1000],
    ]);
    expect(readDir).not.toHaveBeenCalledWith("/ws/node_modules");
  });
});
