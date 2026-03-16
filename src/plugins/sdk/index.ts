export type {
  Plugin,
  PluginAPI,
  PluginManifest,
  PluginCommand,
  CommandHandler,
  RouteConfig,
  SidebarSection,
  SidebarFooterAction,
} from "./types";

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
