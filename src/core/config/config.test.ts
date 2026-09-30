import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_FILE,
  DEFAULT_KEYMAP_FILE,
  mergeConfig,
  validateConfig,
} from "./schema";
import { expandHome, hexToHslToken, parseToml, validateKeymap } from "./loader";
import { applyAppearance, applyKeymap, applyUserStyles, nativeEffectFor } from "./apply";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";

describe("config files", () => {
  it("ships commented defaults that parse to nothing (all defaults)", () => {
    for (const text of [DEFAULT_CONFIG_FILE, DEFAULT_KEYMAP_FILE]) {
      const parsed = parseToml(text, "x.toml");
      expect(parsed.issues).toEqual([]);
    }
    const { config, issues } = validateConfig(parseToml(DEFAULT_CONFIG_FILE, "c").data, "c");
    expect(issues).toEqual([]);
    expect(mergeConfig(config)).toEqual(DEFAULT_CONFIG);
  });

  it("reports syntax errors with the line", () => {
    const { issues } = parseToml('[appearance]\ntheme = "dark\n', "config.toml");
    expect(issues[0]).toMatchObject({ file: "config.toml", line: 2 });
    expect(issues[0].message).toContain("línea 2");
  });

  it("keeps valid options, explains the rest and clamps ranges", () => {
    const { data } = parseToml(
      `[appearance]
theme = "dark"
translucency = "glass"
opacity = 3
font_size = "big"
colour = "red"

[notes]
pinned = ["a.md", 3]

[nope]
x = 1
`,
      "config.toml"
    );
    const { config, issues } = validateConfig(data, "config.toml");
    expect(config.appearance).toEqual({ theme: "dark", opacity: 1 });
    expect(issues.map((i) => i.path)).toEqual([
      "appearance.translucency",
      "appearance.opacity",
      "appearance.font_size",
      "appearance.colour",
      "notes.pinned",
      "nope",
    ]);
    expect(issues[0].message).toContain("none, native, transparent, wallpaper");
  });

  it("merges layers: defaults, then user, then project", () => {
    const merged = mergeConfig(
      { appearance: { theme: "dark", opacity: 0.5 } },
      { appearance: { opacity: 0.9 }, notes: { pinned: ["x.md"] } }
    );
    expect(merged.appearance).toMatchObject({
      theme: "dark",
      opacity: 0.9,
      blur: DEFAULT_CONFIG.appearance.blur,
    });
    expect(merged.notes.pinned).toEqual(["x.md"]);
    // Defaults are never mutated.
    expect(DEFAULT_CONFIG.appearance.theme).toBe("system");
  });

  it("validates keymap bindings", () => {
    const { data } = parseToml(
      `[[bind]]
key = "Ctrl+Alt+N"
command = "templates.new"

[[bind]]
key = "ctrl+k"

[other]
`,
      "keymap.toml"
    );
    const { binds, issues } = validateKeymap(data, "keymap.toml");
    expect(binds).toEqual([{ key: "ctrl+alt+n", command: "templates.new", when: undefined }]);
    expect(issues.map((i) => i.message)).toEqual([
      "Se esperaba [[bind]], no «other»",
      "bind[2]: falta «command»",
    ]);
  });

  it("helpers: home paths, hex colors and native effects per platform", () => {
    expect(expandHome("~/fondo.jpg", "/home/ana")).toBe("/home/ana/fondo.jpg");
    expect(expandHome("/abs.png", "/home/ana")).toBe("/abs.png");
    expect(hexToHslToken("#7c3aed")).toBe("262 83% 58%");
    expect(hexToHslToken("#fff")).toBe("0 0% 100%");
    expect(hexToHslToken("purple")).toBeNull();
    expect(nativeEffectFor("auto", "macos")).toBe("underWindowBackground");
    expect(nativeEffectFor("sidebar", "macos")).toBe("sidebar");
    expect(nativeEffectFor("auto", "windows")).toBe("mica");
    expect(nativeEffectFor("acrylic", "windows")).toBe("acrylic");
    expect(nativeEffectFor("auto", "linux")).toBeNull();
  });
});

describe("applying the config", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.documentElement.className = "";
  });

  it("sets CSS variables, translucency mode and the accent", async () => {
    const config = mergeConfig({
      appearance: {
        translucency: "transparent",
        opacity: 0.6,
        sidebar_opacity: 0.4,
        accent: "#7c3aed",
        density: "comfortable",
        font_family: "IBM Plex Sans",
      },
      editor: { font_family: "JetBrains Mono", font_size: 15 },
    });
    const problems = await applyAppearance(config, new Set(["appearance.radius"]), (p) => p);
    expect(problems).toEqual([]);
    const root = document.documentElement;
    expect(root.classList.contains("qori-translucent")).toBe(true);
    expect(root.dataset.translucency).toBe("transparent");
    expect(root.dataset.density).toBe("comfortable");
    expect(root.style.getPropertyValue("--qori-opacity")).toBe("0.6");
    expect(root.style.getPropertyValue("--primary")).toBe("262 83% 58%");
    expect(root.style.getPropertyValue("--qori-font-sans")).toContain("IBM Plex Sans");
    expect(root.style.getPropertyValue("--qori-editor-size")).toBe("15px");
    expect(root.hasAttribute("data-config-editor")).toBe(true);

    await applyAppearance(mergeConfig({}), new Set(), (p) => p);
    expect(root.classList.contains("qori-translucent")).toBe(false);
    expect(root.style.getPropertyValue("--primary")).toBe("");
  });

  it("explains unsupported combinations instead of failing", async () => {
    const problems = await applyAppearance(
      mergeConfig({ appearance: { translucency: "wallpaper", accent: "morado" } }),
      new Set(),
      (p) => p
    );
    expect(problems.join("\n")).toContain("appearance.accent");
    expect(problems.join("\n")).toContain("appearance.wallpaper");
  });

  it("registers keymap bindings and replaces them on reload", () => {
    applyKeymap([{ key: "ctrl+alt+j", command: "test.first" }]);
    const chord = keyNormalizer.normalizeChord("ctrl+alt+j");
    expect(keybindingRegistry.resolve(chord)?.commandId).toBe("test.first");
    applyKeymap([{ key: "ctrl+alt+k", command: "test.second" }]);
    expect(keybindingRegistry.resolve(chord)).toBeNull();
    expect(keybindingRegistry.resolve(keyNormalizer.normalizeChord("ctrl+alt+k"))?.commandId).toBe(
      "test.second"
    );
    applyKeymap([]);
  });

  it("adds user CSS last in <head>, and removes it when emptied", () => {
    applyUserStyles("body { color: red; }");
    const style = document.getElementById("qori-user-styles");
    expect(style?.textContent).toBe("body { color: red; }");
    expect(document.head.lastElementChild).toBe(style);
    applyUserStyles("  ");
    expect(document.getElementById("qori-user-styles")).toBeNull();
  });
});
