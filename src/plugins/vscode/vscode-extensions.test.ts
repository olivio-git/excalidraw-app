import { describe, it, expect } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseJsonc } from "./jsonc";
import { normalizeRelativePath, resolveRelative } from "./paths";
import { readVsix } from "./vsix";
import {
  getExtensionCandidates,
  normalizeIconTheme,
  resolveFileIconId,
  resolveFolderIconId,
  resolveIconFilePath,
} from "./icon-theme";
import {
  contrastRatio,
  kindFromUiTheme,
  loadColorThemeColors,
  mapColorsToCssVariables,
  parseHexColor,
  toHslTriplet,
  type ColorThemeDocument,
} from "./color-theme";

describe("parseJsonc", () => {
  it("accepts comments, trailing commas and a BOM", () => {
    const source = `\uFEFF{
      // line comment
      "a": 1, /* block */
      "b": ["x", "y",],
    }`;
    expect(parseJsonc(source)).toEqual({ a: 1, b: ["x", "y"] });
  });

  it("keeps comment-like text and commas inside strings", () => {
    expect(parseJsonc('{ "url": "http://a/*b*/", "s": "a,}", "q": "\\"//" }')).toEqual({
      url: "http://a/*b*/",
      s: "a,}",
      q: '"//',
    });
  });
});

describe("extension paths", () => {
  it("normalizes relative paths", () => {
    expect(normalizeRelativePath("./a/../b\\c.svg")).toBe("b/c.svg");
  });

  it("rejects paths escaping the extension root", () => {
    expect(normalizeRelativePath("../evil")).toBeNull();
    expect(normalizeRelativePath("a/../../evil")).toBeNull();
    expect(normalizeRelativePath("/etc/passwd")).toBeNull();
    expect(normalizeRelativePath("C:/Windows")).toBeNull();
  });

  it("resolves icon paths relative to the theme file directory", () => {
    expect(resolveRelative("dist", "../icons/ts.svg")).toBe("icons/ts.svg");
    expect(resolveRelative("", "./icons/ts.svg")).toBe("icons/ts.svg");
  });
});

describe("readVsix", () => {
  const manifest = {
    name: "My-Icons",
    publisher: "Acme",
    version: "1.2.3",
    contributes: { iconThemes: [{ id: "my", label: "My Icons", path: "./theme.json" }] },
  };

  it("reads the manifest and strips the extension/ prefix", () => {
    const bytes = zipSync({
      "extension.vsixmanifest": strToU8("<xml/>"),
      "extension/package.json": strToU8(JSON.stringify(manifest)),
      "extension/icons/a.svg": strToU8("<svg/>"),
    });
    const pkg = readVsix(bytes);
    expect(pkg.id).toBe("acme.my-icons");
    expect(pkg.manifest.contributes?.iconThemes?.[0].id).toBe("my");
    expect(Object.keys(pkg.files).sort()).toEqual(["icons/a.svg", "package.json"]);
  });

  it("rejects archives without a manifest", () => {
    const bytes = zipSync({ "extension/readme.md": strToU8("hi") });
    expect(() => readVsix(bytes)).toThrow(/package\.json/);
  });

  it("rejects zip-slip entries", () => {
    const bytes = zipSync({
      "extension/package.json": strToU8(JSON.stringify(manifest)),
      "extension/../../evil.sh": strToU8("rm -rf"),
    });
    expect(() => readVsix(bytes)).toThrow(/Ruta inválida/);
  });
});

describe("icon theme resolution", () => {
  const theme = normalizeIconTheme({
    iconDefinitions: {
      file: { iconPath: "../icons/file.svg" },
      ts: { iconPath: "../icons/ts.svg" },
      dts: { iconPath: "../icons/dts.svg" },
      pkg: { iconPath: "../icons/pkg.svg" },
      folder: { iconPath: "../icons/folder.svg" },
      folderOpen: { iconPath: "../icons/folder-open.svg" },
      src: { iconPath: "../icons/src.svg" },
      srcOpen: { iconPath: "../icons/src-open.svg" },
      git: { iconPath: "../icons/git.svg" },
      tsLight: { iconPath: "../icons/ts-light.svg" },
      glyph: { fontCharacter: "\\E001" },
    },
    file: "file",
    folder: "folder",
    folderExpanded: "folderOpen",
    fileExtensions: { "D.TS": "dts" },
    fileNames: { "Package.json": "pkg" },
    folderNames: { SRC: "src" },
    folderNamesExpanded: { src: "srcOpen" },
    languageIds: { typescript: "ts", ignore: "git" },
    light: { languageIds: { typescript: "tsLight" } },
  });

  it("lists compound extensions longest first", () => {
    expect(getExtensionCandidates("foo.d.ts")).toEqual(["d.ts", "ts"]);
    expect(getExtensionCandidates(".gitignore")).toEqual(["gitignore"]);
    expect(getExtensionCandidates("Makefile")).toEqual([]);
  });

  it("prefers file names, then compound extensions, then language ids", () => {
    expect(resolveFileIconId(theme, "PACKAGE.JSON")).toBe("pkg");
    expect(resolveFileIconId(theme, "index.d.ts")).toBe("dts");
    expect(resolveFileIconId(theme, "index.ts")).toBe("ts");
    expect(resolveFileIconId(theme, "notes.unknown")).toBe("file");
  });

  it("uses light overrides and falls back to the base theme", () => {
    expect(resolveFileIconId(theme, "index.ts", "light")).toBe("tsLight");
    expect(resolveFileIconId(theme, "index.d.ts", "light")).toBe("dts");
  });

  it("resolves folders case-insensitively with expanded variants", () => {
    expect(resolveFolderIconId(theme, "Src", false)).toBe("src");
    expect(resolveFolderIconId(theme, "Src", true)).toBe("srcOpen");
    expect(resolveFolderIconId(theme, "docs", false)).toBe("folder");
    expect(resolveFolderIconId(theme, "docs", true)).toBe("folderOpen");
  });

  it("resolves image paths relative to the theme file", () => {
    expect(resolveIconFilePath(theme, "dist/theme.json", "ts")).toBe("icons/ts.svg");
    expect(resolveIconFilePath(theme, "theme.json", "ts")).toBeNull();
    expect(resolveIconFilePath(theme, "dist/theme.json", "glyph")).toBeNull();
    expect(resolveIconFilePath(theme, "dist/theme.json", "missing")).toBeNull();
  });
});

describe("color themes", () => {
  it("parses the hex formats VS Code accepts", () => {
    expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHexColor("#00000080")?.a).toBeCloseTo(0.5, 2);
    expect(parseHexColor("red")).toBeNull();
  });

  it("converts colors to the app's HSL triplets", () => {
    expect(toHslTriplet({ r: 255, g: 0, b: 0, a: 1 })).toBe("0 100% 50%");
    expect(toHslTriplet({ r: 30, g: 30, b: 30, a: 1 })).toBe("0 0% 11.8%");
  });

  it("maps workbench colors with fallbacks and blends translucent ones", () => {
    const vars = mapColorsToCssVariables(
      {
        "editor.background": "#000000",
        foreground: "#ffffff",
        "list.hoverBackground": "#ffffff80",
      },
      "dark"
    );
    expect(vars["--background"]).toBe("0 0% 0%");
    // No editor.foreground → falls back to the generic foreground.
    expect(vars["--foreground"]).toBe("0 0% 100%");
    expect(vars["--accent"]).toBe("0 0% 50.2%");
    // Unmapped variables are left to the app defaults.
    expect(vars["--primary"]).toBeUndefined();
  });

  it("keeps accent-colored separators out of --border (Dracula)", () => {
    const vars = mapColorsToCssVariables(
      {
        "editor.background": "#282A36",
        "editor.foreground": "#F8F8F2",
        "panel.border": "#BD93F9",
        "editorGroup.border": "#BD93F9",
        "input.border": "#191A21",
        "tab.inactiveForeground": "#6272A4",
      },
      "dark"
    );
    expect(vars["--border"]).toBe(toHslTriplet(parseHexColor("#191A21")!));
    expect(vars["--input"]).toBe(vars["--border"]);
    // No descriptionForeground → foreground at 70%, like VS Code, not the dim tab color.
    expect(vars["--muted-foreground"]).toBe(toHslTriplet({ r: 186, g: 186, b: 186, a: 1 }));
    // No sideBar border → subtle line derived from the foreground.
    expect(vars["--sidebar-border"]).toBe(toHslTriplet({ r: 71, g: 73, b: 82, a: 1 }));
  });

  it("merges include chains relative to the including file", async () => {
    const files: Record<string, ColorThemeDocument> = {
      "themes/dark.json": { include: "./base/common.json", colors: { a: "#111111" } },
      "themes/base/common.json": { colors: { a: "#000000", b: "#222222" } },
    };
    const colors = await loadColorThemeColors(async (path) => files[path], "themes/dark.json");
    expect(colors).toEqual({ a: "#111111", b: "#222222" });
  });

  it("maps uiTheme to light or dark", () => {
    expect(kindFromUiTheme("vs")).toBe("light");
    expect(kindFromUiTheme("hc-light")).toBe("light");
    expect(kindFromUiTheme("vs-dark")).toBe("dark");
    expect(kindFromUiTheme("hc-black")).toBe("dark");
  });
});

describe("color theme contrast guarantees", () => {
  /** Parse an `H S% L%` triplet back to RGB to measure what the app will render. */
  const fromTriplet = (triplet: string) => {
    const [h, s, l] = triplet.replace(/%/g, "").split(" ").map(Number);
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return { r: f(0), g: f(8), b: f(4), a: 1 };
  };
  const contrast = (vars: Record<string, string>, fg: string, bg: string) =>
    contrastRatio(fromTriplet(vars[fg]), fromTriplet(vars[bg]));

  // Real Dracula colors (dracula-theme.theme-dracula 2.24.3).
  const dracula = {
    "editor.background": "#282A36",
    "editor.foreground": "#F8F8F2",
    foreground: "#F8F8F2",
    "activityBarBadge.background": "#FF79C6",
    "progressBar.background": "#FF79C6",
    "button.background": "#44475A",
    "button.foreground": "#F8F8F2",
    "button.secondaryBackground": "#282A36",
    focusBorder: "#6272A4",
    "list.highlightForeground": "#8BE9FD",
    "list.hoverBackground": "#44475A75",
    "list.activeSelectionBackground": "#44475A",
    "list.activeSelectionForeground": "#F8F8F2",
    "sideBar.background": "#21222C",
    "editorWidget.background": "#21222C",
    "input.background": "#282A36",
    "input.border": "#191A21",
    errorForeground: "#FF5555",
    "panel.border": "#BD93F9",
    "editorGroup.border": "#BD93F9",
  };

  it("picks a readable brand color instead of a gray button (Dracula)", () => {
    const vars = mapColorsToCssVariables(dracula, "dark");
    // Pink accent, not the #44475A button gray.
    expect(vars["--primary"]).toBe(toHslTriplet(parseHexColor("#FF79C6")!));
    // Active tab: text-primary on bg-accent.
    expect(contrast(vars, "--primary", "--accent")).toBeGreaterThanOrEqual(3);
    expect(contrast(vars, "--primary", "--background")).toBeGreaterThanOrEqual(3);
  });

  it("keeps every text/surface pair readable (Dracula)", () => {
    const vars = mapColorsToCssVariables(dracula, "dark");
    for (const [fg, bg] of [
      ["--foreground", "--background"],
      ["--primary-foreground", "--primary"],
      ["--secondary-foreground", "--secondary"],
      ["--accent-foreground", "--accent"],
      ["--card-foreground", "--card"],
      ["--destructive-foreground", "--destructive"],
      ["--sidebar-foreground", "--sidebar-background"],
      ["--sidebar-accent-foreground", "--sidebar-accent"],
    ]) {
      expect(contrast(vars, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(vars, "--muted-foreground", "--background")).toBeGreaterThanOrEqual(3);
  });

  it("makes surfaces equal to the background stand out (Dracula secondary)", () => {
    const vars = mapColorsToCssVariables(dracula, "dark");
    // button.secondaryBackground is the editor background itself.
    expect(vars["--secondary"]).not.toBe(vars["--background"]);
    expect(contrast(vars, "--secondary", "--background")).toBeGreaterThanOrEqual(1.1);
  });

  it("works for light themes and keeps the button text when the button color wins", () => {
    const vars = mapColorsToCssVariables(
      {
        "editor.background": "#ffffff",
        "editor.foreground": "#1f2328",
        "button.background": "#1f883d",
        "button.foreground": "#ffffff",
        "list.hoverBackground": "#eaeef2",
      },
      "light"
    );
    expect(vars["--primary"]).toBe(toHslTriplet(parseHexColor("#1f883d")!));
    expect(vars["--primary-foreground"]).toBe("0 0% 100%");
    expect(contrast(vars, "--primary-foreground", "--primary")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars, "--accent-foreground", "--accent")).toBeGreaterThanOrEqual(4.5);
  });

  it("measures WCAG contrast", () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBe(1);
  });
});
