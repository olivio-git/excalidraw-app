import { useTabStore } from "@/core/tabs/store/tab-store";
import { fileHandlerRegistry } from "./file-handler-registry";
import { isSameOrDescendant } from "./explorer-file-operations";
import { useDocumentStore } from "@/stores/documentStore";
import { useDiagramStore } from "@/core/diagram/store/diagram-store";

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
  useDocumentStore.getState().moveDocuments(oldPath, newPath);
  useDiagramStore.getState().moveDiagrams(oldPath, newPath);
  const { tabs, updateTab } = useTabStore.getState();
  tabs.forEach((tab) => {
    const filePath = tab.metadata?.filePath;
    if (typeof filePath === "string" && isSameOrDescendant(filePath, oldPath)) {
      const updatedPath = newPath + filePath.slice(oldPath.length);
      const name = updatedPath.split(/[\\/]/).pop() ?? updatedPath;
      const handler = fileHandlerRegistry.resolveOrDefault(name);
      const title = handler.displayName ? handler.displayName(name) : name;
      updateTab(tab.id, {
        title,
        instanceId: updatedPath,
        metadata: { ...tab.metadata, filePath: updatedPath },
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
