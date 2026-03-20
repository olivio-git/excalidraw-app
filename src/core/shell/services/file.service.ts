import { stat, copyFile, mkdir, readDir } from "@tauri-apps/plugin-fs";
import { join, basename, dirname } from "@tauri-apps/api/path";

// ---------------------------------------------------------------------------
// FileStat — normalized file metadata
// mtime is always a Unix millisecond timestamp or null (never a Date object)
// ---------------------------------------------------------------------------

export interface FileStat {
  path: string;
  name: string;
  isFile: boolean;
  isDir: boolean;
  size: number;
  mtime: number | null;
}

// ---------------------------------------------------------------------------
// getFileStat — stat a single path and return a normalized FileStat
// Mirrors the mtime normalization in FileTreeNode.tsx handleMouseEnter
// ---------------------------------------------------------------------------

export async function getFileStat(path: string): Promise<FileStat> {
  const info = await stat(path);
  const name = await basename(path);

  // Tauri v2 plugin-fs stat returns mtime as Date | null
  const mtime =
    info.mtime instanceof Date
      ? info.mtime.getTime()
      : typeof info.mtime === "number"
        ? info.mtime
        : null;

  return {
    path,
    name,
    isFile: info.isFile,
    isDir: info.isDirectory,
    size: info.size ?? 0,
    mtime,
  };
}

// ---------------------------------------------------------------------------
// copyPath — copy a file or directory recursively to destPath
// Throws Error("EXISTS") if dest already exists and overwrite is false
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDirRecursive(src: string, dest: string, overwrite: boolean): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readDir(src);
  for (const entry of entries) {
    if (!entry.name) continue;
    const srcChild = await join(src, entry.name);
    const destChild = await join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDirRecursive(srcChild, destChild, overwrite);
    } else {
      if (!overwrite && (await pathExists(destChild))) {
        throw new Error("EXISTS");
      }
      await copyFile(srcChild, destChild);
    }
  }
}

export async function copyPath(src: string, dest: string, overwrite = false): Promise<void> {
  const srcInfo = await stat(src);

  if (srcInfo.isDirectory) {
    if (!overwrite && (await pathExists(dest))) {
      throw new Error("EXISTS");
    }
    await copyDirRecursive(src, dest, overwrite);
  } else {
    if (!overwrite && (await pathExists(dest))) {
      throw new Error("EXISTS");
    }
    // Ensure parent directory exists
    const destDir = await dirname(dest);
    await mkdir(destDir, { recursive: true });
    await copyFile(src, dest);
  }
}
