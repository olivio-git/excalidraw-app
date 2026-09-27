import { useSyncExternalStore } from "react";
import { useThemeStore } from "@/stores/themeStore";
import { readExtensionJson, type InstalledExtension } from "./extension-storage";
import {
  extensionSettings as settings,
  loadInstalledExtensions,
  onInstalledExtensionsChanged,
} from "./extension-registry";
import {
  kindFromUiTheme,
  loadColorThemeColors,
  mapColorsToCssVariables,
  type ColorThemeDocument,
} from "./color-theme";
import type { ColorThemeContribution } from "./vsix";
import { normalizeRelativePath } from "./paths";

/**
 * Applies the active VS Code color theme by overriding the app's CSS variables
 * inline on <html>, and switches the app to the theme's light/dark mode.
 */

export interface ColorThemeOption {
  /** `<extension id>/<theme id or label>` */
  key: string;
  label: string;
  extension: InstalledExtension;
  contribution: ColorThemeContribution;
}

export interface ColorThemeState {
  ready: boolean;
  themes: ColorThemeOption[];
  activeKey: string | null;
}

const ACTIVE_THEME_KEY = "activeColorTheme";

const listeners = new Set<() => void>();
let state: ColorThemeState = { ready: false, themes: [], activeKey: null };
let appliedVariables: string[] = [];
let initPromise: Promise<void> | null = null;
/** Invalidates in-flight loads when another theme is selected. */
let generation = 0;

function emit(): void {
  state = { ...state };
  listeners.forEach((listener) => listener());
}

function contributionId(contribution: ColorThemeContribution): string {
  return contribution.id ?? contribution.label ?? contribution.path;
}

export function colorThemeKey(
  extension: InstalledExtension,
  contribution: ColorThemeContribution
): string {
  return `${extension.id}/${contributionId(contribution)}`;
}

function toOptions(extensions: InstalledExtension[]): ColorThemeOption[] {
  return extensions.flatMap((extension) =>
    extension.colorThemes.map((contribution) => ({
      key: colorThemeKey(extension, contribution),
      label: contribution.label ?? contributionId(contribution),
      extension,
      contribution,
    }))
  );
}

function clearVariables(): void {
  const root = document.documentElement;
  for (const variable of appliedVariables) root.style.removeProperty(variable);
  appliedVariables = [];
}

function applyVariables(variables: Record<string, string>): void {
  clearVariables();
  const root = document.documentElement;
  for (const [variable, value] of Object.entries(variables)) {
    root.style.setProperty(variable, value);
  }
  appliedVariables = Object.keys(variables);
}

/** Load and apply a theme. Returns the key actually applied (null if none). */
async function applyTheme(key: string | null): Promise<string | null> {
  const requestGeneration = ++generation;
  const option = key ? state.themes.find((theme) => theme.key === key) : undefined;
  const themePath = option && normalizeRelativePath(option.contribution.path);
  if (!option || !themePath) {
    clearVariables();
    return null;
  }

  try {
    const colors = await loadColorThemeColors(
      (path) => readExtensionJson<ColorThemeDocument>(option.extension, path),
      themePath
    );
    if (requestGeneration !== generation) return state.activeKey;

    const kind = kindFromUiTheme(option.contribution.uiTheme);
    if (useThemeStore.getState().resolvedTheme !== kind) {
      useThemeStore.getState().setTheme(kind);
    }
    applyVariables(mapColorsToCssVariables(colors, kind));
    return option.key;
  } catch (error) {
    console.error(`[color-theme] Failed to load ${key}`, error);
    if (requestGeneration === generation) clearVariables();
    return null;
  }
}

async function handleExtensionsChanged(extensions: InstalledExtension[]): Promise<void> {
  state = { ...state, themes: toOptions(extensions) };
  if (state.activeKey && !state.themes.some((theme) => theme.key === state.activeKey)) {
    await setActiveColorTheme(null);
  } else {
    emit();
  }
}

async function initialize(): Promise<void> {
  onInstalledExtensionsChanged(handleExtensionsChanged);
  try {
    state = { ...state, themes: toOptions(await loadInstalledExtensions()) };
    const activeKey = await settings.getItem(ACTIVE_THEME_KEY);
    state = { ...state, activeKey: await applyTheme(activeKey) };
  } catch (error) {
    console.error("[color-theme] Failed to initialize", error);
  }
  state = { ...state, ready: true };
  emit();
}

/** Restore the saved color theme. Call once at startup. */
export function ensureColorThemesInitialized(): Promise<void> {
  initPromise ??= initialize();
  return initPromise;
}

export async function setActiveColorTheme(key: string | null): Promise<void> {
  await ensureColorThemesInitialized();
  const activeKey = await applyTheme(key);
  if (activeKey) await settings.setItem(ACTIVE_THEME_KEY, activeKey);
  else await settings.removeItem(ACTIVE_THEME_KEY);
  state = { ...state, activeKey };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void ensureColorThemesInitialized();
  return () => listeners.delete(listener);
}

export function useColorThemeState(): ColorThemeState {
  return useSyncExternalStore(subscribe, () => state);
}
