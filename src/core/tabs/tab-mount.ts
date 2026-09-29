import { create } from "zustand";

/**
 * Tabs with `keepMounted` are mounted the first time they are shown, not at
 * startup. Code that needs a hidden tab's editor alive (e.g. an AI/MCP tool
 * waiting for a diagram canvas) requests its mount here by instance id
 * (the file path).
 */
interface TabMountState {
  requested: Record<string, true>;
  requestMount: (instanceId: string) => void;
}

export const useTabMountStore = create<TabMountState>()((set) => ({
  requested: {},
  requestMount: (instanceId) =>
    set((state) =>
      state.requested[instanceId]
        ? state
        : { requested: { ...state.requested, [instanceId]: true } }
    ),
}));

export function requestTabMount(instanceId: string): void {
  useTabMountStore.getState().requestMount(instanceId);
}
