import { fetch } from "@tauri-apps/plugin-http";
import type { ExcalidrawLibraryEntry } from "./types";

const LIBRARIES_CDN = "https://libraries.excalidraw.com";
const LIBRARIES_BASE_URL = `${LIBRARIES_CDN}/libraries`;
const LIBRARIES_URL = `${LIBRARIES_CDN}/libraries.json`;

let cache: ExcalidrawLibraryEntry[] | null = null;

function resolveUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${LIBRARIES_BASE_URL}/${path}`;
}

export async function fetchLibraries(): Promise<ExcalidrawLibraryEntry[]> {
  if (cache !== null) return cache;
  const res = await fetch(LIBRARIES_URL);
  if (!res.ok) throw new Error(`Failed to fetch libraries: ${res.status}`);
  const data = await res.json();
  cache = (data as ExcalidrawLibraryEntry[]).map((lib) => ({
    ...lib,
    source: resolveUrl(lib.source),
    preview: resolveUrl(lib.preview),
  }));
  return cache;
}

export function clearLibrariesCache(): void {
  cache = null;
}

// Invalidate cache on module reload (Vite HMR)
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    cache = null;
  });
}
