import { homeDir } from "@tauri-apps/api/path";

let cachedHomeDir: string | null = null;

export async function getHomeDir(): Promise<string> {
  if (cachedHomeDir === null) {
    cachedHomeDir = await homeDir();
  }
  return cachedHomeDir;
}

export function tildify(path: string, home: string): string {
  const normalized = home.endsWith("/") ? home : `${home}/`;
  if (path === home) return "~";
  if (path.startsWith(normalized)) return `~/${path.slice(normalized.length)}`;
  return path;
}

export function toRelativePath(absolutePath: string, workspaceDir: string): string {
  return absolutePath.replace(`${workspaceDir}/`, "");
}
