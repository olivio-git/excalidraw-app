import { useEffect, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Blocks } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { LOCATION_LABELS, viewRegistry, viewTitle, type ViewLocation } from "./view-registry";
import { locationOf, useLayoutStore } from "./layout-store";
import { resolveDrop, type LayoutDropData } from "./layout-dnd";

const VIEW_PREFIX = "view:";

/** Pointer first (drop where the cursor is), rectangles for the keyboard. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length === 0) return rectIntersection(args);
  // Prefer a view tab over the part it sits in.
  const tab = hits.find((hit) => String(hit.id).startsWith(VIEW_PREFIX));
  return tab ? [tab] : hits;
};

/**
 * Drag and drop of views between the workbench locations. Wraps the side
 * bars, editor area and panel; nested contexts (editor tabs, file tree) keep
 * working on their own.
 */
export function WorkbenchDnd({ children }: { children: ReactNode }) {
  const dragging = useLayoutStore((s) => s.dragging);
  const setDragging = useLayoutStore((s) => s.setDragging);
  const moveView = useLayoutStore((s) => s.moveView);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Iframes (webviews) swallow pointer events while dragging over them.
  useEffect(() => {
    document.body.classList.toggle("qori-dragging-view", dragging !== null);
  }, [dragging]);

  const onDragStart = ({ active }: DragStartEvent) => {
    const id = String(active.id);
    if (id.startsWith(VIEW_PREFIX)) setDragging(id.slice(VIEW_PREFIX.length));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const id = String(active.id);
    if (!id.startsWith(VIEW_PREFIX)) return;
    const viewId = id.slice(VIEW_PREFIX.length);
    const drop = resolveDrop(viewId, over?.data.current as LayoutDropData | undefined);
    if (drop) moveView(viewId, drop.location, drop.index);
  };

  const view = dragging ? viewRegistry.get(dragging) : undefined;
  const Icon = view?.icon ?? Blocks;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {view && (
          <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lg">
            <Icon className="size-3.5" />
            {viewTitle(view)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Drop target shown while dragging, for a location that is hidden (closed
 * secondary side bar or panel, collapsed primary side bar).
 */
export function EdgeDropZone({
  location,
  edge,
}: {
  location: ViewLocation;
  edge: "left" | "right" | "bottom";
}) {
  const dragging = useLayoutStore((s) => s.dragging);
  const { setNodeRef, isOver } = useDroppable({
    id: `edge:${location}`,
    data: { location } satisfies LayoutDropData,
    disabled: dragging === null,
  });
  if (dragging === null) return null;
  // Dropping a view back where it is does nothing; don't offer it.
  if (locationOf(dragging, useLayoutStore.getState()) === location) return null;
  return (
    <div
      ref={setNodeRef}
      data-edge-drop={location}
      className={cn(
        "absolute z-30 flex items-center justify-center border-2 border-dashed text-[11px] font-medium transition-colors",
        edge === "left" && "inset-y-0 left-0 w-16",
        edge === "right" && "inset-y-0 right-0 w-16",
        edge === "bottom" && "inset-x-0 bottom-0 h-14",
        isOver
          ? "border-primary bg-primary/20 text-foreground"
          : "border-primary/40 bg-background/70 text-muted-foreground"
      )}
    >
      <span className={cn(edge !== "bottom" && "[writing-mode:vertical-rl]")}>
        {LOCATION_LABELS[location]}
      </span>
    </div>
  );
}
