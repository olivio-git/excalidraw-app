import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createTauriStorage } from "../../storage/tauri-storage";
import { keybindingRegistry } from "../keybinding-registry";
import { KeybindingSource } from "../types";
import type { KeybindingEntry } from "../types";

// ── Store shape ───────────────────────────────────────────────────────────────

interface KeybindingStore {
  /** User-defined overrides persisted to disk. */
  overrides: KeybindingEntry[];

  /**
   * Add a user override entry.
   * Forces source to 'user' and registers it in the live registry.
   */
  addOverride: (entry: KeybindingEntry) => void;

  /**
   * Remove an override by the first key of its chord and its commandId.
   * Also unregisters the binding from the live registry.
   */
  removeOverride: (firstKey: string, commandId: string) => void;

  /**
   * Remove all stored overrides and unregister them from the live registry.
   */
  resetAll: () => void;

  /**
   * Replay all stored overrides into the live registry.
   * Called once on store init (auto-triggered by persist rehydration callback)
   * or manually when the registry is rebuilt.
   */
  hydrateRegistry: () => void;
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useKeybindingStore = create<KeybindingStore>()(
  persist(
    (set, get) => ({
      overrides: [],

      addOverride: (entry: KeybindingEntry) => {
        const withUserSource: KeybindingEntry = {
          ...entry,
          source: KeybindingSource.User,
        };

        set((state) => ({
          overrides: [...state.overrides, withUserSource],
        }));

        keybindingRegistry.registerOverride(withUserSource);
      },

      removeOverride: (firstKey: string, commandId: string) => {
        set((state) => ({
          overrides: state.overrides.filter(
            (e) => !(e.chord[0] === firstKey && e.commandId === commandId)
          ),
        }));

        keybindingRegistry.unregister(firstKey as ReturnType<typeof String>, commandId);
      },

      resetAll: () => {
        const { overrides } = get();
        for (const entry of overrides) {
          keybindingRegistry.unregister(entry.chord[0], entry.commandId);
        }
        set({ overrides: [] });
      },

      hydrateRegistry: () => {
        const { overrides } = get();
        for (const entry of overrides) {
          keybindingRegistry.registerOverride(entry);
        }
      },
    }),
    {
      name: "keybindings-storage",
      storage: createJSONStorage(() => createTauriStorage("keybindings-storage.json")),
      partialize: (state) => ({ overrides: state.overrides }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.hydrateRegistry();
        }
      },
    }
  )
);
