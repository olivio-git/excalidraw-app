import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { DIAGRAM_EXTENSION, IMAGE_EXTENSION, NOTE_EXTENSION } from "./paths";

/** Files the editor can link or embed, for `[[` and `/` completions. */

const MAX_FILES = 3000;
const MAX_DIRECTORIES = 2000;
const CACHE_MS = 15_000;
const SKIPPED = new Set(["node_modules", "target", "dist"]);

let cache: { root: string; at: number; files: Promise<string[]> } | null = null;

async function scan(root: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  let directories = 0;
  while (queue.length && files.length < MAX_FILES && directories++ < MAX_DIRECTORIES) {
    const directory = queue.shift()!;
    let entries;
    try {
      entries = await readDir(directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymlink || SKIPPED.has(entry.name)) continue;
      const path = await join(directory, entry.name);
      if (entry.isDirectory) queue.push(path);
      else if (
        NOTE_EXTENSION.test(entry.name) ||
        DIAGRAM_EXTENSION.test(entry.name) ||
        IMAGE_EXTENSION.test(entry.name)
      ) {
        files.push(path);
      }
    }
  }
  return files;
}

export function listWorkspaceFiles(root: string | null): Promise<string[]> {
  if (!root) return Promise.resolve([]);
  if (!cache || cache.root !== root || Date.now() - cache.at > CACHE_MS) {
    cache = { root, at: Date.now(), files: scan(root) };
  }
  return cache.files;
}

export function invalidateWorkspaceFiles(): void {
  cache = null;
}
