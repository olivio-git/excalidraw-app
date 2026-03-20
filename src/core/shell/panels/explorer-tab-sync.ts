import { useTabStore } from "@/core/tabs/store/tab-store";
import { fileHandlerRegistry } from "./file-handler-registry";

// ---------------------------------------------------------------------------
// Tab synchronization helpers for file-system operations
// These are pure functions (no hooks) — they call useTabStore.getState()
// directly and are safe to call from async event handlers.
// ---------------------------------------------------------------------------

/**
 * Update any open tab whose filePath matches `oldPath` to reflect `newPath`.
 * Used after rename and move operations.
 */
export function updateTabsAfterRename(oldPath: string, newPath: string): void {
  const { tabs, updateTab } = useTabStore.getState();
  const name = newPath.split("/").pop() ?? newPath;
  const handler = fileHandlerRegistry.resolveOrDefault(name);
  const title = handler.displayName ? handler.displayName(name) : name;

  tabs.forEach((tab) => {
    if (tab.metadata?.filePath === oldPath) {
      updateTab(tab.id, {
        title,
        instanceId: newPath,
        metadata: { ...tab.metadata, filePath: newPath },
      });
    }
  });
}

/**
 * Update tabs after a file/folder move (path change).
 * Delegates to updateTabsAfterRename — both operations change the path.
 */
export function updateTabsAfterMove(oldPath: string, newPath: string): void {
  updateTabsAfterRename(oldPath, newPath);
}

/**
 * Close any open tabs whose filePath starts with `deletedPath`.
 * Handles both single-file deletes (exact match) and folder deletes (prefix match).
 */
export function closeTabsForDeletedPath(deletedPath: string): void {
  const { tabs, removeTab } = useTabStore.getState();
  tabs
    .filter((t) => {
      const fp = t.metadata?.filePath as string | undefined;
      return fp !== undefined && (fp === deletedPath || fp.startsWith(deletedPath + "/"));
    })
    .forEach((t) => removeTab(t.id));
}
