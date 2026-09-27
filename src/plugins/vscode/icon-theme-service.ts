import { useSyncExternalStore } from "react";
import { createTauriStorage } from "@/core/storage/tauri-storage";
import { useThemeStore } from "@/stores/themeStore";
import {
  installVsix as installVsixToDisk,
  listInstalledExtensions,
  readExtensionFile,
  readExtensionJson,
  uninstallExtension as uninstallFromDisk,
  type InstalledExtension,
} from "./extension-storage";
import {
  normalizeIconTheme,
  resolveFileIconId,
  resolveFolderIconId,
  resolveIconFilePath,
  type IconThemeDocument,
  type IconThemeVariant,
} from "./icon-theme";
import { normalizeRelativePath } from "./paths";

/**
 * Runtime state for VS Code file icon themes.
 *
 * The theme JSON is kept in memory once activated; icon images are read from
 * disk lazily, the first time a file/folder needs them, and cached as blob URLs.
 * Callers get `null` until the image is ready and are re-rendered through
 * `useIconThemeState()` when it arrives.
 */

export interface IconThemeOption {
  /** `<extension id>/<icon theme id>` */
  key: string;
  label: string;
  extension: InstalledExtension;
}

export interface IconThemeState {
  /** Bumped on every change (theme switch, icons loaded, light/dark switch). */
  version: number;
  ready: boolean;
  extensions: InstalledExtension[];
  themes: IconThemeOption[];
  activeKey: string | null;
}

interface ActiveTheme {
  key: string;
  extension: InstalledExtension;
  themePath: string;
  doc: IconThemeDocument;
}

const ACTIVE_THEME_KEY = "activeIconTheme";
const LEGACY_LOCAL_STORAGE_KEYS = ["qori.vsix-icon-themes", "qori.vsix-icon-theme-active"];

const settings = createTauriStorage("extensions-storage.json");
const listeners = new Set<() => void>();

let state: IconThemeState = {
  version: 0,
  ready: false,
  extensions: [],
  themes: [],
  activeKey: null,
};
let active: ActiveTheme | null = null;
let variant: IconThemeVariant = "dark";
let initPromise: Promise<void> | null = null;
/** Invalidates in-flight icon loads when the active theme changes. */
let generation = 0;
const iconUrls = new Map<string, string | null>();
const pendingIcons = new Set<string>();
let notifyScheduled = false;

function emit(): void {
  state = { ...state, version: state.version + 1 };
  listeners.forEach((listener) => listener());
}

/** Coalesce bursts of icon loads into a single re-render. */
function scheduleEmit(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  setTimeout(() => {
    notifyScheduled = false;
    emit();
  }, 0);
}

function themeKey(extension: InstalledExtension, themeId: string): string {
  return `${extension.id}/${themeId}`;
}

function toOptions(extensions: InstalledExtension[]): IconThemeOption[] {
  return extensions.flatMap((extension) =>
    extension.iconThemes.map((theme) => ({
      key: themeKey(extension, theme.id),
      label: theme.label ?? theme.id,
      extension,
    }))
  );
}

function clearIconCache(): void {
  generation++;
  for (const url of iconUrls.values()) if (url) URL.revokeObjectURL(url);
  iconUrls.clear();
  pendingIcons.clear();
}

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "svg") return "image/svg+xml";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return `image/${ext ?? "png"}`;
}

async function loadTheme(key: string | null): Promise<void> {
  clearIconCache();
  active = null;
  if (!key) return;

  const option = toOptions(state.extensions).find((theme) => theme.key === key);
  if (!option) return;
  const contribution = option.extension.iconThemes.find(
    (theme) => themeKey(option.extension, theme.id) === key
  );
  const themePath = contribution && normalizeRelativePath(contribution.path);
  if (!themePath) return;

  const requestGeneration = generation;
  try {
    const doc = await readExtensionJson<IconThemeDocument>(option.extension, themePath);
    // A newer theme switch started while this one was loading.
    if (requestGeneration !== generation) return;
    active = { key, extension: option.extension, themePath, doc: normalizeIconTheme(doc) };
  } catch (error) {
    console.error(`[icon-theme] Failed to load ${key}`, error);
  }
}

async function refreshExtensions(): Promise<void> {
  const extensions = await listInstalledExtensions();
  state = { ...state, extensions, themes: toOptions(extensions) };
}

async function initialize(): Promise<void> {
  try {
    for (const key of LEGACY_LOCAL_STORAGE_KEYS) localStorage.removeItem(key);
  } catch {
    // localStorage unavailable — nothing to clean up
  }

  variant = useThemeStore.getState().resolvedTheme;
  useThemeStore.subscribe((store) => {
    if (store.resolvedTheme !== variant) {
      variant = store.resolvedTheme;
      emit();
    }
  });

  try {
    await refreshExtensions();
    const activeKey = await settings.getItem(ACTIVE_THEME_KEY);
    await loadTheme(activeKey);
    state = { ...state, activeKey: active?.key ?? null };
  } catch (error) {
    console.error("[icon-theme] Failed to initialize", error);
  }
  state = { ...state, ready: true };
  emit();
}

export function ensureIconThemesInitialized(): Promise<void> {
  initPromise ??= initialize();
  return initPromise;
}

function loadIcon(path: string): void {
  if (!active || pendingIcons.has(path)) return;
  pendingIcons.add(path);
  const requestGeneration = generation;
  const extension = active.extension;

  readExtensionFile(extension, path)
    .then((bytes) => {
      if (requestGeneration !== generation) return;
      const blob = new Blob([bytes as BlobPart], { type: mimeFor(path) });
      iconUrls.set(path, URL.createObjectURL(blob));
    })
    .catch((error) => {
      if (requestGeneration !== generation) return;
      console.warn(`[icon-theme] Missing icon ${path}`, error);
      iconUrls.set(path, null);
    })
    .finally(() => {
      if (requestGeneration !== generation) return;
      pendingIcons.delete(path);
      scheduleEmit();
    });
}

function urlForDefinition(definitionId: string | undefined): string | null {
  if (!active || !definitionId) return null;
  const path = resolveIconFilePath(active.doc, active.themePath, definitionId);
  if (!path) return null;
  const cached = iconUrls.get(path);
  if (cached !== undefined) return cached;
  loadIcon(path);
  return null;
}

/** Icon URL for a file from the active theme, or null to use the built-in icon. */
export function getFileIconUrl(filename: string): string | null {
  if (!active) return null;
  return urlForDefinition(resolveFileIconId(active.doc, filename, variant));
}

/** Icon URL for a folder from the active theme, or null to use the built-in icon. */
export function getFolderIconUrl(folderName: string, expanded: boolean): string | null {
  if (!active) return null;
  return urlForDefinition(resolveFolderIconId(active.doc, folderName, expanded, variant));
}

export async function setActiveIconTheme(key: string | null): Promise<void> {
  await ensureIconThemesInitialized();
  await loadTheme(key);
  const activeKey = active?.key ?? null;
  if (activeKey) await settings.setItem(ACTIVE_THEME_KEY, activeKey);
  else await settings.removeItem(ACTIVE_THEME_KEY);
  state = { ...state, activeKey };
  emit();
}

/** Install a `.vsix` and activate its first icon theme. */
export async function installVsixExtension(bytes: Uint8Array): Promise<InstalledExtension> {
  await ensureIconThemesInitialized();
  const extension = await installVsixToDisk(bytes);
  await refreshExtensions();
  await setActiveIconTheme(themeKey(extension, extension.iconThemes[0].id));
  return extension;
}

export async function uninstallVsixExtension(id: string): Promise<void> {
  await ensureIconThemesInitialized();
  const wasActive = active?.extension.id === id;
  await uninstallFromDisk(id);
  await refreshExtensions();
  if (wasActive) await setActiveIconTheme(null);
  else emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void ensureIconThemesInitialized();
  return () => listeners.delete(listener);
}

/** Re-render when the icon theme changes or lazily-loaded icons become available. */
export function useIconThemeState(): IconThemeState {
  return useSyncExternalStore(subscribe, () => state);
}
