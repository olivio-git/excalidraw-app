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

/**
 * App CSS variable → VS Code color keys, most specific first.
 * The first key the theme defines wins; unmapped variables keep the app default.
 */
export const CSS_VARIABLE_SOURCES: Record<string, string[]> = {
  "--background": ["editor.background"],
  "--foreground": ["editor.foreground", "foreground"],
  "--card": ["editorWidget.background", "sideBar.background", "editor.background"],
  "--card-foreground": ["editorWidget.foreground", "foreground", "editor.foreground"],
  "--popover": ["menu.background", "dropdown.background", "editorWidget.background"],
  "--popover-foreground": ["menu.foreground", "dropdown.foreground", "foreground"],
  "--primary": ["button.background", "focusBorder"],
  "--primary-foreground": ["button.foreground"],
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
  "--sidebar-primary": ["activityBarBadge.background", "focusBorder"],
  "--sidebar-primary-foreground": ["activityBarBadge.foreground"],
  "--sidebar-accent": ["list.activeSelectionBackground", "list.hoverBackground"],
  "--sidebar-accent-foreground": ["list.activeSelectionForeground", "sideBar.foreground"],
  "--sidebar-border": ["contrastBorder", "sideBar.border", "sideBarSectionHeader.border"],
  "--sidebar-ring": ["focusBorder"],
};

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
 * Map VS Code workbench colors onto the app CSS variables.
 * Translucent colors are composited over the editor background, since the
 * variables are consumed as opaque `hsl(var(--x))`.
 */
export function mapColorsToCssVariables(
  colors: Record<string, string>,
  kind: ColorThemeKind
): Record<string, string> {
  const base =
    parseHexColor(colors["editor.background"] ?? "") ??
    (kind === "dark" ? { r: 30, g: 30, b: 30, a: 1 } : { r: 255, g: 255, b: 255, a: 1 });

  const result: Record<string, string> = {};
  for (const [variable, keys] of Object.entries(CSS_VARIABLE_SOURCES)) {
    for (const key of keys) {
      const parsed = colors[key] ? parseHexColor(colors[key]) : null;
      if (!parsed) continue;
      result[variable] = toHslTriplet(parsed.a < 1 ? blend(parsed, base) : parsed);
      break;
    }
  }

  const foreground = parseHexColor(colors["editor.foreground"] ?? colors.foreground ?? "");
  if (foreground) {
    for (const [variable, alpha] of Object.entries(DERIVED_FROM_FOREGROUND)) {
      result[variable] ??= toHslTriplet(blend({ ...foreground, a: alpha }, base));
    }
  }
  return result;
}
