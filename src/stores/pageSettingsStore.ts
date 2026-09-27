import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createTauriStorage } from "@/core/storage/tauri-storage";

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_SIZES = {
  a4: { width: 210, height: 297, label: "A4" },
  letter: { width: 216, height: 279, label: "Letter" },
  legal: { width: 216, height: 356, label: "Legal" },
  a3: { width: 297, height: 420, label: "A3" },
  a5: { width: 148, height: 210, label: "A5" },
  b5: { width: 176, height: 250, label: "B5" },
} as const;

type PageSizeKey = (typeof PAGE_SIZES)[keyof typeof PAGE_SIZES]["label"];
type PageSizeKeyRaw = keyof typeof PAGE_SIZES;

const ORIENTATION = {
  portrait: "portrait",
  landscape: "landscape",
} as const;

type Orientation = (typeof ORIENTATION)[keyof typeof ORIENTATION];

// ─── Internal helpers ────────────────────────────────────────────────────────

const getPageSize = (size: PageSizeKeyRaw) => PAGE_SIZES[size];

/** Returns page dimensions in px (96 DPI) for the given size and orientation. */
function getPageDimensionsPx(
  size: PageSizeKeyRaw,
  orientation: Orientation
): { width: number; height: number } {
  const { width: mmW, height: mmH } = getPageSize(size);
  const mmToPx = 96 / 25.4; // 1 mm = 3.7795 px at 96 DPI
  const w = Math.round((orientation === "portrait" ? mmW : mmH) * mmToPx);
  const h = Math.round((orientation === "portrait" ? mmH : mmW) * mmToPx);
  return { width: w, height: h };
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface PageSettingsState {
  pageSize: PageSizeKeyRaw;
  orientation: Orientation;
  /** Margin in px (applied to all 4 sides; 0 = use BlockNote default padding) */
  margin: number;
  /** Zoom level as a multiplier (1 = 100%). Range: 0.25–2.0 */
  zoom: number;

  setPageSize: (size: PageSizeKeyRaw) => void;
  setOrientation: (orientation: Orientation) => void;
  setMargin: (margin: number) => void;
  setZoom: (zoom: number) => void;
  resetDefaults: () => void;

  /** Computed page width in px (accounts for orientation) */
  getPageWidthPx: () => number;
  /** Computed page height in px (accounts for orientation) */
  getPageHeightPx: () => number;
  /** Computed content width (page width minus margins) */
  getContentWidthPx: () => number;
}

const DEFAULTS = {
  pageSize: "a4" as PageSizeKeyRaw,
  orientation: "portrait" as Orientation,
  margin: 96, // ~1 inch
  zoom: 1,
};

export const usePageSettingsStore = create<PageSettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,

      setPageSize: (pageSize) => set({ pageSize }),
      setOrientation: (orientation) => set({ orientation }),
      setMargin: (margin) => set({ margin }),
      setZoom: (zoom) => set({ zoom: Math.min(2, Math.max(0.25, zoom)) }),
      resetDefaults: () => set(DEFAULTS),

      getPageWidthPx: () => {
        const { pageSize, orientation } = get();
        return getPageDimensionsPx(pageSize, orientation).width;
      },

      getPageHeightPx: () => {
        const { pageSize, orientation } = get();
        return getPageDimensionsPx(pageSize, orientation).height;
      },

      getContentWidthPx: () => {
        const { pageSize, orientation, margin } = get();
        return getPageDimensionsPx(pageSize, orientation).width - margin * 2;
      },
    }),
    {
      name: "page-settings-storage",
      storage: createJSONStorage(() => createTauriStorage("page-settings-storage.json")),
    }
  )
);

// Re-export constants for use in UI components
export { PAGE_SIZES, ORIENTATION };
export type { PageSizeKeyRaw, PageSizeKey, Orientation };
