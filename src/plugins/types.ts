import type { RouteConfig } from "@/core/routing/types";
import type { User } from "@/core/auth/types";
import type { KeybindingDeclaration } from "@/core/keybindings/types";

export interface PluginCommand {
  id: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
}

export type CommandHandler = () => void | Promise<void>;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  dependencies?: string[];
  commands?: PluginCommand[];
}

export interface SidebarFooterActionItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  isActive?: boolean;
}

export interface SidebarFooterAction {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  destructive?: boolean;
  submenu?: SidebarFooterActionItem[];
}

/**
 * Handler used for high-level plugin events (pub/sub between plugins and host).
 * The payload is intentionally untyped to keep the event bus generic.
 */
export type PluginEventHandler = (payload: unknown) => void | Promise<void>;

/**
 * Public API surface that the host exposes to plugins.
 *
 * This interface is intentionally small and stable; internal PluginManager
 * details stay private and are not exposed through this type.
 */
export interface PluginAPI {
  registerRoutes: (routes: RouteConfig[]) => void;
  registerSidebarSection: (section: SidebarSection) => void;
  registerCommand: (commandId: string, handler: CommandHandler) => void;
  getAuthState: () => { isAuthenticated: boolean; user: User | null };
  registerSettingsAction: (action: SidebarFooterAction) => void;

  /**
   * Subscribe to a logical event topic.
   * Topics should be namespaced, for example: "myPlugin.didSomething".
   */
  onEvent: (topic: string, handler: PluginEventHandler) => () => void;

  /**
   * Emit an event on a logical topic.
   * Only payload shape agreed by participants should be relied upon.
   */
  emitEvent: (topic: string, payload?: unknown) => void;

  /**
   * Register a keybinding for this plugin.
   * The binding is tagged with source 'plugin' and automatically unregistered
   * when the plugin is deactivated.
   */
  registerKeybinding: (declaration: KeybindingDeclaration) => void;

  /**
   * Set a context key that can be used in keybinding `when` expressions.
   */
  registerContext: (key: string, value: boolean | string | number) => void;
}

export interface SidebarSection {
  id: string;
  label: string;
  order: number;
  icon?: React.ComponentType<{ className?: string }>;
  items: RouteConfig[];
}

export interface Plugin {
  manifest: PluginManifest;
  activate: (api: PluginAPI) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}
