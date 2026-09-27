import { createTauriStorage } from "@/core/storage/tauri-storage";
import { listInstalledExtensions, type InstalledExtension } from "./extension-storage";

/**
 * In-memory list of installed VS Code extensions, shared by the icon theme and
 * color theme services so the index on disk is read once and kept in sync.
 */

/** Settings for extension features (active icon theme, active color theme). */
export const extensionSettings = createTauriStorage("extensions-storage.json");

let extensions: InstalledExtension[] = [];
let loadPromise: Promise<InstalledExtension[]> | null = null;
type Listener = (extensions: InstalledExtension[]) => void | Promise<void>;
const listeners = new Set<Listener>();

/** Load the extension index once; later calls reuse the first read. */
export function loadInstalledExtensions(): Promise<InstalledExtension[]> {
  loadPromise ??= listInstalledExtensions().then((list) => {
    extensions = list;
    return list;
  });
  return loadPromise;
}

/** Re-read the index (after install/uninstall) and notify subscribers. */
export async function reloadInstalledExtensions(): Promise<InstalledExtension[]> {
  extensions = await listInstalledExtensions();
  loadPromise = Promise.resolve(extensions);
  await Promise.all([...listeners].map((listener) => listener(extensions)));
  return extensions;
}

export function onInstalledExtensionsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
