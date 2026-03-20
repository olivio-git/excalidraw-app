import { describe, it, expect, beforeEach } from "vitest";
import { useExplorerStore, useExplorerSelectionStore } from "./explorerStore";

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  useExplorerStore.setState({ sortOrder: "type-first", showDotfiles: false });
  useExplorerSelectionStore.setState({ selectedPaths: [] });
});

// ---------------------------------------------------------------------------
// useExplorerStore
// ---------------------------------------------------------------------------

describe("useExplorerStore", () => {
  describe("default state", () => {
    it('has sortOrder="type-first"', () => {
      expect(useExplorerStore.getState().sortOrder).toBe("type-first");
    });

    it("has showDotfiles=false", () => {
      expect(useExplorerStore.getState().showDotfiles).toBe(false);
    });
  });

  describe("setSortOrder", () => {
    it('updates sortOrder to "name-asc"', () => {
      useExplorerStore.getState().setSortOrder("name-asc");
      expect(useExplorerStore.getState().sortOrder).toBe("name-asc");
    });

    it('updates sortOrder to "name-desc"', () => {
      useExplorerStore.getState().setSortOrder("name-desc");
      expect(useExplorerStore.getState().sortOrder).toBe("name-desc");
    });

    it('updates sortOrder back to "type-first"', () => {
      useExplorerStore.getState().setSortOrder("name-asc");
      useExplorerStore.getState().setSortOrder("type-first");
      expect(useExplorerStore.getState().sortOrder).toBe("type-first");
    });

    it("does not affect showDotfiles", () => {
      useExplorerStore.setState({ showDotfiles: true });
      useExplorerStore.getState().setSortOrder("name-asc");
      expect(useExplorerStore.getState().showDotfiles).toBe(true);
    });
  });

  describe("setShowDotfiles", () => {
    it("sets showDotfiles to true", () => {
      useExplorerStore.getState().setShowDotfiles(true);
      expect(useExplorerStore.getState().showDotfiles).toBe(true);
    });

    it("sets showDotfiles back to false", () => {
      useExplorerStore.getState().setShowDotfiles(true);
      useExplorerStore.getState().setShowDotfiles(false);
      expect(useExplorerStore.getState().showDotfiles).toBe(false);
    });

    it("does not affect sortOrder", () => {
      useExplorerStore.setState({ sortOrder: "name-desc" });
      useExplorerStore.getState().setShowDotfiles(true);
      expect(useExplorerStore.getState().sortOrder).toBe("name-desc");
    });
  });
});

// ---------------------------------------------------------------------------
// useExplorerSelectionStore
// ---------------------------------------------------------------------------

describe("useExplorerSelectionStore", () => {
  describe("default state", () => {
    it("starts with an empty selectedPaths array", () => {
      expect(useExplorerSelectionStore.getState().selectedPaths).toHaveLength(0);
    });
  });

  describe("setSelectedPaths", () => {
    it("updates selectedPaths to the given array", () => {
      useExplorerSelectionStore.getState().setSelectedPaths(["/ws/a.ts", "/ws/b.ts"]);
      expect(useExplorerSelectionStore.getState().selectedPaths).toEqual(["/ws/a.ts", "/ws/b.ts"]);
    });

    it("replaces the previous selection", () => {
      useExplorerSelectionStore.getState().setSelectedPaths(["/ws/a.ts"]);
      useExplorerSelectionStore.getState().setSelectedPaths(["/ws/b.ts"]);
      expect(useExplorerSelectionStore.getState().selectedPaths).toEqual(["/ws/b.ts"]);
    });

    it("accepts an empty array", () => {
      useExplorerSelectionStore.getState().setSelectedPaths(["/ws/a.ts"]);
      useExplorerSelectionStore.getState().setSelectedPaths([]);
      expect(useExplorerSelectionStore.getState().selectedPaths).toHaveLength(0);
    });
  });

  describe("clearSelection", () => {
    it("empties selectedPaths", () => {
      useExplorerSelectionStore.getState().setSelectedPaths(["/ws/a.ts", "/ws/b.ts"]);
      useExplorerSelectionStore.getState().clearSelection();
      expect(useExplorerSelectionStore.getState().selectedPaths).toHaveLength(0);
    });
  });
});
