import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useTabStore } from "../store/tab-store";
import { RouteRegistry } from "@/core/routing/route-registry";
import type { RouteConfig } from "@/core/routing/types";

export function useTabs() {
  const navigate = useNavigate();
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const addTab = useTabStore((s) => s.addTab);
  const removeTab = useTabStore((s) => s.removeTab);
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
      navigate(route.path);
      return tabId;
    },
    [addTab, navigate]
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
      navigate(path);
      return tabId;
    },
    [addTab, navigate, openTab]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const state = useTabStore.getState();
      const wasActive = state.activeTabId === tabId;
      removeTab(tabId);

      if (wasActive) {
        const newState = useTabStore.getState();
        if (newState.activeTabId) {
          const activeTab = newState.tabs.find((t) => t.id === newState.activeTabId);
          if (activeTab) {
            navigate(activeTab.path);
          }
        }
      }
    },
    [removeTab, navigate]
  );

  const switchToTab = useCallback(
    (tabId: string) => {
      const tab = useTabStore.getState().tabs.find((t) => t.id === tabId);
      if (tab) {
        setActiveTab(tabId);
        navigate(tab.path);
      }
    },
    [setActiveTab, navigate]
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
