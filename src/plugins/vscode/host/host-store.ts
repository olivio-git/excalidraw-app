import { create } from "zustand";

export type ExtensionHostStatus =
  | "idle" // no extension with code installed
  | "starting"
  | "running"
  | "stopped"
  | "error"
  | "unavailable"; // not running inside the desktop app

interface HostState {
  status: ExtensionHostStatus;
  error: string | null;
  runtime: string | null;
  activated: string[];
  failed: Record<string, string>;
  setStatus: (status: ExtensionHostStatus, error?: string | null) => void;
  setRuntime: (runtime: string | null) => void;
  markActivated: (id: string) => void;
  markFailed: (id: string, message: string) => void;
  resetExtensions: () => void;
}

export const useExtensionHostStore = create<HostState>()((set) => ({
  status: "idle",
  error: null,
  runtime: null,
  activated: [],
  failed: {},
  setStatus: (status, error = null) => set({ status, error }),
  setRuntime: (runtime) => set({ runtime }),
  markActivated: (id) =>
    set((state) => ({
      activated: state.activated.includes(id) ? state.activated : [...state.activated, id],
      failed: Object.fromEntries(Object.entries(state.failed).filter(([key]) => key !== id)),
    })),
  markFailed: (id, message) => set((state) => ({ failed: { ...state.failed, [id]: message } })),
  resetExtensions: () => set({ activated: [], failed: {} }),
}));
