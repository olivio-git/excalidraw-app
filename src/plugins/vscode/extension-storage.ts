import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { parseJsonc } from "./jsonc";
import { dirname } from "./paths";
import { readVsix, type ColorThemeContribution, type IconThemeContribution } from "./vsix";

/**
 * On-disk layout, mirroring VS Code's `~/.vscode/extensions`:
 *
 *   $APPDATA/extensions/extensions.json          ← index of installed extensions
 *   $APPDATA/extensions/<publisher.name>-<ver>/  ← unpacked `extension/` folder
 */
const EXTENSIONS_DIR = "extensions";
const INDEX_FILE = `${EXTENSIONS_DIR}/extensions.json`;

// Resolved lazily so importing this module never touches the fs plugin.
const opts = () => ({ baseDir: BaseDirectory.AppData });

export interface InstalledExtension {
  id: string;
  version: string;
  displayName: string;
  publisher?: string;
  description?: string;
  /** Folder name under `extensions/`. */
  dir: string;
  iconThemes: IconThemeContribution[];
  colorThemes: ColorThemeContribution[];
}

async function readIndex(): Promise<InstalledExtension[]> {
  try {
    if (!(await exists(INDEX_FILE, opts()))) return [];
    const parsed = JSON.parse(await readTextFile(INDEX_FILE, opts()));
    if (!Array.isArray(parsed)) return [];
    // Entries written before color theme support have no `colorThemes`.
    return (parsed as InstalledExtension[]).map((ext) => ({
      ...ext,
      iconThemes: ext.iconThemes ?? [],
      colorThemes: ext.colorThemes ?? [],
    }));
  } catch (error) {
    console.error("[extensions] Failed to read extensions index", error);
    return [];
  }
}

async function writeIndex(extensions: InstalledExtension[]): Promise<void> {
  await mkdir(EXTENSIONS_DIR, { ...opts(), recursive: true });
  await writeTextFile(INDEX_FILE, JSON.stringify(extensions, null, 2), opts());
}

async function removeDir(dir: string): Promise<void> {
  const path = `${EXTENSIONS_DIR}/${dir}`;
  if (await exists(path, opts())) {
    await remove(path, { ...opts(), recursive: true });
  }
}

export function listInstalledExtensions(): Promise<InstalledExtension[]> {
  return readIndex();
}

/**
 * Hidden files/folders (`.gitignore`, `.vscode/`, ...) are never needed by a
 * theme, and the fs scope glob (`$APPDATA/**`) does not match dot-prefixed
 * segments on Unix (`requireLiteralLeadingDot`), so writing them is rejected.
 */
export function isHiddenPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

/**
 * Unpack a `.vsix` into the extensions folder and register it.
 * Reinstalling the same extension replaces the previous version.
 */
export async function installVsix(bytes: Uint8Array): Promise<InstalledExtension> {
  const pkg = readVsix(bytes);
  const iconThemes = pkg.manifest.contributes?.iconThemes ?? [];
  const colorThemes = pkg.manifest.contributes?.themes ?? [];
  if (iconThemes.length === 0 && colorThemes.length === 0) {
    throw new Error(
      "La extensión no aporta ninguna contribución compatible (por ahora: themes e iconThemes)"
    );
  }

  const version = pkg.manifest.version ?? "0.0.0";
  const dir = `${pkg.id}-${version}`;
  const root = `${EXTENSIONS_DIR}/${dir}`;

  const files = Object.entries(pkg.files).filter(([path]) => !isHiddenPath(path));

  await removeDir(dir);
  try {
    const folders = new Set<string>([root]);
    for (const [path] of files) {
      const folder = dirname(path);
      if (folder) folders.add(`${root}/${folder}`);
    }
    for (const folder of [...folders].sort()) {
      await mkdir(folder, { ...opts(), recursive: true });
    }
    await Promise.all(files.map(([path, data]) => writeFile(`${root}/${path}`, data, opts())));
  } catch (error) {
    await removeDir(dir).catch(() => undefined);
    throw error;
  }

  const installed: InstalledExtension = {
    id: pkg.id,
    version,
    displayName: pkg.manifest.displayName ?? pkg.manifest.name,
    publisher: pkg.manifest.publisher,
    description: pkg.manifest.description,
    dir,
    iconThemes,
    colorThemes,
  };

  const previous = await readIndex();
  for (const old of previous) {
    if (old.id === installed.id && old.dir !== dir) {
      await removeDir(old.dir).catch((error) =>
        console.warn(`[extensions] Could not remove ${old.dir}`, error)
      );
    }
  }
  await writeIndex([...previous.filter((ext) => ext.id !== installed.id), installed]);
  return installed;
}

export async function uninstallExtension(id: string): Promise<void> {
  const extensions = await readIndex();
  const target = extensions.find((ext) => ext.id === id);
  if (!target) return;
  await removeDir(target.dir);
  await writeIndex(extensions.filter((ext) => ext.id !== id));
}

/** Read a file of an installed extension (`path` relative to the extension root). */
export function readExtensionFile(ext: InstalledExtension, path: string): Promise<Uint8Array> {
  return readFile(`${EXTENSIONS_DIR}/${ext.dir}/${path}`, opts());
}

export async function readExtensionJson<T>(ext: InstalledExtension, path: string): Promise<T> {
  const text = await readTextFile(`${EXTENSIONS_DIR}/${ext.dir}/${path}`, opts());
  return parseJsonc<T>(text);
}
