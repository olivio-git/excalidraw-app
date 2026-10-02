import type { AppConfig, NativeEffect } from "./schema";
import { hexToHslToken, type KeymapBinding } from "./loader";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { KeybindingSource } from "@/core/keybindings/types";
import { useThemeStore } from "@/stores/themeStore";
import { useEditorPreferencesStore } from "@/stores/editorPreferencesStore";
import { setEditorKeymap } from "./vim-mode";

type Platform = "macos" | "windows" | "linux";

export function currentPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return "macos";
  if (/Windows/i.test(ua)) return "windows";
  return "linux";
}

const isTauri = () => "__TAURI_INTERNALS__" in window;

/**
 * Native window material for a config value on this platform, or null when
 * the platform has none (Linux: Tauri can't set compositor effects; use
 * "transparent" plus the compositor's blur, or "wallpaper").
 */
export function nativeEffectFor(effect: NativeEffect, platform: Platform): string | null {
  if (platform === "linux") return null;
  if (platform === "macos") {
    const mac: Partial<Record<NativeEffect, string>> = {
      auto: "underWindowBackground",
      sidebar: "sidebar",
      "under-window": "underWindowBackground",
      hud: "hudWindow",
    };
    return mac[effect] ?? "underWindowBackground";
  }
  const windows: Partial<Record<NativeEffect, string>> = {
    auto: "mica",
    mica: "mica",
    acrylic: "acrylic",
    blur: "blur",
  };
  return windows[effect] ?? "mica";
}

/** A theme installed with an extension, by name or key ("" or "none": the app's own). */
async function applyColorTheme(name: string): Promise<string | null> {
  const service = await import("@/plugins/vscode/color-theme-service");
  await service.ensureColorThemesInitialized();
  const { themes, activeKey } = service.getColorThemeState();
  const wanted = name.trim().toLowerCase();
  if (!wanted || wanted === "none") {
    if (activeKey) await service.setActiveColorTheme(null);
    return null;
  }
  const match =
    themes.find((t) => t.key.toLowerCase() === wanted) ??
    themes.find((t) => t.label.toLowerCase() === wanted) ??
    themes.find((t) => t.label.toLowerCase().includes(wanted));
  if (!match)
    return `appearance.color_theme: no hay ningún tema instalado llamado «${name}»${
      themes.length ? ` (instalados: ${themes.map((t) => t.label).join(", ")})` : ""
    }`;
  if (match.key !== activeKey) await service.setActiveColorTheme(match.key);
  return null;
}

let appliedEffect: string | null = null;

async function applyNativeEffect(effect: string | null): Promise<string | null> {
  if (!isTauri() || effect === appliedEffect) return null;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    if (effect) await window.setEffects({ effects: [effect as never] });
    else await window.clearEffects();
    appliedEffect = effect;
    return null;
  } catch (error) {
    return `El efecto de ventana «${effect}» no está disponible aquí: ${String(error)}`;
  }
}

let wallpaperUrl: string | null = null;
let wallpaperPath: string | null = null;

async function loadWallpaper(path: string): Promise<string | null> {
  if (path === wallpaperPath && wallpaperUrl) return wallpaperUrl;
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(path);
  const type = /\.png$/i.test(path)
    ? "image/png"
    : /\.webp$/i.test(path)
      ? "image/webp"
      : "image/jpeg";
  if (wallpaperUrl) URL.revokeObjectURL(wallpaperUrl);
  wallpaperUrl = URL.createObjectURL(new Blob([bytes], { type }));
  wallpaperPath = path;
  return wallpaperUrl;
}

const setVar = (name: string, value: string | null) => {
  const root = document.documentElement;
  if (value === null || value === "") root.style.removeProperty(name);
  else root.style.setProperty(name, value);
};

/**
 * Appearance from the config onto the page: CSS variables and data
 * attributes (styles/config.css reads them), the theme, and the native
 * window effect. Returns problems worth telling the user about.
 */
export async function applyAppearance(
  config: AppConfig,
  explicit: Set<string>,
  resolvePath: (path: string) => string
): Promise<string[]> {
  const problems: string[] = [];
  const a = config.appearance;
  const root = document.documentElement;

  if (explicit.has("appearance.theme") && useThemeStore.getState().theme !== a.theme)
    useThemeStore.getState().setTheme(a.theme);
  if (explicit.has("appearance.color_theme")) {
    const problem = await applyColorTheme(a.color_theme);
    if (problem) problems.push(problem);
  }

  // Typography, shape and density.
  setVar("--qori-font-sans", a.font_family ? `"${a.font_family}", var(--font-sans)` : null);
  setVar(
    "--qori-font-mono",
    a.mono_font_family ? `"${a.mono_font_family}", var(--font-mono)` : null
  );
  root.toggleAttribute("data-config-fonts", Boolean(a.font_family || a.mono_font_family));
  if (explicit.has("appearance.font_size")) root.style.fontSize = `${a.font_size}px`;
  setVar("--radius", explicit.has("appearance.radius") ? `${a.radius / 16}rem` : null);
  root.dataset.density = a.density;
  if (a.accent) {
    const token = hexToHslToken(a.accent);
    if (token) {
      setVar("--primary", token);
      setVar("--sidebar-primary", token);
      setVar("--ring", token);
    } else problems.push(`appearance.accent: usa un color hex (#7c3aed), no «${a.accent}»`);
  } else {
    setVar("--primary", null);
    setVar("--sidebar-primary", null);
    setVar("--ring", null);
  }

  // Editor text.
  const e = config.editor;
  if (explicit.has("editor.markdown")) {
    const choice =
      e.markdown === "source" ? "markdown" : e.markdown === "code" ? "code" : "classic";
    if (useEditorPreferencesStore.getState().markdownEditor !== choice)
      useEditorPreferencesStore.getState().setMarkdownEditor(choice);
  }
  setVar("--qori-content-width", e.content_width === "readable" ? "46rem" : null);
  await setEditorKeymap(e.keymap);
  const { setEditorFeatures } = await import("@/features/code-editor/editor-features");
  setEditorFeatures({ minimap: e.minimap, indentGuides: e.indent_guides });
  setVar("--qori-editor-font", e.font_family ? `"${e.font_family}", var(--font-mono)` : null);
  setVar("--qori-editor-size", e.font_size ? `${e.font_size}px` : null);
  setVar("--qori-editor-line-height", e.line_height ? String(e.line_height) : null);
  root.toggleAttribute(
    "data-config-editor",
    Boolean(e.font_family || e.font_size || e.line_height)
  );

  // Translucency.
  const mode = a.translucency;
  root.dataset.translucency = mode;
  root.classList.toggle("qori-translucent", mode !== "none");
  setVar("--qori-opacity", String(a.opacity));
  setVar("--qori-sidebar-opacity", String(a.sidebar_opacity));
  setVar("--qori-blur", `${a.blur}px`);
  setVar("--qori-wallpaper-dim", String(a.wallpaper_dim));

  const platform = currentPlatform();
  const effect = mode === "native" ? nativeEffectFor(a.native_effect, platform) : null;
  if (mode === "native" && !effect)
    problems.push(
      'appearance.translucency = "native" no existe en Linux: usa "transparent" (desenfoque del compositor) o "wallpaper"'
    );
  const effectProblem = await applyNativeEffect(effect);
  if (effectProblem) problems.push(effectProblem);

  if (mode === "wallpaper") {
    if (!a.wallpaper) {
      problems.push('appearance.wallpaper: indica una imagen para translucency = "wallpaper"');
      setVar("--qori-wallpaper", null);
    } else {
      try {
        const url = await loadWallpaper(resolvePath(a.wallpaper));
        setVar("--qori-wallpaper", url ? `url("${url}")` : null);
      } catch (error) {
        problems.push(`No se pudo leer el fondo «${a.wallpaper}»: ${String(error)}`);
        setVar("--qori-wallpaper", null);
      }
    }
  } else setVar("--qori-wallpaper", null);

  // Flow 3D effects follow the file when it says so.
  if (explicit.has("flow3d.effects")) {
    try {
      localStorage.setItem("flow3d.effects", config.flow3d.effects ? "on" : "off");
    } catch {
      // Private mode: the flow editor keeps its own default.
    }
  }
  return problems;
}

let fileBindings: KeymapBinding[] = [];

/** keymap.toml bindings replace the previous ones and win over the app's. */
export function applyKeymap(binds: KeymapBinding[]): string[] {
  const problems: string[] = [];
  for (const bind of fileBindings) {
    try {
      const chord = keyNormalizer.normalizeChord(bind.key);
      keybindingRegistry.removeUserOverride(chord[0], bind.command);
    } catch {
      // Was never registered.
    }
  }
  fileBindings = [];
  for (const bind of binds) {
    try {
      const chord = keyNormalizer.normalizeChord(bind.key);
      keybindingRegistry.registerOverride({
        commandId: bind.command,
        chord,
        when: bind.when,
        source: KeybindingSource.User,
      });
      fileBindings.push(bind);
    } catch (error) {
      problems.push(`keymap: «${bind.key}» no es una combinación válida (${String(error)})`);
    }
  }
  return problems;
}

/** styles.css, loaded after the theme so it can override anything. */
export function applyUserStyles(css: string): void {
  let style = document.getElementById("qori-user-styles") as HTMLStyleElement | null;
  if (!css.trim()) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = "qori-user-styles";
  }
  // Always last in <head>: wins over the app's stylesheets.
  document.head.appendChild(style);
  style.textContent = css;
}
