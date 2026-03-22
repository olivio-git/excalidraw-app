import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriTabsSettingsStorage } from "@/core/storage/tauri-storage";

interface TabsSettings {
  allowCloseLastTab: boolean;
}

interface TabsSettingsState extends TabsSettings {
  setAllowCloseLastTab: (value: boolean) => void;
  resetToDefaults: () => void;
}

const DEFAULTS: TabsSettings = {
  allowCloseLastTab: false,
};

export const useTabsSettingsStore = create<TabsSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setAllowCloseLastTab: (value) => set({ allowCloseLastTab: value }),

      resetToDefaults: () => set(DEFAULTS),
    }),
    {
      name: "tabs-settings-storage",
      storage: createJSONStorage(() => tauriTabsSettingsStorage),
      partialize: (state) => ({
        allowCloseLastTab: state.allowCloseLastTab,
      }),
    }
  )
);
