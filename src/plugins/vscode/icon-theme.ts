import { dirname, resolveRelative } from "./paths";

/**
 * VS Code file icon theme document (the JSON referenced by `contributes.iconThemes[].path`).
 * See https://code.visualstudio.com/api/extension-guides/file-icon-theme
 */
export interface IconAssociations {
  file?: string;
  folder?: string;
  folderExpanded?: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
  languageIds?: Record<string, string>;
}

export interface IconDefinition {
  iconPath?: string;
  fontCharacter?: string;
  fontColor?: string;
}

export interface IconThemeDocument extends IconAssociations {
  iconDefinitions?: Record<string, IconDefinition>;
  light?: IconAssociations;
  highContrast?: IconAssociations;
}

export type IconThemeVariant = "light" | "dark";

/**
 * Minimal extension → VS Code languageId map. Many icon themes (e.g. Material
 * Icon Theme) map common languages only through `languageIds`, so without this
 * `.ts`/`.py`/... files would fall back to the generic file icon.
 */
const LANGUAGE_IDS: Record<string, string> = {
  bat: "bat",
  c: "c",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  dart: "dart",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  cjs: "javascript",
  mjs: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "javascriptreact",
  kt: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  php: "php",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "shellscript",
  bash: "shellscript",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  cts: "typescript",
  mts: "typescript",
  tsx: "typescriptreact",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

/**
 * Candidate extensions for a file name, longest first, following VS Code:
 * `foo.d.ts` → [`d.ts`, `ts`], `.gitignore` → [`gitignore`].
 */
export function getExtensionCandidates(filename: string): string[] {
  const name = filename.toLowerCase();
  const candidates: string[] = [];
  let dot = name.indexOf(".");
  while (dot !== -1 && dot < name.length - 1) {
    candidates.push(name.slice(dot + 1));
    dot = name.indexOf(".", dot + 1);
  }
  return candidates;
}

function lookup(maps: Array<Record<string, string> | undefined>, key: string): string | undefined {
  for (const map of maps) {
    if (!map) continue;
    const hit = map[key];
    if (hit) return hit;
  }
  return undefined;
}

/** Keys in theme maps are matched case-insensitively, like VS Code does. */
function lowerKeys(map: Record<string, string> | undefined) {
  if (!map) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) out[key.toLowerCase()] = value;
  return out;
}

function normalizeAssociations(assoc: IconAssociations | undefined): IconAssociations | undefined {
  if (!assoc) return undefined;
  return {
    ...assoc,
    fileExtensions: lowerKeys(assoc.fileExtensions),
    fileNames: lowerKeys(assoc.fileNames),
    folderNames: lowerKeys(assoc.folderNames),
    folderNamesExpanded: lowerKeys(assoc.folderNamesExpanded),
  };
}

/** Lowercase all lookup keys once so resolution stays a plain map lookup. */
export function normalizeIconTheme(doc: IconThemeDocument): IconThemeDocument {
  return {
    ...normalizeAssociations(doc),
    iconDefinitions: doc.iconDefinitions ?? {},
    light: normalizeAssociations(doc.light),
    highContrast: normalizeAssociations(doc.highContrast),
  };
}

function layers(theme: IconThemeDocument, variant: IconThemeVariant): IconAssociations[] {
  return variant === "light" && theme.light ? [theme.light, theme] : [theme];
}

/** Resolve the icon definition id for a file (expects a normalized theme). */
export function resolveFileIconId(
  theme: IconThemeDocument,
  filename: string,
  variant: IconThemeVariant = "dark"
): string | undefined {
  const assoc = layers(theme, variant);
  const name = filename.toLowerCase();

  const byName = lookup(
    assoc.map((a) => a.fileNames),
    name
  );
  if (byName) return byName;

  const extensions = getExtensionCandidates(name);
  for (const ext of extensions) {
    const byExt = lookup(
      assoc.map((a) => a.fileExtensions),
      ext
    );
    if (byExt) return byExt;
  }

  const languageId = LANGUAGE_IDS[extensions.at(-1) ?? ""];
  if (languageId) {
    const byLanguage = lookup(
      assoc.map((a) => a.languageIds),
      languageId
    );
    if (byLanguage) return byLanguage;
  }

  return assoc.map((a) => a.file).find(Boolean);
}

/** Resolve the icon definition id for a folder (expects a normalized theme). */
export function resolveFolderIconId(
  theme: IconThemeDocument,
  folderName: string,
  expanded: boolean,
  variant: IconThemeVariant = "dark"
): string | undefined {
  const assoc = layers(theme, variant);
  const name = folderName.toLowerCase();

  if (expanded) {
    const byExpandedName = lookup(
      assoc.map((a) => a.folderNamesExpanded),
      name
    );
    if (byExpandedName) return byExpandedName;
  }

  const byName = lookup(
    assoc.map((a) => a.folderNames),
    name
  );
  if (byName) return byName;

  if (expanded) {
    const openFolder = assoc.map((a) => a.folderExpanded).find(Boolean);
    if (openFolder) return openFolder;
  }
  return assoc.map((a) => a.folder).find(Boolean);
}

/**
 * Path (relative to the extension root) of the image for an icon definition.
 * `iconPath` is relative to the theme file itself, as in VS Code.
 * Returns null for font-glyph definitions or paths escaping the extension.
 */
export function resolveIconFilePath(
  theme: IconThemeDocument,
  themeFilePath: string,
  definitionId: string
): string | null {
  const iconPath = theme.iconDefinitions?.[definitionId]?.iconPath;
  if (!iconPath) return null;
  return resolveRelative(dirname(themeFilePath), iconPath);
}
