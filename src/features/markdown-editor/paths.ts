/**
 * Path helpers for links written into Markdown. Links are stored relative to
 * the note and URI-encoded, so they work in any Markdown tool and resolve
 * through `resolveFileReference` (which decodes them).
 */

function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

function segments(path: string): string[] {
  return toPosix(path).split("/").filter(Boolean);
}

export function posixDirname(path: string): string {
  const normalized = toPosix(path);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? normalized.slice(0, index + 1) : normalized.slice(0, index);
}

/** Relative path from directory `fromDir` to file `to` (`../docs/a.md`). */
export function relativePath(fromDir: string, to: string): string {
  const from = segments(fromDir);
  const target = segments(to);
  // Different Windows drives: no relative path exists.
  if (/^[a-z]:$/i.test(from[0] ?? "") && from[0]?.toLowerCase() !== target[0]?.toLowerCase()) {
    return toPosix(to);
  }
  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) {
    common++;
  }
  const up = from.slice(common).map(() => "..");
  return [...up, ...target.slice(common)].join("/") || ".";
}

/** Encode a relative path for a Markdown link destination (spaces, parentheses…). */
export function encodeLinkPath(path: string): string {
  return path
    .split("/")
    .map((part) => (part === ".." || part === "." ? part : encodeURIComponent(part)))
    .join("/");
}

export function fileName(path: string): string {
  return toPosix(path).split("/").pop() ?? path;
}

/** Display name without the extension (`Mi nota.md` → `Mi nota`). */
export function baseName(path: string): string {
  return fileName(path).replace(/\.[^.]+$/, "");
}

export const DIAGRAM_EXTENSION = /\.excalidraw$/i;
export const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg)$/i;
export const NOTE_EXTENSION = /\.(md|note)$/i;
