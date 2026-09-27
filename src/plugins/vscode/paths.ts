/**
 * POSIX-style path helpers for paths *inside* an extension package.
 * Every path is relative to the extension root and must never escape it.
 */

/**
 * Normalize a relative path (`./a/../b\\c` → `b/c`).
 * Returns null when the path is absolute or climbs above the root.
 */
export function normalizeRelativePath(path: string): string | null {
  const unified = path.replace(/\\/g, "/");
  if (unified.startsWith("/") || /^[a-zA-Z]:/.test(unified)) return null;

  const parts: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length > 0 ? parts.join("/") : null;
}

/** Directory part of a relative path (`a/b/c.json` → `a/b`, `c.json` → ``). */
export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** Resolve `target` relative to the directory `baseDir`, staying inside the root. */
export function resolveRelative(baseDir: string, target: string): string | null {
  return normalizeRelativePath(baseDir ? `${baseDir}/${target}` : target);
}
