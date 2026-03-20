import { useState, type Dispatch, type SetStateAction, type MouseEvent } from "react";
import type { FlatNode } from "@/core/shell/panels/explorer-types";
import { useExplorerSelectionStore } from "@/stores/explorerStore";

// ---------------------------------------------------------------------------
// useMultiSelect
// Manages ephemeral multi-selection state for the file explorer.
// selectedPaths lives only in local component state — NOT in explorerStore.
// ---------------------------------------------------------------------------

export interface UseMultiSelectReturn {
  selectedPaths: Set<string>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  handleNodeClick: (
    e: MouseEvent,
    path: string,
    flatNodes: FlatNode[],
    focusedPath: string | null,
    setFocusedPath: (p: string | null) => void
  ) => void;
  clearSelection: () => void;
}

export function useMultiSelect(): UseMultiSelectReturn {
  const [selectedPaths, setSelectedPathsInternal] = useState<Set<string>>(() => new Set());

  // Sync local Set to the external store on every change so MCP and other
  // external consumers can read the selection without prop-drilling.
  const syncToStore = (next: Set<string>) => {
    useExplorerSelectionStore.getState().setSelectedPaths(Array.from(next));
  };

  // Wrapped setter: keeps the local Set state and syncs to external store.
  const setSelectedPaths: Dispatch<SetStateAction<Set<string>>> = (action) => {
    setSelectedPathsInternal((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      syncToStore(next);
      return next;
    });
  };

  const handleNodeClick = (
    e: MouseEvent,
    path: string,
    flatNodes: FlatNode[],
    focusedPath: string | null,
    setFocusedPath: (p: string | null) => void
  ) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle individual node
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
      // Keep current focused path, update to clicked if none
      if (!focusedPath) setFocusedPath(path);
    } else if (e.shiftKey && focusedPath !== null) {
      // Shift+click: range select
      const anchorIndex = flatNodes.findIndex((n) => n.path === focusedPath);
      const clickedIndex = flatNodes.findIndex((n) => n.path === path);
      if (anchorIndex === -1 || clickedIndex === -1) {
        setSelectedPaths(new Set([path]));
        setFocusedPath(path);
        return;
      }
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      const rangeSet = new Set<string>();
      for (let i = start; i <= end; i++) {
        rangeSet.add(flatNodes[i].path);
      }
      setSelectedPaths(rangeSet);
      // Anchor stays; do NOT update focusedPath on shift+click
    } else {
      // Plain click: clear and select only this node
      setSelectedPaths(new Set([path]));
      setFocusedPath(path);
    }
  };

  const clearSelection = () => {
    setSelectedPaths(new Set());
  };

  return {
    selectedPaths,
    setSelectedPaths,
    handleNodeClick,
    clearSelection,
  };
}
