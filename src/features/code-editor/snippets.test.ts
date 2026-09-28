import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import {
  parseSnippetFile,
  snippetCompletionSource,
  snippetsForLanguage,
  toCodeMirrorTemplate,
} from "./snippets";

describe("toCodeMirrorTemplate", () => {
  it("converts tab stops, placeholders and the final cursor", () => {
    expect(toCodeMirrorTemplate("function ${1:name}($2) {\n\t$0\n}")).toBe(
      "function ${1:name}(${2}) \\{\n\t${0}\n\\}"
    );
  });

  it("uses the first option of a choice", () => {
    expect(toCodeMirrorTemplate("${1|public,private|} x")).toBe("${1:public} x");
  });

  it("flattens nested placeholders into the parent's default text", () => {
    expect(toCodeMirrorTemplate("${1:foo ${2:bar}}")).toBe("${1:foo bar}");
  });

  it("resolves variables and keeps defaults of unknown ones", () => {
    const vars = { filePath: "/w/src/Get-Thing.ps1", now: new Date(2026, 8, 28) };
    expect(toCodeMirrorTemplate("$TM_FILENAME_BASE ${CURRENT_YEAR}", vars)).toBe("Get-Thing 2026");
    expect(toCodeMirrorTemplate("${UNKNOWN_VAR:fallback}", vars)).toBe("fallback");
  });

  it("handles escapes and transforms", () => {
    expect(toCodeMirrorTemplate("\\$notAVar \\}")).toBe("$notAVar \\}");
    expect(toCodeMirrorTemplate("${1/(.*)/${1:/upcase}/} end")).toBe("${1} end");
  });

  it("produces templates CodeMirror accepts for a real PowerShell snippet", () => {
    const body = [
      "function ${1:Verb-Noun} {",
      "\t[CmdletBinding()]",
      "\tparam (",
      "\t\t$0",
      "\t)",
      "}",
    ].join("\n");
    const template = toCodeMirrorTemplate(body);
    expect(template).toContain("${1:Verb-Noun} \\{");
    expect(template).toContain("[CmdletBinding()]");
  });
});

describe("snippet files", () => {
  const file = {
    Function: {
      prefix: ["func", "function"],
      body: ["function $1 {", "}"],
      description: "A function",
    },
    Global: { prefix: "log", body: "console.log($1)", scope: "javascript, typescript" },
    Invalid: { body: "x" },
  };

  it("parses prefixes, bodies and scopes", () => {
    const snippets = parseSnippetFile(file);
    expect(snippets).toHaveLength(2);
    expect(snippets[0]).toMatchObject({ prefixes: ["func", "function"], body: "function $1 {\n}" });
    expect(snippets[1].scopes).toEqual(["javascript", "typescript"]);
  });

  it("filters by language", () => {
    const snippets = parseSnippetFile(file).map((s, i) => ({
      ...s,
      language: i === 0 ? "powershell" : undefined,
    }));
    expect(snippetsForLanguage(snippets, "powershell").map((s) => s.name)).toEqual(["Function"]);
    expect(snippetsForLanguage(snippets, "typescript").map((s) => s.name)).toEqual(["Global"]);
  });

  it("offers snippets as completions by prefix", async () => {
    const snippets = parseSnippetFile(file).slice(0, 1);
    const source = snippetCompletionSource(
      () => snippets,
      () => ({})
    );
    const state = EditorState.create({ doc: "fun" });
    const result = await source(new CompletionContext(state, 3, false));
    expect(result?.from).toBe(0);
    expect(result?.options.map((o) => o.label)).toEqual(["func", "function"]);
    expect(result?.options[0].detail).toBe("A function");
  });
});
