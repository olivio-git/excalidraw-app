"use strict";

const {
  EventEmitter,
  noneEvent,
  Disposable,
  Uri,
  CancellationTokenSource,
  ColorThemeKind,
  ProgressLocation,
} = require("./types.cjs");

/**
 * `vscode.window` pieces that talk to the app UI: notifications, quick picks,
 * input boxes, dialogs, progress and window state. Output, status bar,
 * terminals, trees and webviews live in their own modules and are merged
 * into the namespace per extension.
 */
function createWindow(host) {
  let colorThemeKind = ColorThemeKind.Dark;
  const onDidChangeActiveColorTheme = new EventEmitter();
  const onDidChangeWindowState = new EventEmitter();
  let windowState = { focused: true, active: true };
  let nextProgressId = 1;
  const progressTokens = new Map();

  function splitMessageArgs(rest) {
    let options = {};
    let items = rest;
    const first = rest[0];
    if (
      first &&
      typeof first === "object" &&
      !("title" in first) &&
      ("modal" in first || "detail" in first || "useCustom" in first)
    ) {
      options = first;
      items = rest.slice(1);
    }
    return { options, items: items.flat().filter((item) => item !== undefined) };
  }

  function showMessage(level) {
    return async (message, ...rest) => {
      const { options, items } = splitMessageArgs(rest);
      const titles = items.map((item) => (typeof item === "string" ? item : item.title));
      const index = await host.rpc.request("window.showMessage", {
        level,
        message: String(message),
        detail: options.detail,
        modal: !!options.modal,
        items: titles,
      });
      return typeof index === "number" ? items[index] : undefined;
    };
  }

  function serializeQuickPickItem(item) {
    return {
      label: item.label ?? "",
      description: item.description,
      detail: item.detail,
      picked: !!item.picked,
      alwaysShow: !!item.alwaysShow,
      separator: item.kind === -1,
    };
  }

  async function showQuickPick(itemsOrPromise, options = {}, token) {
    const raw = await itemsOrPromise;
    if (token?.isCancellationRequested) return undefined;
    const items = (raw ?? []).map((item) => (typeof item === "string" ? { label: item } : item));
    const result = await host.rpc.request("window.showQuickPick", {
      items: items.map(serializeQuickPickItem),
      options: {
        title: options.title,
        placeHolder: options.placeHolder,
        canPickMany: !!options.canPickMany,
        matchOnDescription: !!options.matchOnDescription,
        matchOnDetail: !!options.matchOnDetail,
      },
    });
    const original = raw ?? [];
    if (options.canPickMany) {
      return Array.isArray(result) ? result.map((i) => original[i]) : undefined;
    }
    return typeof result === "number" ? original[result] : undefined;
  }

  async function showInputBox(options = {}, token) {
    let value = options.value;
    let validationMessage;
    for (let attempt = 0; attempt < 10; attempt++) {
      if (token?.isCancellationRequested) return undefined;
      const result = await host.rpc.request("window.showInputBox", {
        title: options.title,
        prompt: options.prompt,
        placeHolder: options.placeHolder,
        value,
        password: !!options.password,
        validationMessage,
      });
      if (result === undefined || result === null) return undefined;
      if (!options.validateInput) return result;
      const validation = await options.validateInput(result);
      const message = typeof validation === "string" ? validation : validation?.message;
      if (!message) return result;
      value = result;
      validationMessage = message;
    }
    return undefined;
  }

  function createQuickPick() {
    const onDidAccept = new EventEmitter();
    const onDidHide = new EventEmitter();
    const onDidChangeSelection = new EventEmitter();
    const onDidChangeActive = new EventEmitter();
    const onDidChangeValue = new EventEmitter();
    const onDidTriggerButton = new EventEmitter();
    const onDidTriggerItemButton = new EventEmitter();
    const quickPick = {
      items: [],
      selectedItems: [],
      activeItems: [],
      value: "",
      placeholder: undefined,
      title: undefined,
      canSelectMany: false,
      matchOnDescription: false,
      matchOnDetail: false,
      busy: false,
      enabled: true,
      ignoreFocusOut: false,
      buttons: [],
      keepScrollPosition: false,
      step: undefined,
      totalSteps: undefined,
      onDidAccept: onDidAccept.event,
      onDidHide: onDidHide.event,
      onDidChangeSelection: onDidChangeSelection.event,
      onDidChangeActive: onDidChangeActive.event,
      onDidChangeValue: onDidChangeValue.event,
      onDidTriggerButton: onDidTriggerButton.event,
      onDidTriggerItemButton: onDidTriggerItemButton.event,
      async show() {
        const result = await host.rpc.request("window.showQuickPick", {
          items: quickPick.items.map(serializeQuickPickItem),
          options: {
            title: quickPick.title,
            placeHolder: quickPick.placeholder,
            canPickMany: quickPick.canSelectMany,
            matchOnDescription: quickPick.matchOnDescription,
            matchOnDetail: quickPick.matchOnDetail,
            value: quickPick.value,
          },
        });
        const indices = Array.isArray(result)
          ? result
          : typeof result === "number"
            ? [result]
            : null;
        if (indices) {
          const selected = indices.map((i) => quickPick.items[i]).filter(Boolean);
          quickPick.selectedItems = selected;
          quickPick.activeItems = selected;
          onDidChangeActive.fire(selected);
          onDidChangeSelection.fire(selected);
          onDidAccept.fire();
        }
        onDidHide.fire();
      },
      hide() {},
      dispose() {
        [onDidAccept, onDidHide, onDidChangeSelection, onDidChangeActive, onDidChangeValue].forEach(
          (e) => e.dispose()
        );
      },
    };
    return quickPick;
  }

  function createInputBox() {
    const onDidAccept = new EventEmitter();
    const onDidHide = new EventEmitter();
    const onDidChangeValue = new EventEmitter();
    const inputBox = {
      value: "",
      placeholder: undefined,
      prompt: undefined,
      title: undefined,
      password: false,
      validationMessage: undefined,
      busy: false,
      enabled: true,
      ignoreFocusOut: false,
      buttons: [],
      onDidAccept: onDidAccept.event,
      onDidHide: onDidHide.event,
      onDidChangeValue: onDidChangeValue.event,
      onDidTriggerButton: noneEvent,
      async show() {
        const result = await host.rpc.request("window.showInputBox", {
          title: inputBox.title,
          prompt: inputBox.prompt,
          placeHolder: inputBox.placeholder,
          value: inputBox.value,
          password: inputBox.password,
          validationMessage:
            typeof inputBox.validationMessage === "string"
              ? inputBox.validationMessage
              : inputBox.validationMessage?.message,
        });
        if (typeof result === "string") {
          inputBox.value = result;
          onDidChangeValue.fire(result);
          onDidAccept.fire();
        }
        onDidHide.fire();
      },
      hide() {},
      dispose() {
        [onDidAccept, onDidHide, onDidChangeValue].forEach((e) => e.dispose());
      },
    };
    return inputBox;
  }

  function dialogFilters(filters) {
    if (!filters) return undefined;
    return Object.entries(filters).map(([name, extensions]) => ({ name, extensions }));
  }

  async function withProgress(options, task) {
    const id = `progress-${nextProgressId++}`;
    const source = new CancellationTokenSource();
    progressTokens.set(id, source);
    host.rpc.notify("progress.start", {
      id,
      title: options.title,
      location: options.location === ProgressLocation.Notification ? "notification" : "window",
      cancellable: !!options.cancellable,
    });
    const progress = {
      report(value) {
        host.rpc.notify("progress.report", {
          id,
          message: value?.message,
          increment: value?.increment,
        });
      },
    };
    try {
      return await task(progress, source.token);
    } finally {
      progressTokens.delete(id);
      host.rpc.notify("progress.end", { id });
    }
  }

  host.rpc.on("progress.cancel", ({ id }) => progressTokens.get(id)?.cancel());
  host.rpc.on("theme.changed", ({ kind }) => {
    const next = kind === "light" ? ColorThemeKind.Light : ColorThemeKind.Dark;
    if (next === colorThemeKind) return;
    colorThemeKind = next;
    onDidChangeActiveColorTheme.fire({ kind: next });
  });
  host.rpc.on("window.state", ({ focused }) => {
    windowState = { focused: !!focused, active: !!focused };
    onDidChangeWindowState.fire(windowState);
  });

  let statusMessageId = 1;
  const api = {
    showInformationMessage: showMessage("info"),
    showWarningMessage: showMessage("warning"),
    showErrorMessage: showMessage("error"),
    showQuickPick,
    showInputBox,
    createQuickPick,
    createInputBox,
    async showOpenDialog(options = {}) {
      const paths = await host.rpc.request("window.showOpenDialog", {
        title: options.title,
        canSelectFiles: options.canSelectFiles ?? true,
        canSelectFolders: !!options.canSelectFolders,
        canSelectMany: !!options.canSelectMany,
        defaultPath: options.defaultUri?.fsPath,
        filters: dialogFilters(options.filters),
      });
      return Array.isArray(paths) && paths.length ? paths.map((p) => Uri.file(p)) : undefined;
    },
    async showSaveDialog(options = {}) {
      const filePath = await host.rpc.request("window.showSaveDialog", {
        title: options.title,
        defaultPath: options.defaultUri?.fsPath,
        filters: dialogFilters(options.filters),
      });
      return filePath ? Uri.file(filePath) : undefined;
    },
    async showWorkspaceFolderPick(options = {}) {
      const folders = host.workspace.api.workspaceFolders ?? [];
      const picked = await showQuickPick(
        folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
        { placeHolder: options.placeHolder }
      );
      return picked?.folder;
    },
    withProgress,
    withScmProgress: (task) => task({ report() {} }),
    setStatusBarMessage(text, hideAfter) {
      const id = `message-${statusMessageId++}`;
      host.rpc.notify("window.statusMessage", { id, text });
      const clear = () => host.rpc.notify("window.statusMessage", { id, text: null });
      if (typeof hideAfter === "number") setTimeout(clear, hideAfter);
      else if (hideAfter && typeof hideAfter.then === "function") hideAfter.then(clear, clear);
      return new Disposable(clear);
    },
    get activeColorTheme() {
      return { kind: colorThemeKind };
    },
    onDidChangeActiveColorTheme: onDidChangeActiveColorTheme.event,
    get state() {
      return windowState;
    },
    onDidChangeWindowState: onDidChangeWindowState.event,
    tabGroups: {
      all: [],
      activeTabGroup: { tabs: [], isActive: true, viewColumn: 1, activeTab: undefined },
      onDidChangeTabs: noneEvent,
      onDidChangeTabGroups: noneEvent,
      close: async () => false,
    },
    createTextEditorDecorationType: (options) => ({
      key: `decoration-${Math.random().toString(36).slice(2)}`,
      options,
      dispose() {},
    }),
    registerUriHandler: () => new Disposable(() => {}),
    registerFileDecorationProvider: () => new Disposable(() => {}),
    registerTerminalLinkProvider: () => new Disposable(() => {}),
    registerTerminalProfileProvider: () => new Disposable(() => {}),
    registerCustomEditorProvider: () => new Disposable(() => {}),
    onDidChangeTerminalShellIntegration: noneEvent,
    onDidStartTerminalShellExecution: noneEvent,
    onDidEndTerminalShellExecution: noneEvent,
    visibleNotebookEditors: [],
    activeNotebookEditor: undefined,
    onDidChangeVisibleNotebookEditors: noneEvent,
    onDidChangeActiveNotebookEditor: noneEvent,
    onDidChangeNotebookEditorSelection: noneEvent,
    onDidChangeNotebookEditorVisibleRanges: noneEvent,
  };

  return { api };
}

module.exports = { createWindow };
