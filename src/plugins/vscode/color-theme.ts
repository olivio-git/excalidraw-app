import { dirname, resolveRelative } from "./paths";

/**
 * VS Code color theme support (`contributes.themes`).
 *
 * Only workbench `colors` are used: they are mapped onto the app's shadcn CSS
 * variables (`--background`, `--primary`, ...), which hold `H S% L%` triplets.
 * `tokenColors` (syntax highlighting) is ignored — the app has no code editor.
 */

export type ColorThemeKind = "light" | "dark";

export interface ColorThemeDocument {
  name?: string;
  type?: string;
  include?: string;
  colors?: Record<string, string | null>;
}

/** Light/dark from `contributes.themes[].uiTheme` (`vs`, `vs-dark`, `hc-black`, `hc-light`). */
export function kindFromUiTheme(uiTheme: string | undefined): ColorThemeKind {
  return uiTheme === "vs" || uiTheme === "hc-light" ? "light" : "dark";
}

const MAX_INCLUDE_DEPTH = 5;

/**
 * Load a theme file and merge its `include` chain (included colors first,
 * the including file wins). Paths are relative to the including file.
 */
export async function loadColorThemeColors(
  readJson: (path: string) => Promise<ColorThemeDocument>,
  themePath: string
): Promise<Record<string, string>> {
  const colors: Record<string, string> = {};
  const visit = async (path: string, depth: number): Promise<void> => {
    if (depth > MAX_INCLUDE_DEPTH) throw new Error(`Demasiados 'include' anidados en ${path}`);
    const doc = await readJson(path);
    if (doc.include) {
      const included = resolveRelative(dirname(path), doc.include);
      if (included) await visit(included, depth + 1);
    }
    for (const [key, value] of Object.entries(doc.colors ?? {})) {
      if (typeof value === "string") colors[key] = value;
      else delete colors[key];
    }
  };
  await visit(themePath, 0);
  return colors;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (the formats VS Code accepts). */
export function parseHexColor(value: string): Rgba | null {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length <= 4) hex = [...hex].map((ch) => ch + ch).join("");
  const channel = (index: number) => parseInt(hex.slice(index, index + 2), 16);
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: hex.length === 8 ? channel(6) / 255 : 1,
  };
}

/** Composite a translucent color over an opaque one. */
function blend(color: Rgba, base: Rgba): Rgba {
  const mix = (top: number, bottom: number) => Math.round(top * color.a + bottom * (1 - color.a));
  return { r: mix(color.r, base.r), g: mix(color.g, base.g), b: mix(color.b, base.b), a: 1 };
}

/** `H S% L%` triplet, the format used by the app's CSS variables. */
export function toHslTriplet({ r, g, b }: Rgba): string {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(h)} ${round(s * 100)}% ${round(l * 100)}%`;
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two opaque colors (1–21). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Minimum contrast for body text (WCAG AA). */
const MIN_TEXT_CONTRAST = 4.5;
/** Minimum contrast for icons, large text and UI accents (WCAG AA). */
const MIN_UI_CONTRAST = 3;
/** Below this, a surface is indistinguishable from what it sits on. */
const MIN_SURFACE_CONTRAST = 1.1;

/**
 * App CSS variable → VS Code color keys, most specific first.
 * The first key the theme defines wins; the brand color, text colors and
 * surfaces are then checked for contrast (see `mapColorsToCssVariables`).
 */
export const CSS_VARIABLE_SOURCES: Record<string, string[]> = {
  "--background": ["editor.background"],
  "--foreground": ["editor.foreground", "foreground"],
  "--card": ["editorWidget.background", "sideBar.background", "editor.background"],
  "--card-foreground": ["editorWidget.foreground", "foreground", "editor.foreground"],
  "--popover": ["menu.background", "dropdown.background", "editorWidget.background"],
  "--popover-foreground": ["menu.foreground", "dropdown.foreground", "foreground"],
  "--secondary": ["button.secondaryBackground", "input.background"],
  "--secondary-foreground": ["button.secondaryForeground", "foreground"],
  "--muted": ["input.background", "editorWidget.background"],
  "--muted-foreground": ["descriptionForeground"],
  "--accent": ["list.hoverBackground", "list.inactiveSelectionBackground"],
  "--accent-foreground": ["list.hoverForeground", "foreground"],
  "--destructive": ["errorForeground", "editorError.foreground"],
  // `--border` outlines every card, badge and input in the app, so it takes
  // component borders — not `panel.border`/`editorGroup.border`, which themes
  // often paint in an accent color because VS Code draws them as a single line.
  "--border": [
    "contrastBorder",
    "widget.border",
    "editorWidget.border",
    "dropdown.border",
    "input.border",
    "tab.border",
    "sideBarSectionHeader.border",
  ],
  "--input": ["contrastBorder", "input.border", "dropdown.border"],
  "--ring": ["focusBorder"],
  "--sidebar-background": ["sideBar.background"],
  "--sidebar-foreground": ["sideBar.foreground", "foreground"],
  "--sidebar-accent": ["list.activeSelectionBackground", "list.hoverBackground"],
  "--sidebar-accent-foreground": ["list.activeSelectionForeground", "sideBar.foreground"],
  "--sidebar-border": ["contrastBorder", "sideBar.border", "sideBarSectionHeader.border"],
  "--sidebar-ring": ["focusBorder"],
};

/**
 * Candidates for the brand color (`--primary`, `--sidebar-primary`). The app
 * uses it both as button background and as text/icon color (`text-primary`,
 * e.g. the active tab), so the first candidate readable on the background wins.
 * `button.background` is not first: many themes (Dracula) make it a gray.
 */
export const BRAND_SOURCES = [
  "textLink.foreground",
  "activityBarBadge.background",
  "progressBar.background",
  "button.background",
  "focusBorder",
  "list.highlightForeground",
];

/**
 * Variables derived from the foreground when the theme defines none of their
 * keys, the way VS Code derives its own defaults (e.g. `descriptionForeground`
 * is the foreground at 70% opacity). Keeps the theme's hue instead of the
 * app default, which would clash with it.
 */
const DERIVED_FROM_FOREGROUND: Record<string, number> = {
  "--muted-foreground": 0.7,
  "--border": 0.15,
  "--input": 0.15,
  "--sidebar-border": 0.15,
};

/**
 * Surfaces that must stand out from what they sit on (secondary buttons,
 * chips, hover/selection). Missing or indistinguishable ones are derived as
 * the foreground at `alpha` over their base.
 */
const SURFACES: Array<{ variable: string; on: string; alpha: number }> = [
  { variable: "--secondary", on: "--background", alpha: 0.1 },
  { variable: "--muted", on: "--background", alpha: 0.08 },
  { variable: "--accent", on: "--background", alpha: 0.12 },
  { variable: "--sidebar-accent", on: "--sidebar-background", alpha: 0.12 },
];

/** Text variables and the background they are drawn on. */
const TEXT_PAIRS: Array<[background: string, text: string]> = [
  ["--card", "--card-foreground"],
  ["--popover", "--popover-foreground"],
  ["--primary", "--primary-foreground"],
  ["--secondary", "--secondary-foreground"],
  ["--muted", "--muted-foreground"],
  ["--accent", "--accent-foreground"],
  ["--destructive", "--destructive-foreground"],
  ["--sidebar-background", "--sidebar-foreground"],
  ["--sidebar-primary", "--sidebar-primary-foreground"],
  ["--sidebar-accent", "--sidebar-accent-foreground"],
];

/** First candidate reaching `min` contrast on `background`, else the highest-contrast one. */
function pickReadable(
  candidates: Array<Rgba | undefined>,
  background: Rgba,
  min: number
): Rgba | undefined {
  const defined = candidates.filter((c): c is Rgba => c !== undefined);
  return (
    defined.find((c) => contrastRatio(c, background) >= min) ??
    defined.sort((a, b) => contrastRatio(b, background) - contrastRatio(a, background))[0]
  );
}

/**
 * Map VS Code workbench colors onto the app CSS variables.
 *
 * Translucent colors are composited over the editor background, since the
 * variables are consumed as opaque `hsl(var(--x))`. Because VS Code keys don't
 * map 1:1 to how the app uses each variable, the result is checked for
 * contrast: the brand color must read on the background, text must read on its
 * surface, and surfaces must stand out from their base.
 */
export function mapColorsToCssVariables(
  colors: Record<string, string>,
  kind: ColorThemeKind
): Record<string, string> {
  const fallbackBackground =
    kind === "dark" ? { r: 30, g: 30, b: 30, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  const base = parseHexColor(colors["editor.background"] ?? "") ?? fallbackBackground;
  const read = (key: string): Rgba | undefined => {
    const parsed = colors[key] ? parseHexColor(colors[key]) : null;
    if (!parsed) return undefined;
    return parsed.a < 1 ? blend(parsed, base) : parsed;
  };

  const resolved: Record<string, Rgba> = {};
  for (const [variable, keys] of Object.entries(CSS_VARIABLE_SOURCES)) {
    for (const key of keys) {
      const color = read(key);
      if (color) {
        resolved[variable] = color;
        break;
      }
    }
  }

  const background = resolved["--background"] ?? base;
  const foreground =
    resolved["--foreground"] ??
    (kind === "dark" ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 });
  const onBase = (variable: string) => resolved[variable] ?? background;
  const tint = (alpha: number, on: Rgba) => blend({ ...foreground, a: alpha }, on);

  for (const [variable, alpha] of Object.entries(DERIVED_FROM_FOREGROUND)) {
    resolved[variable] ??= tint(alpha, background);
  }
  if (contrastRatio(resolved["--muted-foreground"], background) < MIN_UI_CONTRAST) {
    resolved["--muted-foreground"] = tint(
      DERIVED_FROM_FOREGROUND["--muted-foreground"],
      background
    );
  }

  for (const { variable, on, alpha } of SURFACES) {
    const surface = resolved[variable];
    if (!surface || contrastRatio(surface, onBase(on)) < MIN_SURFACE_CONTRAST) {
      resolved[variable] = tint(alpha, onBase(on));
    }
  }

  const brandCandidates = BRAND_SOURCES.map((key) => ({ key, color: read(key) })).filter(
    (candidate) => candidate.color
  );
  const pickBrand = (on: Rgba) => {
    const color = pickReadable(
      brandCandidates.map((c) => c.color),
      on,
      MIN_UI_CONTRAST
    );
    return color && brandCandidates.find((c) => c.color === color);
  };
  const brand = pickBrand(background);
  if (brand?.color) {
    resolved["--primary"] = brand.color;
    // The button's own text color is the best match when the button color won.
    const buttonForeground =
      brand.key === "button.background" ? read("button.foreground") : undefined;
    if (buttonForeground) resolved["--primary-foreground"] = buttonForeground;
    resolved["--ring"] ??= brand.color;
  }
  const sidebarBrand = pickBrand(onBase("--sidebar-background"));
  if (sidebarBrand?.color) {
    resolved["--sidebar-primary"] = sidebarBrand.color;
    resolved["--sidebar-ring"] ??= resolved["--ring"] ?? sidebarBrand.color;
  }

  for (const [surfaceVariable, textVariable] of TEXT_PAIRS) {
    const surface = resolved[surfaceVariable];
    if (!surface) continue;
    const min = textVariable === "--muted-foreground" ? MIN_UI_CONTRAST : MIN_TEXT_CONTRAST;
    const text = pickReadable([resolved[textVariable], foreground, background], surface, min);
    if (text) resolved[textVariable] = text;
  }

  return Object.fromEntries(
    Object.entries(resolved).map(([variable, color]) => [variable, toHslTriplet(color)])
  );
}
