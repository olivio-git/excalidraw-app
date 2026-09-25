import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Check, X } from "lucide-react";
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
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { useTabsSettingsStore } from "@/stores/tabsSettingsStore";
import { useHomeDir } from "@/shared/hooks/useHomeDir";
import { cn } from "@/shared/lib/utils";
import { useTabStore } from "../store/tab-store";
import { tabGroup } from "../store/editor-layout";
import { EDITOR_GROUP, type EditorGroupId } from "../types";
import { requestCloseTab, requestCloseTabs } from "../tab-lifecycle";
import Tab from "./Tab";

interface TabBarProps {
  className?: string;
  alwaysVisible?: boolean;
  groupId?: EditorGroupId;
}

export default function TabBar({
  className,
  alwaysVisible = false,
  groupId = EDITOR_GROUP.PRIMARY,
}: TabBarProps) {
  const { t } = useTranslation("tabs");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const allTabs = useTabStore((state) => state.tabs);
  const activeId = useTabStore((state) => state.groupActiveTabIds[groupId]);
  const splitDirection = useTabStore((state) => state.splitDirection);
  const allowCloseLastTab = useTabsSettingsStore((state) => state.allowCloseLastTab);
  const homeDir = useHomeDir();
  const tabs = allTabs.filter((tab) => tabGroup(tab) === groupId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = allTabs.findIndex((tab) => tab.id === active.id);
    const to = allTabs.findIndex((tab) => tab.id === over.id);
    if (from >= 0 && to >= 0) useTabStore.getState().reorderTabs(from, to);
  };
  if (!tabs.length)
    return alwaysVisible ? (
      <div className="flex h-full items-center gap-2 px-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{t("workbench.emptyGroup")}</span>
        {splitDirection && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={t("workbench.closeEmptyGroup")}
            title={t("workbench.closeEmptyGroup")}
            onClick={() => useTabStore.getState().closeEmptyGroup(groupId)}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    ) : null;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
    >
      <div className={cn("flex h-full min-w-0 items-center bg-background", className)}>
        <div
          role="tablist"
          aria-label={t("workbench.openTabs")}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 py-0.5"
        >
          <SortableContext
            items={tabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((tab) => (
              <Tab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeId}
                isLastTab={allTabs.length === 1 && !allowCloseLastTab}
                homeDir={homeDir}
                onTabClick={(item) => useTabStore.getState().setActiveTab(item.id)}
                onCloseTab={(event, id) => {
                  event.stopPropagation();
                  void requestCloseTab(id);
                }}
                onCloseOthers={(id) => {
                  void requestCloseTabs(
                    tabs.filter((item) => item.id !== id).map((item) => item.id)
                  );
                }}
                onCloseAll={() => {
                  void requestCloseTabs(
                    tabs
                      .filter(
                        (item) =>
                          allowCloseLastTab || allTabs.length > tabs.length || item.id !== activeId
                      )
                      .map((item) => item.id)
                  );
                }}
                onCloseToRight={(id) => {
                  void requestCloseTabs(
                    tabs.slice(tabs.findIndex((item) => item.id === id) + 1).map((item) => item.id)
                  );
                }}
                onPin={(id) => useTabStore.getState().pinTab(id)}
                onUnpin={(id) => useTabStore.getState().unpinTab(id)}
              />
            ))}
          </SortableContext>
        </div>
        <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={t("workbench.openTabs")}
            >
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 min-w-48 overflow-y-auto">
            {tabs.map((tab) => (
              <DropdownMenuItem
                key={tab.id}
                onClick={() => useTabStore.getState().setActiveTab(tab.id)}
              >
                <span className="flex-1 truncate">{tab.title}</span>
                {tab.id === activeId && <Check className="size-3" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </DndContext>
  );
}
