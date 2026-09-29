import { useWorkbenchViews, type ViewLocation } from "./view-registry";
import { activeViewIn, useLayoutStore, viewsIn } from "./layout-store";

export const viewDragId = (id: string) => `view:${id}`;
export const partDropId = (location: ViewLocation) => `part:${location}`;

/** Data attached to draggables and droppables (read by WorkbenchDnd). */
export interface LayoutDropData {
  location: ViewLocation;
  viewId?: string;
}

/** Views of a location, in order, re-rendered when views or the layout change. */
export function useLocationViews(location: ViewLocation) {
  const views = useWorkbenchViews();
  const parts = useLayoutStore((s) => s.parts);
  const placements = useLayoutStore((s) => s.placements);
  const state = { parts, placements };
  return {
    views: viewsIn(location, state, views),
    active: activeViewIn(location, state, views),
    open: parts[location].open,
  };
}

/** Where a drop lands: the location and the index among its views. */
export function resolveDrop(
  viewId: string,
  over: LayoutDropData | undefined
): { location: ViewLocation; index?: number } | null {
  if (!over) return null;
  const state = useLayoutStore.getState();
  if (!over.viewId) return { location: over.location };
  if (over.viewId === viewId) return null;
  const ids = viewsIn(over.location, state).map((view) => view.id);
  // Same location: arrayMove semantics (take the hovered view's slot).
  return { location: over.location, index: ids.indexOf(over.viewId) };
}
