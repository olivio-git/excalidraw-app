import { appDataDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { parseJsonc } from "./jsonc";
import { getConfigurationDefaults } from "./contribution-service";

/**
 * User settings for extensions (`workspace.getConfiguration()`), stored like
 * VS Code's `settings.json`: a flat JSON(C) object keyed by setting id
 * (`"powershell.codeFormatting.preset": "OTBS"`). Missing keys fall back to
 * the defaults declared in each extension's `contributes.configuration`.
 */

const SETTINGS_FILE = "extensions/settings.json";
const opts = () => ({ baseDir: BaseDirectory.AppData });

type Listener = (settings: Record<string, unknown>) => void;
const listeners = new Set<Listener>();
let cached: Record<string, unknown> | null = null;

export async function extensionSettingsPath(): Promise<string> {
  return join(await appDataDir(), SETTINGS_FILE);
}

export async function ensureExtensionSettingsFile(): Promise<void> {
  if (await exists(SETTINGS_FILE, opts())) return;
  await mkdir("extensions", { ...opts(), recursive: true });
  await writeTextFile(
    SETTINGS_FILE,
    "{\n  // Configuración de extensiones, igual que settings.json de VS Code.\n}\n",
    opts()
  );
}

/** User-set values only. */
export async function readUserExtensionSettings(): Promise<Record<string, unknown>> {
  if (cached) return cached;
  try {
    if (!(await exists(SETTINGS_FILE, opts()))) return (cached = {});
    const parsed = parseJsonc<unknown>(await readTextFile(SETTINGS_FILE, opts()));
    cached =
      typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch (error) {
    console.warn("[extension-settings] Invalid settings.json", error);
    cached = {};
  }
  return cached;
}

/** Defaults overlaid with user values. */
export async function readExtensionSettings(): Promise<Record<string, unknown>> {
  return { ...getConfigurationDefaults(), ...(await readUserExtensionSettings()) };
}

export async function updateUserExtensionSetting(key: string, value: unknown): Promise<void> {
  const current = { ...(await readUserExtensionSettings()) };
  if (value === undefined) delete current[key];
  else current[key] = value;
  await mkdir("extensions", { ...opts(), recursive: true });
  await writeTextFile(SETTINGS_FILE, `${JSON.stringify(current, null, 2)}\n`, opts());
  cached = current;
  listeners.forEach((listener) => listener(current));
}

/** Re-read the file (after it was edited in the code editor). */
export async function reloadExtensionSettings(): Promise<void> {
  cached = null;
  const settings = await readUserExtensionSettings();
  listeners.forEach((listener) => listener(settings));
}

export function isExtensionSettingsFile(filePath: string): boolean {
  return filePath.replaceAll("\\", "/").endsWith(`/${SETTINGS_FILE}`);
}

export function onExtensionSettingsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
