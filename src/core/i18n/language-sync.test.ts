import { describe, it, expect, beforeEach, vi } from "vitest";
import { createInMemoryStorage } from "@/test/in-memory-storage";

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

const inMemStorage = createInMemoryStorage();

vi.mock("@/core/storage/tauri-storage", () => ({
  tauriLanguageStorage: inMemStorage,
}));

// ── Suite ─────────────────────────────────────────────────────────────────────
//
// The sync between languageStore and i18next is implemented in App.tsx via a
// useEffect that calls i18n.changeLanguage(language) whenever the store
// language changes. This test validates the pattern in isolation:
// calling i18n.changeLanguage with the value from the store produces the
// expected language on the i18next singleton.
//

describe("languageStore → i18next sync pattern", () => {
  let i18n: typeof import("i18next").default;

  beforeEach(async () => {
    const mod = await import("./i18n");
    i18n = mod.default;
    // Reset to EN before each test
    await i18n.changeLanguage("en");
  });

  it('when store language is "en", calling i18n.changeLanguage("en") keeps language as "en"', async () => {
    const { useLanguageStore } = await import("@/stores/languageStore");
    useLanguageStore.setState({ language: "en" });

    const { language } = useLanguageStore.getState();
    await i18n.changeLanguage(language);

    expect(i18n.language).toBe("en");
  });

  it('when store language changes to "es", calling i18n.changeLanguage("es") sets i18n to "es"', async () => {
    const { useLanguageStore } = await import("@/stores/languageStore");
    useLanguageStore.setState({ language: "es" });

    const { language } = useLanguageStore.getState();
    await i18n.changeLanguage(language);

    expect(i18n.language).toBe("es");
  });

  it('after sync to "es", t() resolves translations from the ES locale', async () => {
    const { useLanguageStore } = await import("@/stores/languageStore");
    useLanguageStore.setState({ language: "es" });

    const { language } = useLanguageStore.getState();
    await i18n.changeLanguage(language);

    // Verify translations reflect the new language
    expect(i18n.t("common:actions.save")).toBe("Guardar");
    expect(i18n.t("common:actions.cancel")).toBe("Cancelar");
  });

  it('after sync back to "en", t() resolves translations from the EN locale', async () => {
    const { useLanguageStore } = await import("@/stores/languageStore");

    // Go to ES first, then back to EN
    useLanguageStore.setState({ language: "es" });
    await i18n.changeLanguage("es");

    useLanguageStore.setState({ language: "en" });
    const { language } = useLanguageStore.getState();
    await i18n.changeLanguage(language);

    expect(i18n.t("common:actions.save")).toBe("Save");
    expect(i18n.t("common:actions.cancel")).toBe("Cancel");
  });
});
