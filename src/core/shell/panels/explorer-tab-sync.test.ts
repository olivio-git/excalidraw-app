import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/core/tabs/store/tab-store";
import {
  updateTabsAfterRename,
  updateTabsAfterMove,
  closeTabsForDeletedPath,
} from "./explorer-tab-sync";

// ---------------------------------------------------------------------------
// Mock file-handler-registry so we can control displayName without Tauri deps
// ---------------------------------------------------------------------------
vi.mock("./file-handler-registry", () => ({
  fileHandlerRegistry: {
    resolveOrDefault: vi.fn((name: string) => ({
      routeId: "diagram",
      defaultExtension: "excalidraw",
      create: vi.fn(),
      // Strip .excalidraw extension as the real handler does
      displayName: (filename: string) => filename.replace(/\.excalidraw$/, ""),
    })),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addFileTab(filePath: string, title: string): string {
  const id = useTabStore.getState().addTab({
    routeId: "diagram",
    path: "/diagram",
    title,
    instanceId: filePath,
  });
  // Attach the filePath as metadata (simulates what the diagram panel does)
  useTabStore.getState().updateTab(id, { metadata: { filePath } });
  return id;
}

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null });
});

// ---------------------------------------------------------------------------
// updateTabsAfterRename
// ---------------------------------------------------------------------------

describe("updateTabsAfterRename", () => {
  it("updates title and instanceId for the tab matching oldPath", () => {
    const id = addFileTab("/ws/old-name.excalidraw", "old-name");

    updateTabsAfterRename("/ws/old-name.excalidraw", "/ws/new-name.excalidraw");

    const tab = useTabStore.getState().tabs.find((t) => t.id === id)!;
    expect(tab.instanceId).toBe("/ws/new-name.excalidraw");
    expect(tab.metadata?.filePath).toBe("/ws/new-name.excalidraw");
  });

  it("updates the display title using the file name of the new path", () => {
    const id = addFileTab("/ws/old-name.excalidraw", "old-name");

    updateTabsAfterRename("/ws/old-name.excalidraw", "/ws/new-name.excalidraw");

    const tab = useTabStore.getState().tabs.find((t) => t.id === id)!;
    // The mock displayName strips .excalidraw → "new-name"
    expect(tab.title).toBe("new-name");
  });

  it("does not affect tabs that do not match oldPath", () => {
    const idA = addFileTab("/ws/a.excalidraw", "a");
    const idB = addFileTab("/ws/b.excalidraw", "b");

    updateTabsAfterRename("/ws/a.excalidraw", "/ws/a-renamed.excalidraw");

    const tabB = useTabStore.getState().tabs.find((t) => t.id === idB)!;
    expect(tabB.instanceId).toBe("/ws/b.excalidraw");
    expect(tabB.metadata?.filePath).toBe("/ws/b.excalidraw");
    expect(tabB.title).toBe("b");
  });

  it("is a no-op when no tab has the oldPath", () => {
    addFileTab("/ws/a.excalidraw", "a");
    const before = JSON.stringify(useTabStore.getState().tabs);

    updateTabsAfterRename("/ws/nonexistent.excalidraw", "/ws/whatever.excalidraw");

    expect(JSON.stringify(useTabStore.getState().tabs)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// updateTabsAfterMove (delegates to updateTabsAfterRename)
// ---------------------------------------------------------------------------

describe("updateTabsAfterMove", () => {
  it("updates tab path after a move (same behavior as rename)", () => {
    const id = addFileTab("/ws/folder-a/file.excalidraw", "file");

    updateTabsAfterMove("/ws/folder-a/file.excalidraw", "/ws/folder-b/file.excalidraw");

    const tab = useTabStore.getState().tabs.find((t) => t.id === id)!;
    expect(tab.metadata?.filePath).toBe("/ws/folder-b/file.excalidraw");
  });
});

// ---------------------------------------------------------------------------
// closeTabsForDeletedPath
// ---------------------------------------------------------------------------

describe("closeTabsForDeletedPath", () => {
  it("closes a tab whose filePath exactly matches the deleted path", () => {
    // Need at least 2 tabs so removeTab doesn't guard against closing the last
    addFileTab("/ws/keep.excalidraw", "keep");
    const deleteId = addFileTab("/ws/delete-me.excalidraw", "delete-me");

    closeTabsForDeletedPath("/ws/delete-me.excalidraw");

    const ids = useTabStore.getState().tabs.map((t) => t.id);
    expect(ids).not.toContain(deleteId);
  });

  it("keeps a tab whose filePath does NOT match", () => {
    const keepId = addFileTab("/ws/keep.excalidraw", "keep");
    addFileTab("/ws/delete-me.excalidraw", "delete-me");

    closeTabsForDeletedPath("/ws/delete-me.excalidraw");

    const ids = useTabStore.getState().tabs.map((t) => t.id);
    expect(ids).toContain(keepId);
  });

  it("closes all tabs inside a deleted folder (prefix match)", () => {
    addFileTab("/ws/other.excalidraw", "other");
    const childId1 = addFileTab("/ws/folder/a.excalidraw", "a");
    const childId2 = addFileTab("/ws/folder/sub/b.excalidraw", "b");

    closeTabsForDeletedPath("/ws/folder");

    const ids = useTabStore.getState().tabs.map((t) => t.id);
    expect(ids).not.toContain(childId1);
    expect(ids).not.toContain(childId2);
  });

  it("does not close a tab at a path that is only a prefix of the deleted path string", () => {
    // /ws/fold should NOT be closed when /ws/folder is deleted
    const keepId = addFileTab("/ws/fold/keep.excalidraw", "keep");
    addFileTab("/ws/folder/delete-me.excalidraw", "delete-me");

    closeTabsForDeletedPath("/ws/folder");

    const ids = useTabStore.getState().tabs.map((t) => t.id);
    expect(ids).toContain(keepId);
  });
});
