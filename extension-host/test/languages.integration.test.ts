import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HostClient } from "./host-client";

const LANG_EXTENSION = `
const vscode = require("vscode");
exports.activate = (context) => {
  const selector = { language: "demo" };
  const diagnostics = vscode.languages.createDiagnosticCollection("demo");
  const lint = (doc) => {
    if (doc.languageId !== "demo") return;
    const found = [];
    doc.getText().split(/\\n/).forEach((line, i) => {
      const at = line.indexOf("TODO");
      if (at >= 0) found.push(new vscode.Diagnostic(new vscode.Range(i, at, i, at + 4), "Pendiente", vscode.DiagnosticSeverity.Warning));
    });
    diagnostics.set(doc.uri, found);
  };
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(lint),
    vscode.workspace.onDidChangeTextDocument((e) => lint(e.document)),
    vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems(doc, pos) {
        const word = doc.getWordRangeAtPosition(pos);
        const item = new vscode.CompletionItem("Get-Thing", vscode.CompletionItemKind.Function);
        item.insertText = new vscode.SnippetString("Get-Thing -Name \${1:x}");
        item.detail = "cmdlet";
        const plain = new vscode.CompletionItem({ label: "Set-Thing", description: "módulo" }, vscode.CompletionItemKind.Function);
        if (word) plain.range = word;
        return [item, plain];
      },
      resolveCompletionItem(item) { item.documentation = new vscode.MarkdownString("**Obtiene** cosas"); return item; },
    }, "-"),
    vscode.languages.registerHoverProvider(selector, {
      provideHover(doc, pos) {
        const range = doc.getWordRangeAtPosition(pos);
        return range ? new vscode.Hover(new vscode.MarkdownString("Palabra: \`" + doc.getText(range) + "\`"), range) : undefined;
      },
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition(doc) { return new vscode.Location(doc.uri, new vscode.Position(0, 0)); },
    }),
    vscode.languages.registerSignatureHelpProvider(selector, {
      provideSignatureHelp() {
        const help = new vscode.SignatureHelp();
        const sig = new vscode.SignatureInformation("Get-Thing(Name, Count)", "Firma");
        sig.parameters = [new vscode.ParameterInformation("Name"), new vscode.ParameterInformation("Count")];
        help.signatures = [sig];
        help.activeParameter = 1;
        return help;
      },
    }, "(", ","),
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      provideDocumentFormattingEdits(doc) {
        return [vscode.TextEdit.replace(new vscode.Range(0, 0, doc.lineCount, 0), doc.getText().trim().toUpperCase() + "\\n")];
      },
    }),
    vscode.commands.registerCommand("demo.upper", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return "no-editor";
      await editor.edit((b) => b.insert(new vscode.Position(0, 0), ">> "));
      return editor.document.fileName + "@" + editor.selection.active.line;
    }),
    vscode.commands.registerCommand("demo.changes", () => changes),
  );
  const changes = [];
  vscode.workspace.onDidChangeTextDocument((e) => changes.push(e.contentChanges.map((c) => c.text + "@" + c.range.start.line + ":" + c.range.start.character).join("|") + " v" + e.document.version + " " + JSON.stringify(e.document.getText())));
};
`;

describe("language features through the host", () => {
  let root: string;
  let client: HostClient;
  let file: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "qori-lang-"));
    const extensionPath = path.join(root, "extensions", "acme.lang-1.0.0");
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(
      path.join(extensionPath, "package.json"),
      JSON.stringify({ name: "lang", publisher: "acme", main: "./extension.js" })
    );
    writeFileSync(path.join(extensionPath, "extension.js"), LANG_EXTENSION);
    file = path.join(root, "main.demo");
    writeFileSync(file, "hello world\nTODO fix\n");

    client = new HostClient();
    client.handlers["document.applyEdits"] = () => true;
    await client.waitFor("ready");
    await client.request("initialize", {
      extensions: [{ id: "acme.lang", extensionPath, activationEvents: ["onLanguage:demo"] }],
      workspaceFolders: [root],
      settings: { defaults: {}, user: {} },
      storagePath: path.join(root, "data"),
    });
    await client.request("activateByEvent", { event: "onLanguage:demo" });
    client.notify("document.opened", {
      path: file,
      languageId: "demo",
      version: 1,
      text: "hello world\nTODO fix\n",
    });
  });

  afterAll(async () => {
    await client?.request("shutdown").catch(() => undefined);
    client?.child.kill();
    rmSync(root, { recursive: true, force: true });
  });

  it("publishes diagnostics for opened documents", async () => {
    const diag = await client.waitFor(
      "diagnostics.set",
      (p) => p.path === file && p.diagnostics.length > 0
    );
    expect(diag).toMatchObject({ owner: "demo" });
    expect(diag.diagnostics[0]).toMatchObject({
      message: "Pendiente",
      severity: 1,
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
    });
  });

  it("reports capabilities with trigger characters", async () => {
    const caps = await client.request("languages.capabilities", { path: file });
    expect(caps).toMatchObject({
      completion: true,
      completionTriggers: ["-"],
      hover: true,
      definition: true,
      signatureHelp: true,
      signatureTriggers: ["(", ","],
      formatting: true,
    });
  });

  it("returns completions, including snippets, ranges and resolved documentation", async () => {
    const result = await client.request("languages.completion", {
      path: file,
      position: { line: 0, character: 3 },
    });
    expect(result.items.map((i: any) => i.label)).toEqual(["Get-Thing", "Set-Thing"]);
    expect(result.items[0]).toMatchObject({
      isSnippet: true,
      insertText: "Get-Thing -Name ${1:x}",
      detail: "cmdlet",
      kind: 2,
    });
    expect(result.items[1]).toMatchObject({
      labelDescription: "módulo",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    });
    const resolved = await client.request("languages.resolveCompletion", {
      id: result.id,
      itemId: result.items[0].id,
    });
    expect(resolved.documentation).toBe("**Obtiene** cosas");
  });

  it("filters completion providers by trigger character", async () => {
    const none = await client.request("languages.completion", {
      path: file,
      position: { line: 0, character: 3 },
      triggerCharacter: ".",
    });
    expect(none.items).toEqual([]);
    const some = await client.request("languages.completion", {
      path: file,
      position: { line: 0, character: 3 },
      triggerCharacter: "-",
    });
    expect(some.items).toHaveLength(2);
  });

  it("answers hover, definition, signature help and formatting", async () => {
    const hover = await client.request("languages.hover", {
      path: file,
      position: { line: 0, character: 8 },
    });
    expect(hover).toEqual({
      contents: ["Palabra: `world`"],
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
    });

    const definition = await client.request("languages.definition", {
      path: file,
      position: { line: 1, character: 1 },
    });
    expect(definition).toEqual([
      { path: file, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    ]);

    const signature = await client.request("languages.signatureHelp", {
      path: file,
      position: { line: 0, character: 2 },
      triggerCharacter: "(",
    });
    expect(signature).toMatchObject({
      activeParameter: 1,
      signatures: [
        { label: "Get-Thing(Name, Count)", parameters: [{ label: "Name" }, { label: "Count" }] },
      ],
    });

    const edits = await client.request("languages.format", {
      path: file,
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(edits[0].newText).toBe("HELLO WORLD\nTODO FIX\n");
  });

  it("applies incremental changes and re-lints", async () => {
    client.notify("document.changed", {
      path: file,
      version: 2,
      changes: [
        {
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
          text: "DONE",
        },
      ],
    });
    await client.waitFor("diagnostics.set", (p) => p.path === file && p.diagnostics.length === 0);
    const changes = await client.request("executeCommand", { id: "demo.changes" });
    expect(changes.at(-1)).toBe('DONE@1:0 v2 "hello world\\nDONE fix\\n"');
  });

  it("exposes the active editor and applies TextEditor.edit through the app", async () => {
    client.notify("editor.active", {
      path: file,
      selections: [{ anchor: { line: 1, character: 2 }, active: { line: 1, character: 2 } }],
    });
    await new Promise((r) => setTimeout(r, 50));
    const result = await client.request("executeCommand", { id: "demo.upper" });
    expect(result).toBe(`${file}@1`);
    const apply = client.requests.find((r) => r.method === "document.applyEdits")!.params;
    expect(apply).toMatchObject({
      path: file,
      edits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: ">> ",
        },
      ],
    });
  });

  it("closes documents", async () => {
    client.notify("document.closed", { path: file });
    await expect(
      client.request("languages.hover", { path: file, position: { line: 0, character: 1 } })
    ).rejects.toThrow(/not open/);
  });
});
