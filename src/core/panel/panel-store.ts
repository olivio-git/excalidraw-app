import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createTauriStorage } from "@/core/storage/tauri-storage";

export const PANEL_MIN_HEIGHT = 120;
export const PANEL_DEFAULT_HEIGHT = 260;

interface PanelState {
  open: boolean;
  height: number;
  activeViewId: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setHeight: (height: number) => void;
  /** Open the panel on a view. */
  showView: (viewId: string) => void;
}

export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      open: false,
      height: PANEL_DEFAULT_HEIGHT,
      activeViewId: null,
      setOpen: (open) => set({ open }),
      toggle: () => set((state) => ({ open: !state.open })),
      setHeight: (height) => set({ height: Math.max(PANEL_MIN_HEIGHT, Math.round(height)) }),
      showView: (viewId) => set({ open: true, activeViewId: viewId }),
    }),
    {
      name: "panel-storage",
      storage: createJSONStorage(() => createTauriStorage("panel-storage.json")),
      partialize: (state) => ({ height: state.height, activeViewId: state.activeViewId }),
    }
  )
);
