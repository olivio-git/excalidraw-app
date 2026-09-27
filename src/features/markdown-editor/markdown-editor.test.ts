import { describe, it, expect, vi, afterEach } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

vi.mock("./workspace-files", () => ({
  listWorkspaceFiles: vi.fn(async () => [
    "/ws/notes/Arquitectura general.md",
    "/ws/diagrams/flujo compra.excalidraw",
    "/ws/notes/actual.md",
  ]),
}));

import { encodeLinkPath, relativePath } from "./paths";
import { insertLink, toggleInline, toggleTaskAt } from "./formatting";
import { EMBED_LINE, embedHref, embeds, findMathBlocks } from "./embeds";
import { findHeading } from "./headings";
import { linkCompletions, linkMarkdown, slashCompletions } from "./completions";
import { livePreview } from "./live-preview";
import { noteContext, type NoteContext } from "./note-context";

const context: NoteContext = {
  getFilePath: () => "/ws/notes/actual.md",
  getWorkspaceDir: () => "/ws",
  isDark: () => false,
  resolve: async (href) => href,
  open: vi.fn(),
  readFile: async () => new Uint8Array(),
  renderDiagram: async () => new Blob(["<svg/>"], { type: "image/svg+xml" }),
};

function run(command: StateCommand, doc: string, anchor: number, head = anchor): EditorState {
  let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
  command({ state, dispatch: (tr) => (state = tr.state) });
  return state;
}

describe("paths", () => {
  it("builds relative, URI-encoded link paths", () => {
    expect(relativePath("/ws/notes", "/ws/notes/b.md")).toBe("b.md");
    expect(relativePath("/ws/notes", "/ws/diagrams/flujo.excalidraw")).toBe(
      "../diagrams/flujo.excalidraw"
    );
    expect(relativePath("C:\\ws\\notes", "C:\\ws\\a.md")).toBe("../a.md");
    expect(encodeLinkPath("../mis notas/a (1).md")).toBe("../mis%20notas/a%20(1).md");
  });
});

describe("formatting commands", () => {
  it("wraps, then unwraps, the selection with a marker", () => {
    const bold = run(toggleInline("**"), "hola mundo", 5, 10);
    expect(bold.doc.toString()).toBe("hola **mundo**");
    const selection = bold.selection.main;
    const plain = run(toggleInline("**"), bold.doc.toString(), selection.from, selection.to);
    expect(plain.doc.toString()).toBe("hola mundo");
  });

  it("inserts empty markers around the cursor", () => {
    const state = run(toggleInline("`"), "ab", 1);
    expect(state.doc.toString()).toBe("a``b");
    expect(state.selection.main.head).toBe(2);
  });

  it("turns the selection into a link and selects the url", () => {
    const state = run(insertLink, "ver docs", 4, 8);
    expect(state.doc.toString()).toBe("ver [docs](url)");
    const { from, to } = state.selection.main;
    expect(state.sliceDoc(from, to)).toBe("url");
  });

  it("toggles task checkboxes", () => {
    const done = run(toggleTaskAt(2), "- [ ] tarea", 0);
    expect(done.doc.toString()).toBe("- [x] tarea");
    expect(run(toggleTaskAt(2), done.doc.toString(), 0).doc.toString()).toBe("- [ ] tarea");
  });
});

describe("block parsing", () => {
  it("recognizes embed lines", () => {
    const encoded = EMBED_LINE.exec("![Flujo](../diagrams/flujo%20compra.excalidraw)")!;
    expect(embedHref(encoded)).toBe("../diagrams/flujo%20compra.excalidraw");
    expect(embedHref(EMBED_LINE.exec('![img](<a b.png> "title")')!)).toBe("a b.png");
    expect(EMBED_LINE.exec("texto ![img](a.png)")).toBeNull();
  });

  it("finds $$ math blocks outside code", () => {
    const state = EditorState.create({
      doc: "$$E = mc^2$$\n\n$$\n\\frac{a}{b}\n$$\n\n```\n$$\nnot math\n$$\n```",
    });
    expect(findMathBlocks(state).map((block) => block.tex)).toEqual(["E = mc^2", "\\frac{a}{b}"]);
  });

  it("finds headings by text or slug, ignoring code blocks", () => {
    const state = EditorState.create({
      doc: "```\n# Falso\n```\n# Introducción\n## Flujo de compra",
    });
    expect(findHeading(state.doc, "Flujo de compra")).toBe(state.doc.line(5).from);
    expect(findHeading(state.doc, "#introducción")).toBe(state.doc.line(4).from);
    expect(findHeading(state.doc, "Falso")).toBe(-1);
  });
});

describe("completions", () => {
  it("offers slash commands matching keywords", () => {
    const doc = "texto /tabla";
    const state = EditorState.create({ doc });
    const result = slashCompletions(new CompletionContext(state, doc.length, false));
    expect(result?.from).toBe(6);
    expect(result?.options.some((option) => option.displayLabel === "Tabla")).toBe(true);
    // Not inside a word (e.g. a URL path).
    const url = EditorState.create({ doc: "http://a" });
    expect(slashCompletions(new CompletionContext(url, 8, false))).toBeNull();
  });

  it("links notes and embeds diagrams relative to the current note", async () => {
    expect(linkMarkdown("/ws/notes/actual.md", "/ws/notes/Arquitectura general.md")).toBe(
      "[Arquitectura general](Arquitectura%20general.md)"
    );
    expect(linkMarkdown("/ws/notes/actual.md", "/ws/diagrams/flujo compra.excalidraw")).toBe(
      "![flujo compra](../diagrams/flujo%20compra.excalidraw)"
    );

    const doc = "ver [[arq";
    const state = EditorState.create({ doc, extensions: [noteContext.of(context)] });
    const result = await linkCompletions(new CompletionContext(state, doc.length, false));
    expect(result?.from).toBe(4);
    // The note being edited is not offered.
    expect(result?.options.map((option) => option.displayLabel)).toEqual([
      "Arquitectura general",
      "flujo compra",
    ]);
  });
});

describe("live preview (in the DOM)", () => {
  let view: EditorView | null = null;
  afterEach(() => view?.destroy());

  const mount = (doc: string, cursor: number) => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        selection: { anchor: cursor },
        extensions: [
          noteContext.of(context),
          markdown({ base: markdownLanguage }),
          livePreview,
          embeds,
        ],
      }),
    });
    return view;
  };

  it("hides Markdown syntax except on the line being edited", () => {
    const doc = "# Título\n\nTexto **fuerte** y [enlace](a.md)\n\n- [ ] tarea";
    const editor = mount(doc, 0);
    const lines = [...editor.contentDOM.querySelectorAll(".cm-line")].map((l) => l.textContent);
    // Cursor on the heading: its "#" stays visible.
    expect(lines[0]).toBe("# Título");
    expect(lines[2]).toBe("Texto fuerte y enlace");
    expect(editor.contentDOM.querySelector("input.cm-md-task")).toBeTruthy();

    // Moving the cursor to the paragraph reveals its syntax and hides the heading's.
    editor.dispatch({ selection: { anchor: doc.indexOf("Texto") } });
    const after = [...editor.contentDOM.querySelectorAll(".cm-line")].map((l) => l.textContent);
    expect(after[0]).toBe("Título");
    expect(after[2]).toBe("Texto **fuerte** y [enlace](a.md)");
  });

  it("toggles a task from its checkbox", () => {
    const editor = mount("Intro\n- [ ] tarea", 0);
    editor.contentDOM.querySelector<HTMLInputElement>("input.cm-md-task")!.click();
    expect(editor.state.doc.toString()).toBe("Intro\n- [x] tarea");
  });

  it("renders diagram embeds and math blocks as widgets when not editing them", () => {
    const doc = "Intro\n![Flujo](../diagrams/flujo.excalidraw)\n$$\nx^2\n$$";
    const editor = mount(doc, 0);
    expect(editor.dom.querySelector(".cm-md-embed-diagram figcaption")?.textContent).toContain(
      "Flujo"
    );
    expect(editor.dom.querySelector(".cm-md-math-block .katex")).toBeTruthy();

    // Cursor on the embed line shows its Markdown instead.
    editor.dispatch({ selection: { anchor: doc.indexOf("![") } });
    expect(editor.dom.querySelector(".cm-md-embed")).toBeNull();
  });

  it("renders GitHub callouts and code fences as labels when not editing them", () => {
    const doc = "Intro\n> [!WARNING]\n> Cuidado\n\n```ts\nconst a = 1;\n```";
    const editor = mount(doc, 0);
    const callout = editor.contentDOM.querySelector(".cm-md-callout-warning");
    expect(callout?.textContent).toBe("Advertencia");
    // The marker is a label, not a link.
    expect(callout?.querySelector(".cm-md-link")).toBeNull();
    expect(editor.contentDOM.querySelector(".cm-md-code-lang")?.textContent).toBe("ts");

    // Editing inside the code block shows the fences again.
    editor.dispatch({ selection: { anchor: doc.indexOf("const") } });
    expect(editor.contentDOM.querySelector(".cm-md-code-lang")).toBeNull();
    expect(editor.contentDOM.querySelector(".cm-md-codeblock-first")?.textContent).toBe("```ts");
  });
});
