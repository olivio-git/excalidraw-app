import type React from "react";

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RouteConfig {
  id: string;
  path?: string;
  name: string;
  description?: string;
  type: "public" | "protected";
  icon?: React.ComponentType<{ className?: string }>;
  component?: React.LazyExoticComponent<React.ComponentType<any>>;

  security: {
    requiresAuth: boolean;
    permissions?: string[];
    roles?: string[];
  };

  tabConfig?: {
    pinnable?: boolean;
    closable?: boolean;
    singleton?: boolean;
    maxInstances?: number;
  };

  metadata?: {
    keywords?: string[];
    category?: string;
    order?: number;
    hidden?: boolean;
  };

  subRoutes?: RouteConfig[];
  isHeader?: boolean;
  showSidebar?: boolean;
  showInCommandPalette?: boolean;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export interface SidebarSection {
  id: string;
  label: string;
  order: number;
  icon?: React.ComponentType<{ className?: string }>;
  items: RouteConfig[];
}

export interface SidebarFooterAction {
  id: string;
  icon?: React.ComponentType<{ className?: string }>;
  tooltip: string;
  onClick: () => void;
  destructive?: boolean;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type CommandHandler = () => void | Promise<void>;

export interface PluginCommand {
  id: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  minAppVersion?: string;
  entryPoint?: string;
  permissions?: Array<"sidebar" | "routes" | "commands" | "auth">;
  dependencies?: string[];
  commands?: PluginCommand[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type PluginEventHandler = (payload: unknown) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Keybindings
// ---------------------------------------------------------------------------

export interface KeybindingDeclaration {
  key: string;
  commandId: string;
  when?: string;
}

// ---------------------------------------------------------------------------
// Diagram API
// ---------------------------------------------------------------------------

/**
 * Diagram sub-API exposed through PluginAPI.diagram.
 * Provides imperative access to the active Excalidraw canvas instance.
 * Types use `any` where Excalidraw's internal types are not re-exported by the package.
 */
export interface DiagramPluginAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getElements(): readonly any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addElements(elements: any[]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setElements(elements: any[]): void;
  updateScene(sceneData: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    elements?: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    appState?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    files?: Record<string, any>;
  }): void;
  scrollToContent(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getApi(instanceId: string): any | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  waitForInstance(instanceId: string, timeoutMs?: number): Promise<any>;
}

// ---------------------------------------------------------------------------
// API expuesta al plugin
// ---------------------------------------------------------------------------

export interface PluginAPI {
  // UI registration
  registerRoutes: (routes: RouteConfig[]) => void;
  registerSidebarSection: (section: SidebarSection) => void;
  registerSidebarFooterAction: (action: SidebarFooterAction) => void;
  registerCommand: (commandId: string, handler: CommandHandler) => void;

  // Event bus (namespaced topics, e.g. "myPlugin.didSomething")
  onEvent: (topic: string, handler: PluginEventHandler) => () => void;
  emitEvent: (topic: string, payload?: unknown) => void;

  // Keybindings
  registerKeybinding: (declaration: KeybindingDeclaration) => void;
  registerContext: (key: string, value: boolean | string | number) => void;

  // App state
  getAuthState: () => { isAuthenticated: boolean; user: any };

  // Diagram canvas access
  diagram: DiagramPluginAPI;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface Plugin {
  manifest: PluginManifest;
  activate: (api: PluginAPI) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}
