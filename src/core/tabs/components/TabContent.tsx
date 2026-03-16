import React, { Suspense, Activity } from "react";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { TabContext } from "../hooks/use-tab-context";
import { useTabStore } from "../store/tab-store";
import { RouteRegistry } from "@/core/routing/route-registry";
import type { TabInstance } from "../types";
import { ErrorBoundary } from "@/shared/components/error/ErrorBoundary";
import { ErrorFallback } from "@/shared/components/error/ErrorFallback";

const TabSkeleton = () => (
  <div className="p-6 space-y-4">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-32 w-full" />
  </div>
);

const FallbackPage = () => (
  <div className="flex items-center justify-center h-full">
    <div className="text-center text-muted-foreground">
      <p className="text-lg font-medium">Page not found</p>
      <p className="text-sm mt-2">The requested page could not be found.</p>
    </div>
  </div>
);

const TabRenderer = React.memo(
  ({ tab, isActive }: { tab: TabInstance; isActive: boolean }) => {
    const route = RouteRegistry.getRoute(tab.routeId);
    const Component = route?.component;

    return (
      <TabContext.Provider value={{ tabId: tab.id, isActive }}>
        <Activity mode={isActive ? "visible" : "hidden"}>
          <ErrorBoundary fallback={ErrorFallback} name={`TabBoundary-${route?.name || tab.id}`}>
            <Suspense fallback={<TabSkeleton />}>
              {Component ? <Component /> : <FallbackPage />}
            </Suspense>
          </ErrorBoundary>
        </Activity>
      </TabContext.Provider>
    );
  },
  (prev, next) => {
    if (prev.tab.id !== next.tab.id) return false;
    if (prev.isActive !== next.isActive) return false;
    if (prev.tab.routeId !== next.tab.routeId) return false;
    return true;
  }
);
TabRenderer.displayName = "TabRenderer";

const TabContent: React.FC = () => {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  if (tabs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p className="text-lg font-medium">No tabs open</p>
          <p className="text-sm mt-2">Navigate to any section to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full relative">
      {tabs.map((tab) => (
        <TabRenderer key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
      ))}
    </div>
  );
};

export default TabContent;
