import type React from "react";
import type { RouteConfig } from "@/core/routing/types";
import type { User } from "@/core/auth/types";
import type { KeybindingDeclaration } from "@/core/keybindings/types";
import type {
  ExcalidrawImperativeAPI,
  BinaryFileData,
  AppState,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

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
 * Diagram sub-API exposed through PluginAPI.diagram.
 * Provides imperative access to the active Excalidraw canvas instance.
 */
export interface DiagramPluginAPI {
  getElements(): readonly ExcalidrawElement[];
  addElements(elements: ExcalidrawElement[]): void;
  setElements(elements: ExcalidrawElement[]): void;
  updateScene(sceneData: {
    elements?: ExcalidrawElement[];
    appState?: Partial<AppState>;
    files?: Record<string, BinaryFileData>;
  }): void;
  scrollToContent(): void;
  getApi(instanceId: string): ExcalidrawImperativeAPI | undefined;
  waitForInstance(instanceId: string, timeoutMs?: number): Promise<ExcalidrawImperativeAPI>;
}

/**
 * Public API surface that the host exposes to plugins.
 *
 * This interface is intentionally small and stable; internal PluginManager
 * details stay private and are not exposed through this type.
 */
export interface ActiveTabInfo {
  tabId: string;
  routeId: string;
  title: string;
  path: string;
  instanceId?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginAPI {
  registerRoutes: (routes: RouteConfig[]) => void;
  registerSidebarSection: (section: SidebarSection) => void;
  registerCommand: (commandId: string, handler: CommandHandler) => void;
  getAuthState: () => { isAuthenticated: boolean; user: User | null };
  /** Show a toast notification. */
  notify: (message: string, options?: import("@/shared/lib/notify").NotifyOptions) => void;
  /** Show a confirmation dialog. Returns true if confirmed, false if cancelled. */
  confirm: (options?: import("@/shared/lib/confirm").ConfirmOptions) => Promise<boolean>;
  /**
   * Show a form dialog with one or more input fields.
   * Returns a Record<fieldId, value> if confirmed, null if cancelled.
   */
  prompt: (
    options: import("@/shared/lib/prompt").PromptOptions
  ) => Promise<import("@/shared/lib/prompt").PromptResult>;
  /** Returns the currently active tab, or null if none. */
  getActiveTab: () => ActiveTabInfo | null;
  /** Returns the current workspace directory, or null if not set. */
  getWorkspaceDir: () => string | null;
  /**
   * Register a custom icon for a file extension.
   * Example: api.registerFileIcon("md", MarkdownIcon)
   */
  registerFileIcon: (extension: string, icon: React.ComponentType<{ className?: string }>) => void;
  /**
   * Register a handler for a file extension.
   * Determines which route opens the file and how new files are created.
   * Example: api.registerFileHandler("md", { routeId: "markdown-editor", ... })
   */
  registerFileHandler: (
    extension: string,
    handler: import("@/core/shell/panels/file-handler-registry").FileHandler
  ) => void;
  registerSettingsAction: (action: SidebarFooterAction) => void;
  registerSidebarFooterAction: (action: SidebarFooterAction) => void;

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

  /**
   * Open a file in a new tab.
   * Uses the registered file handler for the extension, falls back to the default handler.
   */
  openFile: (filePath: string) => void;

  /**
   * Execute a registered command by ID.
   * Can target built-in commands or commands from other plugins.
   */
  executeCommand: (commandId: string) => Promise<void>;

  /**
   * Subscribe to active tab changes.
   * Handler is called immediately with the current tab, then on every change.
   * Returns an unsubscribe function — call it in plugin deactivate().
   */
  onTabChange: (handler: (tab: ActiveTabInfo | null) => void) => () => void;

  /**
   * Returns the current resolved theme ("light" or "dark").
   */
  getTheme: () => "light" | "dark";

  /**
   * Imperative API for the active Excalidraw diagram canvas.
   * All methods operate on the currently active diagram tab instance.
   */
  diagram: DiagramPluginAPI;
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
