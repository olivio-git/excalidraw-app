import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { RouteRegistry } from "./route-registry";

/**
 * Bidirectional bridge between URL and Tab store.
 * - URL changes -> activates/creates matching tab
 * - Tab changes -> updates URL
 */
export function useTabRouter() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastPathRef = useRef(location.pathname);
  const isTabSwitchRef = useRef(false);

  // Always-current pathname ref — updated after every render so Tab→URL can read
  // the latest value without location.pathname being a reactive dep of that effect.
  const locationPathRef = useRef(location.pathname);
  useLayoutEffect(() => {
    locationPathRef.current = location.pathname;
  });

  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  // URL -> Tab sync: only depend on location so we don't re-run when the store
  // updates (addTab/setActiveTab). That re-run would race with Tab→URL and cause
  // the rapid switch / crash. Read store inside the effect.
  useEffect(() => {
    if (isTabSwitchRef.current) {
      isTabSwitchRef.current = false;
      return;
    }

    const path = location.pathname;
    if (path === lastPathRef.current) return;
    lastPathRef.current = path;

    const {
      tabs: currentTabs,
      activeTabId: currentActiveId,
      addTab,
      setActiveTab,
    } = useTabStore.getState();

    // Skip public routes (login, etc.)
    const route = RouteRegistry.getRouteByPath(path);
    if (!route || route.type === "public") return;

    const existingTab = currentTabs.find((t) => t.path === path);
    if (existingTab) {
      if (existingTab.id !== currentActiveId) {
        setActiveTab(existingTab.id);
      }
      return;
    }

    addTab({
      routeId: route.id,
      path,
      title: route.name,
      icon: route.icon,
    });
  }, [location.pathname]);

  // Tab -> URL sync: When active tab changes, navigate to its path.
  //
  // IMPORTANT: location.pathname is intentionally NOT in deps. This effect must
  // only react to tab store changes (user clicking a tab), never to external URL
  // changes (those are handled exclusively by URL→Tab above). Including
  // location.pathname would cause this effect to run when the URL changes and
  // fight URL→Tab with stale activeTabId, creating an infinite navigate loop.
  // locationPathRef gives us the current pathname without the reactive dep.
  useEffect(() => {
    if (!activeTabId) return;

    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab && activeTab.path !== locationPathRef.current) {
      isTabSwitchRef.current = true;
      lastPathRef.current = activeTab.path;
      navigate(activeTab.path, { replace: true });
    }
  }, [activeTabId, tabs, navigate]);
}

export function TabRouter() {
  useTabRouter();
  return null;
}
