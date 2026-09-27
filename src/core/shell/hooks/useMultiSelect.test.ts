import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMultiSelect } from "./useMultiSelect";
import { useExplorerSelectionStore } from "@/stores/explorerStore";
import type { FlatNode } from "@/core/shell/panels/explorer-types";

// ---------------------------------------------------------------------------
// Flat nodes fixture (simulates a visible file tree)
// ---------------------------------------------------------------------------

const flatNodes: FlatNode[] = [
  { path: "/ws/a.ts", name: "a.ts", isDir: false, depth: 0, parentPath: null, index: 0 },
  { path: "/ws/b.ts", name: "b.ts", isDir: false, depth: 0, parentPath: null, index: 1 },
  { path: "/ws/c.ts", name: "c.ts", isDir: false, depth: 0, parentPath: null, index: 2 },
  { path: "/ws/d.ts", name: "d.ts", isDir: false, depth: 0, parentPath: null, index: 3 },
];

// Helper: build a synthetic MouseEvent with modifier flags
function clickEvent(opts: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) {
  return {
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
  } as React.MouseEvent;
}

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  useExplorerSelectionStore.setState({ selectedPaths: [] });
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useMultiSelect", () => {
  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe("initial state", () => {
    it("starts with empty selectedPaths", () => {
      const { result } = renderHook(() => useMultiSelect());
      expect(result.current.selectedPaths.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Plain click (single select)
  // -------------------------------------------------------------------------
  describe("plain click", () => {
    it("selects the clicked node", () => {
      const { result } = renderHook(() => useMultiSelect());
      let focusedPath: string | null = null;
      const setFocusedPath = (p: string | null) => {
        focusedPath = p;
      };

      act(() => {
        result.current.handleNodeClick(
          clickEvent(),
          "/ws/a.ts",
          flatNodes,
          focusedPath,
          setFocusedPath
        );
      });

      expect(result.current.selectedPaths.has("/ws/a.ts")).toBe(true);
      expect(result.current.selectedPaths.size).toBe(1);
    });

    it("replaces the previous selection on a new plain click", () => {
      const { result } = renderHook(() => useMultiSelect());
      let focusedPath: string | null = null;
      const setFocusedPath = (p: string | null) => {
        focusedPath = p;
      };

      act(() => {
        result.current.handleNodeClick(
          clickEvent(),
          "/ws/a.ts",
          flatNodes,
          focusedPath,
          setFocusedPath
        );
      });
      act(() => {
        result.current.handleNodeClick(
          clickEvent(),
          "/ws/b.ts",
          flatNodes,
          focusedPath,
          setFocusedPath
        );
      });

      expect(result.current.selectedPaths.has("/ws/a.ts")).toBe(false);
      expect(result.current.selectedPaths.has("/ws/b.ts")).toBe(true);
      expect(result.current.selectedPaths.size).toBe(1);
    });

    it("updates focusedPath to the clicked node", () => {
      const { result } = renderHook(() => useMultiSelect());
      let focusedPath: string | null = null;
      const setFocusedPath = (p: string | null) => {
        focusedPath = p;
      };

      act(() => {
        result.current.handleNodeClick(
          clickEvent(),
          "/ws/c.ts",
          flatNodes,
          focusedPath,
          setFocusedPath
        );
      });

      expect(focusedPath).toBe("/ws/c.ts");
    });
  });

  // -------------------------------------------------------------------------
  // Ctrl+click (toggle individual)
  // -------------------------------------------------------------------------
  describe("Ctrl+click", () => {
    it("adds a node to the existing selection", () => {
      const { result } = renderHook(() => useMultiSelect());
      let focusedPath: string | null = "/ws/a.ts";
      const setFocusedPath = (p: string | null) => {
        focusedPath = p;
      };

      // First: plain select a.ts
      act(() => {
        result.current.handleNodeClick(clickEvent(), "/ws/a.ts", flatNodes, null, setFocusedPath);
      });
      // Ctrl+click b.ts to add
      act(() => {
        result.current.handleNodeClick(
          clickEvent({ ctrlKey: true }),
          "/ws/b.ts",
          flatNodes,
          focusedPath,
          setFocusedPath
        );
      });

      expect(result.current.selectedPaths.has("/ws/a.ts")).toBe(true);
      expect(result.current.selectedPaths.has("/ws/b.ts")).toBe(true);
    });

    it("removes an already-selected node on Ctrl+click (toggle)", () => {
      const { result } = renderHook(() => useMultiSelect());
      let focusedPath: string | null = null;
      const setFocusedPath = (p: string | null) => {
        focusedPath = p;
      };

      act(() => {
        result.current.handleNodeClick(clickEvent(), "/ws/a.ts", flatNodes, null, setFocusedPath);
      });
      act(() => {
        result.current.handleNodeClick(
          clickEvent({ ctrlKey: true }),
          "/ws/b.ts",
          flatNodes,
          "/ws/a.ts",
          setFocusedPath
        );
      });
      // Ctrl+click a.ts again to deselect
      act(() => {
        result.current.handleNodeClick(
          clickEvent({ ctrlKey: true }),
          "/ws/a.ts",
          flatNodes,
          "/ws/a.ts",
          setFocusedPath
        );
      });

      expect(result.current.selectedPaths.has("/ws/a.ts")).toBe(false);
      expect(result.current.selectedPaths.has("/ws/b.ts")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Shift+click (range select)
  // -------------------------------------------------------------------------
  describe("Shift+click", () => {
    it("selects the range between focusedPath and clicked node (inclusive)", () => {
      const { result } = renderHook(() => useMultiSelect());
      let focusedPath: string | null = "/ws/a.ts";
      const setFocusedPath = (p: string | null) => {
        focusedPath = p;
      };

      // Anchor at index 0 (a.ts), shift+click index 2 (c.ts)
      act(() => {
        result.current.handleNodeClick(
          clickEvent({ shiftKey: true }),
          "/ws/c.ts",
          flatNodes,
          "/ws/a.ts",
          setFocusedPath
        );
      });

      expect(result.current.selectedPaths.has("/ws/a.ts")).toBe(true);
      expect(result.current.selectedPaths.has("/ws/b.ts")).toBe(true);
      expect(result.current.selectedPaths.has("/ws/c.ts")).toBe(true);
      expect(result.current.selectedPaths.has("/ws/d.ts")).toBe(false);
    });

    it("selects range in reverse order (anchor > clicked)", () => {
      const { result } = renderHook(() => useMultiSelect());
      let focusedPath: string | null = "/ws/d.ts";
      const setFocusedPath = (p: string | null) => {
        focusedPath = p;
      };

      // Anchor at index 3 (d.ts), shift+click index 1 (b.ts)
      act(() => {
        result.current.handleNodeClick(
          clickEvent({ shiftKey: true }),
          "/ws/b.ts",
          flatNodes,
          "/ws/d.ts",
          setFocusedPath
        );
      });

      expect(result.current.selectedPaths.has("/ws/b.ts")).toBe(true);
      expect(result.current.selectedPaths.has("/ws/c.ts")).toBe(true);
      expect(result.current.selectedPaths.has("/ws/d.ts")).toBe(true);
      expect(result.current.selectedPaths.has("/ws/a.ts")).toBe(false);
    });

    it("falls back to single selection when focusedPath is null", () => {
      const { result } = renderHook(() => useMultiSelect());
      let focusedPath: string | null = null;
      const setFocusedPath = (p: string | null) => {
        focusedPath = p;
      };

      act(() => {
        result.current.handleNodeClick(
          clickEvent({ shiftKey: true }),
          "/ws/c.ts",
          flatNodes,
          null,
          setFocusedPath
        );
      });

      expect(result.current.selectedPaths.has("/ws/c.ts")).toBe(true);
      expect(result.current.selectedPaths.size).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // clearSelection
  // -------------------------------------------------------------------------
  describe("clearSelection", () => {
    it("empties selectedPaths", () => {
      const { result } = renderHook(() => useMultiSelect());
      let focusedPath: string | null = null;
      const setFocusedPath = (p: string | null) => {
        focusedPath = p;
      };

      act(() => {
        result.current.handleNodeClick(clickEvent(), "/ws/a.ts", flatNodes, null, setFocusedPath);
      });
      expect(result.current.selectedPaths.size).toBe(1);

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedPaths.size).toBe(0);
    });

    it("syncs the empty state to the external store", () => {
      const { result } = renderHook(() => useMultiSelect());
      let focusedPath: string | null = null;
      const setFocusedPath = (p: string | null) => {
        focusedPath = p;
      };

      act(() => {
        result.current.handleNodeClick(clickEvent(), "/ws/a.ts", flatNodes, null, setFocusedPath);
      });

      act(() => {
        result.current.clearSelection();
      });

      expect(useExplorerSelectionStore.getState().selectedPaths).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Store sync
  // -------------------------------------------------------------------------
  describe("store sync", () => {
    it("syncs selection to useExplorerSelectionStore on plain click", () => {
      const { result } = renderHook(() => useMultiSelect());
      let focusedPath: string | null = null;
      const setFocusedPath = (p: string | null) => {
        focusedPath = p;
      };

      act(() => {
        result.current.handleNodeClick(clickEvent(), "/ws/a.ts", flatNodes, null, setFocusedPath);
      });

      expect(useExplorerSelectionStore.getState().selectedPaths).toContain("/ws/a.ts");
    });
  });
});
