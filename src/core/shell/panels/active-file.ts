import type { useTabStore } from "@/core/tabs/store/tab-store";

type TabStoreState = ReturnType<typeof useTabStore.getState>;

/** File path of the active tab — a primitive, so subscribers only re-render when it changes. */
export function selectActiveFilePath(state: TabStoreState): string | undefined {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  return tab?.metadata?.filePath as string | undefined;
}

/**
 * `paths` added to `set`, returning the same Set when nothing is new, so state
 * updates that change nothing don't re-render the whole tree.
 */
export function withPaths(set: Set<string>, paths: string[]): Set<string> {
  if (paths.every((path) => set.has(path))) return set;
  const next = new Set(set);
  paths.forEach((path) => next.add(path));
  return next;
}
