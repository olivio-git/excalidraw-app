import { unzipSync, strFromU8 } from "fflate";

export interface VsixIconTheme {
  id: string;
  name: string;
  publisher?: string;
  version?: string;
  iconDefinitions: Record<string, { iconPath?: string; fontCharacter?: string }>;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
  folder?: string;
  folderExpanded?: string;
  files: Record<string, string>;
}

const STORAGE_KEY = "qori.vsix-icon-themes";
const ACTIVE_KEY = "qori.vsix-icon-theme-active";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, Math.min(index + chunkSize, bytes.length))
    );
  }
  return btoa(binary);
}

function readInstalled(): VsixIconTheme[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as VsixIconTheme[];
  } catch {
    return [];
  }
}

export function listVsixIconThemes(): VsixIconTheme[] {
  return readInstalled();
}

export function getActiveVsixIconThemeId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveVsixIconTheme(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
  window.dispatchEvent(new Event("qori-vsix-themes-changed"));
}

export function installVsixIconTheme(bytes: Uint8Array): VsixIconTheme[] {
  const archive = unzipSync(bytes);
  const packageEntry = Object.keys(archive).find(
    (path) => path.endsWith("/extension/package.json") || path === "extension/package.json"
  );
  if (!packageEntry) throw new Error("El VSIX no contiene extension/package.json");
  const root = packageEntry.slice(0, -"package.json".length);
  const manifest = JSON.parse(strFromU8(archive[packageEntry])) as {
    name: string;
    publisher?: string;
    version?: string;
    contributes?: { iconThemes?: Array<{ id: string; label?: string; path: string }> };
  };
  const declaration = manifest.contributes?.iconThemes?.[0];
  if (!declaration) throw new Error("Esta extensión no contiene un icon theme compatible");
  const themePath = `${root}${declaration.path.replace(/^\//, "").replace(/^\.\//, "")}`;
  const themeBytes =
    archive[themePath] ?? archive[themePath.replace(`${root}extension/`, `${root}`)];
  if (!themeBytes) throw new Error(`No se encontró el archivo de tema: ${declaration.path}`);
  const theme = JSON.parse(strFromU8(themeBytes)) as {
    iconDefinitions?: Record<string, { iconPath?: string; fontCharacter?: string }>;
    fileExtensions?: Record<string, string>;
    fileNames?: Record<string, string>;
    folderNames?: Record<string, string>;
    folderNamesExpanded?: Record<string, string>;
    folder?: string;
    folderExpanded?: string;
  };
  const files: Record<string, string> = {};
  for (const [path, data] of Object.entries(archive)) {
    if (/\.(svg|png|webp|jpg|jpeg)$/i.test(path)) {
      const mime = path.endsWith(".svg") ? "image/svg+xml" : `image/${path.split(".").pop()}`;
      files[path] = `data:${mime};base64,${toBase64(data)}`;
    }
  }
  const installed: VsixIconTheme = {
    id: `${manifest.publisher ?? "unknown"}.${manifest.name}.${declaration.id}`,
    name: declaration.label ?? declaration.id,
    publisher: manifest.publisher,
    version: manifest.version,
    iconDefinitions: theme.iconDefinitions ?? {},
    fileExtensions: theme.fileExtensions,
    fileNames: theme.fileNames,
    folderNames: theme.folderNames,
    folderNamesExpanded: theme.folderNamesExpanded,
    folder: theme.folder,
    folderExpanded: theme.folderExpanded,
    files,
  };
  const next = [...readInstalled().filter((item) => item.id !== installed.id), installed];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  localStorage.setItem(ACTIVE_KEY, installed.id);
  window.dispatchEvent(new Event("qori-vsix-themes-changed"));
  return next;
}

function getActiveTheme(): VsixIconTheme | undefined {
  const installed = readInstalled();
  const activeId = getActiveVsixIconThemeId();
  return installed.find((item) => item.id === activeId) ?? installed.at(-1);
}

function resolveIcon(
  theme: VsixIconTheme | undefined,
  definition: string | undefined
): string | null {
  const iconPath = definition ? theme?.iconDefinitions[definition]?.iconPath : undefined;
  if (!theme || !iconPath) return null;
  const normalized = iconPath.replace(/^\.\//, "").replace(/^\.\.\//, "");
  const path = Object.keys(theme.files).find(
    (candidate) =>
      candidate.endsWith(normalized) || candidate.endsWith(`/${normalized.replace(/^\.\.\//, "")}`)
  );
  return path ? theme.files[path] : null;
}

export function getVsixIconForFile(filename: string): string | null {
  const theme = getActiveTheme();
  if (!theme) return null;
  const extension = filename.split(".").pop() ?? "";
  const definition =
    theme.fileNames?.[filename] ??
    theme.fileNames?.[filename.toLowerCase()] ??
    theme.fileExtensions?.[extension] ??
    theme.fileExtensions?.[`.${extension}`];
  return resolveIcon(theme, definition);
}

export function getVsixIconForFolder(folderName: string, expanded: boolean): string | null {
  const theme = getActiveTheme();
  if (!theme) return null;
  const definition =
    (expanded ? theme.folderNamesExpanded?.[folderName] : undefined) ??
    theme.folderNames?.[folderName] ??
    (expanded ? theme.folderExpanded : theme.folder);
  return resolveIcon(theme, definition);
}
