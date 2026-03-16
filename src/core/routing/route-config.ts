import { lazy } from "react";
import { LayoutDashboard, LucideView, Settings, PlugZap, PencilLine } from "lucide-react";
import type { RouteConfig } from "./types";

// Lazy-loaded feature components
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const PluginAdminPage = lazy(() => import("@/features/plugins/PluginAdminPage"));
const DiagramCanvas = lazy(() => import("@/features/diagram/DiagramCanvas"));

export const diagramRoute: RouteConfig = {
  id: "diagram",
  path: "/diagram",
  name: "Diagram",
  type: "protected",
  icon: PencilLine as unknown as React.ComponentType<{ className?: string }>,
  component: DiagramCanvas,
  security: { requiresAuth: false },
  tabConfig: { singleton: false, closable: true, keepMounted: true },
  showSidebar: false,
  showInCommandPalette: false,
};

export const protectedRoutes: RouteConfig[] = [
  {
    id: "home",
    path: "/home",
    name: "Home",
    description: "Main dashboard",
    type: "protected",
    icon: LayoutDashboard as unknown as React.ComponentType<{ className?: string }>,
    isHeader: true,
    security: {
      requiresAuth: true,
    },
    tabConfig: {
      singleton: true,
      pinnable: true,
      closable: true,
    },
    metadata: {
      keywords: ["dashboard", "home", "main"],
      category: "General",
      order: 0,
    },
    showSidebar: true,
    showInCommandPalette: true,

    subRoutes: [
      {
        id: "home-overview",
        path: "/home/overview",
        name: "Welcome",
        type: "protected",
        security: {
          requiresAuth: true,
        },
        showSidebar: true,
        showInCommandPalette: true,
        icon: LucideView as unknown as React.ComponentType<{ className?: string }>,
      },
    ],
  },
  {
    id: "settings",
    path: "/settings",
    name: "Settings",
    description: "Application settings and preferences",
    type: "protected",
    icon: Settings as unknown as React.ComponentType<{ className?: string }>,
    component: SettingsPage,
    security: {
      requiresAuth: true,
    },
    tabConfig: {
      singleton: true,
      pinnable: false,
      closable: true,
    },
    metadata: {
      keywords: ["settings", "preferences", "theme", "appearance"],
      category: "General",
      order: 100,
    },
    showSidebar: true,
    showInCommandPalette: true,
  },
  {
    id: "plugin-admin",
    path: "/settings/plugins",
    name: "Plugin Administration",
    description: "Manage installed plugins and their capabilities",
    type: "protected",
    icon: PlugZap as unknown as React.ComponentType<{ className?: string }>,
    component: PluginAdminPage,
    security: {
      requiresAuth: true,
    },
    tabConfig: {
      singleton: true,
      pinnable: false,
      closable: true,
    },
    metadata: {
      keywords: ["plugins", "extensions", "integrations"],
      category: "General",
      order: 110,
    },
    showSidebar: false,
    showInCommandPalette: true,
  },
];

export const publicRoutes: RouteConfig[] = [
  {
    id: "login",
    path: "/login",
    name: "Login",
    type: "public",
    security: {
      requiresAuth: false,
    },
    showSidebar: false,
  },
];
