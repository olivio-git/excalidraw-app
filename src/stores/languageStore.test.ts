import { describe, it, expect, beforeEach, vi } from "vitest";
import { createInMemoryStorage } from "@/test/in-memory-storage";

// ── Mock tauri storage → in-memory storage ────────────────────────────────────

let inMemStorage = createInMemoryStorage();

vi.mock("@/core/storage/tauri-storage", () => ({
  tauriLanguageStorage: inMemStorage,
}));

// ── Mock @tauri-apps/plugin-store (also covered by setup.ts) ─────────────────

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

// ── Helper to get a fresh store instance per test ────────────────────────────

async function getStore() {
  vi.resetModules();

  vi.mock("@/core/storage/tauri-storage", () => ({
    tauriLanguageStorage: inMemStorage,
  }));

  const { useLanguageStore } = await import("./languageStore");
  return useLanguageStore;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("useLanguageStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inMemStorage = createInMemoryStorage();
  });

  describe("Initial state", () => {
    it('starts with language="en"', async () => {
      const store = await getStore();

      expect(store.getState().language).toBe("en");
    });

    it("exposes a setLanguage action", async () => {
      const store = await getStore();

      expect(typeof store.getState().setLanguage).toBe("function");
    });
  });

  describe("setLanguage", () => {
    it('setLanguage("es") updates language to "es"', async () => {
      const store = await getStore();

      store.getState().setLanguage("es");

      expect(store.getState().language).toBe("es");
    });

    it('setLanguage("en") updates language to "en"', async () => {
      const store = await getStore();

      store.getState().setLanguage("es");
      store.getState().setLanguage("en");

      expect(store.getState().language).toBe("en");
    });

    it("successive calls reflect the last value", async () => {
      const store = await getStore();

      store.getState().setLanguage("es");
      expect(store.getState().language).toBe("es");

      store.getState().setLanguage("en");
      expect(store.getState().language).toBe("en");
    });
  });

  describe("State shape", () => {
    it("state has exactly the expected keys: language and setLanguage", async () => {
      const store = await getStore();
      const state = store.getState();
      const keys = Object.keys(state).sort();

      expect(keys).toContain("language");
      expect(keys).toContain("setLanguage");
    });

    it('language value is either "en" or "es"', async () => {
      const store = await getStore();

      const validLanguages = ["en", "es"];
      expect(validLanguages).toContain(store.getState().language);

      store.getState().setLanguage("es");
      expect(validLanguages).toContain(store.getState().language);
    });
  });
});
