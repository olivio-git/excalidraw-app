import { lazy } from "react";
import type { Plugin, PluginAPI } from "@/plugins/types";
import { useTabStore } from "@/core/tabs/store/tab-store";
import i18n from "@/core/i18n/i18n";

// Three.js loads only when the graph is opened.
const KnowledgeGraph = lazy(() => import("./KnowledgeGraph"));

export const GRAPH_ROUTE_ID = "knowledge-graph";

export function openKnowledgeGraph(): void {
  useTabStore.getState().addTab({
    routeId: GRAPH_ROUTE_ID,
    path: `/${GRAPH_ROUTE_ID}`,
    title: i18n.t("graph.title", { ns: "common" }),
  });
}

function activate(api: PluginAPI): void {
  api.registerRoutes([
    {
      id: GRAPH_ROUTE_ID,
      path: `/${GRAPH_ROUTE_ID}`,
      name: "Knowledge graph",
      type: "protected",
      component: KnowledgeGraph,
      security: { requiresAuth: false },
      tabConfig: { singleton: true, closable: true, keepMounted: true },
      showSidebar: false,
      showInCommandPalette: false,
    },
  ]);
  api.registerCommand("knowledgeGraph.open", openKnowledgeGraph);
}

export const knowledgeGraphPlugin: Plugin = {
  manifest: {
    id: "knowledge-graph",
    name: "Knowledge graph",
    version: "0.1.0",
    description: "Files and links of the workspace as a 3D graph",
    author: "excalidraw-app",
    commands: [{ id: "knowledgeGraph.open", name: "Workspace: Knowledge graph (3D)" }],
  },
  activate,
};
