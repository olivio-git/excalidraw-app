import { describe, it, expect } from "vitest";

// ── Locale JSON imports ───────────────────────────────────────────────────────

import en_common from "./locales/en/common.json";
import en_settings from "./locales/en/settings.json";
import en_explorer from "./locales/en/explorer.json";
import en_tabs from "./locales/en/tabs.json";
import en_commands from "./locales/en/commands.json";

import es_common from "./locales/es/common.json";
import es_settings from "./locales/es/settings.json";
import es_explorer from "./locales/es/explorer.json";
import es_tabs from "./locales/es/tabs.json";
import es_commands from "./locales/es/commands.json";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively collect all dot-notation leaf key paths from a JSON object.
 * E.g. { a: { b: "val" } } → ["a.b"]
 */
function collectLeafPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) {
    return [prefix];
  }

  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return collectLeafPaths(value, path);
  });
}

/**
 * Returns keys present in `reference` but missing from `target`.
 */
function findMissingKeys(reference: unknown, target: unknown): string[] {
  const refPaths = new Set(collectLeafPaths(reference));
  const targetPaths = new Set(collectLeafPaths(target));

  return [...refPaths].filter((path) => !targetPaths.has(path));
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Locale completeness: EN and ES parity", () => {
  describe("common namespace", () => {
    it("EN common has no keys missing that ES common has", () => {
      const missing = findMissingKeys(es_common, en_common);
      expect(missing).toEqual([]);
    });

    it("ES common has no keys missing that EN common has", () => {
      const missing = findMissingKeys(en_common, es_common);
      expect(missing).toEqual([]);
    });
  });

  describe("settings namespace", () => {
    it("EN settings has no keys missing that ES settings has", () => {
      const missing = findMissingKeys(es_settings, en_settings);
      expect(missing).toEqual([]);
    });

    it("ES settings has no keys missing that EN settings has", () => {
      const missing = findMissingKeys(en_settings, es_settings);
      expect(missing).toEqual([]);
    });
  });

  describe("explorer namespace", () => {
    it("EN explorer has no keys missing that ES explorer has", () => {
      const missing = findMissingKeys(es_explorer, en_explorer);
      expect(missing).toEqual([]);
    });

    it("ES explorer has no keys missing that EN explorer has", () => {
      const missing = findMissingKeys(en_explorer, es_explorer);
      expect(missing).toEqual([]);
    });
  });

  describe("tabs namespace", () => {
    it("EN tabs has no keys missing that ES tabs has", () => {
      const missing = findMissingKeys(es_tabs, en_tabs);
      expect(missing).toEqual([]);
    });

    it("ES tabs has no keys missing that EN tabs has", () => {
      const missing = findMissingKeys(en_tabs, es_tabs);
      expect(missing).toEqual([]);
    });
  });

  describe("commands namespace", () => {
    it("EN commands has no keys missing that ES commands has", () => {
      const missing = findMissingKeys(es_commands, en_commands);
      expect(missing).toEqual([]);
    });

    it("ES commands has no keys missing that EN commands has", () => {
      const missing = findMissingKeys(en_commands, es_commands);
      expect(missing).toEqual([]);
    });
  });
});

describe("Locale EN: required keys exist and are non-empty strings", () => {
  const requiredCommonKeys: Array<[string, unknown]> = [
    ["actions.save", en_common.actions.save],
    ["actions.cancel", en_common.actions.cancel],
    ["actions.confirm", en_common.actions.confirm],
    ["actions.delete", en_common.actions.delete],
    ["commandPalette.noCommandsFound", en_common.commandPalette.noCommandsFound],
    ["commandPalette.noWorkspaceSelected", en_common.commandPalette.noWorkspaceSelected],
    ["commandPalette.noFilesFound", en_common.commandPalette.noFilesFound],
    ["sidebar.collapse", en_common.sidebar.collapse],
    ["sidebar.expand", en_common.sidebar.expand],
  ];

  it.each(requiredCommonKeys)('common["%s"] is a non-empty string', (_path, value) => {
    expect(typeof value).toBe("string");
    expect((value as string).length).toBeGreaterThan(0);
  });

  it("settings.appearance.language exists and is a non-empty string", () => {
    expect(typeof en_settings.appearance.language).toBe("string");
    expect(en_settings.appearance.language.length).toBeGreaterThan(0);
  });

  it("commands.changeLanguage.title exists and is a non-empty string", () => {
    expect(typeof en_commands.changeLanguage.title).toBe("string");
    expect(en_commands.changeLanguage.title.length).toBeGreaterThan(0);
  });
});

describe("Locale ES: required keys exist and are non-empty strings", () => {
  const requiredCommonKeys: Array<[string, unknown]> = [
    ["actions.save", es_common.actions.save],
    ["actions.cancel", es_common.actions.cancel],
    ["commandPalette.noCommandsFound", es_common.commandPalette.noCommandsFound],
    ["commandPalette.noWorkspaceSelected", es_common.commandPalette.noWorkspaceSelected],
    ["commandPalette.noFilesFound", es_common.commandPalette.noFilesFound],
  ];

  it.each(requiredCommonKeys)('common["%s"] is a non-empty string', (_path, value) => {
    expect(typeof value).toBe("string");
    expect((value as string).length).toBeGreaterThan(0);
  });

  it("settings.appearance.language is translated (not equal to EN)", () => {
    expect(es_settings.appearance.language).not.toBe(en_settings.appearance.language);
    expect(es_settings.appearance.language).toBe("Idioma");
  });

  it("common.actions.save is translated (not equal to EN)", () => {
    expect(es_common.actions.save).not.toBe(en_common.actions.save);
    expect(es_common.actions.save).toBe("Guardar");
  });
});
