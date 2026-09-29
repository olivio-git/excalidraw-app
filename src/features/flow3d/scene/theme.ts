import { useEffect, useState } from "react";
import { useThemeStore } from "@/stores/themeStore";

export interface SceneTheme {
  dark: boolean;
  background: string;
  card: string;
  /** Card color for 3D nodes (lit surfaces need a lighter tone in dark themes). */
  nodeCard: string;
  foreground: string;
  muted: string;
  border: string;
  primary: string;
  grid: string;
  gridSection: string;
}

/** `220 13% 16%` (a shadcn token) → `hsl(220, 13%, 16%)`. */
function token(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (raw.startsWith("#") || raw.startsWith("rgb") || raw.startsWith("hsl")) return raw;
  const parts = raw.split(/\s+/);
  return parts.length >= 3 ? `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})` : fallback;
}

/** Same token, `amount` lightness points brighter (hsl tokens only). */
function lighten(name: string, fallback: string, amount: number): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(/\s+/);
  if (parts.length < 3 || !parts[2].endsWith("%")) return fallback;
  const lightness = Math.min(95, parseFloat(parts[2]) + amount);
  return `hsl(${parts[0]}, ${parts[1]}, ${lightness}%)`;
}

function readTheme(dark: boolean): SceneTheme {
  return {
    dark,
    background: token("--background", dark ? "#1f232b" : "#ffffff"),
    card: token("--card", dark ? "#262b34" : "#ffffff"),
    nodeCard: dark ? lighten("--card", "#3a4150", 14) : token("--card", "#ffffff"),
    foreground: token("--foreground", dark ? "#f8fafc" : "#0f172a"),
    muted: token("--muted-foreground", "#64748b"),
    border: token("--border", dark ? "#343a46" : "#e2e8f0"),
    primary: token("--primary", "#6366f1"),
    grid: dark ? "#2d333d" : "#e5e7eb",
    gridSection: dark ? "#3b4250" : "#cbd5e1",
  };
}

/** Scene colors from the app's theme tokens; follows theme changes. */
export function useSceneTheme(): SceneTheme {
  const resolved = useThemeStore((s) => s.resolvedTheme);
  const [theme, setTheme] = useState(() => readTheme(resolved === "dark"));
  useEffect(() => {
    // Wait a frame so the new theme's CSS variables are applied.
    const id = requestAnimationFrame(() => setTheme(readTheme(resolved === "dark")));
    const observer = new MutationObserver(() => setTheme(readTheme(resolved === "dark")));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    return () => {
      cancelAnimationFrame(id);
      observer.disconnect();
    };
  }, [resolved]);
  return theme;
}
