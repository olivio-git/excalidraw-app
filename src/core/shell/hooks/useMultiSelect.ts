import { useState, type Dispatch, type SetStateAction, type MouseEvent } from "react";
import type { FlatNode } from "@/core/shell/panels/explorer-types";

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
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());

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
