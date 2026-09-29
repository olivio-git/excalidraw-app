"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const types = require("./api/types.cjs");
const { createVscodeApi } = require("./api/index.cjs");
const { createCommands } = require("./api/commands.cjs");
const { createConfiguration } = require("./api/configuration.cjs");
const { createWorkspace } = require("./api/workspace.cjs");
const { createWindow } = require("./api/window.cjs");
const { createOutputChannels } = require("./api/output.cjs");
const { createStatusBar } = require("./api/statusbar.cjs");
const { createTerminals } = require("./api/terminals.cjs");
const { createTrees } = require("./api/trees.cjs");
const { createWebviews } = require("./api/webviews.cjs");
const { createEnv } = require("./api/env.cjs");
const { createLanguages } = require("./api/languages.cjs");
const { createMemento, createSecretStorage } = require("./api/memento.cjs");
const { createEditors } = require("./api/editors.cjs");
const { createLanguageFeatures } = require("./api/language-features.cjs");

const { EventEmitter, Uri, ExtensionMode, LogLevel, noneEvent } = types;

const API_VERSION = "1.96.0";
const DEACTIVATE_TIMEOUT_MS = 5000;

/**
 * For an error thrown inside an extension, the code around the first stack
 * frame in the extension's own files (bundled extensions are minified, so the
 * line alone says nothing). Returns "" when no such frame is found.
 */
function sourceExcerpt(error, extensionPath, before = 240, after = 120) {
  const stack = error && typeof error.stack === "string" ? error.stack : "";
  for (const match of stack.matchAll(/\(?((?:[A-Za-z]:)?[^\s()]+):(\d+):(\d+)\)?$/gm)) {
    const [, file, lineText, columnText] = match;
    if (!path.resolve(file).startsWith(path.resolve(extensionPath) + path.sep)) continue;
    try {
      const line = fs.readFileSync(file, "utf8").split("\n")[Number(lineText) - 1];
      if (line === undefined) continue;
      const column = Number(columnText) - 1;
      const start = Math.max(0, column - before);
      const code = `${line.slice(start, column)} ⟪aquí⟫ ${line.slice(column, column + after)}`;
      return `${path.relative(extensionPath, file)}:${lineText}:${columnText}\n${start > 0 ? "…" : ""}${code}…`;
    } catch {
      return "";
    }
  }
  return "";
}

function readPackageJson(extensionPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(extensionPath, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

/**
 * Runs VS Code extensions: resolves `require("vscode")` to an API object per
 * extension, activates extensions on their activation events and answers
 * the app's requests (commands, views, webviews, terminals, ...).
 */
class ExtensionHost {
  constructor(rpc) {
    this.rpc = rpc;
    this.config = {};
    this.logLevel = LogLevel.Info;
    this.apiVersion = API_VERSION;
    this.descriptions = [];
    this.activations = new Map();
    this.apis = new Map();
    this.contexts = new Map();
    this.missingReported = new Set();
    this.missingByExtension = new Map();
    this.initialized = false;

    this.configuration = createConfiguration(this);
    this.commands = createCommands(this);
    this.workspace = createWorkspace(this);
    this.window = createWindow(this);
    this.output = createOutputChannels(this);
    this.statusBar = createStatusBar(this);
    this.terminals = createTerminals(this);
    this.trees = createTrees(this);
    this.webviews = createWebviews(this);
    this.env = createEnv(this);
    this.languages = createLanguages(this);
    this.editorEvents = {
      onDidChangeActiveTextEditor: new EventEmitter(),
      onDidChangeVisibleTextEditors: new EventEmitter(),
      onDidChangeTextEditorSelection: new EventEmitter(),
      onDidChangeTextEditorVisibleRanges: new EventEmitter(),
      onDidChangeTextEditorOptions: new EventEmitter(),
      onDidChangeTextEditorViewColumn: new EventEmitter(),
    };
    this.activeTextEditor = undefined;
    this.visibleTextEditors = [];
    this.editors = createEditors(this);
    this.languageFeatures = createLanguageFeatures(this);

    const host = this;
    this.extensionsApi = {
      getExtension: (id) => {
        const desc = host.findDescription(id);
        return desc ? host.extensionObject(desc) : undefined;
      },
      get all() {
        return host.descriptions.map((d) => host.extensionObject(d));
      },
      get allAcrossExtensionHosts() {
        return host.descriptions.map((d) => host.extensionObject(d));
      },
      onDidChange: noneEvent,
    };

    rpc.on("initialize", (params) => this.initialize(params));
    rpc.on("activateByEvent", async ({ event }) => this.activateByEvent(event));
    rpc.on("activate", async ({ id }) => {
      await this.activate(id);
      return true;
    });
    rpc.on("executeCommand", async ({ id, args }) =>
      this.toTransferable(await this.commands.executeCommand(id, ...this.reviveArgs(args ?? [])))
    );
    rpc.on("statusBar.click", ({ id }) => this.statusBar.click(id));
    rpc.on("workspace.foldersChanged", ({ folders }) => this.workspace.setFolders(folders));
    rpc.on("getActivatedExtensions", () =>
      [...this.activations.entries()].filter(([, r]) => r.active).map(([id]) => id)
    );
    rpc.on("shutdown", async () => {
      await this.deactivateAll();
      return true;
    });
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  initialize(params) {
    this.config = params ?? {};
    this.logLevel = params.logLevel ?? LogLevel.Info;
    this.descriptions = (params.extensions ?? []).map((ext) => {
      const packageJSON = readPackageJson(ext.extensionPath);
      return {
        id: ext.id,
        extensionPath: ext.extensionPath,
        main: ext.main ?? packageJSON.main,
        activationEvents: ext.activationEvents ?? packageJSON.activationEvents ?? [],
        packageJSON,
        contributes: packageJSON.contributes ?? {},
      };
    });
    this.configuration.setValues(params.settings?.defaults, params.settings?.user);
    this.workspace.setFolders(params.workspaceFolders ?? []);
    this.installRequireHook();
    this.initialized = true;
    // Activate startup extensions once the app has the initialize answer.
    setTimeout(() => void this.startupActivation(), 0);
    return { pid: process.pid, apiVersion: API_VERSION };
  }

  installRequireHook() {
    if (this.requireHookInstalled) return;
    this.requireHookInstalled = true;
    const host = this;
    const originalLoad = Module._load;
    Module._load = function load(request, parent, isMain) {
      if (request === "vscode") return host.apiForFile(parent && parent.filename);
      return originalLoad.call(this, request, parent, isMain);
    };
    // Runtimes that ignore Module._load still resolve node_modules/vscode by
    // walking up from the extension folder.
    globalThis.__qoriVscodeApiFor = (filename) => host.apiForFile(filename);
    const roots = new Set(this.descriptions.map((d) => path.dirname(d.extensionPath)));
    for (const root of roots) {
      try {
        const dir = path.join(root, "node_modules", "vscode");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "index.js"),
          "module.exports = globalThis.__qoriVscodeApiFor(module.parent && module.parent.filename);\n"
        );
        fs.writeFileSync(path.join(dir, "package.json"), '{"name":"vscode","main":"index.js"}\n');
      } catch (error) {
        this.log("warn", `Could not write the vscode module shim: ${error.message}`);
      }
    }
  }

  // ── Extensions ───────────────────────────────────────────────────────────

  extensionDescriptions() {
    return this.descriptions;
  }

  findDescription(id) {
    const lower = String(id).toLowerCase();
    return this.descriptions.find((d) => d.id.toLowerCase() === lower);
  }

  descriptionForFile(filename) {
    if (!filename) return undefined;
    return this.descriptions
      .filter(
        (d) => filename === d.extensionPath || filename.startsWith(d.extensionPath + path.sep)
      )
      .sort((a, b) => b.extensionPath.length - a.extensionPath.length)[0];
  }

  apiForFile(filename) {
    const desc = this.descriptionForFile(filename) ?? {
      id: "unknown.extension",
      extensionPath: path.dirname(filename ?? process.cwd()),
      packageJSON: {},
      contributes: {},
      activationEvents: [],
    };
    return this.getApi(desc);
  }

  getApi(desc) {
    let api = this.apis.get(desc.id);
    if (!api) {
      api = createVscodeApi(this, desc);
      this.apis.set(desc.id, api);
    }
    return api;
  }

  extensionObject(desc) {
    const host = this;
    return {
      id: desc.id,
      extensionUri: Uri.file(desc.extensionPath),
      extensionPath: desc.extensionPath,
      packageJSON: desc.packageJSON,
      extensionKind: types.ExtensionKind.Workspace,
      get isActive() {
        return !!host.activations.get(desc.id)?.active;
      },
      get exports() {
        return host.activations.get(desc.id)?.exports;
      },
      activate: () => host.activate(desc.id),
    };
  }

  matchesEvent(desc, event) {
    return desc.activationEvents.some((e) => e === event || e === "*");
  }

  async activateByEvent(event) {
    const matching = this.descriptions.filter((d) => this.matchesEvent(d, event));
    const results = await Promise.allSettled(matching.map((d) => this.activate(d.id)));
    return matching.filter((_, i) => results[i].status === "fulfilled").map((d) => d.id);
  }

  async startupActivation() {
    await this.activateByEvent("*");
    await this.activateByEvent("onStartupFinished");
    await this.activateByEvent("onFileSystem:file");
    for (const desc of this.descriptions) {
      if (this.activations.has(desc.id)) continue;
      for (const event of desc.activationEvents) {
        if (!event.startsWith("workspaceContains:")) continue;
        const pattern = event.slice("workspaceContains:".length);
        const glob = /[*?{[]/.test(pattern) ? pattern : `**/${pattern}`;
        try {
          const found = await this.workspace.api.findFiles(glob, undefined, 1);
          if (found.length > 0) {
            await this.activate(desc.id).catch(() => undefined);
            break;
          }
        } catch {
          // A bad pattern only means no activation.
        }
      }
    }
  }

  activate(id) {
    const existing = this.activations.get(id);
    if (existing) return existing.promise;
    const desc = this.findDescription(id);
    if (!desc) return Promise.reject(new Error(`Unknown extension ${id}`));
    const record = { active: false, exports: undefined, module: undefined };
    this.activations.set(desc.id, record);
    record.promise = (async () => {
      for (const dependency of desc.packageJSON.extensionDependencies ?? []) {
        if (this.findDescription(dependency))
          await this.activate(this.findDescription(dependency).id);
      }
      if (!desc.main) {
        record.active = true;
        return undefined;
      }
      const started = Date.now();
      const mainPath = require.resolve(path.resolve(desc.extensionPath, desc.main));
      const context = this.createContext(desc);
      this.contexts.set(desc.id, context);
      const mod = require(mainPath);
      record.module = mod;
      const exports = typeof mod.activate === "function" ? await mod.activate(context) : undefined;
      record.exports = exports;
      record.active = true;
      this.rpc.notify("extension.activated", { id: desc.id, ms: Date.now() - started });
      this.log("info", `Activada ${desc.id} (${Date.now() - started} ms)`);
      return exports;
    })().catch((error) => {
      const excerpt = sourceExcerpt(error, desc.extensionPath);
      const missing = this.missingByExtension.get(desc.id) ?? [];
      this.rpc.notify("extension.activationFailed", {
        id: desc.id,
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack,
      });
      this.log(
        "error",
        `No se pudo activar ${desc.id}: ${error && error.stack ? error.stack : error}` +
          (excerpt ? `\nCódigo donde falló: ${excerpt}` : "") +
          (missing.length ? `\nAPIs no disponibles usadas: ${missing.join(", ")}` : "")
      );
      throw error;
    });
    return record.promise;
  }

  createContext(desc) {
    const storageRoot =
      this.config.storagePath ?? path.join(require("node:os").tmpdir(), "qori-extensions");
    const globalStoragePath = path.join(storageRoot, "globalStorage", desc.id);
    const folders = (this.workspace.api.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const workspaceKey = folders.length
      ? crypto.createHash("sha1").update(folders.join("|")).digest("hex").slice(0, 16)
      : null;
    const storagePath = workspaceKey
      ? path.join(storageRoot, "workspaceStorage", workspaceKey, desc.id)
      : undefined;
    const logPath = path.join(storageRoot, "logs", desc.id);
    for (const dir of [globalStoragePath, logPath]) fs.mkdirSync(dir, { recursive: true });

    const environmentVariables = new Map();
    const environmentVariableCollection = {
      persistent: true,
      description: undefined,
      replace: (variable, value, options) =>
        environmentVariables.set(variable, { value, type: 1, options }),
      append: (variable, value, options) =>
        environmentVariables.set(variable, { value, type: 2, options }),
      prepend: (variable, value, options) =>
        environmentVariables.set(variable, { value, type: 3, options }),
      get: (variable) => environmentVariables.get(variable),
      forEach: (callback, thisArg) =>
        environmentVariables.forEach((m, v) =>
          callback.call(thisArg, v, m, environmentVariableCollection)
        ),
      delete: (variable) => environmentVariables.delete(variable),
      clear: () => environmentVariables.clear(),
      getScoped: () => environmentVariableCollection,
      [Symbol.iterator]: () => environmentVariables.entries(),
    };

    return {
      subscriptions: [],
      extensionPath: desc.extensionPath,
      extensionUri: Uri.file(desc.extensionPath),
      extension: this.extensionObject(desc),
      extensionMode: ExtensionMode.Production,
      globalState: createMemento(path.join(globalStoragePath, "state.json")),
      workspaceState: createMemento(
        path.join(storageRoot, "workspaceStorage", workspaceKey ?? "_empty", desc.id, "state.json")
      ),
      secrets: createSecretStorage(path.join(globalStoragePath, "secrets.json")),
      storagePath,
      storageUri: storagePath ? Uri.file(storagePath) : undefined,
      globalStoragePath,
      globalStorageUri: Uri.file(globalStoragePath),
      logPath,
      logUri: Uri.file(logPath),
      asAbsolutePath: (relativePath) => path.join(desc.extensionPath, relativePath),
      environmentVariableCollection,
      languageModelAccessInformation: { onDidChange: noneEvent, canSendRequest: () => undefined },
    };
  }

  async deactivateAll() {
    for (const [id, record] of this.activations) {
      const context = this.contexts.get(id);
      try {
        if (record.module && typeof record.module.deactivate === "function") {
          await withTimeout(Promise.resolve(record.module.deactivate()), DEACTIVATE_TIMEOUT_MS);
        }
      } catch (error) {
        this.log("error", `deactivate() de ${id} falló: ${error}`);
      }
      if (context) {
        for (const disposable of context.subscriptions) {
          try {
            disposable?.dispose?.();
          } catch {
            // Keep disposing the rest.
          }
        }
        context.globalState.flush();
        context.workspaceState.flush();
      }
    }
  }

  // ── Editors (filled in by the language bridge) ──────────────────────────

  getActiveTextEditor() {
    return this.activeTextEditor;
  }

  getVisibleTextEditors() {
    return this.visibleTextEditors;
  }

  async showTextDocument(documentOrUri, columnOrOptions) {
    const uri = documentOrUri instanceof Uri ? documentOrUri : documentOrUri?.uri;
    if (!uri) return undefined;
    const options = typeof columnOrOptions === "object" && columnOrOptions ? columnOrOptions : {};
    const isTarget = (editor) => editor && editor.document.uri.toString() === uri.toString();
    // The app reports the editor once it is open and focused.
    const opened = isTarget(this.activeTextEditor)
      ? Promise.resolve(this.activeTextEditor)
      : new Promise((resolve) => {
          const timer = setTimeout(() => {
            subscription.dispose();
            resolve(undefined);
          }, 3000);
          const subscription = this.editorEvents.onDidChangeActiveTextEditor.event((editor) => {
            if (!isTarget(editor)) return;
            clearTimeout(timer);
            subscription.dispose();
            resolve(editor);
          });
        });
    await this.rpc.request("window.showTextDocument", {
      path: uri.fsPath,
      options: this.toTransferable({
        preview: options.preview,
        selection: options.selection
          ? {
              start: {
                line: options.selection.start.line,
                character: options.selection.start.character,
              },
              end: { line: options.selection.end.line, character: options.selection.end.character },
            }
          : undefined,
      }),
    });
    const editor = await opened;
    if (editor) return editor;
    const data = this.workspace.documents.get(uri.toString());
    return data ? this.editors.editorFor(data) : undefined;
  }

  // ── Helpers used by the API modules ──────────────────────────────────────

  log(level, message) {
    this.rpc.notify("log", { level, message: String(message) });
  }

  reportMissing(extension, member) {
    const key = `${extension.id}:${member}`;
    if (this.missingReported.has(key)) return;
    this.missingReported.add(key);
    const list = this.missingByExtension.get(extension.id) ?? [];
    list.push(`vscode.${member}`);
    this.missingByExtension.set(extension.id, list);
    this.log("warn", `[${extension.id}] usa una API no disponible: vscode.${member}`);
  }

  assetUrl(fsPath) {
    return `${this.config.assetPrefix ?? "asset://localhost/"}${encodeURIComponent(fsPath)}`;
  }

  cspSource() {
    return this.config.cspSource ?? "asset: http://asset.localhost";
  }

  /**
   * URL for a file loaded by a webview. With `webviewAssetPrefix` (the app's
   * `qori-ext:` protocol) the path stays readable, so relative URLs inside
   * the extension's scripts and styles resolve like on disk.
   */
  webviewAssetUrl(fsPath) {
    const prefix = this.config.webviewAssetPrefix;
    if (!prefix) return this.assetUrl(fsPath);
    const segments = fsPath.replace(/\\/g, "/").split("/").filter(Boolean);
    return `${prefix}${segments.map(encodeURIComponent).join("/")}`;
  }

  webviewCspSource() {
    return this.config.webviewCspSource ?? this.cspSource();
  }

  serializeIcon(icon, extension) {
    if (!icon) return undefined;
    const resolve = (value) => {
      if (!value) return undefined;
      if (value instanceof Uri) return this.assetUrl(value.fsPath);
      if (typeof value === "string") {
        const absolute = path.isAbsolute(value)
          ? value
          : path.join(extension?.extensionPath ?? "", value);
        return this.assetUrl(absolute);
      }
      if (typeof value.fsPath === "string") return this.assetUrl(value.fsPath);
      return undefined;
    };
    if (
      typeof icon === "object" &&
      typeof icon.id === "string" &&
      !(icon instanceof Uri) &&
      !icon.fsPath
    ) {
      return { codicon: icon.id, color: icon.color?.id };
    }
    if (typeof icon === "object" && !(icon instanceof Uri) && (icon.light || icon.dark)) {
      return { light: resolve(icon.light ?? icon.dark), dark: resolve(icon.dark ?? icon.light) };
    }
    const url = resolve(icon);
    return url ? { light: url, dark: url } : undefined;
  }

  /** JSON-safe copy of a value for the app (Uris become `{ $uri, fsPath }`). */
  toTransferable(value) {
    const seen = new WeakSet();
    const convert = (v) => {
      if (v === undefined || typeof v === "function" || typeof v === "symbol") return undefined;
      if (v === null || typeof v !== "object") return typeof v === "bigint" ? Number(v) : v;
      if (v instanceof Uri) return { $uri: v.toString(), fsPath: v.fsPath };
      if (seen.has(v)) return undefined;
      seen.add(v);
      if (Array.isArray(v)) return v.map((item) => convert(item) ?? null);
      if (v instanceof Uint8Array) return Array.from(v);
      const out = {};
      for (const [key, item] of Object.entries(v)) {
        const converted = convert(item);
        if (converted !== undefined) out[key] = converted;
      }
      return out;
    };
    return convert(value);
  }

  reviveArgs(args) {
    const revive = (v) => {
      if (Array.isArray(v)) return v.map(revive);
      if (v && typeof v === "object") {
        if (typeof v.$uri === "string") return Uri.parse(v.$uri);
        return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, revive(item)]));
      }
      return v;
    };
    return args.map(revive);
  }
}

module.exports = { ExtensionHost, API_VERSION, sourceExcerpt };
