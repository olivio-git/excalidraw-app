import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createTauriStorage } from "@/core/storage/tauri-storage";
import type { ExplorerStore, SortOrder } from "@/core/shell/panels/explorer-types";

export const useExplorerStore = create<ExplorerStore>()(
  persist(
    (set) => ({
      sortOrder: "type-first" as SortOrder,
      showDotfiles: false,
      setSortOrder: (order) => set({ sortOrder: order }),
      setShowDotfiles: (show) => set({ showDotfiles: show }),
    }),
    {
      name: "explorer-storage",
      storage: createJSONStorage(() => createTauriStorage("explorer-storage.json")),
    }
  )
);
