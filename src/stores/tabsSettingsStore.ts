import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriTabsSettingsStorage } from "@/core/storage/tauri-storage";

interface TabsSettings {
  allowCloseLastTab: boolean;
  /** Single-click in the explorer opens files in a reusable preview tab. */
  enablePreview: boolean;
}

interface TabsSettingsState extends TabsSettings {
  setAllowCloseLastTab: (value: boolean) => void;
  setEnablePreview: (value: boolean) => void;
  resetToDefaults: () => void;
}

const DEFAULTS: TabsSettings = {
  allowCloseLastTab: false,
  enablePreview: true,
};

export const useTabsSettingsStore = create<TabsSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setAllowCloseLastTab: (value) => set({ allowCloseLastTab: value }),
      setEnablePreview: (value) => set({ enablePreview: value }),

      resetToDefaults: () => set(DEFAULTS),
    }),
    {
      name: "tabs-settings-storage",
      storage: createJSONStorage(() => tauriTabsSettingsStorage),
      partialize: (state) => ({
        allowCloseLastTab: state.allowCloseLastTab,
        enablePreview: state.enablePreview,
      }),
    }
  )
);
