import { useSyncExternalStore } from "react";
import type { LanguageDescription } from "@codemirror/language";
import { languages as codemirrorLanguages } from "@codemirror/language-data";
import type { InstalledExtension } from "@/plugins/vscode/extension-storage";
import type { LanguageContribution } from "@/plugins/vscode/contributions";

/**
 * Language ids for files, VS Code style. Built-in knowledge comes from
 * CodeMirror's language-data (so common languages highlight without any
 * extension); extensions add languages or extend existing ones with more
 * file extensions/names, exactly like `contributes.languages` in VS Code.
 */

export interface LanguageInfo {
  id: string;
  /** Display name. */
  name: string;
  aliases: string[];
  /** Lowercase, with the leading dot (".ps1"). */
  extensions: string[];
  /** Exact file names (case-insensitive). */
  filenames: string[];
  filenamePatterns: string[];
  firstLine?: RegExp;
  /** Built-in CodeMirror support, loaded on demand. */
  codemirror?: LanguageDescription;
  /** Extension ids that contributed to this language. */
  contributedBy: string[];
}

/** language-data names whose VS Code id is not simply the lowercased name. */
const VSCODE_IDS: Record<string, string> = {
  "c++": "cpp",
  "c#": "csharp",
  shell: "shellscript",
  jsx: "javascriptreact",
  tsx: "typescriptreact",
  "objective-c": "objective-c",
  "objective-c++": "objective-cpp",
  "f#": "fsharp",
  "protocol buffers": "proto",
  "vb.net": "vb",
  "common lisp": "commonlisp",
  "emacs lisp": "elisp",
  mysql: "sql",
  sql: "sql",
  plsql: "sql",
  "properties files": "properties",
  "text/plain": "plaintext",
};

export function vscodeLanguageId(name: string): string {
  const lower = name.toLowerCase();
  return VSCODE_IDS[lower] ?? lower.replace(/\s+/g, "-");
}

const PLAIN_TEXT: LanguageInfo = {
  id: "plaintext",
  name: "Texto sin formato",
  aliases: ["Plain Text", "text"],
  extensions: [".txt", ".text", ".log", ".env", ".gitignore", ".gitattributes", ".editorconfig"],
  filenames: ["license", "readme", "changelog", "authors", "copying", ".gitignore", ".env"],
  filenamePatterns: [],
  contributedBy: [],
};

type Listener = () => void;

/** Glob subset used by `filenamePatterns` (`*`, `**`, `?`) → RegExp on the basename or path. */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        source += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        source += "[^/]*";
      }
    } else if (ch === "?") {
      source += "[^/]";
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "i");
}

function safeRegExp(source: string | undefined): RegExp | undefined {
  if (!source) return undefined;
  try {
    return new RegExp(source);
  } catch {
    return undefined;
  }
}

export class LanguageRegistry {
  private languages = new Map<string, LanguageInfo>();
  private listeners = new Set<Listener>();
  private builtins: LanguageDescription[] = [];
  private version = 0;

  constructor(builtins: readonly LanguageDescription[] = []) {
    this.builtins = [...builtins];
    this.rebuild([]);
  }

  /** Recompute from the built-ins plus the languages of `extensions`. */
  rebuild(extensions: Pick<InstalledExtension, "id" | "contributions">[]): void {
    const map = new Map<string, LanguageInfo>();
    map.set(PLAIN_TEXT.id, { ...PLAIN_TEXT });
    for (const description of this.builtins) {
      const id = vscodeLanguageId(description.name);
      const existing = map.get(id);
      const extensionsList = description.extensions.map((ext) => `.${ext.toLowerCase()}`);
      if (existing) {
        existing.extensions = [...new Set([...existing.extensions, ...extensionsList])];
        existing.codemirror ??= description;
        continue;
      }
      map.set(id, {
        id,
        name: description.name,
        aliases: [description.name, ...description.alias],
        extensions: extensionsList,
        filenames: [],
        filenamePatterns: [],
        codemirror: description,
        contributedBy: [],
      });
    }
    for (const extension of extensions) {
      for (const language of extension.contributions.languages) {
        this.merge(map, language, extension.id);
      }
    }
    this.languages = map;
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  private merge(map: Map<string, LanguageInfo>, language: LanguageContribution, from: string) {
    const current = map.get(language.id) ?? {
      id: language.id,
      name: language.aliases?.[0] ?? language.id,
      aliases: [],
      extensions: [],
      filenames: [],
      filenamePatterns: [],
      contributedBy: [],
    };
    current.aliases = [...new Set([...current.aliases, ...(language.aliases ?? [])])];
    if (language.aliases?.[0] && current.contributedBy.length === 0 && !current.codemirror) {
      current.name = language.aliases[0];
    }
    current.extensions = [
      ...new Set([
        ...current.extensions,
        ...(language.extensions ?? []).map((e) => e.toLowerCase()),
      ]),
    ];
    current.filenames = [
      ...new Set([...current.filenames, ...(language.filenames ?? []).map((f) => f.toLowerCase())]),
    ];
    current.filenamePatterns = [
      ...new Set([...current.filenamePatterns, ...(language.filenamePatterns ?? [])]),
    ];
    current.firstLine ??= safeRegExp(language.firstLine);
    current.contributedBy = [...new Set([...current.contributedBy, from])];
    map.set(language.id, current);
  }

  get(id: string): LanguageInfo | undefined {
    return this.languages.get(id);
  }

  getAll(): LanguageInfo[] {
    return [...this.languages.values()];
  }

  getVersion(): number {
    return this.version;
  }

  /** Language id for a file, or null if the file is not known to be text. */
  resolve(filePath: string, firstLine?: string): string | null {
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    const lower = name.toLowerCase();
    const all = [...this.languages.values()];

    const byName = all.find((lang) => lang.filenames.includes(lower));
    if (byName) return byName.id;

    const byPattern = all.find((lang) =>
      lang.filenamePatterns.some((pattern) => {
        const regex = globToRegExp(pattern);
        return regex.test(name) || regex.test(filePath.replaceAll("\\", "/"));
      })
    );
    if (byPattern) return byPattern.id;

    // Longest matching extension wins (".d.ts" over ".ts").
    let best: { id: string; length: number } | null = null;
    for (const lang of all) {
      for (const ext of lang.extensions) {
        if (
          lower.endsWith(ext) &&
          lower.length > ext.length &&
          (!best || ext.length > best.length)
        ) {
          best = { id: lang.id, length: ext.length };
        }
      }
    }
    if (best) return best.id;

    const builtin = all.find((lang) => lang.codemirror?.filename?.test(name));
    if (builtin) return builtin.id;

    if (firstLine !== undefined) {
      const byFirstLine = all.find((lang) => lang.firstLine?.test(firstLine));
      if (byFirstLine) return byFirstLine.id;
    }
    return null;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

let registry: LanguageRegistry | null = null;

/** The app-wide registry (built-ins from @codemirror/language-data). */
export function getLanguageRegistry(): LanguageRegistry {
  registry ??= new LanguageRegistry(codemirrorLanguages);
  return registry;
}

export function useLanguageRegistryVersion(): number {
  const reg = getLanguageRegistry();
  return useSyncExternalStore(reg.subscribe, () => reg.getVersion());
}
