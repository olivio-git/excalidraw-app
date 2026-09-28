import type { ITheme } from "@xterm/xterm";

/**
 * xterm.js colors: the active VS Code color theme's `terminal.*` colors when
 * present, otherwise the app's CSS variables plus VS Code's default ANSI
 * palettes for light and dark.
 */

const ANSI_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

type AnsiKey = (typeof ANSI_KEYS)[number];

const DARK_ANSI: Record<AnsiKey, string> = {
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

const LIGHT_ANSI: Record<AnsiKey, string> = {
  black: "#000000",
  red: "#cd3131",
  green: "#00bc00",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

/** `H S% L%` (the app's CSS variable format) → `#rrggbb`. */
export function hslTripletToHex(triplet: string): string | null {
  const match = /^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/.exec(triplet);
  if (!match) return null;
  const h = Number(match[1]) / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r = l;
  let g = l;
  let b = l;
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const hex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function buildXtermTheme(
  cssVar: (name: string) => string,
  isDark: boolean,
  themeColors: Record<string, string>
): ITheme {
  const fromVar = (name: string) => hslTripletToHex(cssVar(name));
  const background =
    themeColors["terminal.background"] ??
    themeColors["panel.background"] ??
    fromVar("--background") ??
    (isDark ? "#1e1e1e" : "#ffffff");
  const foreground =
    themeColors["terminal.foreground"] ??
    fromVar("--foreground") ??
    (isDark ? "#cccccc" : "#333333");

  const palette = isDark ? DARK_ANSI : LIGHT_ANSI;
  const ansi = Object.fromEntries(
    ANSI_KEYS.map((key) => [key, themeColors[`terminal.ansi${capitalize(key)}`] ?? palette[key]])
  ) as Record<AnsiKey, string>;

  return {
    background,
    foreground,
    cursor: themeColors["terminalCursor.foreground"] ?? foreground,
    cursorAccent: themeColors["terminalCursor.background"] ?? background,
    selectionBackground:
      themeColors["terminal.selectionBackground"] ?? (isDark ? "#264f7880" : "#add6ff80"),
    ...ansi,
  };
}

/** Theme for the current document state. */
export function currentXtermTheme(themeColors: Record<string, string>): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const isDark = document.documentElement.classList.contains("dark");
  return buildXtermTheme((name) => styles.getPropertyValue(name), isDark, themeColors);
}

export function currentMonoFont(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  return value || 'ui-monospace, "Cascadia Code", "Fira Code", Menlo, Consolas, monospace';
}
