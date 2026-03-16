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
// API expuesta al plugin
// ---------------------------------------------------------------------------

export interface PluginAPI {
  registerRoutes: (routes: RouteConfig[]) => void;
  registerSidebarSection: (section: SidebarSection) => void;
  registerSidebarFooterAction: (action: SidebarFooterAction) => void;
  registerCommand: (commandId: string, handler: CommandHandler) => void;
  getAuthState: () => { isAuthenticated: boolean; user: any };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface Plugin {
  manifest: PluginManifest;
  activate: (api: PluginAPI) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}
