import { create } from "zustand";

export type SettingsTab = "appearance" | "keybindings" | "workspace" | "ai" | "tabs";

interface SettingsState {
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  activeTab: "appearance",
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
