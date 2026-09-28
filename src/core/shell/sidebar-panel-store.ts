import { create } from "zustand";

/**
 * Which sidebar panel is shown. Built-in panels use fixed ids ("explorer",
 * "ai-chat", ...); extension view containers use `ext:<containerId>`.
 * A store (not component state) so commands can reveal a panel.
 */
interface SidebarPanelState {
  activePanel: string;
  setActivePanel: (panel: string) => void;
}

export const useSidebarPanelStore = create<SidebarPanelState>()((set) => ({
  activePanel: "explorer",
  setActivePanel: (activePanel) => set({ activePanel }),
}));

export const extensionPanelId = (containerId: string) => `ext:${containerId}`;
