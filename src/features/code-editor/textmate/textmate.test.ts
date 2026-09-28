import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, beforeAll } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as oniguruma from "vscode-oniguruma";
import type { IOnigLib } from "vscode-textmate";
import { TextMateService } from "./textmate-service";
import {
  LineStateCache,
  fontStyleOf,
  foregroundOf,
  textMateHighlighting,
  textMateThemeCss,
} from "./highlighter";
import { buildTextMateTheme } from "./token-theme";

const require = createRequire(import.meta.url);

/** Tiny grammar in the shape extensions ship (`contributes.grammars`). */
const grammar = {
  scopeName: "source.demo",
  patterns: [
    { name: "comment.line.demo", match: "#.*$" },
    { name: "keyword.control.demo", match: "\\b(function|if|return)\\b" },
    { name: "string.quoted.double.demo", begin: '"', end: '"' },
    {
      name: "comment.block.demo",
      begin: "<#",
      end: "#>",
    },
  ],
};

let onigLib: Promise<IOnigLib>;

beforeAll(() => {
  onigLib = (async () => {
    const wasm = readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    return {
      createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text: string) => new oniguruma.OnigString(text),
    };
  })();
});

function createService() {
  const service = new TextMateService(() => onigLib);
  service.setSources([
    {
      extensionId: "acme.demo",
      contribution: {
        language: "demo",
        scopeName: "source.demo",
        path: "syntaxes/demo.tmLanguage.json",
      },
      read: async () => JSON.stringify(grammar),
    },
  ]);
  service.setTheme(buildTextMateTheme(true, null, {}));
  return service;
}

describe("TextMateService", () => {
  it("loads contributed grammars by language and colors tokens with the theme", async () => {
    const service = createService();
    expect(service.hasGrammarFor("demo")).toBe(true);
    expect(service.hasGrammarFor("other")).toBe(false);

    const loaded = await service.loadGrammar("demo");
    expect(loaded).not.toBeNull();
    const { tokens } = loaded!.tokenizeLine2('function "x" # hi', null);
    const colorMap = service.getColorMap();
    const colorAt = (index: number) => colorMap[foregroundOf(tokens[2 * index + 1])].toUpperCase();

    // function → keyword.control (#C586C0 in Dark+), string → #CE9178, comment → #6A9955
    expect(colorAt(0)).toBe("#C586C0");
    const starts = Array.from({ length: tokens.length / 2 }, (_, i) => tokens[2 * i]);
    expect(starts).toContain(9); // `"x"` starts at column 9
    const stringToken = starts.indexOf(9);
    expect(colorAt(stringToken)).toBe("#CE9178");
    expect(colorAt(starts.length - 1)).toBe("#6A9955");
    expect(fontStyleOf(tokens[1])).toBe(0);
  });

  it("uses the active VS Code theme's tokenColors when present", async () => {
    const service = createService();
    service.setTheme(
      buildTextMateTheme(
        true,
        [{ scope: "keyword", settings: { foreground: "#FF0000", fontStyle: "italic" } }],
        {}
      )
    );
    const loaded = await service.loadGrammar("demo");
    const { tokens } = loaded!.tokenizeLine2("return", null);
    expect(service.getColorMap()[foregroundOf(tokens[1])].toUpperCase()).toBe("#FF0000");
    expect(fontStyleOf(tokens[1]) & 1).toBe(1);
  });

  it("returns null for languages without grammar", async () => {
    expect(await createService().loadGrammar("nope")).toBeNull();
  });
});

describe("TextMate highlighting in CodeMirror", () => {
  it("keeps multi-line state across lines and re-tokenizes after edits", async () => {
    const service = createService();
    const loaded = (await service.loadGrammar("demo"))!;
    const state = EditorState.create({ doc: "<# block\nstill comment\n#>\nif" });
    const cache = new LineStateCache(loaded);
    const second = cache.tokenize(state.doc, 2, cache.stateBefore(state.doc, 2));
    const colorMap = service.getColorMap();
    expect(colorMap[foregroundOf(second.tokens[1])].toUpperCase()).toBe("#6A9955");

    cache.invalidateFrom(1);
    const fourth = cache.tokenize(state.doc, 4, cache.stateBefore(state.doc, 4));
    expect(colorMap[foregroundOf(fourth.tokens[1])].toUpperCase()).toBe("#C586C0");
  });

  it("decorates the editor with theme classes", async () => {
    const service = createService();
    const loaded = (await service.loadGrammar("demo"))!;
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'function main # comment\n  return "ok"',
        extensions: [textMateHighlighting(loaded, () => service.getThemeVersion())],
      }),
    });
    const classes = [...view.contentDOM.querySelectorAll("[class*='tm-f']")].map(
      (el) => el.className
    );
    expect(classes.length).toBeGreaterThanOrEqual(3);
    const css = textMateThemeCss(service.getColorMap());
    for (const className of classes) {
      expect(css).toContain(`.${className.split(" ")[0]}{color:`);
    }
    view.destroy();
    parent.remove();
  });
});
