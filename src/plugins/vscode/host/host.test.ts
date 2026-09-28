import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// plugin-api pulls in Excalidraw, which does not load under jsdom.
vi.mock("@/plugins/plugin-api", () => ({ createPluginAPI: vi.fn() }));
vi.mock("../extension-registry", () => ({
  loadInstalledExtensions: vi.fn(async () => []),
  onInstalledExtensionsChanged: vi.fn(() => () => undefined),
  extensionSettings: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));
vi.mock("../extension-settings", () => ({
  readUserExtensionSettings: vi.fn(async () => ({ "demo.flag": true })),
  onExtensionSettingsChanged: vi.fn(() => () => undefined),
  updateUserExtensionSetting: vi.fn(async () => undefined),
}));

import { HostConnection, type HostTransport } from "./host-connection";
import { ExtensionHostService } from "./extension-host-service";
import { useExtensionHostStore } from "./host-store";
import { useOutputStore, HOST_LOG_CHANNEL } from "./output-store";
import { useStatusBarStore, sortStatusBarItems } from "./statusbar-store";
import { useTreeStore, useWebviewStore, webviewMessages } from "./view-stores";
import { parseLabelWithIcons } from "./codicons";
import { buildWebviewDocument, buildWebviewTheme, sandboxFor } from "./webview-document";
import { buildViewContainers, buildViewMenus, SHARED_CONTAINER_ID } from "./view-containers";
import { emptyContributions } from "../contributions";
import type { InstalledExtension } from "../extension-storage";
import { executeExtensionCommand } from "../extension-commands";

/** In-memory transport with a scripted fake host on the other side. */
class FakeTransport implements HostTransport {
  sent: any[] = [];
  started = 0;
  stopped = 0;
  private messageListeners = new Set<(line: string) => void>();
  private exitListeners = new Set<(code: number | null) => void>();
  onRequest: (message: any) => unknown = () => null;

  async start() {
    this.started++;
    queueMicrotask(() => this.emit({ type: "ntf", method: "ready", params: { pid: 1 } }));
    return { pid: 42, runtime: "node (fake)" };
  }
  async send(line: string) {
    const message = JSON.parse(line);
    this.sent.push(message);
    if (message.type === "req") {
      const result = await this.onRequest(message);
      this.emit({ type: "res", id: message.id, result: result ?? null });
    }
  }
  async stop() {
    this.stopped++;
  }
  onMessage(listener: (line: string) => void) {
    this.messageListeners.add(listener);
    return () => void this.messageListeners.delete(listener);
  }
  onLog() {
    return () => undefined;
  }
  onExit(listener: (code: number | null) => void) {
    this.exitListeners.add(listener);
    return () => void this.exitListeners.delete(listener);
  }
  emit(message: unknown) {
    const line = JSON.stringify(message);
    this.messageListeners.forEach((listener) => listener(line));
  }
  exit(code: number) {
    this.exitListeners.forEach((listener) => listener(code));
  }
}

function extension(overrides: Partial<InstalledExtension> = {}): InstalledExtension {
  return {
    id: "acme.demo",
    version: "1.0.0",
    displayName: "Demo",
    dir: "acme.demo-1.0.0",
    iconThemes: [],
    colorThemes: [],
    contributions: {
      ...emptyContributions(),
      commands: [{ command: "demo.run", title: "Run" }],
    },
    main: "out/extension.js",
    activationEvents: ["onStartupFinished"],
    ...overrides,
  };
}

describe("HostConnection", () => {
  it("correlates responses, answers requests and dispatches notifications", async () => {
    const transport = new FakeTransport();
    transport.onRequest = (m) => (m.method === "echo" ? m.params.value : null);
    const connection = new HostConnection(transport);
    expect(await connection.request("echo", { value: 7 })).toBe(7);

    const notified = vi.fn();
    connection.on("output.append", notified);
    connection.on("window.showMessage", ({ message }) => `seen:${message}`);
    transport.emit({ type: "ntf", method: "output.append", params: { text: "x" } });
    transport.emit({
      type: "req",
      id: 99,
      method: "window.showMessage",
      params: { message: "hi" },
    });
    await vi.waitFor(() => expect(transport.sent.find((m) => m.id === 99)).toBeDefined());
    expect(notified).toHaveBeenCalledWith({ text: "x" });
    expect(transport.sent.find((m) => m.id === 99)).toEqual({
      type: "res",
      id: 99,
      result: "seen:hi",
    });

    transport.emit({ type: "req", id: 100, method: "nope", params: {} });
    await vi.waitFor(() => expect(transport.sent.find((m) => m.id === 100)?.error).toBeDefined());
  });

  it("rejects pending requests when disposed", async () => {
    const transport = new FakeTransport();
    transport.send = async (line) => void transport.sent.push(JSON.parse(line));
    const connection = new HostConnection(transport);
    const pending = connection.request("slow");
    connection.dispose("gone");
    await expect(pending).rejects.toThrow("gone");
  });
});

describe("ExtensionHostService", () => {
  let transport: FakeTransport;
  let service: ExtensionHostService;

  beforeEach(() => {
    transport = new FakeTransport();
    service = new ExtensionHostService({
      transport: () => transport,
      paths: async () => ({
        extensionsDir: "/data/extensions",
        storagePath: "/data/extension-data",
      }),
      assetPrefix: async () => "asset://localhost/",
      isAvailable: () => true,
    });
    useExtensionHostStore.setState({ status: "idle", error: null, activated: [], failed: {} });
  });

  afterEach(async () => {
    await service.stop();
  });

  it("stays idle without extensions that have code", async () => {
    await service.start([extension({ main: undefined })]);
    expect(transport.started).toBe(0);
    expect(useExtensionHostStore.getState().status).toBe("idle");
  });

  it("starts, initializes with paths/settings and routes extension commands", async () => {
    transport.onRequest = (m) => (m.method === "executeCommand" ? `ran:${m.params.id}` : null);
    await service.start([extension()]);
    expect(useExtensionHostStore.getState()).toMatchObject({
      status: "running",
      runtime: "node (fake)",
    });

    const init = transport.sent.find((m) => m.method === "initialize").params;
    expect(init.extensions).toEqual([
      {
        id: "acme.demo",
        extensionPath: "/data/extensions/acme.demo-1.0.0",
        main: "out/extension.js",
        activationEvents: ["onStartupFinished", "onCommand:demo.run"],
      },
    ]);
    expect(init).toMatchObject({
      storagePath: "/data/extension-data",
      assetPrefix: "asset://localhost/",
    });
    expect(init.settings.user).toEqual({ "demo.flag": true });

    expect(await executeExtensionCommand("demo.run", 1)).toBe("ran:demo.run");
    expect(transport.sent.find((m) => m.method === "executeCommand").params).toEqual({
      id: "demo.run",
      args: [1],
    });
  });

  it("feeds host notifications into the UI stores", async () => {
    await service.start([extension()]);
    transport.emit({ type: "ntf", method: "log", params: { level: "info", message: "hola" } });
    transport.emit({ type: "ntf", method: "output.create", params: { id: "o1", name: "Demo" } });
    transport.emit({ type: "ntf", method: "output.append", params: { id: "o1", text: "line\n" } });
    transport.emit({
      type: "ntf",
      method: "statusBar.update",
      params: { id: "s1", alignment: "left", priority: 1, text: "$(check) ok", hasCommand: false },
    });
    transport.emit({
      type: "ntf",
      method: "tree.registered",
      params: { viewId: "demo.tree", canSelectMany: false, showCollapseAll: false },
    });
    transport.emit({ type: "ntf", method: "extension.activated", params: { id: "acme.demo" } });

    await vi.waitFor(() =>
      expect(useExtensionHostStore.getState().activated).toEqual(["acme.demo"])
    );
    const channels = useOutputStore.getState().channels;
    expect(channels.find((c) => c.id === HOST_LOG_CHANNEL)?.text).toContain("[info] hola");
    expect(channels.find((c) => c.id === "o1")?.text).toBe("line\n");
    expect(useStatusBarStore.getState().items.s1.text).toBe("$(check) ok");
    expect(useTreeStore.getState().views["demo.tree"]).toBeDefined();
  });

  it("reports an unexpected exit and clears host UI", async () => {
    await service.start([extension()]);
    transport.emit({
      type: "ntf",
      method: "statusBar.update",
      params: { id: "s1", alignment: "left", priority: 0, text: "x", hasCommand: false },
    });
    await vi.waitFor(() => expect(useStatusBarStore.getState().items.s1).toBeDefined());
    transport.exit(1);
    await vi.waitFor(() => expect(useExtensionHostStore.getState().status).toBe("error"));
    expect(useStatusBarStore.getState().items).toEqual({});
    expect(transport.stopped).toBe(1);
  });

  it("restarts only when the set of code extensions changes", async () => {
    await service.start([extension()]);
    await service.handleExtensionsChanged([extension()]);
    expect(transport.started).toBe(1);
    await service.handleExtensionsChanged([extension({ version: "2.0.0" })]);
    expect(transport.started).toBe(2);
    expect(transport.sent.some((m) => m.method === "shutdown")).toBe(true);
  });

  it("is unavailable outside the desktop app", async () => {
    const browserService = new ExtensionHostService({
      transport: () => transport,
      isAvailable: () => false,
    });
    await browserService.start([extension()]);
    expect(useExtensionHostStore.getState().status).toBe("unavailable");
    expect(transport.started).toBe(0);
  });
});

describe("webview documents", () => {
  const theme = buildWebviewTheme(
    (name) => ({ "--background": "0 0% 100%", "--foreground": "0 0% 0%" })[name] ?? "",
    false,
    {
      "button.background": "#123456",
    }
  );

  it("maps theme colors to --vscode-* variables with app fallbacks", () => {
    expect(theme.kind).toBe("light");
    expect(theme.vars["--vscode-editor-background"]).toBe("#ffffff");
    expect(theme.vars["--vscode-foreground"]).toBe("#000000");
    expect(theme.vars["--vscode-button-background"]).toBe("#123456");
    expect(theme.vars["--vscode-font-size"]).toBe("13px");
  });

  it("injects the bootstrap before the page's CSP meta", () => {
    const html =
      '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'nonce-a\'"></head><body>x</body></html>';
    const doc = buildWebviewDocument(html, {
      handle: "webview-1",
      state: { n: 1 },
      theme,
      enableScripts: true,
    });
    expect(doc.indexOf("acquireVsCodeApi")).toBeLessThan(doc.indexOf("Content-Security-Policy"));
    expect(doc).toContain('"webview-1"');
    expect(doc).toContain('{"n":1}');
    expect(doc.startsWith("<!DOCTYPE html><html><head>")).toBe(true);
  });

  it("wraps fragments and skips scripts when disabled", () => {
    const doc = buildWebviewDocument("<p>hi</p>", {
      handle: "h",
      state: undefined,
      theme,
      enableScripts: false,
    });
    expect(doc).toMatch(/^<!DOCTYPE html><html><head><style/);
    expect(doc).not.toContain("acquireVsCodeApi");
    expect(doc).toContain("<body><p>hi</p></body>");
  });

  it("does not let state break out of the script tag", () => {
    const doc = buildWebviewDocument("<head></head>", {
      handle: "h",
      state: "</script><script>alert(1)</script>",
      theme,
      enableScripts: true,
    });
    expect(doc).not.toContain("</script><script>alert(1)");
  });

  it("only allows scripts in the sandbox when enabled", () => {
    expect(sandboxFor({ enableScripts: false, enableForms: false })).not.toContain("allow-scripts");
    expect(sandboxFor({ enableScripts: true, enableForms: true })).toContain("allow-scripts");
    expect(sandboxFor({ enableScripts: true, enableForms: true })).not.toContain(
      "allow-same-origin"
    );
  });
});

describe("view containers and menus", () => {
  const ext = extension({
    contributions: {
      ...emptyContributions(),
      commands: [{ command: "demo.refresh", title: "Refresh", icon: "$(refresh)" }],
      viewsContainers: {
        activitybar: [{ id: "demo", title: "Demo", icon: "media/demo.svg" }],
        panel: [],
      },
      views: [
        { id: "demo.tree", name: "Items", container: "demo", type: "tree" },
        { id: "demo.explorerView", name: "Outline", container: "explorer", type: "tree" },
        { id: "orphan", name: "Orphan", container: "unknown", type: "tree" },
      ],
      menus: {
        "view/title": [{ command: "demo.refresh", when: "view == demo.tree", group: "navigation" }],
      },
    },
  });

  it("builds sidebar containers and groups built-in container views", () => {
    const containers = buildViewContainers([ext]);
    expect(containers.map((c) => c.id)).toEqual(["demo", SHARED_CONTAINER_ID]);
    expect(containers[0].icon).toEqual({ path: "media/demo.svg", extensionDir: "acme.demo-1.0.0" });
    expect(containers[1].views.map((v) => v.id)).toEqual(["demo.explorerView"]);
  });

  it("attributes title actions to the views named in their when clause", () => {
    const menus = buildViewMenus([ext]);
    expect(menus.title.get("demo.tree")?.map((m) => m.command)).toEqual(["demo.refresh"]);
    expect(menus.commands.get("demo.refresh")?.icon).toBe("$(refresh)");
  });
});

describe("small helpers", () => {
  it("parses $(icon) syntax", () => {
    expect(parseLabelWithIcons("$(sync~spin) Loading $(check)")).toEqual([
      { type: "icon", name: "sync~spin" },
      { type: "text", value: " Loading " },
      { type: "icon", name: "check" },
    ]);
    expect(parseLabelWithIcons("plain")).toEqual([{ type: "text", value: "plain" }]);
  });

  it("orders status bar items by priority, highest first", () => {
    const item = (id: string, priority: number, alignment: "left" | "right") => ({
      id,
      priority,
      alignment,
      text: id,
      hasCommand: false,
    });
    const items = [
      item("a", 1, "left"),
      item("b", 10, "left"),
      item("c", 5, "right"),
      item("d", 50, "right"),
    ];
    expect(sortStatusBarItems(items, "left").map((i) => i.id)).toEqual(["b", "a"]);
    expect(sortStatusBarItems(items, "right").map((i) => i.id)).toEqual(["d", "c"]);
  });

  it("buffers webview messages until the frame listens", () => {
    webviewMessages.post("h1", { a: 1 });
    const received: unknown[] = [];
    const off = webviewMessages.subscribe("h1", (m) => received.push(m));
    webviewMessages.post("h1", { b: 2 });
    off();
    expect(received).toEqual([{ a: 1 }, { b: 2 }]);
    webviewMessages.clear();
    useWebviewStore.getState().reset();
  });
});
