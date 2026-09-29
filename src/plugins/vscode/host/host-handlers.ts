import {
  dismissNotification,
  showNotification,
  type NotificationAction,
} from "@/shared/components/notification";
import { contextKeyService } from "@/core/keybindings/context-key-service";
import { panelViews } from "@/core/panel/panel-store";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { openFileInWorkbench } from "@/core/shell/services/file-navigation";
import { extensionPanelId, revealView } from "@/core/shell/sidebar-panel-store";
import { PluginManager } from "@/plugins/plugin-manager";
import { codeEditorRegistry } from "@/features/code-editor/code-editor-registry";
import type { HostConnection } from "./host-connection";
import type { ExtensionHostService } from "./extension-host-service";
import { useExtensionHostStore } from "./host-store";
import { HOST_LOG_CHANNEL, useOutputStore } from "./output-store";
import { useStatusBarStore, type StatusBarItem } from "./statusbar-store";
import { useDiagnosticsStore, useTreeStore, useWebviewStore, webviewMessages } from "./view-stores";
import {
  cancelQuickInputs,
  showInputBox,
  showMessageToast,
  showModalMessage,
  showQuickPick,
} from "./quick-input";
import { registerTerminalBridge } from "./terminal-bridge";
import { getLanguageBridge, registerLanguageHandlers } from "./language-bridge";
import { revealInEditor } from "@/features/code-editor/reveal";
import { updateUserExtensionSetting } from "../extension-settings";

export const OUTPUT_VIEW_ID = "output";
export const WEBVIEW_ROUTE_ID = "extension-webview";

type Params = Record<string, any>;

function openWebviewTab(handle: string, title: string, preserveFocus: boolean): void {
  const store = useTabStore.getState();
  const existing = store.tabs.find(
    (tab) => tab.routeId === WEBVIEW_ROUTE_ID && tab.instanceId === handle
  );
  if (existing) {
    if (!preserveFocus) store.setActiveTab(existing.id);
    return;
  }
  const previous = store.activeTabId;
  store.addTab({
    routeId: WEBVIEW_ROUTE_ID,
    path: `/${WEBVIEW_ROUTE_ID}`,
    title,
    instanceId: handle,
    metadata: { webviewHandle: handle },
  });
  if (preserveFocus && previous) useTabStore.getState().setActiveTab(previous);
}

function closeWebviewTab(handle: string): void {
  const store = useTabStore.getState();
  const tab = store.tabs.find((t) => t.routeId === WEBVIEW_ROUTE_ID && t.instanceId === handle);
  if (tab) store.removeTab(tab.id);
}

/** Workbench commands requested by extensions (`commands.executeCommand`). */
async function executeWorkbenchCommand(id: string, args: unknown[]): Promise<unknown> {
  if (id.startsWith("workbench.view.extension.")) {
    revealView(extensionPanelId(id.slice("workbench.view.extension.".length)));
    return undefined;
  }
  switch (id) {
    case "workbench.action.output.toggleOutput":
    case "workbench.panel.output.focus":
      panelViews.show(OUTPUT_VIEW_ID);
      return undefined;
    case "workbench.action.reloadWindow":
      window.location.reload();
      return undefined;
    case "workbench.action.files.save": {
      const active = useTabStore.getState().activeTabId;
      const tab = active ? useTabStore.getState().getTab(active) : undefined;
      const path = tab?.instanceId;
      return path ? codeEditorRegistry.get(path)?.save() : undefined;
    }
    case "workbench.action.focusActiveEditorGroup":
      return PluginManager.executeCommand("workbench.action.focusEditor");
    case "revealInExplorer":
    case "revealFileInOS":
      return undefined;
  }
  if (PluginManager.hasCommand(id)) {
    await PluginManager.executeCommand(id);
    return undefined;
  }
  useOutputStore
    .getState()
    .append(
      HOST_LOG_CHANNEL,
      `[warn] Comando no disponible en la app: ${id}${args.length ? " (con argumentos)" : ""}\n`
    );
  return undefined;
}

const progressToasts = new Map<
  string,
  { toastId: string | number; title?: string; location: string; actions?: NotificationAction[] }
>();

/** Register every host → app handler. Returns the unsubscribe functions. */
export function registerHostHandlers(
  connection: HostConnection,
  host: ExtensionHostService
): Array<() => void> {
  const on = (method: string, handler: (params: Params) => unknown) =>
    connection.on(method, handler);
  const hostStore = useExtensionHostStore.getState;
  const output = useOutputStore.getState;
  const log = (text: string) =>
    output().append(HOST_LOG_CHANNEL, text.endsWith("\n") ? text : `${text}\n`);

  return [
    // ── Host state ───────────────────────────────────────────────────────
    on("log", ({ level, message }) => log(`[${level}] ${message}`)),
    on("extension.activated", ({ id }) => hostStore().markActivated(id)),
    on("extension.activationFailed", ({ id, message }) => {
      hostStore().markFailed(id, message);
      showNotification({
        level: "error",
        message: `No se pudo activar ${id}`,
        detail: message,
        source: "Extension Host",
        actions: [
          {
            label: "Ver registro",
            onClick: () =>
              void PluginManager.executeCommand("workbench.action.showExtensionHostLog"),
          },
        ],
      });
    }),
    on("context.set", ({ key, value }) => contextKeyService.set(key, value)),

    // ── Commands from extensions for the workbench ───────────────────────
    on("commands.executeWorkbench", ({ id, args }) => executeWorkbenchCommand(id, args ?? [])),

    // ── Output channels ──────────────────────────────────────────────────
    on("output.create", ({ id, name }) => output().create(id, name)),
    on("output.append", ({ id, text }) => output().append(id, text)),
    on("output.clear", ({ id }) => output().clear(id)),
    on("output.dispose", ({ id }) => output().remove(id)),
    on("output.show", ({ id }) => {
      output().setActive(id);
      panelViews.show(OUTPUT_VIEW_ID);
    }),
    on("output.hide", () => undefined),

    // ── Status bar ───────────────────────────────────────────────────────
    on("statusBar.update", (item) => useStatusBarStore.getState().update(item as StatusBarItem)),
    on("statusBar.dispose", ({ id }) => useStatusBarStore.getState().remove(id)),
    on("window.statusMessage", ({ id, text }) => useStatusBarStore.getState().setMessage(id, text)),

    // ── Notifications and quick input ────────────────────────────────────
    on("window.showMessage", ({ level, message, detail, modal, items }) =>
      modal
        ? showModalMessage({ level, message, detail, items: items ?? [] })
        : showMessageToast({ level, message, detail, items: items ?? [] })
    ),
    on("window.showQuickPick", ({ items, options }) => showQuickPick(items ?? [], options ?? {})),
    on("window.showInputBox", (params) => showInputBox(params)),
    on(
      "window.showOpenDialog",
      async ({ title, canSelectFiles, canSelectFolders, canSelectMany, defaultPath, filters }) => {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          title,
          directory: !!canSelectFolders && !canSelectFiles,
          multiple: !!canSelectMany,
          defaultPath,
          filters,
        });
        if (!selected) return [];
        return Array.isArray(selected) ? selected : [selected];
      }
    ),
    on("window.showSaveDialog", async ({ title, defaultPath, filters }) => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      return (await save({ title, defaultPath, filters })) ?? undefined;
    }),
    on("window.showTextDocument", ({ path, options }) => {
      const selection = options?.selection;
      if (selection) return revealInEditor(path, selection.start, selection.end);
      return Boolean(openFileInWorkbench(path));
    }),

    // ── Progress ─────────────────────────────────────────────────────────
    on("progress.start", ({ id, title, location, cancellable }) => {
      if (location === "window") {
        useStatusBarStore.getState().setMessage(id, `$(sync~spin) ${title ?? ""}`.trim());
        progressToasts.set(id, { toastId: id, title, location });
        return;
      }
      const actions = cancellable
        ? [{ label: "Cancelar", onClick: () => connection.notify("progress.cancel", { id }) }]
        : [];
      const toastId = showNotification({
        level: "progress",
        message: title ?? "Trabajando…",
        actions,
      });
      progressToasts.set(id, { toastId, title, location, actions });
    }),
    on("progress.report", ({ id, message }) => {
      const entry = progressToasts.get(id);
      if (!entry || !message) return;
      const text = entry.title ? `${entry.title}: ${message}` : message;
      if (entry.location === "window")
        useStatusBarStore.getState().setMessage(id, `$(sync~spin) ${text}`);
      else
        showNotification({
          id: entry.toastId,
          level: "progress",
          message: entry.title ?? text,
          detail: entry.title ? message : undefined,
          actions: entry.actions,
        });
    }),
    on("progress.end", ({ id }) => {
      const entry = progressToasts.get(id);
      progressToasts.delete(id);
      if (!entry) return;
      if (entry.location === "window") useStatusBarStore.getState().setMessage(id, null);
      else dismissNotification(entry.toastId);
    }),

    // ── Environment ──────────────────────────────────────────────────────
    on("env.openExternal", async ({ url }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      if (/^https?:\/\//i.test(url)) await invoke("open_external_url", { url });
      else await (await import("@tauri-apps/plugin-opener")).openUrl(url);
      return true;
    }),
    on("env.clipboard.readText", () => navigator.clipboard.readText().catch(() => "")),
    on("env.clipboard.writeText", ({ text }) =>
      navigator.clipboard.writeText(text).catch(() => undefined)
    ),

    // ── Settings and documents ───────────────────────────────────────────
    on("configuration.update", ({ key, value }) =>
      updateUserExtensionSetting(key, value ?? undefined)
    ),
    on("document.save", async ({ path }) => (await codeEditorRegistry.get(path)?.save()) ?? true),
    on("document.saveAll", async () => {
      const results = await Promise.all(
        codeEditorRegistry.getAll().map(([, handle]) => handle.save())
      );
      return results.every(Boolean);
    }),
    on("diagnostics.set", ({ owner, path, diagnostics }) =>
      useDiagnosticsStore.getState().set(owner, path, diagnostics ?? [])
    ),

    // ── Tree views ───────────────────────────────────────────────────────
    on("tree.registered", ({ viewId, extensionId, canSelectMany, showCollapseAll }) =>
      useTreeStore.getState().register({ viewId, extensionId, canSelectMany, showCollapseAll })
    ),
    on("tree.refresh", ({ viewId }) => useTreeStore.getState().refresh(viewId)),
    on("tree.update", ({ viewId, ...changes }) => useTreeStore.getState().update(viewId, changes)),
    on("tree.reveal", ({ viewId, handle }) => useTreeStore.getState().reveal(viewId, handle)),
    on("tree.disposed", ({ viewId }) => useTreeStore.getState().remove(viewId)),

    // ── Webviews ─────────────────────────────────────────────────────────
    on(
      "webview.create",
      ({ handle, kind, viewType, title, extensionId, options, preserveFocus }) => {
        useWebviewStore.getState().upsert(handle, { kind, viewType, title, extensionId, options });
        if (kind === "view") useWebviewStore.getState().setViewHandle(viewType, handle);
        else openWebviewTab(handle, title ?? viewType, !!preserveFocus);
      }
    ),
    on("webview.html", ({ handle, html }) => useWebviewStore.getState().upsert(handle, { html })),
    on("webview.options", ({ handle, options }) =>
      useWebviewStore.getState().upsert(handle, { options })
    ),
    on("webview.title", ({ handle, title }) => {
      useWebviewStore.getState().upsert(handle, { title });
      const store = useTabStore.getState();
      const tab = store.tabs.find((t) => t.routeId === WEBVIEW_ROUTE_ID && t.instanceId === handle);
      if (tab) store.updateTab(tab.id, { title });
    }),
    on("webview.icon", () => undefined),
    on("webview.postMessage", ({ handle, message }) => webviewMessages.post(handle, message)),
    on("webview.reveal", ({ handle, preserveFocus }) => {
      const webview = useWebviewStore.getState().webviews[handle];
      if (webview) openWebviewTab(handle, webview.title ?? webview.viewType, !!preserveFocus);
    }),
    on("webview.dispose", ({ handle }) => {
      useWebviewStore.getState().remove(handle);
      webviewMessages.clear(handle);
      closeWebviewTab(handle);
    }),
    on("webviewView.registered", ({ viewId }) =>
      useWebviewStore.getState().registerProvider(viewId)
    ),
    on("webviewView.update", ({ viewId, title, description }) =>
      useWebviewStore.getState().setViewMeta(viewId, { title, description })
    ),
    on("webviewView.show", ({ viewId }) => {
      void viewId;
    }),

    // Closing a webview tab disposes the panel in the extension.
    useTabStore.subscribe((state, prev) => {
      for (const tab of prev.tabs) {
        if (tab.routeId !== WEBVIEW_ROUTE_ID || !tab.instanceId) continue;
        if (state.tabs.some((t) => t.id === tab.id)) continue;
        const handle = tab.instanceId;
        if (useWebviewStore.getState().webviews[handle]) {
          useWebviewStore.getState().remove(handle);
          webviewMessages.clear(handle);
          host.notify("webview.disposed", { handle });
        }
      }
    }),

    ...registerTerminalBridge(connection),
    ...(getLanguageBridge() ? registerLanguageHandlers(connection, getLanguageBridge()!) : []),
  ];
}

/** Clear UI owned by a host that stopped. */
export function resetHostUi(): void {
  cancelQuickInputs();
  useStatusBarStore.getState().reset();
  useTreeStore.getState().reset();
  for (const handle of Object.keys(useWebviewStore.getState().webviews)) closeWebviewTab(handle);
  useWebviewStore.getState().reset();
  webviewMessages.clear();
  useDiagnosticsStore.getState().reset();
  useOutputStore.getState().reset();
  for (const [id, entry] of progressToasts) {
    if (entry.location !== "window") dismissNotification(entry.toastId);
    progressToasts.delete(id);
  }
}
