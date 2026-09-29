import { Suspense, lazy, memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { ErrorBoundary } from "@/shared/components/error/ErrorBoundary";
import { ErrorFallback } from "@/shared/components/error/ErrorFallback";
import { RouteRegistry } from "@/core/routing/route-registry";
import { contextKeyService } from "@/core/keybindings/context-key-service";
import { TabContext } from "../hooks/use-tab-context";
import { useTabStore } from "../store/tab-store";
import { useTabMountStore } from "../tab-mount";
import { tabGroup } from "../store/editor-layout";
import { EDITOR_GROUP, type EditorGroupId, type SplitDirection } from "../types";
import { useResizePreview } from "@/shared/hooks/useResizePreview";
import TabBar from "./TabBar";
import { cn } from "@/shared/lib/utils";

const WelcomeScreen = lazy(() => import("@/features/diagram/WelcomeScreen"));
const TabSkeleton = () => (
  <div className="p-6">
    <Skeleton className="h-32 w-full" />
  </div>
);

function paneBounds(group: EditorGroupId, direction: SplitDirection | null): CSSProperties {
  if (!direction) return { left: 0, top: 0, width: "100%", height: "100%" };
  const primary = group === EDITOR_GROUP.PRIMARY;
  const offset = primary ? "0px" : "calc(var(--editor-split-ratio) + 3px)";
  const extent = primary
    ? "calc(var(--editor-split-ratio) - 3px)"
    : "calc(100% - var(--editor-split-ratio) - 3px)";
  return direction === "horizontal"
    ? { left: offset, width: extent, top: 0, height: "100%" }
    : { top: offset, height: extent, left: 0, width: "100%" };
}

// The app does not enable React Compiler. Keep layout renders outside editor trees.
const TabRenderer = memo(function TabRenderer({
  tabId,
  routeId,
  instanceId,
  isActive,
  isVisible,
}: {
  tabId: string;
  routeId: string;
  instanceId?: string;
  isActive: boolean;
  isVisible: boolean;
}) {
  const route = RouteRegistry.getRoute(routeId);
  const Component = route?.component;
  const { t } = useTranslation("tabs");
  // keepMounted tabs are created the first time they are shown (not all at
  // startup when a session is restored) and then stay mounted to keep their
  // editor state. A hidden tab can also be mounted on request (tab-mount.ts).
  const [wasVisible, setWasVisible] = useState(isVisible);
  if (isVisible && !wasVisible) setWasVisible(true);
  const mountRequested = useTabMountStore((state) => !!instanceId && !!state.requested[instanceId]);
  const mounted = isVisible || (!!route?.tabConfig?.keepMounted && (wasVisible || mountRequested));
  return (
    <TabContext.Provider value={{ tabId, isActive, isVisible }}>
      <ErrorBoundary fallback={ErrorFallback} name={`TabBoundary-${routeId}`}>
        <Suspense fallback={<TabSkeleton />}>
          {mounted ? (
            Component ? (
              <Component />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">{t("workbench.unavailable")}</p>
            )
          ) : null}
        </Suspense>
      </ErrorBoundary>
    </TabContext.Provider>
  );
});

export default function TabContent() {
  const { t } = useTranslation("tabs");
  const tabs = useTabStore((state) => state.tabs);
  const activeTabId = useTabStore((state) => state.activeTabId);
  const activeGroupId = useTabStore((state) => state.activeGroupId);
  const groupActiveIds = useTabStore((state) => state.groupActiveTabIds);
  const direction = useTabStore((state) => state.splitDirection);
  const savedRatio = useTabStore((state) => state.splitRatio);
  const rootRef = useRef<HTMLDivElement>(null);
  const resize = useResizePreview();
  const activeRoute = tabs.find((tab) => tab.id === activeTabId)?.routeId;
  const groups = direction ? Object.values(EDITOR_GROUP) : [EDITOR_GROUP.PRIMARY];

  useEffect(() => {
    contextKeyService.set("documentEditorActive", activeRoute === "document-editor");
    return () => contextKeyService.set("documentEditorActive", false);
  }, [activeRoute]);

  return (
    <div
      ref={rootRef}
      className="relative h-full min-h-0 w-full overflow-hidden"
      data-editor-workspace
      style={{ "--editor-split-ratio": `${savedRatio}%` } as CSSProperties}
      onAuxClick={(event) => {
        if (event.button !== 3 && event.button !== 4) return;
        event.preventDefault();
        useTabStore.getState().navigateHistory(event.button === 3 ? -1 : 1);
      }}
    >
      {groups.map((group) => {
        const bounds = paneBounds(group, direction);
        const hasTab = tabs.some((tab) => tabGroup(tab) === group);
        return (
          <section
            key={group}
            aria-label={t(
              group === EDITOR_GROUP.PRIMARY ? "workbench.primary" : "workbench.secondary"
            )}
            className={cn(
              "absolute flex min-h-0 flex-col bg-background",
              groups.length > 1 && activeGroupId === group && "ring-1 ring-inset ring-primary/30"
            )}
            style={bounds}
            onPointerDownCapture={() => useTabStore.getState().setActiveGroup(group)}
            onFocusCapture={() => useTabStore.getState().setActiveGroup(group)}
          >
            <div className="h-9 shrink-0 border-b border-border/70">
              <TabBar groupId={group} alwaysVisible />
            </div>
            {!hasTab && (
              <div className="min-h-0 flex-1">
                {tabs.length === 0 && !direction ? (
                  <Suspense fallback={<TabSkeleton />}>
                    <WelcomeScreen />
                  </Suspense>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                    <p>{t("workbench.emptyGroup")}</p>
                    <p className="max-w-72 text-xs">{t("workbench.emptyHint")}</p>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
      {/* Stable siblings preserve live editor instances when a tab moves between groups. */}
      {tabs.map((tab) => {
        const group = tabGroup(tab);
        const visible = groups.includes(group) && groupActiveIds[group] === tab.id;
        const bounds = paneBounds(group, direction);
        return (
          <div
            key={tab.id}
            data-editor-tab={tab.id}
            data-editor-group={group}
            aria-hidden={!visible}
            inert={!visible}
            className="absolute overflow-hidden"
            style={{
              ...bounds,
              top: `calc(${bounds.top === 0 ? "0px" : bounds.top} + 36px)`,
              height: `calc(${bounds.height} - 36px)`,
              // Keep editor/undo state alive, but remove hidden DOM from layout and painting.
              display: visible ? undefined : "none",
              zIndex: visible ? 1 : 0,
            }}
            onPointerDownCapture={() => {
              if (visible && activeTabId !== tab.id) useTabStore.getState().setActiveTab(tab.id);
            }}
            onFocusCapture={() => {
              if (visible && activeTabId !== tab.id) useTabStore.getState().setActiveTab(tab.id);
            }}
          >
            <TabRenderer
              tabId={tab.id}
              routeId={tab.routeId}
              instanceId={tab.instanceId}
              isActive={activeTabId === tab.id}
              isVisible={visible}
            />
          </div>
        );
      })}
      {direction && (
        <div
          role="separator"
          tabIndex={0}
          aria-label={t("workbench.resize")}
          aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
          aria-valuemin={20}
          aria-valuemax={80}
          aria-valuenow={Math.round(savedRatio)}
          className={cn(
            "absolute z-20 touch-none bg-border/60 hover:bg-primary/50 focus:bg-primary/50 focus:outline-none",
            direction === "horizontal"
              ? "inset-y-0 w-1.5 cursor-col-resize"
              : "inset-x-0 h-1.5 cursor-row-resize"
          )}
          style={
            direction === "horizontal"
              ? { left: "calc(var(--editor-split-ratio) - 3px)" }
              : { top: "calc(var(--editor-split-ratio) - 3px)" }
          }
          onPointerDown={(event) => {
            const element = rootRef.current;
            if (!element) return;
            const rect = element.getBoundingClientRect();
            const extent = direction === "horizontal" ? rect.width : rect.height;
            if (extent <= 0) return;
            resize.start(event, {
              element,
              property: "--editor-split-ratio",
              initial: savedRatio,
              measure: (pointer) => {
                const position =
                  direction === "horizontal"
                    ? pointer.clientX - rect.left
                    : pointer.clientY - rect.top;
                return Math.max(20, Math.min(80, (position / extent) * 100));
              },
              format: (value) => `${value}%`,
              onCommit: (value) => useTabStore.getState().setSplitRatio(value),
            });
          }}
          onPointerMove={resize.onPointerMove}
          onPointerUp={resize.onPointerUp}
          onPointerCancel={resize.onPointerCancel}
          onLostPointerCapture={resize.onLostPointerCapture}
          onDoubleClick={() => useTabStore.getState().setSplitRatio(50)}
          onKeyDown={(event) => {
            const decrease = direction === "horizontal" ? "ArrowLeft" : "ArrowUp";
            const increase = direction === "horizontal" ? "ArrowRight" : "ArrowDown";
            if (![decrease, increase, "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            useTabStore
              .getState()
              .setSplitRatio(
                event.key === "Home"
                  ? 20
                  : event.key === "End"
                    ? 80
                    : savedRatio + (event.key === decrease ? -5 : 5)
              );
          }}
        />
      )}
    </div>
  );
}
