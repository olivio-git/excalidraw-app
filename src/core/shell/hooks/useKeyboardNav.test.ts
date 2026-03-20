import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useKeyboardNav } from "./useKeyboardNav";
import type { FlatNode, UseKeyboardNavOptions } from "@/core/shell/panels/explorer-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeNodes = (): FlatNode[] => [
  { path: "/ws/dir", name: "dir", isDir: true, depth: 0, parentPath: null, index: 0 },
  { path: "/ws/dir/a.ts", name: "a.ts", isDir: false, depth: 1, parentPath: "/ws/dir", index: 1 },
  { path: "/ws/b.ts", name: "b.ts", isDir: false, depth: 0, parentPath: null, index: 2 },
  { path: "/ws/c.ts", name: "c.ts", isDir: false, depth: 0, parentPath: null, index: 3 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fire a keydown event on window and simulate the container having focus
 * by directly setting hasFocusRef to true via focusin.
 */
function fireKey(container: HTMLElement, key: string, opts: KeyboardEventInit = {}) {
  // Ensure the hook believes the container has focus by dispatching focusin
  container.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts })
  );
}

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useKeyboardNav", () => {
  // -------------------------------------------------------------------------
  // Setup helper — creates a container element, renders the hook,
  // and returns control handles.
  // -------------------------------------------------------------------------
  function setup(
    overrides: Partial<UseKeyboardNavOptions> = {},
    initialFocusedPath: string | null = null,
    renamingPath: string | null = null,
    creating = false
  ) {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const onOpen = vi.fn();
    const onStartRename = vi.fn();
    const onDelete = vi.fn();
    const onToggle = vi.fn();
    const setSelectedPaths = vi.fn();
    const cancelAction = vi.fn();

    let focusedPath = initialFocusedPath;
    const setFocusedPath = vi.fn((p: string | null) => {
      focusedPath = p;
    });

    const nodes = makeNodes();
    const expandedPaths = new Set<string>(["/ws/dir"]);

    const options: UseKeyboardNavOptions = {
      flatNodes: nodes,
      expandedPaths,
      onOpen,
      onStartRename,
      onDelete,
      onToggle,
      selectedPaths: new Set(),
      setSelectedPaths,
      ...overrides,
    };

    const { unmount } = renderHook(() => {
      const ref = { current: container };
      useKeyboardNav(
        ref,
        options,
        focusedPath,
        setFocusedPath,
        renamingPath,
        creating,
        cancelAction
      );
    });

    return {
      container,
      onOpen,
      onStartRename,
      onDelete,
      onToggle,
      setSelectedPaths,
      cancelAction,
      setFocusedPath,
      getFocusedPath: () => focusedPath,
      unmount: () => {
        unmount();
        document.body.removeChild(container);
      },
    };
  }

  // -------------------------------------------------------------------------
  // Focus guard: keys should be no-ops when container does NOT have focus
  // -------------------------------------------------------------------------
  describe("focus guard", () => {
    it("ignores ArrowDown when container does not have focus", () => {
      const { container, setFocusedPath, unmount } = setup();

      // Do NOT fire focusin — container has no focus
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));

      expect(setFocusedPath).not.toHaveBeenCalled();
      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // ArrowDown / ArrowUp navigation
  // -------------------------------------------------------------------------
  describe("ArrowDown", () => {
    it("moves focusedPath to the next node in flatNodes", () => {
      const { container, setFocusedPath, unmount } = setup({}, "/ws/dir");

      act(() => {
        fireKey(container, "ArrowDown");
      });

      // From index 0 (/ws/dir) → index 1 (/ws/dir/a.ts)
      expect(setFocusedPath).toHaveBeenCalledWith("/ws/dir/a.ts");
      unmount();
    });

    it("moves focusedPath to the first node when none is focused", () => {
      const { container, setFocusedPath, unmount } = setup({}, null);

      act(() => {
        fireKey(container, "ArrowDown");
      });

      expect(setFocusedPath).toHaveBeenCalledWith("/ws/dir");
      unmount();
    });

    it("wraps from last node back to first (no wrap — stays at last)", () => {
      // Current implementation does NOT wrap — it clamps at last
      const { container, setFocusedPath, unmount } = setup({}, "/ws/c.ts");

      act(() => {
        fireKey(container, "ArrowDown");
      });

      // Last node index 3 (/ws/c.ts) — stays
      expect(setFocusedPath).toHaveBeenCalledWith("/ws/c.ts");
      unmount();
    });
  });

  describe("ArrowUp", () => {
    it("moves focusedPath to the previous node", () => {
      const { container, setFocusedPath, unmount } = setup({}, "/ws/dir/a.ts");

      act(() => {
        fireKey(container, "ArrowUp");
      });

      // index 1 → index 0 (/ws/dir)
      expect(setFocusedPath).toHaveBeenCalledWith("/ws/dir");
      unmount();
    });

    it("moves focusedPath to the last node when none is focused", () => {
      const { container, setFocusedPath, unmount } = setup({}, null);

      act(() => {
        fireKey(container, "ArrowUp");
      });

      expect(setFocusedPath).toHaveBeenCalledWith("/ws/c.ts");
      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // ArrowRight — expand folder / move into first child
  // -------------------------------------------------------------------------
  describe("ArrowRight", () => {
    it("expands a collapsed folder", () => {
      // /ws/dir is expanded by default in setup — use a collapsed folder
      const { container, onToggle, unmount } = setup(
        {
          expandedPaths: new Set(), // nothing expanded
        },
        "/ws/dir"
      );

      act(() => {
        fireKey(container, "ArrowRight");
      });

      expect(onToggle).toHaveBeenCalledWith("/ws/dir");
      unmount();
    });

    it("moves focus to first child when folder is already expanded", () => {
      const { container, setFocusedPath, onToggle, unmount } = setup(
        {
          expandedPaths: new Set(["/ws/dir"]),
        },
        "/ws/dir"
      );

      act(() => {
        fireKey(container, "ArrowRight");
      });

      // Should focus first child, not toggle
      expect(setFocusedPath).toHaveBeenCalledWith("/ws/dir/a.ts");
      expect(onToggle).not.toHaveBeenCalled();
      unmount();
    });

    it("is a no-op on a file node", () => {
      const { container, onToggle, setFocusedPath, unmount } = setup({}, "/ws/b.ts");

      act(() => {
        fireKey(container, "ArrowRight");
      });

      expect(onToggle).not.toHaveBeenCalled();
      expect(setFocusedPath).not.toHaveBeenCalled();
      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // ArrowLeft — collapse folder / move to parent
  // -------------------------------------------------------------------------
  describe("ArrowLeft", () => {
    it("collapses an expanded folder", () => {
      const { container, onToggle, unmount } = setup(
        {
          expandedPaths: new Set(["/ws/dir"]),
        },
        "/ws/dir"
      );

      act(() => {
        fireKey(container, "ArrowLeft");
      });

      expect(onToggle).toHaveBeenCalledWith("/ws/dir");
      unmount();
    });

    it("moves focus to parent when node has a parent", () => {
      const { container, setFocusedPath, unmount } = setup(
        {
          expandedPaths: new Set(["/ws/dir"]),
        },
        "/ws/dir/a.ts"
      );

      act(() => {
        fireKey(container, "ArrowLeft");
      });

      expect(setFocusedPath).toHaveBeenCalledWith("/ws/dir");
      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Enter — open file / toggle folder
  // -------------------------------------------------------------------------
  describe("Enter", () => {
    it("opens a file", () => {
      const { container, onOpen, unmount } = setup({}, "/ws/b.ts");

      act(() => {
        fireKey(container, "Enter");
      });

      expect(onOpen).toHaveBeenCalledWith("/ws/b.ts", "b.ts");
      unmount();
    });

    it("toggles a folder", () => {
      const { container, onToggle, onOpen, unmount } = setup({}, "/ws/dir");

      act(() => {
        fireKey(container, "Enter");
      });

      expect(onToggle).toHaveBeenCalledWith("/ws/dir");
      expect(onOpen).not.toHaveBeenCalled();
      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // F2 — trigger rename
  // -------------------------------------------------------------------------
  describe("F2", () => {
    it("calls onStartRename with the focused path", () => {
      const { container, onStartRename, unmount } = setup({}, "/ws/b.ts");

      act(() => {
        fireKey(container, "F2");
      });

      expect(onStartRename).toHaveBeenCalledWith("/ws/b.ts");
      unmount();
    });

    it("is a no-op when no path is focused", () => {
      const { container, onStartRename, unmount } = setup({}, null);

      act(() => {
        fireKey(container, "F2");
      });

      expect(onStartRename).not.toHaveBeenCalled();
      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Escape — cancelAction AND clear selection + focus
  // -------------------------------------------------------------------------
  describe("Escape", () => {
    it("calls cancelAction", () => {
      const { container, cancelAction, unmount } = setup({}, "/ws/b.ts");

      act(() => {
        fireKey(container, "Escape");
      });

      expect(cancelAction).toHaveBeenCalled();
      unmount();
    });

    it("clears selection (setSelectedPaths called with empty Set)", () => {
      const { container, setSelectedPaths, unmount } = setup({}, "/ws/b.ts");

      act(() => {
        fireKey(container, "Escape");
      });

      expect(setSelectedPaths).toHaveBeenCalledWith(new Set());
      unmount();
    });

    it("clears focusedPath (setFocusedPath called with null)", () => {
      const { container, setFocusedPath, unmount } = setup({}, "/ws/b.ts");

      act(() => {
        fireKey(container, "Escape");
      });

      expect(setFocusedPath).toHaveBeenCalledWith(null);
      unmount();
    });

    it("calls cancelAction even when an inline input is active (renamingPath set)", () => {
      const { container, cancelAction, unmount } = setup({}, "/ws/b.ts", "/ws/b.ts");

      act(() => {
        fireKey(container, "Escape");
      });

      expect(cancelAction).toHaveBeenCalled();
      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Modifier combos are skipped
  // -------------------------------------------------------------------------
  describe("modifier combos", () => {
    it("ignores ArrowDown when Ctrl is held", () => {
      const { container, setFocusedPath, unmount } = setup({}, "/ws/dir");

      act(() => {
        fireKey(container, "ArrowDown", { ctrlKey: true });
      });

      expect(setFocusedPath).not.toHaveBeenCalled();
      unmount();
    });
  });
});
