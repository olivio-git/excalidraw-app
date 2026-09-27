import { useCallback } from "react";
import { requestCloseTab } from "../tab-lifecycle";
import { useTabStore } from "../store/tab-store";
import { RouteRegistry } from "@/core/routing/route-registry";
import type { RouteConfig } from "@/core/routing/types";

export function useTabs() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const addTab = useTabStore((s) => s.addTab);
  const setActiveTab = useTabStore((s) => s.setActiveTab);

  const openTab = useCallback(
    (route: RouteConfig, instanceId?: string, metadata?: Record<string, any>) => {
      if (!route.path) return;
      const tabId = addTab({
        routeId: route.id,
        path: route.path,
        title: route.name,
        icon: route.icon,
        instanceId,
        metadata,
      });
      return tabId;
    },
    [addTab]
  );

  const openTabByPath = useCallback(
    (path: string, title?: string) => {
      const route = RouteRegistry.getRouteByPath(path);
      if (route) {
        return openTab(route);
      }
      // Fallback for unregistered paths
      const tabId = addTab({
        routeId: path,
        path,
        title: title || path.split("/").pop() || "Tab",
      });
      return tabId;
    },
    [addTab, openTab]
  );

  const closeTab = requestCloseTab;

  const switchToTab = useCallback(
    (tabId: string) => {
      const tab = useTabStore.getState().tabs.find((t) => t.id === tabId);
      if (tab) {
        setActiveTab(tabId);
      }
    },
    [setActiveTab]
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return {
    tabs,
    activeTabId,
    activeTab,
    openTab,
    openTabByPath,
    closeTab,
    switchToTab,
  };
}
