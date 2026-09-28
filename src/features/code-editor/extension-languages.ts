import { strFromU8 } from "fflate";
import { useThemeStore } from "@/stores/themeStore";
import {
  readExtensionFile,
  readExtensionJson,
  type InstalledExtension,
} from "@/plugins/vscode/extension-storage";
import {
  loadInstalledExtensions,
  onInstalledExtensionsChanged,
} from "@/plugins/vscode/extension-registry";
import {
  getActiveThemeColors,
  getActiveTokenColors,
  onActiveThemeColorsChanged,
} from "@/plugins/vscode/color-theme-service";
import { normalizeRelativePath } from "@/plugins/vscode/paths";
import { getLanguageRegistry } from "./language-registry";
import { parseSnippetFile, type Snippet } from "./snippets";
import { textMateService, type GrammarSource } from "./textmate/textmate-service";
import { buildTextMateTheme } from "./textmate/token-theme";
import { applyTextMateThemeCss } from "./textmate/highlighter";

/**
 * Feeds the code editor with what installed extensions contribute:
 * languages, TextMate grammars, snippets and language configuration
 * (comment tokens, brackets). Kept in sync with installs and theme changes.
 */

export interface LanguageConfiguration {
  comments?: { lineComment?: string; blockComment?: [string, string] };
  brackets?: [string, string][];
  autoClosingPairs?: Array<[string, string] | { open: string; close: string }>;
  wordPattern?: string | { pattern: string };
}

let extensions: InstalledExtension[] = [];
let snippetCache: Promise<Array<Snippet & { language?: string }>> | null = null;
const configurationCache = new Map<string, Promise<LanguageConfiguration | null>>();
let initialized = false;

function readText(extension: InstalledExtension, path: string): Promise<string> {
  const normalized = normalizeRelativePath(path);
  if (!normalized) return Promise.reject(new Error(`Ruta inválida: ${path}`));
  return readExtensionFile(extension, normalized).then((bytes) => strFromU8(bytes));
}

function grammarSources(list: InstalledExtension[]): GrammarSource[] {
  return list.flatMap((extension) =>
    extension.contributions.grammars.map((contribution) => ({
      extensionId: extension.id,
      contribution,
      read: (path: string) => readText(extension, path),
    }))
  );
}

function refreshTheme(): void {
  const isDark = useThemeStore.getState().resolvedTheme === "dark";
  const tokenColors = getActiveTokenColors();
  textMateService.setTheme(
    buildTextMateTheme(isDark, tokenColors.length > 0 ? tokenColors : null, getActiveThemeColors())
  );
}

function apply(list: InstalledExtension[]): void {
  extensions = list;
  snippetCache = null;
  configurationCache.clear();
  getLanguageRegistry().rebuild(list);
  textMateService.setSources(grammarSources(list));
}

/** Snippets of every installed extension (loaded once per install state). */
export function getExtensionSnippets(): Promise<Array<Snippet & { language?: string }>> {
  snippetCache ??= Promise.all(
    extensions.flatMap((extension) =>
      extension.contributions.snippets.map(async (contribution) => {
        const path = normalizeRelativePath(contribution.path);
        if (!path) return [];
        try {
          const json = await readExtensionJson<unknown>(extension, path);
          return parseSnippetFile(json).map((snippet) => ({
            ...snippet,
            language: contribution.language,
          }));
        } catch (error) {
          console.warn(`[snippets] ${extension.id}: ${contribution.path}`, error);
          return [];
        }
      })
    )
  ).then((groups) => groups.flat());
  return snippetCache;
}

/** `language-configuration.json` of the extension contributing `languageId`. */
export function getLanguageConfiguration(
  languageId: string
): Promise<LanguageConfiguration | null> {
  const cached = configurationCache.get(languageId);
  if (cached) return cached;
  const promise = (async () => {
    for (const extension of extensions) {
      const language = extension.contributions.languages.find(
        (lang) => lang.id === languageId && lang.configuration
      );
      const path = language?.configuration && normalizeRelativePath(language.configuration);
      if (!path) continue;
      try {
        return await readExtensionJson<LanguageConfiguration>(extension, path);
      } catch (error) {
        console.warn(`[language-configuration] ${extension.id}`, error);
      }
    }
    return null;
  })();
  configurationCache.set(languageId, promise);
  return promise;
}

/** Load contributions and follow installs and theme switches. Call once. */
export async function initExtensionLanguages(): Promise<void> {
  if (initialized) return;
  initialized = true;
  textMateService.subscribe(() => applyTextMateThemeCss(textMateService.getColorMap()));
  onInstalledExtensionsChanged(apply);
  onActiveThemeColorsChanged(refreshTheme);
  useThemeStore.subscribe((state, prev) => {
    if (state.resolvedTheme !== prev.resolvedTheme) refreshTheme();
  });
  refreshTheme();
  apply(await loadInstalledExtensions());
}
