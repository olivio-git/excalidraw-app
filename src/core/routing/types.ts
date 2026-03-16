import type React from "react";

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
    /**
     * When true, the tab stays mounted and uses `visibility: hidden` instead of unmounting.
     * Required for canvas-based components (Excalidraw, PDF viewers, etc.) that lose
     * their rendering context when removed from the DOM.
     */
    keepMounted?: boolean;
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
