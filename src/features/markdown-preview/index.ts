import { lazy } from "react";
import { Eye } from "lucide-react";
import { RouteRegistry } from "@/core/routing/route-registry";
import type { RouteConfig } from "@/core/routing/types";
import { PluginManager } from "@/plugins/plugin-manager";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { KeybindingSource } from "@/core/keybindings/types";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { notify } from "@/shared/lib/notify";

const MarkdownPreview = lazy(() => import("./MarkdownPreview"));

export const MARKDOWN_PREVIEW_ROUTE_ID = "markdown-preview";
export const OPEN_PREVIEW_COMMAND = "markdown.openPreviewToSide";

const previewRoute: RouteConfig = {
  id: MARKDOWN_PREVIEW_ROUTE_ID,
  path: "/markdown-preview",
  name: "Markdown Preview",
  type: "protected",
  icon: Eye as unknown as React.ComponentType<{ className?: string }>,
  component: MarkdownPreview,
  security: { requiresAuth: false },
  tabConfig: { singleton: false, closable: true, keepMounted: true },
  showSidebar: false,
  showInCommandPalette: false,
};

const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

/** Open (or show) the preview of a Markdown file in the other editor group. */
export function openMarkdownPreview(filePath: string): string {
  const store = useTabStore.getState();
  const instanceId = `preview:${filePath}`;
  const existing = store.tabs.find((tab) => tab.instanceId === instanceId);
  if (existing) {
    store.setActiveTab(existing.id);
    return existing.id;
  }
  const source = store.activeGroupId;
  return store.addTab({
    routeId: MARKDOWN_PREVIEW_ROUTE_ID,
    path: `/${MARKDOWN_PREVIEW_ROUTE_ID}`,
    title: `Vista previa: ${filePath.split(/[\\/]/).pop() ?? filePath}`,
    instanceId,
    metadata: { filePath },
    groupId: source === "secondary" ? "primary" : "secondary",
  });
}

let initialized = false;

/** Route, command and Ctrl+K V shortcut of the Markdown preview. Call once. */
export function initMarkdownPreview(): void {
  if (initialized) return;
  initialized = true;
  RouteRegistry.register([previewRoute]);
  PluginManager.registerDynamicCommand(
    { id: OPEN_PREVIEW_COMMAND, name: "Markdown: Abrir vista previa al lado", category: "View" },
    async () => {
      const state = useTabStore.getState();
      const tab = state.tabs.find((t) => t.id === state.activeTabId);
      const filePath = (tab?.metadata?.filePath ?? tab?.instanceId ?? "") as string;
      if (!isMarkdown(filePath)) {
        notify("Abre un archivo Markdown (.md) para ver su vista previa", { type: "info" });
        return;
      }
      openMarkdownPreview(filePath);
    }
  );
  keybindingRegistry.registerDefault({
    commandId: OPEN_PREVIEW_COMMAND,
    chord: keyNormalizer.normalizeChord("ctrl+k v"),
    source: KeybindingSource.Builtin,
    allowInInput: true,
  });
}
