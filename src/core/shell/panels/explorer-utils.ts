import type { FileEntry, FlatNode, SortOrder } from "./explorer-types";

// ---------------------------------------------------------------------------
// Tree Flattening
// ---------------------------------------------------------------------------

/**
 * Flatten the visible portion of the file tree into a linear array.
 * Only recurses into directories that are in `expandedPaths`.
 */
export function flattenVisible(
  tree: FileEntry[],
  expandedPaths: Set<string>,
  depth = 0,
  parentPath: string | null = null,
  result: FlatNode[] = []
): FlatNode[] {
  for (const entry of tree) {
    const node: FlatNode = {
      path: entry.path,
      name: entry.name,
      isDir: entry.isDir,
      depth,
      parentPath,
      index: result.length,
    };
    result.push(node);

    if (entry.isDir && expandedPaths.has(entry.path) && entry.children) {
      flattenVisible(entry.children, expandedPaths, depth + 1, entry.path, result);
    }
  }
  return result;
}

/**
 * Flatten the entire file tree ignoring expansion state.
 * Used by Quick Open to index all files.
 */
export function flattenAll(
  tree: FileEntry[],
  depth = 0,
  parentPath: string | null = null,
  result: FlatNode[] = []
): FlatNode[] {
  for (const entry of tree) {
    const node: FlatNode = {
      path: entry.path,
      name: entry.name,
      isDir: entry.isDir,
      depth,
      parentPath,
      index: result.length,
    };
    result.push(node);

    if (entry.isDir && entry.children) {
      flattenAll(entry.children, depth + 1, entry.path, result);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Quick Open Scoring
// ---------------------------------------------------------------------------

/**
 * Score how well a file matches the query.
 * - 100: exact name match
 * - 80: name starts with query
 * - 60: name contains query (mid-string)
 * - 30: path contains query
 * - 0: no match
 */
export function scoreMatch(name: string, path: string, query: string): number {
  const lowerName = name.toLowerCase();
  const lowerPath = path.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerName === lowerQuery) return 100;
  if (lowerName.startsWith(lowerQuery)) return 80;
  if (lowerName.includes(lowerQuery)) return 60;
  if (lowerPath.includes(lowerQuery)) return 30;
  return 0;
}

/**
 * Filter and rank the flat node index by query, returning up to 50 results.
 * When query is empty, returns the first 50 nodes.
 */
export function filterIndex(index: FlatNode[], query: string): FlatNode[] {
  if (!query.trim()) return index.slice(0, 50);

  return index
    .map((node) => ({
      node,
      score: scoreMatch(node.name, node.path, query),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((r) => r.node);
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Sort a flat array of FileEntry items according to the given SortOrder.
 * Does NOT recurse — callers must apply this at each level individually
 * (or let buildTree handle the initial sort and re-sort here for display).
 */
export function sortEntries(entries: FileEntry[], order: SortOrder): FileEntry[] {
  const sorted = [...entries];

  switch (order) {
    case "type-first":
      sorted.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      break;

    case "name-asc":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;

    case "name-desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;

    default:
      // Fallback to type-first
      sorted.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  return sorted;
}

/**
 * Recursively sort a full tree by the given SortOrder.
 */
export function sortTree(entries: FileEntry[], order: SortOrder): FileEntry[] {
  return sortEntries(entries, order).map((entry) => {
    if (entry.isDir && entry.children) {
      return { ...entry, children: sortTree(entry.children, order) };
    }
    return entry;
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a byte count as a human-readable string (B, KB, MB).
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format a timestamp (ms since epoch) to a locale date/time string.
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Tree filtering (inline search)
// ---------------------------------------------------------------------------

/**
 * Filter the tree to only show nodes whose name matches the query,
 * or folders that have at least one matching descendant.
 * Returns a new tree with the same structure but only matching branches.
 */
export function filterTree(entries: FileEntry[], query: string): FileEntry[] {
  if (!query.trim()) return entries;
  const lower = query.toLowerCase();

  const filtered: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.isDir && entry.children) {
      const filteredChildren = filterTree(entry.children, query);
      if (filteredChildren.length > 0 || entry.name.toLowerCase().includes(lower)) {
        filtered.push({ ...entry, children: filteredChildren });
      }
    } else {
      if (entry.name.toLowerCase().includes(lower)) {
        filtered.push(entry);
      }
    }
  }
  return filtered;
}

/**
 * Collect all ancestor paths from a filtered tree so they can be
 * auto-expanded when a search is active.
 */
export function getFilteredExpandedPaths(entries: FileEntry[], query: string): Set<string> {
  if (!query.trim()) return new Set();
  const paths = new Set<string>();

  function collectExpanded(nodes: FileEntry[]) {
    for (const node of nodes) {
      if (node.isDir && node.children) {
        const hasMatch = hasMatchingDescendant(node.children, query);
        if (hasMatch) {
          paths.add(node.path);
          collectExpanded(node.children);
        }
      }
    }
  }

  collectExpanded(entries);
  return paths;
}

function hasMatchingDescendant(entries: FileEntry[], query: string): boolean {
  const lower = query.toLowerCase();
  for (const entry of entries) {
    if (entry.name.toLowerCase().includes(lower)) return true;
    if (entry.isDir && entry.children && hasMatchingDescendant(entry.children, query)) return true;
  }
  return false;
}
