/**
 * @deprecated All types have been consolidated in `src/plugins/types.ts`.
 * Import from `src/plugins/sdk` (index) or directly from `@/plugins/types`.
 *
 * This file is kept to avoid breaking any existing relative imports.
 * It re-exports everything from the canonical sources.
 */

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
  FileStat,
  FileListEntry,
  PluginFilesAPI,
  TabInfo,
  PluginTabsAPI,
} from "@/plugins/types";

export type { RouteConfig } from "@/core/routing/types";
export type { KeybindingDeclaration } from "@/core/keybindings/types";
