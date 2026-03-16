import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "@testing-library/react";
import { KeybindingSource } from "../types";
import type { KeybindingEntry, NormalizedKey, KeyChord } from "../types";
import { createInMemoryStorage } from "../../../test/in-memory-storage";

// ── Mock keybinding-registry singleton ────────────────────────────────────────

const mockRegisterOverride = vi.fn();
const mockUnregister = vi.fn();

vi.mock("../keybinding-registry", () => ({
  keybindingRegistry: {
    registerOverride: mockRegisterOverride,
    unregister: mockUnregister,
    resolve: vi.fn().mockReturnValue(null),
    getAll: vi.fn().mockReturnValue([]),
    getConflicts: vi.fn().mockReturnValue([]),
    registerDefault: vi.fn(),
  },
}));

// ── Mock tauri storage → in-memory storage ────────────────────────────────────

let inMemStorage = createInMemoryStorage();

vi.mock("../../storage/tauri-storage", () => ({
  createTauriStorage: vi.fn(() => inMemStorage),
}));

// ── Mock @tauri-apps/plugin-store (already done in setup.ts, but be explicit) ─

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function key(s: string): NormalizedKey {
  return s as NormalizedKey;
}

function chord(...keys: string[]): KeyChord {
  if (keys.length === 1) return [key(keys[0])] as KeyChord;
  return [key(keys[0]), key(keys[1])] as KeyChord;
}

function makeEntry(
  commandId: string,
  chordKeys: string | string[],
  overrides?: Partial<KeybindingEntry>
): KeybindingEntry {
  const c = Array.isArray(chordKeys) ? chord(...chordKeys) : chord(chordKeys);
  return {
    commandId,
    chord: c,
    source: KeybindingSource.Builtin,
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("useKeybindingStore", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset in-memory storage to isolate each test
    inMemStorage = createInMemoryStorage();

    // Re-import mock to ensure fresh module resolution
    const { createTauriStorage } = await import("../../storage/tauri-storage");
    vi.mocked(createTauriStorage).mockReturnValue(inMemStorage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Helper to get a fresh store instance ──────────────────────────────────

  async function getStore() {
    // Re-import fresh to get a clean Zustand instance per test
    vi.resetModules();

    // Re-apply mocks after resetModules
    vi.mock("../keybinding-registry", () => ({
      keybindingRegistry: {
        registerOverride: mockRegisterOverride,
        unregister: mockUnregister,
        resolve: vi.fn().mockReturnValue(null),
        getAll: vi.fn().mockReturnValue([]),
        getConflicts: vi.fn().mockReturnValue([]),
        registerDefault: vi.fn(),
      },
    }));

    vi.mock("../../storage/tauri-storage", () => ({
      createTauriStorage: vi.fn(() => inMemStorage),
    }));

    const { useKeybindingStore } = await import("./keybinding-store");
    return useKeybindingStore;
  }

  // ── addOverride: adds to store + calls registerOverride ──────────────────

  describe("addOverride", () => {
    it('adds the entry to the overrides array with source forced to "user"', async () => {
      const store = await getStore();

      const entry = makeEntry("editor.save", "ctrl+s");

      await act(async () => {
        store.getState().addOverride(entry);
      });

      const { overrides } = store.getState();
      expect(overrides).toHaveLength(1);
      expect(overrides[0].commandId).toBe("editor.save");
      expect(overrides[0].source).toBe(KeybindingSource.User);
    });

    it("calls keybindingRegistry.registerOverride with the user-sourced entry", async () => {
      const store = await getStore();

      const entry = makeEntry("editor.save", "ctrl+s");

      await act(async () => {
        store.getState().addOverride(entry);
      });

      expect(mockRegisterOverride).toHaveBeenCalledWith(
        expect.objectContaining({ commandId: "editor.save", source: KeybindingSource.User })
      );
    });

    it("accumulates multiple overrides", async () => {
      const store = await getStore();

      await act(async () => {
        store.getState().addOverride(makeEntry("cmd.a", "ctrl+a"));
        store.getState().addOverride(makeEntry("cmd.b", "ctrl+b"));
      });

      expect(store.getState().overrides).toHaveLength(2);
    });
  });

  // ── removeOverride: removes from store + calls unregister ─────────────────

  describe("removeOverride", () => {
    it("removes the matching entry from the overrides array", async () => {
      const store = await getStore();

      await act(async () => {
        store.getState().addOverride(makeEntry("editor.save", "ctrl+s"));
        store.getState().removeOverride("ctrl+s", "editor.save");
      });

      expect(store.getState().overrides).toHaveLength(0);
    });

    it("calls keybindingRegistry.unregister with firstKey and commandId", async () => {
      const store = await getStore();

      await act(async () => {
        store.getState().addOverride(makeEntry("editor.save", "ctrl+s"));
        store.getState().removeOverride("ctrl+s", "editor.save");
      });

      expect(mockUnregister).toHaveBeenCalledWith("ctrl+s", "editor.save");
    });

    it("does not remove entries for other commandIds", async () => {
      const store = await getStore();

      await act(async () => {
        store.getState().addOverride(makeEntry("editor.save", "ctrl+s"));
        store.getState().addOverride(makeEntry("editor.undo", "ctrl+z"));
        store.getState().removeOverride("ctrl+s", "editor.save");
      });

      const { overrides } = store.getState();
      expect(overrides).toHaveLength(1);
      expect(overrides[0].commandId).toBe("editor.undo");
    });
  });

  // ── resetAll: clears all overrides ────────────────────────────────────────

  describe("resetAll", () => {
    it("removes all entries from the overrides array", async () => {
      const store = await getStore();

      await act(async () => {
        store.getState().addOverride(makeEntry("cmd.a", "ctrl+a"));
        store.getState().addOverride(makeEntry("cmd.b", "ctrl+b"));
        store.getState().resetAll();
      });

      expect(store.getState().overrides).toHaveLength(0);
    });

    it("calls unregister for each override in the store", async () => {
      const store = await getStore();

      await act(async () => {
        store.getState().addOverride(makeEntry("cmd.a", "ctrl+a"));
        store.getState().addOverride(makeEntry("cmd.b", "ctrl+b"));
      });

      mockUnregister.mockClear();

      await act(async () => {
        store.getState().resetAll();
      });

      expect(mockUnregister).toHaveBeenCalledTimes(2);
    });
  });

  // ── hydrateRegistry: replays overrides into registry ─────────────────────

  describe("hydrateRegistry", () => {
    it("calls registerOverride for each stored override", async () => {
      const store = await getStore();

      await act(async () => {
        store.getState().addOverride(makeEntry("cmd.a", "ctrl+a"));
        store.getState().addOverride(makeEntry("cmd.b", "ctrl+b"));
      });

      mockRegisterOverride.mockClear();

      await act(async () => {
        store.getState().hydrateRegistry();
      });

      expect(mockRegisterOverride).toHaveBeenCalledTimes(2);
      expect(mockRegisterOverride).toHaveBeenCalledWith(
        expect.objectContaining({ commandId: "cmd.a" })
      );
      expect(mockRegisterOverride).toHaveBeenCalledWith(
        expect.objectContaining({ commandId: "cmd.b" })
      );
    });

    it("does nothing when overrides is empty", async () => {
      const store = await getStore();

      mockRegisterOverride.mockClear();

      await act(async () => {
        store.getState().hydrateRegistry();
      });

      expect(mockRegisterOverride).not.toHaveBeenCalled();
    });
  });
});
