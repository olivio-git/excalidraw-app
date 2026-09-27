import { copyFile, exists, lstat, mkdir, readDir, remove } from "@tauri-apps/plugin-fs";
import { basename, join } from "@tauri-apps/api/path";

/** Compare complete path segments, including Windows paths returned by the native picker. */
export function isSameOrDescendant(path: string, ancestor: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");
  const parent = ancestor.replaceAll("\\", "/").replace(/\/$/, "");
  return normalized === parent || normalized.startsWith(`${parent}/`);
}

/** A selected parent already includes its descendants for recursive operations. */
export function topLevelPaths(paths: string[]): string[] {
  const unique = [...new Set(paths)];
  return unique.filter(
    (path) => !unique.some((other) => other !== path && isSameOrDescendant(path, other))
  );
}

export function isValidEntryName(name: string): boolean {
  return (
    !!name.trim() &&
    name !== "." &&
    name !== ".." &&
    !/[<>:"/\\|?*]/.test(name) &&
    ![...name].some((char) => char.charCodeAt(0) < 32) &&
    !/[. ]$/.test(name) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
  );
}

export async function availableDestination(
  source: string,
  directory: string,
  isDirectory: boolean
): Promise<string> {
  const name = await basename(source);
  const dot = isDirectory ? -1 : name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let destination = await join(directory, name);
  let index = 1;
  while (await exists(destination)) {
    destination = await join(
      directory,
      `${stem} copy${index === 1 ? "" : ` ${index}`}${extension}`
    );
    index++;
  }
  return destination;
}

/** Copy directories without following symlinks or leaving a partial directory after failure. */
export async function copyEntry(source: string, destination: string): Promise<void> {
  const info = await lstat(source);
  if (info.isSymlink) throw new Error("Symbolic links cannot be copied.");
  if (!info.isDirectory) {
    await copyFile(source, destination);
    return;
  }
  await mkdir(destination);
  try {
    for (const entry of await readDir(source)) {
      await copyEntry(await join(source, entry.name), await join(destination, entry.name));
    }
  } catch (error) {
    await remove(destination, { recursive: true }).catch(() => undefined);
    throw error;
  }
}
