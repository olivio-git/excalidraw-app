import { readTextFile, writeTextFile, remove, readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

export async function readDocumentFile(filePath: string): Promise<string> {
  return readTextFile(filePath);
}

export async function writeDocumentFile(filePath: string, content: string): Promise<void> {
  await writeTextFile(filePath, content);
}

export async function deleteDocumentFile(filePath: string): Promise<void> {
  await remove(filePath, { recursive: false });
}

export async function listDocumentFiles(dir: string): Promise<string[]> {
  const result: string[] = [];

  async function walkDir(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readDir(currentDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.name) continue;
      const fullPath = await join(currentDir, entry.name);
      if (entry.isDirectory) {
        await walkDir(fullPath);
      } else if (entry.isFile && (entry.name.endsWith(".md") || entry.name.endsWith(".note"))) {
        result.push(fullPath);
      }
    }
  }

  await walkDir(dir);
  return result;
}

export const documentFileService = {
  readDocumentFile,
  writeDocumentFile,
  deleteDocumentFile,
  listDocumentFiles,
};
