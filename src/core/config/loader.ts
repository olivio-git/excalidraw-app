import { parse, TomlError } from "smol-toml";
import type { ConfigIssue } from "./schema";

/** A keybinding from keymap.toml. */
export interface KeymapBinding {
  key: string;
  command: string;
  when?: string;
}

/** Parse TOML; syntax errors come back as issues with their line. */
export function parseToml(text: string, file: string): { data: unknown; issues: ConfigIssue[] } {
  try {
    return { data: parse(text), issues: [] };
  } catch (error) {
    if (error instanceof TomlError) {
      const message = error.message.split("\n")[0].replace(/^Invalid TOML document: /, "");
      return {
        data: null,
        issues: [
          {
            file,
            path: "",
            line: error.line,
            message: `Error de sintaxis (línea ${error.line}): ${message}`,
          },
        ],
      };
    }
    return { data: null, issues: [{ file, path: "", message: String(error) }] };
  }
}

export function validateKeymap(
  raw: unknown,
  file: string
): { binds: KeymapBinding[]; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];
  const binds: KeymapBinding[] = [];
  if (!raw || typeof raw !== "object") return { binds, issues };
  const data = raw as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (key !== "bind")
      issues.push({ file, path: key, message: `Se esperaba [[bind]], no «${key}»` });
  }
  const list = data.bind;
  if (list === undefined) return { binds, issues };
  if (!Array.isArray(list)) {
    issues.push({ file, path: "bind", message: "Usa [[bind]] (una tabla por atajo)" });
    return { binds, issues };
  }
  list.forEach((item, index) => {
    const entry = item as Record<string, unknown>;
    const path = `bind[${index + 1}]`;
    if (typeof entry?.key !== "string" || !entry.key.trim()) {
      issues.push({ file, path, message: `${path}: falta «key» (p. ej. "ctrl+alt+n")` });
      return;
    }
    if (typeof entry.command !== "string" || !entry.command.trim()) {
      issues.push({ file, path, message: `${path}: falta «command»` });
      return;
    }
    binds.push({
      key: entry.key.trim().toLowerCase(),
      command: entry.command.trim(),
      when: typeof entry.when === "string" && entry.when.trim() ? entry.when.trim() : undefined,
    });
  });
  return { binds, issues };
}

/** `~/x` → `<home>/x`. */
export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\"))
    return `${home.replace(/[\\/]$/, "")}/${path.slice(2)}`;
  return path;
}

/** `#7c3aed` / `#abc` → `"262 83% 58%"` (the theme's HSL token format), or null. */
export function hexToHslToken(color: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
