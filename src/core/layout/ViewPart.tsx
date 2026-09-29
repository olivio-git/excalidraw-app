import { Suspense, useState, type ReactNode } from "react";
import { useDndContext, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Blocks } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { buttonVariants } from "@/shared/components/ui/button";
import { ErrorBoundary } from "@/shared/components/error/ErrorBoundary";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import {
  LOCATION_LABELS,
  VIEW_LOCATIONS,
  viewTitle,
  type ViewLocation,
  type WorkbenchView,
} from "./view-registry";
import { useLayoutStore } from "./layout-store";
import { partDropId, useLocationViews, viewDragId, type LayoutDropData } from "./layout-dnd";

/** A crashing view shows this instead of taking the workbench down. */
function ViewError({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 p-4 text-xs">
      <p className="font-medium text-destructive">Esta vista falló al mostrarse.</p>
      <p className="break-words text-muted-foreground">{error.message}</p>
      <button
        type="button"
        onClick={resetErrorBoundary}
        className="rounded border border-border px-2 py-1 hover:bg-accent"
      >
        Reintentar
      </button>
    </div>
  );
}

function ViewTabMenu({ view, location }: { view: WorkbenchView; location: ViewLocation }) {
  const moveView = useLayoutStore((s) => s.moveView);
  const resetLayout = useLayoutStore((s) => s.resetLayout);
  return (
    <ContextMenuContent className="w-60">
      {VIEW_LOCATIONS.filter((target) => target !== location).map((target) => (
        <ContextMenuItem key={target} onClick={() => moveView(view.id, target)}>
          Mover a {LOCATION_LABELS[target].toLowerCase()}
        </ContextMenuItem>
      ))}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={resetLayout}>Restablecer diseño</ContextMenuItem>
    </ContextMenuContent>
  );
}

function ViewTab({
  view,
  location,
  variant,
  active,
  onSelect,
}: {
  view: WorkbenchView;
  location: ViewLocation;
  variant: "sidebar" | "panel";
  active: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: viewDragId(view.id),
    data: { location, viewId: view.id } satisfies LayoutDropData,
  });
  const title = viewTitle(view);
  const Icon = view.icon ?? Blocks;
  const style = { transform: CSS.Translate.toString(transform), transition };

  const button =
    variant === "sidebar" ? (
      <button
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={title}
        data-view-tab={view.id}
        onClick={onSelect}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "touch-none",
          active ? "bg-muted text-foreground" : "text-muted-foreground",
          isDragging && "opacity-40"
        )}
      >
        <Icon className="size-4" />
      </button>
    ) : (
      <button
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        type="button"
        role="tab"
        aria-selected={active}
        data-view-tab={view.id}
        onClick={onSelect}
        className={cn(
          "relative h-8 px-2 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap transition-colors touch-none outline-none focus-visible:text-foreground",
          "after:absolute after:inset-x-2 after:bottom-0 after:h-px after:rounded-full after:transition-colors",
          active
            ? "text-foreground after:bg-foreground"
            : "text-muted-foreground hover:text-foreground after:bg-transparent",
          isDragging && "opacity-40"
        )}
      >
        {title}
      </button>
    );

  return (
    <ContextMenu>
      {variant === "sidebar" ? (
        <TooltipProvider delay={300}>
          <Tooltip>
            <TooltipTrigger render={<ContextMenuTrigger render={button} />} />
            <TooltipContent side={location === "panel" ? "top" : "bottom"}>{title}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <ContextMenuTrigger render={button} />
      )}
      <ViewTabMenu view={view} location={location} />
    </ContextMenu>
  );
}

interface ViewPartProps {
  location: ViewLocation;
  variant: "sidebar" | "panel";
  /** Side bar narrowed to its icons: the content is hidden. */
  compact?: boolean;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
  className?: string;
}

/**
 * A workbench location (side bar or panel): a header with the views placed
 * there, draggable to reorder or to move to another location, and the active
 * view. Views stay mounted once shown so terminals, trees and webviews keep
 * their state while hidden.
 */
export function ViewPart({
  location,
  variant,
  compact = false,
  headerStart,
  headerEnd,
  className,
}: ViewPartProps) {
  const { views, active, open } = useLocationViews(location);
  const setActive = useLayoutStore((s) => s.setActive);
  const dragging = useLayoutStore((s) => s.dragging);
  const { setNodeRef } = useDroppable({
    id: partDropId(location),
    data: { location } satisfies LayoutDropData,
  });
  const { over } = useDndContext();
  const isDropTarget =
    dragging !== null && (over?.data.current as LayoutDropData | undefined)?.location === location;
  const [mounted, setMounted] = useState<string[]>([]);

  const showContent = open && !compact;
  // Mount views on first show and keep them (adjusting state during render).
  if (showContent && active && !mounted.includes(active.id)) {
    setMounted([...mounted, active.id]);
  }
  const Actions = active?.actions;

  return (
    <div
      ref={setNodeRef}
      data-part={location}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col",
        isDropTarget &&
          "after:pointer-events-none after:absolute after:inset-0 after:z-20 after:bg-primary/10 after:ring-2 after:ring-inset after:ring-primary/60",
        className
      )}
    >
      <div
        className={cn(
          "flex shrink-0 gap-0.5 border-b border-border/50",
          variant === "panel"
            ? "h-8 items-center px-2 gap-1"
            : compact
              ? "flex-col items-center p-1.5"
              : "flex-row flex-wrap items-center p-1.5"
        )}
      >
        {headerStart}
        <SortableContext
          items={views.map((view) => viewDragId(view.id))}
          strategy={variant === "panel" ? horizontalListSortingStrategy : rectSortingStrategy}
        >
          <div
            role="tablist"
            aria-label={`Vistas de ${LOCATION_LABELS[location].toLowerCase()}`}
            className={cn(
              "flex min-w-0 gap-0.5",
              variant === "panel"
                ? "items-center overflow-x-auto"
                : compact
                  ? "flex-col"
                  : "flex-wrap"
            )}
          >
            {views.map((view) => (
              <ViewTab
                key={view.id}
                view={view}
                location={location}
                variant={variant}
                active={view.id === active?.id}
                onSelect={() => setActive(location, view.id)}
              />
            ))}
          </div>
        </SortableContext>
        {variant === "panel" && <div className="flex-1" />}
        {variant === "panel" && Actions && <Actions />}
        {headerEnd}
      </div>

      {variant === "sidebar" && showContent && active && Actions && (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/40 px-2">
          <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {viewTitle(active)}
          </span>
          <div className="flex-1" />
          <Actions />
        </div>
      )}

      <div className={cn("relative flex-1 min-h-0", !showContent && "hidden")}>
        {views.length === 0 && (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
            Arrastra aquí una vista desde otra barra o desde el panel.
          </div>
        )}
        {views
          .filter((view) => mounted.includes(view.id))
          .map((view) => {
            const View = view.component;
            const visible = showContent && view.id === active?.id;
            return (
              <div
                key={view.id}
                role="tabpanel"
                data-view={view.id}
                data-view-visible={visible}
                className={cn("absolute inset-0 flex flex-col", !visible && "hidden")}
              >
                <ErrorBoundary fallback={ViewError} name={`view:${view.id}`}>
                  <Suspense fallback={null}>
                    <View />
                  </Suspense>
                </ErrorBoundary>
              </div>
            );
          })}
      </div>
    </div>
  );
}
