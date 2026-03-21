import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { ScrollArea, ScrollBar } from "@/shared/components/ui/scroll-area";
import { cn } from "@/shared/lib/utils";
import { useTabStore } from "../store/tab-store";
import type { TabInstance } from "../types";
import { RouteRegistry } from "@/core/routing/route-registry";
import { useTabsSettingsStore } from "@/stores/tabsSettingsStore";
import { useHomeDir } from "@/shared/hooks/useHomeDir";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import * as Tabs from "@radix-ui/react-tabs";
import { ChevronDown, Check, Plus } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import Tab from "./Tab";

interface TabBarProps {
  className?: string;
  alwaysVisible?: boolean;
}

// No hay tabs abiertas
const EmptyTabBar = React.memo(({ onNewTab }: { onNewTab: () => void }) => (
  <div data-tauri-drag-region className="flex items-center h-8 px-2 gap-2">
    <span className="text-xs text-muted-foreground">No tabs open</span>
    {/* <Button
      variant="ghost"
      size="sm"
      onClick={onNewTab}
      className="h-6 px-2 text-xs hover:bg-accent"
    >
      <Plus className="size-3 mr-1" />
      New tab
    </Button> */}
  </div>
));
EmptyTabBar.displayName = "EmptyTabBar";

const TabBar: React.FC<TabBarProps> = ({ className, alwaysVisible = false }) => {
  const navigate = useNavigate();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const allowCloseLastTab = useTabsSettingsStore((s) => s.allowCloseLastTab);
  const homeDir = useHomeDir();
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const removeTab = useTabStore((s) => s.removeTab);
  const reorderTabs = useTabStore((s) => s.reorderTabs);
  const closeOtherTabs = useTabStore((s) => s.closeOtherTabs);
  const closeAllTabs = useTabStore((s) => s.closeAllTabs);
  const closeTabsToRight = useTabStore((s) => s.closeTabsToRight);
  const pinTab = useTabStore((s) => s.pinTab);
  const unpinTab = useTabStore((s) => s.unpinTab);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = tabs.findIndex((tab) => tab.id === active.id);
        const newIndex = tabs.findIndex((tab) => tab.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          reorderTabs(oldIndex, newIndex);
        }
      }
    },
    [tabs, reorderTabs]
  );

  const handleTabClick = useCallback(
    (tab: TabInstance) => {
      setActiveTab(tab.id);
      const url = tab.instanceId
        ? `${tab.path}?file=${encodeURIComponent(tab.instanceId)}`
        : tab.path;
      navigate(url);
    },
    [setActiveTab, navigate]
  );

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      const state = useTabStore.getState();
      const wasActive = state.activeTabId === tabId;
      removeTab(tabId);

      if (wasActive) {
        const newState = useTabStore.getState();
        if (newState.activeTabId) {
          const activeTab = newState.tabs.find((t) => t.id === newState.activeTabId);
          if (activeTab) {
            const url = activeTab.instanceId
              ? `${activeTab.path}?file=${encodeURIComponent(activeTab.instanceId)}`
              : activeTab.path;
            navigate(url);
          }
        } else {
          navigate("/");
        }
      }
    },
    [removeTab, navigate]
  );

  const handleCloseAll = useCallback(() => {
    closeAllTabs();
  }, [closeAllTabs]);

  const handleNewTab = useCallback(() => {
    navigate("/");
  }, [navigate]);

  if (tabs.length === 0 && !alwaysVisible) return null;
  if (tabs.length === 0) return <EmptyTabBar onNewTab={handleNewTab} />;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
    >
      <Tabs.Root
        value={activeTabId || undefined}
        onValueChange={setActiveTab}
        className={cn("flex items-center bg-background w-full h-full", className)}
      >
        <div className="flex-1 overflow-hidden min-w-0">
          <ScrollArea className="w-max max-w-full">
            <SortableContext
              items={tabs.map((tab) => tab.id)}
              strategy={horizontalListSortingStrategy}
            >
              <Tabs.List
                data-tauri-drag-region
                className="flex items-center gap-1 px-2 py-1 min-h-full"
              >
                {tabs.map((tab) => (
                  <Tabs.Trigger key={tab.id} value={tab.id} asChild>
                    <Tab
                      tab={tab}
                      isActive={tab.id === activeTabId}
                      isLastTab={tabs.length === 1 && !allowCloseLastTab}
                      homeDir={homeDir}
                      onTabClick={handleTabClick}
                      onCloseTab={handleCloseTab}
                      onCloseOthers={closeOtherTabs}
                      onCloseAll={handleCloseAll}
                      onCloseToRight={closeTabsToRight}
                      onPin={pinTab}
                      onUnpin={unpinTab}
                    />
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </SortableContext>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>

        <div className="flex-shrink-0 border-l border-border px-2">
          <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="size-7 p-0 hover:bg-accent">
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-h-96 overflow-y-auto">
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                Open tabs ({tabs.length})
              </div>
              <DropdownMenuSeparator />
              {tabs.map((tab) => {
                const TabIcon = tab.icon ?? RouteRegistry.getRoute(tab.routeId)?.icon;
                return (
                  <DropdownMenuItem
                    key={tab.id}
                    onClick={() => handleTabClick(tab)}
                    className={cn(
                      "flex items-center gap-2 cursor-pointer",
                      "hover:bg-accent focus:bg-accent",
                      tab.id === activeTabId &&
                        "bg-primary/10 text-primary hover:bg-primary/15 focus:bg-primary/20"
                    )}
                  >
                    {TabIcon && <TabIcon className="size-3 flex-shrink-0" />}
                    <span className="flex-1 truncate text-xs">
                      {tab.title || tab.path.split("/").pop() || "Untitled"}
                    </span>
                    {tab.id === activeTabId && (
                      <Check className="size-3 text-primary flex-shrink-0" />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Tabs.Root>
    </DndContext>
  );
};

export default React.memo(TabBar);
