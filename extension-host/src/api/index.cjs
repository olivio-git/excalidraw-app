"use strict";

const types = require("./types.cjs");
const { stubNamespace, stubClass } = require("./stubs.cjs");

/**
 * Builds the `vscode` module object handed to one extension. Every
 * namespace is wrapped so unimplemented members degrade gracefully (see
 * stubs.cjs) and unknown top-level classes can still be subclassed.
 */

function formatL10n(message, args) {
  if (!args || (Array.isArray(args) && args.length === 0)) return message;
  const values = Array.isArray(args) ? args : [args];
  const record =
    values.length === 1 && typeof values[0] === "object" && values[0] !== null ? values[0] : null;
  return message.replace(/\{([^}]+)\}/g, (match, key) => {
    if (record && key in record) return String(record[key]);
    const index = Number(key);
    return Number.isInteger(index) && index < values.length ? String(values[index]) : match;
  });
}

function createVscodeApi(host, extension) {
  const report = (member) => host.reportMissing(extension, member);
  const ns = (name, implemented) => stubNamespace(name, implemented, report);

  const window = ns("window", {
    ...host.window.api,
    createOutputChannel: (name, options) => host.output.createOutputChannel(name, options),
    createStatusBarItem: (a, b, c) => host.statusBar.createStatusBarItem(a, b, c, extension.id),
    createTerminal: (a, b, c) => host.terminals.createTerminal(a, b, c),
    get terminals() {
      return host.terminals.terminals;
    },
    get activeTerminal() {
      return host.terminals.activeTerminal;
    },
    onDidOpenTerminal: host.terminals.onDidOpenTerminal,
    onDidCloseTerminal: host.terminals.onDidCloseTerminal,
    onDidChangeActiveTerminal: host.terminals.onDidChangeActiveTerminal,
    onDidChangeTerminalState: host.terminals.onDidChangeTerminalState,
    createTreeView: (viewId, options) => host.trees.createTreeView(viewId, options, extension),
    registerTreeDataProvider: (viewId, provider) =>
      host.trees.registerTreeDataProvider(viewId, provider, extension),
    createWebviewPanel: (viewType, title, showOptions, options) =>
      host.webviews.createWebviewPanel(viewType, title, showOptions, options, extension),
    registerWebviewViewProvider: (viewId, provider, options) =>
      host.webviews.registerWebviewViewProvider(viewId, provider, options, extension),
    registerWebviewPanelSerializer: host.webviews.registerWebviewPanelSerializer,
    registerCustomEditorProvider: host.webviews.registerCustomEditorProvider,
    get activeTextEditor() {
      return host.getActiveTextEditor();
    },
    get visibleTextEditors() {
      return host.getVisibleTextEditors();
    },
    onDidChangeActiveTextEditor: host.editorEvents.onDidChangeActiveTextEditor.event,
    onDidChangeVisibleTextEditors: host.editorEvents.onDidChangeVisibleTextEditors.event,
    onDidChangeTextEditorSelection: host.editorEvents.onDidChangeTextEditorSelection.event,
    onDidChangeTextEditorVisibleRanges: host.editorEvents.onDidChangeTextEditorVisibleRanges.event,
    onDidChangeTextEditorOptions: host.editorEvents.onDidChangeTextEditorOptions.event,
    onDidChangeTextEditorViewColumn: host.editorEvents.onDidChangeTextEditorViewColumn.event,
    showTextDocument: (documentOrUri, columnOrOptions) =>
      host.showTextDocument(documentOrUri, columnOrOptions),
  });

  const api = {
    version: host.apiVersion,
    ...types,
    commands: host.commands.forExtension(extension.id),
    window,
    workspace: ns("workspace", host.workspace.api),
    env: ns("env", host.env),
    languages: ns("languages", host.languages.forExtension(extension.id)),
    extensions: ns("extensions", host.extensionsApi),
    l10n: {
      t(messageOrOptions, ...args) {
        if (typeof messageOrOptions === "object" && messageOrOptions !== null) {
          return formatL10n(messageOrOptions.message, messageOrOptions.args);
        }
        return formatL10n(
          String(messageOrOptions),
          args.length === 1 && typeof args[0] === "object" ? args[0] : args
        );
      },
      bundle: undefined,
      uri: undefined,
    },
    debug: ns("debug", {
      activeDebugSession: undefined,
      activeDebugConsole: { append() {}, appendLine() {} },
      breakpoints: [],
      activeStackItem: undefined,
    }),
    tasks: ns("tasks", { taskExecutions: [], fetchTasks: async () => [] }),
    scm: ns("scm", { inputBox: undefined }),
    tests: ns("tests", {}),
    notebooks: ns("notebooks", {}),
    authentication: ns("authentication", {
      getSession: async () => undefined,
      getAccounts: async () => [],
    }),
    comments: ns("comments", {}),
    chat: ns("chat", {}),
    lm: ns("lm", { selectChatModels: async () => [], tools: [] }),
    interactive: ns("interactive", {}),
  };

  const classes = new Map();
  return new Proxy(api, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol" || prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "then" || prop === "__esModule" || prop === "default") {
        return prop === "default" ? receiver : undefined;
      }
      const name = String(prop);
      report(name);
      if (/^[A-Z]/.test(name)) {
        if (!classes.has(name)) classes.set(name, stubClass(name));
        return classes.get(name);
      }
      const namespace = ns(name, {});
      target[name] = namespace;
      return namespace;
    },
  });
}

module.exports = { createVscodeApi, formatL10n };
