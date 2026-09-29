import { create } from "zustand";
import type { TemplateKind } from "./templates";

interface GalleryState {
  open: boolean;
  kind: TemplateKind | "all";
  /** Folder new files go to (workspace root when unset). */
  folder: string | null;
  show: (options?: { kind?: TemplateKind; folder?: string | null }) => void;
  hide: () => void;
}

export const useTemplateGallery = create<GalleryState>()((set) => ({
  open: false,
  kind: "all",
  folder: null,
  show: (options = {}) =>
    set({ open: true, kind: options.kind ?? "all", folder: options.folder ?? null }),
  hide: () => set({ open: false }),
}));
