import { useEffect, useRef, type RefObject } from "react";
import type { UseKeyboardNavOptions } from "@/core/shell/panels/explorer-types";

// ---------------------------------------------------------------------------
// useKeyboardNav
// Handles keyboard navigation within the explorer panel.
// Only active when the explorer container has focus.
// ---------------------------------------------------------------------------

export function useKeyboardNav(
  containerRef: RefObject<HTMLElement | null>,
  options: UseKeyboardNavOptions,
  focusedPath: string | null,
  setFocusedPath: (path: string | null) => void,
  renamingPath: string | null,
  creating: boolean,
  cancelAction: () => void
) {
  const { flatNodes, expandedPaths, onOpen, onStartRename, onDelete, onToggle } = options;

  // Track whether the panel container is focused
  const hasFocusRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onFocus = () => {
      hasFocusRef.current = true;
    };
    const onBlur = (e: FocusEvent) => {
      // Only lose focus if the new target is outside the container
      if (!container.contains(e.relatedTarget as Node | null)) {
        hasFocusRef.current = false;
      }
    };

    container.addEventListener("focusin", onFocus);
    container.addEventListener("focusout", onBlur);
    return () => {
      container.removeEventListener("focusin", onFocus);
      container.removeEventListener("focusout", onBlur);
    };
  }, [containerRef]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Gate: only handle if panel has focus
      if (!hasFocusRef.current) return;

      // If an inline input is active (rename / create), only Escape is handled
      if (renamingPath !== null || creating) {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelAction();
        }
        return;
      }

      // Skip modifier combos (Ctrl+C, etc.)
      if (e.ctrlKey || e.metaKey) return;

      const currentIndex = flatNodes.findIndex((n) => n.path === focusedPath);

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          if (flatNodes.length === 0) return;
          const nextIndex =
            currentIndex === -1 ? 0 : Math.min(currentIndex + 1, flatNodes.length - 1);
          setFocusedPath(flatNodes[nextIndex].path);
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          if (flatNodes.length === 0) return;
          const prevIndex =
            currentIndex === -1 ? flatNodes.length - 1 : Math.max(currentIndex - 1, 0);
          setFocusedPath(flatNodes[prevIndex].path);
          break;
        }

        case "ArrowRight": {
          e.preventDefault();
          if (currentIndex === -1) return;
          const node = flatNodes[currentIndex];
          if (!node.isDir) return;
          if (!expandedPaths.has(node.path)) {
            // Expand the folder
            onToggle(node.path);
          } else {
            // Move focus to first child (next in flat list)
            const nextIndex = currentIndex + 1;
            if (nextIndex < flatNodes.length && flatNodes[nextIndex].depth > node.depth) {
              setFocusedPath(flatNodes[nextIndex].path);
            }
          }
          break;
        }

        case "ArrowLeft": {
          e.preventDefault();
          if (currentIndex === -1) return;
          const node = flatNodes[currentIndex];
          if (node.isDir && expandedPaths.has(node.path)) {
            // Collapse folder
            onToggle(node.path);
          } else if (node.parentPath !== null) {
            // Move focus to parent
            setFocusedPath(node.parentPath);
          }
          break;
        }

        case "Enter": {
          e.preventDefault();
          if (currentIndex === -1) return;
          const node = flatNodes[currentIndex];
          if (node.isDir) {
            onToggle(node.path);
          } else {
            onOpen(node.path, node.name);
          }
          break;
        }

        case "F2": {
          e.preventDefault();
          if (currentIndex === -1) return;
          onStartRename(flatNodes[currentIndex].path);
          break;
        }

        case "Delete": {
          e.preventDefault();
          if (currentIndex === -1) return;
          const node = flatNodes[currentIndex];
          onDelete(node.path, node.isDir);
          break;
        }

        case "Escape": {
          e.preventDefault();
          cancelAction();
          // Clear selection and focus when no inline input is active
          options.setSelectedPaths?.(new Set());
          setFocusedPath(null);
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    flatNodes,
    expandedPaths,
    focusedPath,
    renamingPath,
    creating,
    onOpen,
    onStartRename,
    onDelete,
    onToggle,
    setFocusedPath,
    cancelAction,
  ]);
}
