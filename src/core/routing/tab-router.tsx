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
  const lastPathRef = useRef(location.pathname + location.search);
  const isTabSwitchRef = useRef(false);

  // Always-current full URL ref — updated after every render so Tab→URL can read
  // the latest value without location being a reactive dep of that effect.
  const locationPathRef = useRef(location.pathname + location.search);
  useLayoutEffect(() => {
    locationPathRef.current = location.pathname + location.search;
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

    const fullUrl = location.pathname + location.search;
    if (fullUrl === lastPathRef.current) return;
    lastPathRef.current = fullUrl;

    const path = location.pathname;

    const { activeTabId: currentActiveId, findTabByPath, setActiveTab } = useTabStore.getState();

    // Skip public routes (login, etc.)
    const route = RouteRegistry.getRouteByPath(path);
    if (!route || route.type === "public") return;

    // Parse ?file= query param to identify the specific tab instance
    const fileParam = new URLSearchParams(location.search).get("file");
    const decodedInstanceId = fileParam ? decodeURIComponent(fileParam) : undefined;

    const existingTab = findTabByPath(path, decodedInstanceId);
    if (existingTab) {
      if (existingTab.id !== currentActiveId) {
        setActiveTab(existingTab.id);
      }
      return;
    }

    // Auto-create tab for routes that have a component and don't need an instanceId.
    // Routes like /diagram always carry a ?file= param (instanceId), so they won't
    // be auto-created here — they open explicitly via ExplorerPanel.
    if (!fileParam && route.component) {
      const { addTab } = useTabStore.getState();
      addTab({
        routeId: route.id,
        path,
        title: route.name,
        icon: route.icon,
      });
    }
  }, [location.pathname, location.search]);

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
    if (activeTab) {
      const targetUrl = activeTab.instanceId
        ? `${activeTab.path}?file=${encodeURIComponent(activeTab.instanceId)}`
        : activeTab.path;
      if (targetUrl !== locationPathRef.current) {
        isTabSwitchRef.current = true;
        lastPathRef.current = targetUrl;
        navigate(targetUrl, { replace: true });
      }
    }
  }, [activeTabId, tabs, navigate]);
}

export function TabRouter() {
  useTabRouter();
  return null;
}
