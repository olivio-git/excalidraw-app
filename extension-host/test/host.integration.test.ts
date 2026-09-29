import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HostClient } from "./host-client";

const SAMPLE = `
const vscode = require("vscode");
// Subclassing API classes at load time must work (vscode-languageclient does it).
class ProtocolItem extends vscode.CompletionItem {}
class FutureThing extends vscode.SomethingFromAFutureVersion {}

exports.activate = async (context) => {
  const out = vscode.window.createOutputChannel("Sample");
  out.appendLine("activated " + vscode.workspace.getConfiguration("sample").get("greeting"));
  console.log("this must not corrupt the protocol");

  context.subscriptions.push(
    vscode.commands.registerCommand("sample.hello", async (name) => {
      const choice = await vscode.window.showInformationMessage("Hello " + name, "Yes", "No");
      return "chose:" + choice;
    }),
    vscode.commands.registerCommand("sample.pick", async () => {
      const picked = await vscode.window.showQuickPick(["uno", "dos", "tres"], { placeHolder: "Elige" });
      const typed = await vscode.window.showInputBox({ prompt: "Nombre" });
      return picked + "/" + typed;
    })
  );

  vscode.window.registerTreeDataProvider("sample.tree", {
    getChildren: (el) => (el ? [] : ["alpha", "beta"]),
    getTreeItem: (el) => {
      const item = new vscode.TreeItem(el, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("symbol-method");
      item.command = { command: "sample.hello", title: "Hi", arguments: [el] };
      return item;
    },
  });

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  status.text = "$(sync) Sample";
  status.command = { command: "sample.hello", title: "", arguments: ["status"] };
  status.show();

  vscode.debug.registerDebugAdapterDescriptorFactory("x", {});

  await context.globalState.update("count", context.globalState.get("count", 0) + 1);

  const panel = vscode.window.createWebviewPanel("sample.view", "Sample View", vscode.ViewColumn.One, { enableScripts: true });
  const img = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "logo.png"));
  panel.webview.html = '<img src="' + img + '">';
  panel.webview.onDidReceiveMessage((m) => panel.webview.postMessage({ echo: m }));

  const writer = new vscode.EventEmitter();
  vscode.window.createTerminal({
    name: "Echo",
    pty: {
      onDidWrite: writer.event,
      open: () => writer.fire("hello pty\\r\\n"),
      close() {},
      handleInput: (data) => writer.fire(data.toUpperCase()),
    },
  });

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("sample.greeting")) {
      out.appendLine("greeting now " + vscode.workspace.getConfiguration("sample").get("greeting"));
    }
  });

  return { api: 42 };
};
`;

describe("extension host (real process)", () => {
  let root: string;
  let client: HostClient;
  let extensionPath: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "qori-exthost-"));
    extensionPath = path.join(root, "extensions", "acme.sample-1.0.0");
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(
      path.join(extensionPath, "package.json"),
      JSON.stringify({
        name: "sample",
        publisher: "acme",
        main: "./extension.js",
        activationEvents: ["onStartupFinished"],
        contributes: { commands: [{ command: "sample.hello", title: "Hello" }] },
      })
    );
    writeFileSync(path.join(extensionPath, "extension.js"), SAMPLE);

    const brokenPath = path.join(root, "extensions", "acme.broken-1.0.0");
    mkdirSync(brokenPath, { recursive: true });
    writeFileSync(
      path.join(brokenPath, "package.json"),
      JSON.stringify({ name: "broken", main: "./x.js" })
    );
    writeFileSync(
      path.join(brokenPath, "x.js"),
      "exports.activate = () => { throw new Error('boom'); };"
    );

    client = new HostClient();
    client.handlers["window.showMessage"] = () => 0;
    client.handlers["window.showQuickPick"] = () => 1;
    client.handlers["window.showInputBox"] = () => "Ana";
    await client.waitFor("ready");
    const info = await client.request("initialize", {
      extensions: [
        {
          id: "acme.sample",
          extensionPath,
          activationEvents: ["onStartupFinished", "onCommand:sample.hello"],
        },
        {
          id: "acme.broken",
          extensionPath: brokenPath,
          activationEvents: ["onCommand:broken.run"],
        },
      ],
      workspaceFolders: [root],
      settings: { defaults: { "sample.greeting": "Hola" }, user: {} },
      storagePath: path.join(root, "data"),
      assetPrefix: "asset://localhost/",
    });
    expect(info.pid).toBeGreaterThan(0);
    await client.waitFor("extension.activated", (p) => p.id === "acme.sample");
  });

  afterAll(async () => {
    await client?.request("shutdown").catch(() => undefined);
    client?.child.kill();
    rmSync(root, { recursive: true, force: true });
  });

  it("activates on startup and streams output channel text", async () => {
    expect(await client.waitFor("output.create")).toMatchObject({ name: "Sample" });
    const appended = await client.waitFor("output.append", (p) => p.text.includes("activated"));
    expect(appended.text).toBe("activated Hola\n");
    expect(client.stderr).toContain("this must not corrupt the protocol");
  });

  it("registers commands and round-trips UI requests", async () => {
    await client.waitFor("commands.registered", (p) => p.id === "sample.hello");
    expect(await client.request("executeCommand", { id: "sample.hello", args: ["Ana"] })).toBe(
      "chose:Yes"
    );
    const message = client.requests.find((r) => r.method === "window.showMessage")!.params;
    expect(message).toMatchObject({ level: "info", message: "Hello Ana", items: ["Yes", "No"] });

    expect(await client.request("executeCommand", { id: "sample.pick" })).toBe("dos/Ana");
    const pick = client.requests.find((r) => r.method === "window.showQuickPick")!.params;
    expect(pick.items.map((i: any) => i.label)).toEqual(["uno", "dos", "tres"]);
    expect(pick.options.placeHolder).toBe("Elige");
  });

  it("serves tree view children and runs item commands", async () => {
    await client.waitFor("tree.registered", (p) => p.viewId === "sample.tree");
    const children = await client.request("tree.getChildren", { viewId: "sample.tree" });
    expect(children.map((c: any) => c.label)).toEqual(["alpha", "beta"]);
    expect(children[0]).toMatchObject({ icon: { codicon: "symbol-method" }, collapsibleState: 0 });
    expect(children[0].command).toMatchObject({ command: "sample.hello" });

    const before = client.requests.filter((r) => r.method === "window.showMessage").length;
    await client.request("tree.executeItemCommand", {
      viewId: "sample.tree",
      handle: children[1].handle,
    });
    const messages = client.requests.filter((r) => r.method === "window.showMessage");
    expect(messages.length).toBe(before + 1);
    expect(messages.at(-1)!.params.message).toBe("Hello beta");
  });

  it("shows status bar items and runs their command with arguments", async () => {
    const update = await client.waitFor("statusBar.update");
    expect(update).toMatchObject({
      text: "$(sync) Sample",
      alignment: "right",
      priority: 10,
      hasCommand: true,
    });
    await client.request("statusBar.click", { id: update.id });
    expect(
      client.requests.filter((r) => r.method === "window.showMessage").at(-1)!.params.message
    ).toBe("Hello status");
  });

  it("creates webviews with asset URLs and relays messages both ways", async () => {
    const created = await client.waitFor("webview.create");
    expect(created).toMatchObject({ kind: "panel", viewType: "sample.view", title: "Sample View" });
    expect(created.options.enableScripts).toBe(true);
    const html = await client.waitFor("webview.html", (p) => p.handle === created.handle);
    const expected = `asset://localhost/${encodeURIComponent(path.join(extensionPath, "media", "logo.png"))}`;
    expect(html.html).toBe(`<img src="${expected}">`);

    client.notify("webview.message", { handle: created.handle, message: { ping: 1 } });
    const posted = await client.waitFor("webview.postMessage", (p) => p.handle === created.handle);
    expect(posted.message).toEqual({ echo: { ping: 1 } });
  });

  it("drives extension pseudoterminals", async () => {
    const terminal = await client.waitFor("terminal.create", (p) => p.pty === true);
    expect(terminal.name).toBe("Echo");
    client.notify("terminal.opened", { id: terminal.id, cols: 80, rows: 24 });
    expect((await client.waitFor("terminal.write", (p) => p.id === terminal.id)).data).toBe(
      "hello pty\r\n"
    );
    client.notify("terminal.input", { id: terminal.id, data: "abc" });
    await client.waitFor("terminal.write", (p) => p.data === "ABC");
  });

  it("degrades unsupported APIs to stubs and reports them", async () => {
    const warning = await client.waitFor("log", (p) =>
      p.message.includes("vscode.debug.registerDebugAdapterDescriptorFactory")
    );
    expect(warning.level).toBe("warn");
    await client.waitFor("log", (p) => p.message.includes("SomethingFromAFutureVersion"));
  });

  it("persists globalState to the extension's storage folder", async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const file = path.join(root, "data", "globalStorage", "acme.sample", "state.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ count: 1 });
  });

  it("notifies configuration changes", async () => {
    client.notify("configuration.changed", {
      defaults: { "sample.greeting": "Hola" },
      user: { "sample.greeting": "Buenas" },
    });
    await client.waitFor("output.append", (p) => p.text === "greeting now Buenas\n");
  });

  it("reports activation failures without killing the host", async () => {
    await expect(client.request("activate", { id: "acme.broken" })).rejects.toThrow("boom");
    const failed = await client.waitFor(
      "extension.activationFailed",
      (p) => p.id === "acme.broken"
    );
    expect(failed.message).toBe("boom");
    // The log points at the failing code, since bundled extensions are minified.
    const logged = await client.waitFor("log", (p) => p.message.includes("acme.broken"));
    expect(logged.message).toContain("Código donde falló: x.js:1:");
    expect(logged.message).toContain("⟪aquí⟫ new Error('boom')");
    expect(await client.request("getActivatedExtensions")).toContain("acme.sample");
  });

  it("forwards unknown commands to the app", async () => {
    client.handlers["commands.executeWorkbench"] = (params) => `app:${params.id}`;
    const result = await client.request("executeCommand", { id: "sample.forward" });
    expect(result).toBe("app:sample.forward");
  });
});
