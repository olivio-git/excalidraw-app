import type { Plugin } from "@/plugins/types";
import manifest from "./manifest.json";
import { lazy } from "react";
import { Archive, Puzzle } from "lucide-react";

const myPluginRoute = {
  id: "my-plugin-page",
  path: "/my-plugin",
  name: "My Plugin Page",
  type: "protected" as const,
  security: { requiresAuth: true },
  component: lazy(() => import("./examplePage")),
  showSidebar: true,
  icon: Puzzle,
};
const myPluginRoute2 = {
  id: "my-plugin-page-2",
  path: "/my-plugin/2",
  name: "My Plugin Page 2",
  type: "protected" as const,
  security: { requiresAuth: true },
  component: lazy(() => import("./examplePage")),
  showSidebar: true,
  icon: Archive,
};
const examplePlugin: Plugin = {
  manifest,

  activate: (_api) => {
    console.log("[ExamplePlugin] Activated");

    _api.registerCommand("example.command.write", () => {
      alert("Example command executed!");
    });

    _api.registerRoutes([myPluginRoute, myPluginRoute2]);
    _api.registerSidebarSection({
      id: "my-plugin-section",
      label: "My Plugin",
      order: 100,
      icon: Puzzle,
      items: [myPluginRoute, myPluginRoute2],
    });
  },

  deactivate: () => {
    console.log("[ExamplePlugin] Deactivated");
  },
};

export default examplePlugin;
