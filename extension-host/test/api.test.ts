import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const types = require("../src/api/types.cjs");
const { TextDocumentData, applyTextEdits } = require("../src/api/documents.cjs");
const { createConfiguration } = require("../src/api/configuration.cjs");
const { globToRegExp } = require("../src/api/glob.cjs");
const { stubNamespace } = require("../src/api/stubs.cjs");
const { formatL10n } = require("../src/api/index.cjs");

const {
  Uri,
  Position,
  Range,
  Selection,
  EventEmitter,
  CancellationTokenSource,
  SnippetString,
  TextEdit,
} = types;

describe("Uri", () => {
  it("round-trips file paths", () => {
    const uri = Uri.file("/home/ana/proyecto/main.ps1");
    expect(uri.scheme).toBe("file");
    expect(uri.fsPath).toBe("/home/ana/proyecto/main.ps1");
    expect(uri.toString()).toBe("file:///home/ana/proyecto/main.ps1");
    expect(Uri.parse(uri.toString()).fsPath).toBe(uri.fsPath);
  });

  it("parses other schemes and encodes on toString", () => {
    const uri = Uri.parse("https://example.com/a b?q=1#frag");
    expect(uri).toMatchObject({
      scheme: "https",
      authority: "example.com",
      path: "/a b",
      query: "q=1",
      fragment: "frag",
    });
    expect(uri.toString()).toBe("https://example.com/a%20b?q%3D1#frag");
    expect(uri.toString(true)).toBe("https://example.com/a b?q=1#frag");
  });

  it("supports joinPath and with", () => {
    const base = Uri.file("/ext");
    expect(Uri.joinPath(base, "media", "../icons/a.svg").fsPath).toBe("/ext/icons/a.svg");
    expect(base.with({ scheme: "untitled" }).scheme).toBe("untitled");
  });
});

describe("Position / Range / Selection", () => {
  it("compares and translates positions", () => {
    const a = new Position(1, 5);
    const b = new Position(2, 0);
    expect(a.isBefore(b)).toBe(true);
    expect(a.compareTo(b)).toBe(-1);
    expect(a.translate(1, -5).isEqual(b)).toBe(true);
    expect(a.with({ character: 0 })).toEqual(new Position(1, 0));
  });

  it("normalizes, contains, intersects and unions ranges", () => {
    const r = new Range(3, 0, 1, 0);
    expect(r.start.line).toBe(1);
    expect(r.contains(new Position(2, 4))).toBe(true);
    expect(r.intersection(new Range(0, 0, 2, 0))?.isEqual(new Range(1, 0, 2, 0))).toBe(true);
    expect(r.union(new Range(5, 0, 6, 0)).end.line).toBe(6);
    expect(new Range(1, 1, 1, 1).isEmpty).toBe(true);
  });

  it("tracks selection direction", () => {
    const s = new Selection(4, 0, 2, 0);
    expect(s.isReversed).toBe(true);
    expect(s.start.line).toBe(2);
  });
});

describe("events, cancellation, snippets", () => {
  it("fires to listeners and disposes subscriptions", () => {
    const emitter = new EventEmitter();
    const seen: number[] = [];
    const sub = emitter.event((v: number) => seen.push(v));
    emitter.fire(1);
    sub.dispose();
    emitter.fire(2);
    expect(seen).toEqual([1]);
  });

  it("cancels tokens once", () => {
    const source = new CancellationTokenSource();
    let calls = 0;
    source.token.onCancellationRequested(() => calls++);
    source.cancel();
    source.cancel();
    expect(source.token.isCancellationRequested).toBe(true);
    expect(calls).toBe(1);
  });

  it("builds snippet strings", () => {
    const snippet = new SnippetString("function ")
      .appendPlaceholder("name")
      .appendText("() {}")
      .appendTabstop(0);
    expect(snippet.value).toBe("function ${1:name}() {\\}$0");
  });
});

describe("TextDocument", () => {
  const data = new TextDocumentData(
    Uri.file("/w/a.ps1"),
    "powershell",
    1,
    "param($x)\r\nWrite-Host $x\nend"
  );
  const doc = data.document;

  it("exposes lines with CRLF and LF endings", () => {
    expect(doc.lineCount).toBe(3);
    expect(doc.lineAt(0).text).toBe("param($x)");
    expect(doc.lineAt(1).text).toBe("Write-Host $x");
    expect(doc.lineAt(1).firstNonWhitespaceCharacterIndex).toBe(0);
    expect(doc.eol).toBe(types.EndOfLine.CRLF);
  });

  it("converts offsets and positions", () => {
    const pos = doc.positionAt(13);
    expect(pos).toEqual(new Position(1, 2));
    expect(doc.offsetAt(pos)).toBe(13);
    expect(doc.getText(new Range(1, 0, 1, 10))).toBe("Write-Host");
    expect(doc.validatePosition(new Position(99, 99))).toEqual(new Position(2, 3));
  });

  it("finds words and applies incremental changes", () => {
    expect(doc.getText(doc.getWordRangeAtPosition(new Position(1, 3)))).toBe("Write");
    data.applyChanges(
      [
        {
          range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } },
          text: "done",
        },
      ],
      2
    );
    expect(doc.lineAt(2).text).toBe("done");
    expect(doc.version).toBe(2);
  });

  it("applies TextEdits against the original text", () => {
    const text = "one two three";
    const edits = [
      TextEdit.replace(new Range(0, 0, 0, 3), "1"),
      TextEdit.insert(new Position(0, 13), "!"),
    ];
    expect(applyTextEdits(text, edits)).toBe("1 two three!");
  });
});

describe("configuration", () => {
  const host = {
    rpc: { on() {}, request: async () => undefined },
    toTransferable: (v: unknown) => v,
  };
  const config = createConfiguration(host);
  config.setValues(
    { "demo.format.enable": true, "demo.format.indent": 4, "demo.name": "x" },
    { "demo.format.indent": 2 }
  );

  it("reads flat keys, nested sections and defaults", () => {
    const section = config.getConfiguration("demo");
    expect(section.get("name")).toBe("x");
    expect(section.get("format")).toEqual({ enable: true, indent: 2 });
    expect(section.get("missing", "fallback")).toBe("fallback");
    expect(section.format).toEqual({ enable: true, indent: 2 });
    expect(config.getConfiguration("demo.format").get("indent")).toBe(2);
  });

  it("inspects default and user values", () => {
    expect(config.getConfiguration("demo").inspect("format.indent")).toMatchObject({
      defaultValue: 4,
      globalValue: 2,
    });
  });

  it("fires change events with affectsConfiguration", () => {
    let affected: boolean | undefined;
    config.onDidChangeConfiguration((e: { affectsConfiguration(s: string): boolean }) => {
      affected = e.affectsConfiguration("demo.format");
    });
    config.setValues(
      { "demo.format.enable": true, "demo.format.indent": 4, "demo.name": "x" },
      { "demo.format.indent": 8 }
    );
    expect(affected).toBe(true);
  });
});

describe("helpers", () => {
  it("matches globs", () => {
    expect(globToRegExp("**/*.ps1").test("scripts/a/b.ps1")).toBe(true);
    expect(globToRegExp("**/*.ps1").test("b.ps1")).toBe(true);
    expect(globToRegExp("*.{ts,js}").test("x.js")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
  });

  it("formats l10n messages", () => {
    expect(formatL10n("Hola {0}, tienes {1}", ["Ana", 3])).toBe("Hola Ana, tienes 3");
    expect(formatL10n("Hola {name}", { name: "Ana" })).toBe("Hola Ana");
  });

  it("stubs missing namespace members by name", () => {
    const missing: string[] = [];
    const ns = stubNamespace("debug", { activeDebugSession: undefined }, (m: string) =>
      missing.push(m)
    );
    expect(ns.activeDebugSession).toBeUndefined();
    expect(typeof ns.registerDebugConfigurationProvider("x", {}).dispose).toBe("function");
    expect(typeof ns.onDidStartDebugSession(() => {}).dispose).toBe("function");
    expect(ns.breakpoints).toEqual([]);
    expect(ns.getSession()).toBeUndefined();
    expect(missing).toEqual([
      "debug.registerDebugConfigurationProvider",
      "debug.onDidStartDebugSession",
      "debug.breakpoints",
      "debug.getSession",
    ]);
  });
});

describe("vscode module object", () => {
  const { createVscodeApi } = require("../src/api/index.cjs");
  const { ExtensionHost } = require("../src/host.cjs");
  const rpc = new Proxy(
    { request: async () => undefined },
    { get: (target: Record<string, unknown>, prop: string) => target[prop] ?? (() => {}) }
  );

  function vscodeFor() {
    const host = new ExtensionHost(rpc);
    const missing: string[] = [];
    host.reportMissing = (_ext: unknown, member: string) => missing.push(member);
    const api = createVscodeApi(host, {
      id: "acme.test",
      extensionPath: "/tmp/acme",
      packageJSON: {},
      contributes: {},
    });
    return { api, missing };
  }

  // esbuild's __toESM, as emitted in bundled extensions: own props are copied
  // onto an object whose prototype is the module's.
  function toESM(mod: object) {
    const target = Object.create(Object.getPrototypeOf(mod));
    Object.defineProperty(target, "default", { value: mod, enumerable: true });
    for (const key of Object.getOwnPropertyNames(mod)) {
      Object.defineProperty(target, key, {
        get: () => (mod as Record<string, unknown>)[key],
        enumerable: true,
      });
    }
    return target;
  }

  it("builds notebook outputs at load time (Claude Code does)", () => {
    const vscode = toESM(vscodeFor().api);
    const item = vscode.NotebookCellOutputItem.error(new Error("x"));
    expect(item.mime).toBe("application/vnd.code.notebook.error");
    expect(JSON.parse(Buffer.from(item.data).toString()).message).toBe("x");
  });

  it("stubs unknown members read through a bundler's namespace copy", () => {
    const { api, missing } = vscodeFor();
    const vscode = toESM(api);
    class Sub extends vscode.FutureClass {}
    expect(new Sub()).toBeInstanceOf(vscode.FutureClass);
    expect(vscode.FutureClass.create(1)).toBeInstanceOf(vscode.FutureClass);
    expect(vscode.FutureClass.Member).toBeUndefined();
    expect(vscode.futureNamespace.registerThing()).toHaveProperty("dispose");
    expect(vscode.then).toBeUndefined();
    expect(String(vscode)).toBe("[object Object]");
    expect(vscode.futureNamespace).toBe(vscode.futureNamespace);
    expect([...new Set(missing)]).toEqual([
      "FutureClass",
      "futureNamespace",
      "futureNamespace.registerThing",
    ]);
  });
});

describe("webview asset URLs", () => {
  const { ExtensionHost } = require("../src/host.cjs");
  const rpc = new Proxy(
    {},
    { get: (target: Record<string, unknown>, prop: string) => target[prop] ?? (() => {}) }
  );

  it("keeps paths readable under the qori-ext protocol", () => {
    const host = new ExtensionHost(rpc);
    host.config = { webviewAssetPrefix: "qori-ext://localhost/", webviewCspSource: "qori-ext:" };
    expect(host.webviewAssetUrl("/home/ana/ext one/webview/index.js")).toBe(
      "qori-ext://localhost/home/ana/ext%20one/webview/index.js"
    );
    expect(host.webviewAssetUrl("C:\\Users\\ana\\index.js")).toBe(
      "qori-ext://localhost/C%3A/Users/ana/index.js"
    );
    expect(host.webviewCspSource()).toBe("qori-ext:");
  });

  it("falls back to the asset protocol", () => {
    const host = new ExtensionHost(rpc);
    host.config = { assetPrefix: "asset://localhost/" };
    expect(host.webviewAssetUrl("/a/b.js")).toBe("asset://localhost/%2Fa%2Fb.js");
  });
});
