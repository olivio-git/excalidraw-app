import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ── Suite ─────────────────────────────────────────────────────────────────────
//
// Verifies that the translation keys used by the CommandPalette empty-state
// rendering exist in both EN and ES and resolve to non-empty strings.
//

describe("CommandPalette translation keys", () => {
  let i18n: typeof import("i18next").default;

  // Keys consumed by the CommandPalette component
  const commandPaletteKeys = [
    "common:commandPalette.noCommandsFound",
    "common:commandPalette.noWorkspaceSelected",
    "common:commandPalette.noFilesFound",
  ] as const;

  beforeEach(async () => {
    const mod = await import("./i18n");
    i18n = mod.default;
  });

  describe("EN locale", () => {
    beforeEach(async () => {
      await i18n.changeLanguage("en");
    });

    it.each(commandPaletteKeys)('"%s" resolves to a non-empty string in EN', (key) => {
      const result = i18n.t(key);

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      // Must not fall back to the key path itself — must be a real translation
      expect(result).not.toBe(key);
    });

    it('noCommandsFound returns "No commands found" in EN', () => {
      expect(i18n.t("common:commandPalette.noCommandsFound")).toBe("No commands found");
    });

    it('noWorkspaceSelected returns "No workspace selected" in EN', () => {
      expect(i18n.t("common:commandPalette.noWorkspaceSelected")).toBe("No workspace selected");
    });

    it('noFilesFound returns "No files found" in EN', () => {
      expect(i18n.t("common:commandPalette.noFilesFound")).toBe("No files found");
    });
  });

  describe("ES locale", () => {
    beforeEach(async () => {
      await i18n.changeLanguage("es");
    });

    afterEach(async () => {
      // Restore EN so other test suites are not affected
      await i18n.changeLanguage("en");
    });

    it.each(commandPaletteKeys)('"%s" resolves to a non-empty string in ES', (key) => {
      const result = i18n.t(key);

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toBe(key);
    });

    it('noCommandsFound returns "No se encontraron comandos" in ES', () => {
      expect(i18n.t("common:commandPalette.noCommandsFound")).toBe("No se encontraron comandos");
    });

    it('noWorkspaceSelected returns "No hay workspace seleccionado" in ES', () => {
      expect(i18n.t("common:commandPalette.noWorkspaceSelected")).toBe(
        "No hay workspace seleccionado"
      );
    });

    it('noFilesFound returns "No se encontraron archivos" in ES', () => {
      expect(i18n.t("common:commandPalette.noFilesFound")).toBe("No se encontraron archivos");
    });
  });
});
