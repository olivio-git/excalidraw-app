import { createElement, lazy } from "react";
import { AppWindow, Blocks, ScrollText } from "lucide-react";
import { RouteRegistry } from "@/core/routing/route-registry";
import type { RouteConfig } from "@/core/routing/types";
import { panelRegistry } from "@/core/panel/panel-registry";
import { viewRegistry } from "@/core/layout/view-registry";
import { extensionPanelId } from "@/core/shell/sidebar-panel-store";
import { ExtensionIcon } from "./extension-assets";
import { panelViews } from "@/core/panel/panel-store";
import { PluginManager } from "@/plugins/plugin-manager";
import { editorContributions } from "@/features/code-editor/editor-contributions";
import { extensionHost, initExtensionHost } from "./extension-host-service";
import { HOST_LOG_CHANNEL, useOutputStore } from "./output-store";
import { OUTPUT_VIEW_ID, WEBVIEW_ROUTE_ID } from "./host-handlers";
import { subscribeViewModel, type ViewContainerInfo } from "./view-containers";
import { initLanguageBridge } from "./language-bridge";

const WebviewPanelTab = lazy(() => import("./WebviewPanelTab"));
const OutputPanel = lazy(() => import("./OutputPanel").then((m) => ({ default: m.OutputPanel })));
const OutputPanelActions = lazy(() =>
  import("./OutputPanel").then((m) => ({ default: m.OutputPanelActions }))
);
const ExtensionViewContainer = lazy(() =>
  import("./ExtensionViewContainer").then((m) => ({ default: m.ExtensionViewContainer }))
);

const webviewRoute: RouteConfig = {
  id: WEBVIEW_ROUTE_ID,
  path: `/${WEBVIEW_ROUTE_ID}`,
  name: "Webview",
  type: "protected",
  icon: AppWindow as unknown as React.ComponentType<{ className?: string }>,
  component: WebviewPanelTab,
  security: { requiresAuth: false },
  // Webviews lose their state when their iframe is removed.
  tabConfig: { singleton: false, closable: true, keepMounted: true },
  showSidebar: false,
  showInCommandPalette: false,
};

const COMMANDS: Array<{ id: string; name: string; category: string; run: () => unknown }> = [
  {
    id: "workbench.action.restartExtensionHost",
    name: "Desarrollador: Reiniciar Extension Host",
    category: "Developer",
    run: () => extensionHost.restart(),
  },
  {
    id: "workbench.action.showExtensionHostLog",
    name: "Desarrollador: Mostrar registro del Extension Host",
    category: "Developer",
    run: () => {
      useOutputStore.getState().create(HOST_LOG_CHANNEL, "Extension Host");
      useOutputStore.getState().setActive(HOST_LOG_CHANNEL);
      panelViews.show(OUTPUT_VIEW_ID);
    },
  },
  {
    id: "workbench.action.output.toggleOutput",
    name: "Ver: Mostrar salida",
    category: "View",
    run: () => panelViews.show(OUTPUT_VIEW_ID),
  },
];

/** Registered view containers, by id, with the info they were registered with. */
const registeredContainers = new Map<string, { key: string; dispose: () => void }>();

/**
 * Extension view containers are workbench views: they start in the side bar
 * or the panel (as contributed) and the user can move them. Re-registered
 * only when their info changes, so open views are not remounted.
 */
function syncContainers(containers: ViewContainerInfo[]): void {
  const seen = new Set<string>();
  containers.forEach((container, index) => {
    const id = extensionPanelId(container.id);
    const key = JSON.stringify([container, index]);
    seen.add(id);
    if (registeredContainers.get(id)?.key === key) return;
    registeredContainers.get(id)?.dispose();
    const icon = ({ className }: { className?: string }) =>
      createElement(ExtensionIcon, {
        icon: container.icon,
        className,
        fallback: createElement(Blocks, { className }),
      });
    const dispose = viewRegistry.register({
      id,
      title: container.title,
      icon,
      order: 100 + index,
      defaultLocation: container.location === "panel" ? "panel" : "primary",
      component: () => createElement(ExtensionViewContainer, { container }),
    });
    registeredContainers.set(id, { key, dispose });
  });
  for (const [id, entry] of registeredContainers) {
    if (seen.has(id)) continue;
    entry.dispose();
    registeredContainers.delete(id);
  }
}

let initialized = false;

/** Wire the extension host into the workbench. Call once at startup. */
export function initExtensionHostUi(): void {
  if (initialized) return;
  initialized = true;

  RouteRegistry.register([webviewRoute]);
  panelRegistry.register({
    id: OUTPUT_VIEW_ID,
    title: "Salida",
    icon: ScrollText,
    order: 20,
    component: OutputPanel,
    actions: OutputPanelActions,
  });
  for (const command of COMMANDS) {
    if (PluginManager.hasCommand(command.id)) continue;
    PluginManager.registerDynamicCommand(
      { id: command.id, name: command.name, category: command.category },
      async () => {
        await command.run();
      }
    );
  }
  subscribeViewModel((model) => syncContainers(model.containers));

  // `onLanguage:<id>` activation when a file of that language is opened.
  editorContributions.register({
    id: "exthost-activation",
    onDidOpen: (doc) => void extensionHost.activateByEvent(`onLanguage:${doc.languageId}`),
  });

  initLanguageBridge(extensionHost);
  initExtensionHost();
}

export { QuickInputHost } from "./quick-input";
export { StatusBar } from "./StatusBar";
