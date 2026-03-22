import { describe, it, expect, beforeEach } from "vitest";

// ── Suite ─────────────────────────────────────────────────────────────────────
//
// i18n is a module-level singleton. We import it once and test state changes
// directly via the i18next instance API. Tests must restore the language to
// "en" in beforeEach so they remain order-independent.
//

describe("i18n singleton", () => {
  let i18n: typeof import("i18next").default;

  beforeEach(async () => {
    // Dynamic import so the singleton is resolved once and reused.
    const mod = await import("./i18n");
    i18n = mod.default;
    // Reset to EN before each test to avoid order-dependency.
    await i18n.changeLanguage("en");
  });

  describe("initialization", () => {
    it("initializes without throwing", async () => {
      await expect(import("./i18n")).resolves.toBeDefined();
    });

    it('default language is "en"', () => {
      expect(i18n.language).toBe("en");
    });

    it("isInitialized is true after import", () => {
      expect(i18n.isInitialized).toBe(true);
    });
  });

  describe("EN translations", () => {
    it('common:actions.save returns "Save" in EN', () => {
      expect(i18n.t("common:actions.save")).toBe("Save");
    });

    it('common:actions.cancel returns "Cancel" in EN', () => {
      expect(i18n.t("common:actions.cancel")).toBe("Cancel");
    });

    it('common:commandPalette.noCommandsFound returns "No commands found" in EN', () => {
      expect(i18n.t("common:commandPalette.noCommandsFound")).toBe("No commands found");
    });

    it('common:commandPalette.noWorkspaceSelected returns "No workspace selected" in EN', () => {
      expect(i18n.t("common:commandPalette.noWorkspaceSelected")).toBe("No workspace selected");
    });

    it('common:commandPalette.noFilesFound returns "No files found" in EN', () => {
      expect(i18n.t("common:commandPalette.noFilesFound")).toBe("No files found");
    });

    it('settings:appearance.language returns "Language" in EN', () => {
      expect(i18n.t("settings:appearance.language")).toBe("Language");
    });
  });

  describe("ES translations after changeLanguage", () => {
    it('changeLanguage("es") resolves and sets language to "es"', async () => {
      await i18n.changeLanguage("es");

      expect(i18n.language).toBe("es");
    });

    it('common:actions.save returns "Guardar" in ES', async () => {
      await i18n.changeLanguage("es");

      expect(i18n.t("common:actions.save")).toBe("Guardar");
    });

    it('common:actions.cancel returns "Cancelar" in ES', async () => {
      await i18n.changeLanguage("es");

      expect(i18n.t("common:actions.cancel")).toBe("Cancelar");
    });

    it("common:commandPalette.noCommandsFound returns ES text", async () => {
      await i18n.changeLanguage("es");

      expect(i18n.t("common:commandPalette.noCommandsFound")).toBe("No se encontraron comandos");
    });

    it('settings:appearance.language returns "Idioma" in ES', async () => {
      await i18n.changeLanguage("es");

      expect(i18n.t("settings:appearance.language")).toBe("Idioma");
    });
  });

  describe("Fallback behavior", () => {
    it("missing key returns the key path itself, not undefined", () => {
      const result = i18n.t("common:nonExistent.deepKey");

      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      // i18next returns the key when not found, not undefined or empty
      expect(result.length).toBeGreaterThan(0);
    });

    it("missing namespace key does not throw", () => {
      expect(() => i18n.t("unknownNamespace:some.key")).not.toThrow();
    });
  });
});
