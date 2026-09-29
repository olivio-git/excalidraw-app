/**
 * Minimal JSONC parser (JSON with comments and trailing commas), the format
 * VS Code accepts for extension manifests and theme files.
 */
export function stripJsonc(source: string): string {
  let out = "";
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '"') {
      const start = i;
      i++;
      while (i < len && source[i] !== '"') {
        if (source[i] === "\\") i++;
        i++;
      }
      i++;
      out += source.slice(start, i);
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < len && source[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (ch === ",") {
      // Drop the comma when only whitespace/comments separate it from a closing bracket.
      let j = i + 1;
      while (j < len) {
        if (/\s/.test(source[j])) {
          j++;
        } else if (source[j] === "/" && source[j + 1] === "/") {
          while (j < len && source[j] !== "\n") j++;
        } else if (source[j] === "/" && source[j + 1] === "*") {
          j += 2;
          while (j < len && !(source[j] === "*" && source[j + 1] === "/")) j++;
          j += 2;
        } else {
          break;
        }
      }
      if (source[j] === "}" || source[j] === "]") {
        i++;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

export function parseJsonc<T = unknown>(source: string): T {
  // Strip a UTF-8 BOM, which some theme files ship with.
  return JSON.parse(stripJsonc(source.replace(/^\uFEFF/, ""))) as T;
}
