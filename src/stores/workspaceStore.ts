import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createTauriStorage } from "@/core/storage/tauri-storage";

interface WorkspaceStore {
  workspaceDir: string | null;
  setWorkspaceDir: (dir: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      workspaceDir: null,
      setWorkspaceDir: (dir) => set({ workspaceDir: dir }),
    }),
    {
      name: "workspace-storage",
      storage: createJSONStorage(() => createTauriStorage("workspace-storage.json")),
    }
  )
);
