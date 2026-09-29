import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createTauriStorage } from "@/core/storage/tauri-storage";
import { viewRegistry, type ViewLocation, type WorkbenchView } from "./view-registry";

export const PANEL_MIN_SIZE = 120;
export const PANEL_DEFAULT_HEIGHT = 260;
export const PANEL_DEFAULT_WIDTH = 420;
export const SECONDARY_MIN_WIDTH = 180;
export const SECONDARY_MAX_WIDTH = 720;
export const SECONDARY_DEFAULT_WIDTH = 300;

export interface PartState {
  /** User order of the views placed here (views not listed go last). */
  order: string[];
  active: string | null;
  open: boolean;
  /** Bumped when something asks to reveal the part (opens a collapsed side bar). */
  reveal: number;
}

export type SidebarSide = "left" | "right";
export type PanelPosition = "bottom" | "right";

interface LayoutData {
  parts: Record<ViewLocation, PartState>;
  /** Views the user moved out of their default location. */
  placements: Record<string, ViewLocation>;
  /** Side of the primary side bar; the secondary one takes the other side. */
  sidebarSide: SidebarSide;
  panelPosition: PanelPosition;
  secondaryWidth: number;
  panelHeight: number;
  panelWidth: number;
}

interface LayoutState extends LayoutData {
  /** View being dragged (not persisted). */
  dragging: string | null;
  showView: (id: string) => void;
  /** Close the view's location if the view is what it shows. */
  hideView: (id: string) => void;
  setActive: (location: ViewLocation, id: string) => void;
  setPartOpen: (location: ViewLocation, open: boolean) => void;
  togglePart: (location: ViewLocation) => void;
  /** Move a view to a location, at `index` among that location's views (end by default). */
  moveView: (id: string, location: ViewLocation, index?: number) => void;
  setSidebarSide: (side: SidebarSide) => void;
  setPanelPosition: (position: PanelPosition) => void;
  setSecondaryWidth: (width: number) => void;
  setPanelSize: (size: number) => void;
  setDragging: (id: string | null) => void;
  resetLayout: () => void;
}

const emptyPart = (open: boolean): PartState => ({ order: [], active: null, open, reveal: 0 });

const DEFAULT_LAYOUT: LayoutData = {
  parts: { primary: emptyPart(true), secondary: emptyPart(false), panel: emptyPart(false) },
  placements: {},
  sidebarSide: "left",
  panelPosition: "bottom",
  secondaryWidth: SECONDARY_DEFAULT_WIDTH,
  panelHeight: PANEL_DEFAULT_HEIGHT,
  panelWidth: PANEL_DEFAULT_WIDTH,
};

/** A fresh default layout (tests, reset). */
export function defaultLayout(): LayoutData {
  return structuredClone(DEFAULT_LAYOUT);
}

type Placement = Pick<LayoutData, "placements">;
type Ordering = Pick<LayoutData, "parts" | "placements">;

export function locationOf(
  id: string,
  state: Placement,
  views: WorkbenchView[] = viewRegistry.getAll()
): ViewLocation {
  return state.placements[id] ?? views.find((view) => view.id === id)?.defaultLocation ?? "primary";
}

/** Views shown in a location, in the user's order. */
export function viewsIn(
  location: ViewLocation,
  state: Ordering,
  views: WorkbenchView[] = viewRegistry.getAll()
): WorkbenchView[] {
  const order = state.parts[location].order;
  const rank = (view: WorkbenchView) => {
    const index = order.indexOf(view.id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return views
    .filter((view) => locationOf(view.id, state, views) === location)
    .map((view, index) => ({ view, index }))
    .sort((a, b) => rank(a.view) - rank(b.view) || a.index - b.index)
    .map(({ view }) => view);
}

/** The view a location shows: its active one if still there, else the first. */
export function activeViewIn(
  location: ViewLocation,
  state: Ordering,
  views: WorkbenchView[] = viewRegistry.getAll()
): WorkbenchView | undefined {
  const here = viewsIn(location, state, views);
  return here.find((view) => view.id === state.parts[location].active) ?? here[0];
}

export function isViewVisible(id: string, state: Ordering = useLayoutStore.getState()): boolean {
  const location = locationOf(id, state);
  return state.parts[location].open && activeViewIn(location, state)?.id === id;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(Math.round(value), min), max);

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => {
      const updatePart = (location: ViewLocation, patch: Partial<PartState>) =>
        set((state) => ({
          parts: { ...state.parts, [location]: { ...state.parts[location], ...patch } },
        }));

      return {
        ...DEFAULT_LAYOUT,
        dragging: null,

        showView: (id) => {
          const location = locationOf(id, get());
          const part = get().parts[location];
          updatePart(location, { active: id, open: true, reveal: part.reveal + 1 });
        },

        hideView: (id) => {
          const state = get();
          const location = locationOf(id, state);
          if (activeViewIn(location, state)?.id === id) updatePart(location, { open: false });
        },

        setActive: (location, id) => updatePart(location, { active: id }),

        setPartOpen: (location, open) => {
          const part = get().parts[location];
          updatePart(location, open ? { open, reveal: part.reveal + 1 } : { open });
        },

        togglePart: (location) => get().setPartOpen(location, !get().parts[location].open),

        moveView: (id, target, index) => {
          const state = get();
          const views = viewRegistry.getAll();
          if (!views.some((view) => view.id === id)) return;
          const source = locationOf(id, state, views);
          const targetIds = viewsIn(target, state, views)
            .map((view) => view.id)
            .filter((viewId) => viewId !== id);
          const at = index === undefined ? targetIds.length : clamp(index, 0, targetIds.length);
          targetIds.splice(at, 0, id);

          const parts = { ...state.parts };
          parts[target] = {
            ...parts[target],
            order: targetIds,
            active: id,
            open: true,
            reveal: parts[target].reveal + 1,
          };
          if (source !== target) {
            const remaining = viewsIn(source, state, views)
              .map((view) => view.id)
              .filter((viewId) => viewId !== id);
            const part = parts[source];
            parts[source] = {
              ...part,
              order: remaining,
              active: part.active === id ? (remaining[0] ?? null) : part.active,
              // An emptied side bar or panel closes; the primary side bar stays.
              open: remaining.length > 0 || source === "primary" ? part.open : false,
            };
          }
          set({ parts, placements: { ...state.placements, [id]: target } });
        },

        setSidebarSide: (sidebarSide) => set({ sidebarSide }),
        setPanelPosition: (panelPosition) => set({ panelPosition }),
        setSecondaryWidth: (width) =>
          set({ secondaryWidth: clamp(width, SECONDARY_MIN_WIDTH, SECONDARY_MAX_WIDTH) }),
        setPanelSize: (size) =>
          set((state) =>
            state.panelPosition === "bottom"
              ? { panelHeight: Math.max(PANEL_MIN_SIZE, Math.round(size)) }
              : { panelWidth: Math.max(PANEL_MIN_SIZE, Math.round(size)) }
          ),
        setDragging: (dragging) => set({ dragging }),

        resetLayout: () =>
          set((state) => ({
            ...DEFAULT_LAYOUT,
            parts: {
              primary: {
                ...emptyPart(state.parts.primary.open),
                reveal: state.parts.primary.reveal,
              },
              secondary: emptyPart(false),
              panel: { ...emptyPart(state.parts.panel.open) },
            },
          })),
      };
    },
    {
      name: "layout-storage",
      storage: createJSONStorage(() => createTauriStorage("layout-storage.json")),
      partialize: (state): LayoutData => ({
        parts: {
          // The primary side bar's visibility belongs to the sidebar provider.
          primary: { ...state.parts.primary, open: true, reveal: 0 },
          secondary: { ...state.parts.secondary, reveal: 0 },
          // Like VS Code, the panel starts closed.
          panel: { ...state.parts.panel, open: false, reveal: 0 },
        },
        placements: state.placements,
        sidebarSide: state.sidebarSide,
        panelPosition: state.panelPosition,
        secondaryWidth: state.secondaryWidth,
        panelHeight: state.panelHeight,
        panelWidth: state.panelWidth,
      }),
      merge: (persisted, current) => {
        const data = (persisted ?? {}) as Partial<LayoutData>;
        return {
          ...current,
          ...data,
          parts: {
            primary: { ...current.parts.primary, ...data.parts?.primary },
            secondary: { ...current.parts.secondary, ...data.parts?.secondary },
            panel: { ...current.parts.panel, ...data.parts?.panel },
          },
        };
      },
    }
  )
);
