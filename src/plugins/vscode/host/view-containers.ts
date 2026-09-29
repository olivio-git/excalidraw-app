import { useSyncExternalStore } from "react";
import type { InstalledExtension } from "../extension-storage";
import type { CommandContribution, MenuItemContribution, ViewContribution } from "../contributions";
import { loadInstalledExtensions, onInstalledExtensionsChanged } from "../extension-registry";
import { normalizeRelativePath } from "../paths";

/**
 * Sidebar/panel containers built from `contributes.viewsContainers` and
 * `contributes.views`. Views contributed to VS Code's built-in containers
 * (explorer, scm, debug, test, remote) are grouped in one "Extensiones"
 * container, since the app has no equivalent panels.
 */

export const BUILTIN_CONTAINERS = new Set(["explorer", "scm", "debug", "test", "remote"]);
export const SHARED_CONTAINER_ID = "qori.extensionViews";

export interface ContainerIcon {
  /** Codicon id (`$(name)` in the manifest). */
  codicon?: string;
  /** Image path relative to the extension folder. */
  path?: string;
  extensionDir?: string;
}

export interface ViewContainerInfo {
  id: string;
  title: string;
  location: "sidebar" | "panel";
  icon?: ContainerIcon;
  views: Array<ViewContribution & { extensionId: string }>;
}

export interface ViewMenus {
  /** view id → title actions */
  title: Map<string, Array<MenuItemContribution & { extensionId: string }>>;
  item: Map<string, Array<MenuItemContribution & { extensionId: string }>>;
  commands: Map<string, CommandContribution & { extensionDir: string }>;
}

function parseIcon(icon: string | undefined, extensionDir: string): ContainerIcon | undefined {
  if (!icon) return undefined;
  const codicon = /^\$\(([\w-]+)\)$/.exec(icon);
  if (codicon) return { codicon: codicon[1] };
  const path = normalizeRelativePath(icon);
  return path ? { path, extensionDir } : undefined;
}

export function buildViewContainers(extensions: InstalledExtension[]): ViewContainerInfo[] {
  const containers = new Map<string, ViewContainerInfo>();
  for (const extension of extensions) {
    const { viewsContainers } = extension.contributions;
    for (const container of viewsContainers.activitybar) {
      containers.set(container.id, {
        id: container.id,
        title: container.title,
        location: "sidebar",
        icon: parseIcon(container.icon, extension.dir),
        views: [],
      });
    }
    for (const container of viewsContainers.panel) {
      containers.set(container.id, {
        id: container.id,
        title: container.title,
        location: "panel",
        icon: parseIcon(container.icon, extension.dir),
        views: [],
      });
    }
  }
  for (const extension of extensions) {
    for (const view of extension.contributions.views) {
      let target = containers.get(view.container);
      if (!target) {
        if (!BUILTIN_CONTAINERS.has(view.container)) continue;
        target = containers.get(SHARED_CONTAINER_ID) ?? {
          id: SHARED_CONTAINER_ID,
          title: "Vistas de extensiones",
          location: "sidebar",
          icon: { codicon: "extensions" },
          views: [],
        };
        containers.set(SHARED_CONTAINER_ID, target);
      }
      target.views.push({ ...view, extensionId: extension.id });
    }
  }
  return [...containers.values()].filter((container) => container.views.length > 0);
}

export function buildViewMenus(extensions: InstalledExtension[]): ViewMenus {
  const menus: ViewMenus = { title: new Map(), item: new Map(), commands: new Map() };
  const viewIds = extensions.flatMap((ext) => ext.contributions.views.map((v) => v.id));
  for (const extension of extensions) {
    for (const command of extension.contributions.commands) {
      menus.commands.set(command.command, { ...command, extensionDir: extension.dir });
    }
    const add = (map: ViewMenus["title"], items: MenuItemContribution[] | undefined) => {
      for (const item of items ?? []) {
        // Attribute each item to the views its `when` mentions (`view == id`).
        const targets = viewIds.filter((id) => item.when?.includes(id));
        for (const viewId of targets.length > 0 ? targets : []) {
          map.set(viewId, [...(map.get(viewId) ?? []), { ...item, extensionId: extension.id }]);
        }
      }
    };
    add(menus.title, extension.contributions.menus["view/title"]);
    add(menus.item, extension.contributions.menus["view/item/context"]);
  }
  return menus;
}

interface ViewModel {
  containers: ViewContainerInfo[];
  menus: ViewMenus;
}

const EMPTY: ViewModel = {
  containers: [],
  menus: { title: new Map(), item: new Map(), commands: new Map() },
};

let current: ViewModel = EMPTY;
const listeners = new Set<(model: ViewModel) => void>();
let watching = false;

function apply(extensions: InstalledExtension[]): void {
  current = { containers: buildViewContainers(extensions), menus: buildViewMenus(extensions) };
  listeners.forEach((listener) => listener(current));
}

function ensureWatching(): void {
  if (watching) return;
  watching = true;
  onInstalledExtensionsChanged(apply);
  void loadInstalledExtensions().then(apply);
}

export function getViewModel(): ViewModel {
  return current;
}

function subscribeForReact(onChange: () => void): () => void {
  ensureWatching();
  const listener = () => onChange();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useViewModel(): ViewModel {
  return useSyncExternalStore(subscribeForReact, getViewModel);
}

export function subscribeViewModel(listener: (model: ViewModel) => void): () => void {
  ensureWatching();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
