// Re-export from canonical sources — sdk/types.ts is kept only for
// SDK-specific helpers (RouteConfig, KeybindingDeclaration) that live
// outside src/plugins/types.ts.
export type {
  Plugin,
  PluginAPI,
  PluginManifest,
  PluginCommand,
  CommandHandler,
  SidebarSection,
  SidebarFooterAction,
  SidebarFooterActionItem,
  PluginEventHandler,
  DiagramPluginAPI,
  ActiveTabInfo,
  // files sub-API
  FileStat,
  FileListEntry,
  PluginFilesAPI,
  // tabs sub-API
  TabInfo,
  PluginTabsAPI,
} from "@/plugins/types";

// These types live outside src/plugins/types.ts — re-export for plugin convenience
export type { RouteConfig } from "@/core/routing/types";
export type { KeybindingDeclaration } from "@/core/keybindings/types";

/**
 * Helper para definir un plugin con autocompletado completo.
 * No hace nada en runtime — solo ayuda a TypeScript a inferir los tipos.
 *
 * @example
 * import { definePlugin } from "@tuapp/plugin-sdk";
 *
 * export default definePlugin({
 *   manifest: { id: "mi-plugin", name: "Mi Plugin", version: "1.0.0" },
 *   activate(api) {
 *     api.registerSidebarFooterAction({ ... });
 *   },
 * });
 */
export function definePlugin(plugin: import("./types").Plugin) {
  return plugin;
}
