"use strict";

const { EventEmitter, Uri, ViewColumn } = require("./types.cjs");

/**
 * Webviews: panels (editor tabs) and webview views (sidebar/panel). The app
 * renders the HTML in a sandboxed iframe with `acquireVsCodeApi()`; local
 * resources are served through Tauri's asset protocol (`asWebviewUri`).
 */
function createWebviews(host) {
  let nextHandle = 1;
  const webviews = new Map();
  const viewProviders = new Map();

  function createWebview(handle, options, extension) {
    const onDidReceiveMessage = new EventEmitter();
    let html = "";
    let currentOptions = { enableScripts: false, ...options };
    const webview = {
      get html() {
        return html;
      },
      set html(value) {
        html = String(value ?? "");
        host.rpc.notify("webview.html", { handle, html });
      },
      get options() {
        return currentOptions;
      },
      set options(value) {
        currentOptions = { ...currentOptions, ...value };
        host.rpc.notify("webview.options", { handle, options: webviewOptions(currentOptions) });
      },
      get cspSource() {
        return host.cspSource();
      },
      asWebviewUri(uri) {
        const url = host.assetUrl(uri.fsPath);
        const result = Uri.parse(url);
        // Keep the exact URL the asset protocol expects.
        result.toString = () => url;
        return result;
      },
      postMessage(message) {
        host.rpc.notify("webview.postMessage", { handle, message: host.toTransferable(message) });
        return Promise.resolve(true);
      },
      onDidReceiveMessage: onDidReceiveMessage.event,
    };
    webviews.set(handle, { webview, onDidReceiveMessage, extension });
    return webview;
  }

  function webviewOptions(options = {}) {
    return {
      enableScripts: !!options.enableScripts,
      enableForms: options.enableForms ?? !!options.enableScripts,
      retainContextWhenHidden: !!options.retainContextWhenHidden,
      enableCommandUris: !!options.enableCommandUris,
    };
  }

  function createWebviewPanel(viewType, title, showOptions, options = {}, extension) {
    const handle = `webview-${nextHandle++}`;
    const webview = createWebview(handle, options, extension);
    const onDidDispose = new EventEmitter();
    const onDidChangeViewState = new EventEmitter();
    const viewColumn =
      typeof showOptions === "object" ? showOptions?.viewColumn : (showOptions ?? ViewColumn.One);
    let panelTitle = title;
    let iconPath;
    let disposed = false;
    let active = true;
    let visible = true;

    const panel = {
      viewType,
      webview,
      options: webviewOptions(options),
      get title() {
        return panelTitle;
      },
      set title(value) {
        panelTitle = value;
        host.rpc.notify("webview.title", { handle, title: value });
      },
      get iconPath() {
        return iconPath;
      },
      set iconPath(value) {
        iconPath = value;
        host.rpc.notify("webview.icon", { handle, icon: host.serializeIcon(value, extension) });
      },
      get viewColumn() {
        return viewColumn;
      },
      get active() {
        return active;
      },
      get visible() {
        return visible;
      },
      onDidDispose: onDidDispose.event,
      onDidChangeViewState: onDidChangeViewState.event,
      reveal(column, preserveFocus) {
        host.rpc.notify("webview.reveal", { handle, preserveFocus: !!preserveFocus });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        host.rpc.notify("webview.dispose", { handle });
        finish();
      },
    };
    const finish = () => {
      disposed = true;
      const entry = webviews.get(handle);
      webviews.delete(handle);
      entry?.onDidReceiveMessage.dispose();
      onDidDispose.fire();
      onDidDispose.dispose();
    };
    webviews.get(handle).panel = {
      panel,
      finish,
      onDidChangeViewState,
      setState: (a, v) => ((active = a), (visible = v)),
    };

    host.rpc.notify("webview.create", {
      handle,
      kind: "panel",
      viewType,
      title,
      extensionId: extension?.id,
      options: webviewOptions(options),
      preserveFocus: typeof showOptions === "object" ? !!showOptions.preserveFocus : false,
    });
    return panel;
  }

  function registerWebviewViewProvider(viewId, provider, options = {}, extension) {
    viewProviders.set(viewId, { provider, options, extension });
    host.rpc.notify("webviewView.registered", { viewId, extensionId: extension?.id });
    return {
      dispose() {
        if (viewProviders.get(viewId)?.provider === provider) viewProviders.delete(viewId);
      },
    };
  }

  async function resolveWebviewView(viewId) {
    const entry = viewProviders.get(viewId);
    if (!entry) return null;
    const handle = `webview-${nextHandle++}`;
    const webview = createWebview(handle, {}, entry.extension);
    const onDidDispose = new EventEmitter();
    const onDidChangeVisibility = new EventEmitter();
    let title;
    let description;
    let badge;
    let visible = true;
    const view = {
      viewType: viewId,
      webview,
      get title() {
        return title;
      },
      set title(value) {
        title = value;
        host.rpc.notify("webviewView.update", { viewId, title: value });
      },
      get description() {
        return description;
      },
      set description(value) {
        description = value;
        host.rpc.notify("webviewView.update", { viewId, description: value });
      },
      get badge() {
        return badge;
      },
      set badge(value) {
        badge = value;
        host.rpc.notify("webviewView.update", { viewId, badge: value ?? null });
      },
      get visible() {
        return visible;
      },
      onDidDispose: onDidDispose.event,
      onDidChangeVisibility: onDidChangeVisibility.event,
      show(preserveFocus) {
        host.rpc.notify("webviewView.show", { viewId, preserveFocus: !!preserveFocus });
      },
    };
    webviews.get(handle).view = {
      view,
      finish: () => {
        webviews.delete(handle);
        onDidDispose.fire();
      },
      setVisible: (v) => {
        visible = v;
        onDidChangeVisibility.fire();
      },
    };
    host.rpc.notify("webview.create", {
      handle,
      kind: "view",
      viewType: viewId,
      extensionId: entry.extension?.id,
      options: webviewOptions({ enableScripts: true, ...entry.options.webviewOptions }),
    });
    await entry.provider.resolveWebviewView(
      view,
      { state: undefined },
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose() {} }),
      }
    );
    return { handle, options: webviewOptions(webview.options) };
  }

  host.rpc.on("webview.message", ({ handle, message }) => {
    webviews.get(handle)?.onDidReceiveMessage.fire(message);
  });
  host.rpc.on("webview.disposed", ({ handle }) => {
    const entry = webviews.get(handle);
    if (entry?.panel) entry.panel.finish();
    else if (entry?.view) entry.view.finish();
  });
  host.rpc.on("webview.viewState", ({ handle, active, visible }) => {
    const entry = webviews.get(handle);
    if (entry?.panel) {
      entry.panel.setState(active, visible);
      entry.panel.onDidChangeViewState.fire({ webviewPanel: entry.panel.panel });
    } else if (entry?.view) {
      entry.view.setVisible(visible);
    }
  });
  host.rpc.on("webviewView.resolve", ({ viewId }) => resolveWebviewView(viewId));

  return {
    createWebviewPanel,
    registerWebviewViewProvider,
    registerWebviewPanelSerializer: () => ({ dispose() {} }),
    registerCustomEditorProvider: () => ({ dispose() {} }),
    hasViewProvider: (viewId) => viewProviders.has(viewId),
  };
}

module.exports = { createWebviews };
