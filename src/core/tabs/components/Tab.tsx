import { Button } from "@/shared/components/ui/button";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import { cn } from "@/shared/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Pin, X } from "lucide-react";
import React, { useMemo } from "react";
import type { TabInstance } from "../types";
import { RouteRegistry } from "@/core/routing/route-registry";

interface TabProps {
  tab: TabInstance;
  isActive: boolean;
  isLastTab: boolean;
  onTabClick: (tab: TabInstance) => void;
  onCloseTab: (e: React.MouseEvent, tabId: string) => void;
  onCloseOthers: (tabId: string) => void;
  onCloseAll: () => void;
  onCloseToRight: (tabId: string) => void;
  onPin: (tabId: string) => void;
  onUnpin: (tabId: string) => void;
}

const Tab = React.memo(
  ({
    tab,
    isActive,
    isLastTab,
    onTabClick,
    onCloseTab,
    onCloseOthers,
    onCloseAll,
    onCloseToRight,
    onPin,
    onUnpin,
  }: TabProps) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: tab.id,
    });

    // Resolver icono desde RouteRegistry si la tab no lo tiene (p. ej. plugins o rehidratación)
    const Icon = useMemo(
      () => tab.icon ?? RouteRegistry.getRoute(tab.routeId)?.icon,
      [tab.icon, tab.routeId]
    );

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    const handleMiddleClick = (e: React.MouseEvent) => {
      if (e.button === 1 && tab.isClosable && !tab.isPinned) {
        e.preventDefault();
        onCloseTab(e, tab.id);
      }
    };

    return (
      <div ref={setNodeRef} style={style}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <Button
              variant="ghost"
              onClick={() => onTabClick(tab)}
              onMouseDown={handleMiddleClick}
              {...attributes}
              {...listeners}
              className={cn(
                "group relative flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium transition-colors",
                "hover:bg-accent",
                "cursor-grab active:cursor-grabbing",
                isDragging && "shadow-lg ring-2 ring-primary/20",
                tab.isPinned
                  ? "min-w-[40px] max-w-[40px] h-7 justify-center"
                  : "min-w-[120px] max-w-[200px] h-7",
                isActive ? "bg-accent text-primary" : "text-foreground hover:text-primary"
              )}
            >
              {tab.isPinned ? (
                <TooltipWrapper tooltip={tab.title} side="bottom">
                  <span className="flex items-center justify-center">
                    {Icon ? (
                      <Icon className="size-3 flex-shrink-0" />
                    ) : (
                      <Pin className="size-3 flex-shrink-0 rotate-45" />
                    )}
                  </span>
                </TooltipWrapper>
              ) : (
                <>
                  {Icon && <Icon className="size-3 flex-shrink-0" />}
                  <span className="truncate flex-1 text-left" title={tab.title}>
                    {tab.title || tab.path.split("/").pop() || "Untitled"}
                  </span>
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full bg-foreground transition-opacity",
                      tab.metadata?.isDirty ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {tab.isClosable && !isLastTab && (
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onCloseTab(e, tab.id);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className={cn(
                        "flex-shrink-0 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-border p-0.5 transition-opacity cursor-pointer",
                        isActive && "opacity-100"
                      )}
                      aria-label="Close tab"
                    >
                      <X className="size-3" />
                    </span>
                  )}
                </>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent className="border-none">
            {tab.isPinned ? (
              <ContextMenuItem onClick={() => onUnpin(tab.id)}>Unpin tab</ContextMenuItem>
            ) : (
              <ContextMenuItem onClick={() => onPin(tab.id)}>Pin tab</ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onCloseOthers(tab.id)}>
              Close other tabs
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onCloseToRight(tab.id)}>
              Close tabs to the right
            </ContextMenuItem>
            {!isLastTab && (
              <ContextMenuItem onClick={() => onCloseAll()}>Close all tabs</ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
      </div>
    );
  }
);

Tab.displayName = "Tab";

export default Tab;
