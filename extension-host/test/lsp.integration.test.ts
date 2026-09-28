import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HostClient } from "./host-client";

/**
 * A real LSP-based extension (vscode-languageclient, like PowerShell, Python,
 * Go, ...) talking to a real language server through the host's vscode API.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

const CLIENT = `
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");
let client;
exports.activate = async (context) => {
  const serverModule = context.asAbsolutePath("server.js");
  client = new LanguageClient(
    "demoLsp",
    "Demo LSP",
    { run: { module: serverModule, transport: TransportKind.ipc }, debug: { module: serverModule, transport: TransportKind.ipc } },
    { documentSelector: [{ scheme: "file", language: "demo" }] }
  );
  await client.start();
};
exports.deactivate = () => client && client.stop();
`;

const SERVER = `
const { createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind, DiagnosticSeverity, CompletionItemKind, MarkupKind } = require("vscode-languageserver/node");
const { TextDocument } = require("vscode-languageserver-textdocument");
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: ["-"], resolveProvider: true },
    hoverProvider: true,
    definitionProvider: true,
    documentFormattingProvider: true,
    signatureHelpProvider: { triggerCharacters: ["("] },
  },
}));
const validate = (doc) => {
  const diagnostics = [];
  doc.getText().split(/\\r?\\n/).forEach((line, i) => {
    const at = line.indexOf("TODO");
    if (at >= 0) diagnostics.push({ severity: DiagnosticSeverity.Warning, range: { start: { line: i, character: at }, end: { line: i, character: at + 4 } }, message: "Tarea pendiente", source: "demo-lsp" });
  });
  connection.sendDiagnostics({ uri: doc.uri, diagnostics });
};
documents.onDidChangeContent((e) => validate(e.document));
connection.onCompletion(() => [
  { label: "Get-Process", kind: CompletionItemKind.Function, data: 1 },
  { label: "Get-Service", kind: CompletionItemKind.Function, data: 2, insertTextFormat: 2, insertText: "Get-Service -Name \${1:name}" },
]);
connection.onCompletionResolve((item) => ({ ...item, detail: "cmdlet", documentation: { kind: MarkupKind.Markdown, value: "Doc de **" + item.label + "**" } }));
connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  const line = doc.getText().split(/\\r?\\n/)[params.position.line] || "";
  return { contents: { kind: MarkupKind.Markdown, value: "Línea: \`" + line + "\`" } };
});
connection.onDefinition((params) => ({ uri: params.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }));
connection.onDocumentFormatting((params) => {
  const doc = documents.get(params.textDocument.uri);
  return [{ range: { start: { line: 0, character: 0 }, end: doc.positionAt(doc.getText().length) }, newText: doc.getText().toUpperCase() }];
});
connection.onSignatureHelp(() => ({ signatures: [{ label: "Get-Process(Name)", parameters: [{ label: "Name" }] }], activeSignature: 0, activeParameter: 0 }));
documents.listen(connection);
connection.listen();
`;

describe("vscode-languageclient extension (real LSP)", () => {
  let root: string;
  let client: HostClient;
  let file: string;

  beforeAll(async () => {
    // Inside the repo so the extension resolves the LSP libraries from node_modules.
    root = mkdtempSync(path.join(here, ".tmp-lsp-"));
    const extensionPath = path.join(root, "extensions", "acme.lsp-1.0.0");
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(
      path.join(extensionPath, "package.json"),
      JSON.stringify({
        name: "lsp",
        publisher: "acme",
        main: "./extension.js",
        engines: { vscode: "^1.91.0" },
      })
    );
    writeFileSync(path.join(extensionPath, "extension.js"), CLIENT);
    writeFileSync(path.join(extensionPath, "server.js"), SERVER);
    file = path.join(root, "script.demo");
    writeFileSync(file, "hello\nTODO: algo\n");

    client = new HostClient();
    client.handlers["document.applyEdits"] = () => true;
    await client.waitFor("ready");
    await client.request("initialize", {
      extensions: [{ id: "acme.lsp", extensionPath, activationEvents: ["onLanguage:demo"] }],
      workspaceFolders: [root],
      settings: { defaults: {}, user: {} },
      storagePath: path.join(root, "data"),
    });
    await client.request("activateByEvent", { event: "onLanguage:demo" });
    client.notify("document.opened", {
      path: file,
      languageId: "demo",
      version: 1,
      text: "hello\nTODO: algo\n",
    });
    client.notify("editor.active", {
      path: file,
      selections: [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
    });
  }, 30000);

  afterAll(async () => {
    await client?.request("shutdown").catch(() => undefined);
    client?.child.kill();
    rmSync(root, { recursive: true, force: true });
  });

  it("activates without errors", async () => {
    expect(await client.request("getActivatedExtensions")).toContain("acme.lsp");
    const failures = client.notifications.filter((n) => n.method === "extension.activationFailed");
    expect(failures).toEqual([]);
  });

  it("receives diagnostics pushed by the server", async () => {
    const diag = await client.waitFor(
      "diagnostics.set",
      (p) => p.path === file && p.diagnostics.length > 0,
      15000
    );
    expect(diag.diagnostics[0]).toMatchObject({
      message: "Tarea pendiente",
      source: "demo-lsp",
      severity: 1,
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
    });
  });

  it("exposes the server's capabilities through registered providers", async () => {
    const caps = await client.request("languages.capabilities", { path: file });
    expect(caps).toMatchObject({
      completion: true,
      hover: true,
      definition: true,
      formatting: true,
      signatureHelp: true,
    });
    expect(caps.completionTriggers).toContain("-");
    expect(caps.signatureTriggers).toContain("(");
  });

  it("completes and resolves documentation via LSP", async () => {
    const result = await client.request("languages.completion", {
      path: file,
      position: { line: 0, character: 2 },
    });
    expect(result.items.map((i: any) => i.label)).toEqual(
      expect.arrayContaining(["Get-Process", "Get-Service"])
    );
    const service = result.items.find((i: any) => i.label === "Get-Service");
    expect(service).toMatchObject({ isSnippet: true, insertText: "Get-Service -Name ${1:name}" });
    const resolved = await client.request("languages.resolveCompletion", {
      id: result.id,
      itemId: service.id,
    });
    expect(resolved).toMatchObject({ detail: "cmdlet", documentation: "Doc de **Get-Service**" });
  });

  it("answers hover, definition, signature help and formatting via LSP", async () => {
    const hover = await client.request("languages.hover", {
      path: file,
      position: { line: 1, character: 1 },
    });
    expect(hover.contents.join("\n")).toContain("Línea: `TODO: algo`");
    const definition = await client.request("languages.definition", {
      path: file,
      position: { line: 1, character: 1 },
    });
    expect(definition[0]).toMatchObject({
      path: file,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    });
    const signature = await client.request("languages.signatureHelp", {
      path: file,
      position: { line: 0, character: 1 },
      triggerCharacter: "(",
    });
    expect(signature.signatures[0].label).toBe("Get-Process(Name)");
    const edits = await client.request("languages.format", {
      path: file,
      options: { tabSize: 4, insertSpaces: true },
    });
    expect(edits[0].newText).toBe("HELLO\nTODO: ALGO\n");
  });

  it("syncs incremental edits to the server", async () => {
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
    await client.waitFor(
      "diagnostics.set",
      (p) => p.path === file && p.diagnostics.length === 0,
      15000
    );
  });
});
