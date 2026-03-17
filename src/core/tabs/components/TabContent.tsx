import React, { Suspense, lazy } from "react";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { TabContext } from "../hooks/use-tab-context";
import { useTabStore } from "../store/tab-store";
import { RouteRegistry } from "@/core/routing/route-registry";
import type { TabInstance } from "../types";
import { ErrorBoundary } from "@/shared/components/error/ErrorBoundary";
import { ErrorFallback } from "@/shared/components/error/ErrorFallback";

const WelcomeScreen = lazy(() => import("@/features/diagram/WelcomeScreen"));

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

    const keepMounted = route?.tabConfig?.keepMounted ?? false;

    return (
      <TabContext.Provider value={{ tabId: tab.id, isActive }}>
        <div
          className="h-full"
          style={!isActive && keepMounted ? { opacity: 0, pointerEvents: "none" } : undefined}
        >
          <ErrorBoundary fallback={ErrorFallback} name={`TabBoundary-${route?.name || tab.id}`}>
            <Suspense fallback={<TabSkeleton />}>
              {isActive || keepMounted ? Component ? <Component /> : <FallbackPage /> : null}
            </Suspense>
          </ErrorBoundary>
        </div>
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
      <Suspense fallback={null}>
        <WelcomeScreen />
      </Suspense>
    );
  }

  return (
    <div className="h-full relative">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="absolute inset-0"
          style={{ zIndex: tab.id === activeTabId ? 1 : 0 }}
        >
          <TabRenderer tab={tab} isActive={tab.id === activeTabId} />
        </div>
      ))}
    </div>
  );
};

export default TabContent;
