import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDiagramStore } from "./diagram-store";

// ---------------------------------------------------------------------------
// Mock diagramFileService — tests must not touch the filesystem
// ---------------------------------------------------------------------------

vi.mock("../services/diagram-file.service", () => ({
  diagramFileService: {
    readDiagram: vi.fn().mockResolvedValue({
      elements: [],
      appState: {},
      files: {},
    }),
    writeDiagram: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  useDiagramStore.setState({ diagrams: {} });
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("DiagramStore", () => {
  // -------------------------------------------------------------------------
  // loadDiagram
  // -------------------------------------------------------------------------
  describe("loadDiagram", () => {
    it("creates a diagram entry with isDirty=false", async () => {
      await useDiagramStore.getState().loadDiagram("inst-1", "/ws/file.excalidraw");

      const diagram = useDiagramStore.getState().diagrams["inst-1"];
      expect(diagram).toBeDefined();
      expect(diagram.isDirty).toBe(false);
      expect(diagram.filePath).toBe("/ws/file.excalidraw");
    });

    it("does not overwrite an existing diagram (idempotent)", async () => {
      await useDiagramStore.getState().loadDiagram("inst-1", "/ws/file.excalidraw");
      useDiagramStore.getState().markDirty("inst-1");

      // Load again — should not reset the dirty state
      await useDiagramStore.getState().loadDiagram("inst-1", "/ws/file.excalidraw");

      expect(useDiagramStore.getState().diagrams["inst-1"].isDirty).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // markDirty (W2: dirty dot regression)
  // -------------------------------------------------------------------------
  describe("markDirty", () => {
    it("transitions isDirty from false to true", async () => {
      await useDiagramStore.getState().loadDiagram("inst-1", "/ws/file.excalidraw");
      expect(useDiagramStore.getState().diagrams["inst-1"].isDirty).toBe(false);

      useDiagramStore.getState().markDirty("inst-1");

      expect(useDiagramStore.getState().diagrams["inst-1"].isDirty).toBe(true);
    });

    it("is idempotent — calling twice keeps isDirty=true without extra state updates", async () => {
      await useDiagramStore.getState().loadDiagram("inst-1", "/ws/file.excalidraw");
      useDiagramStore.getState().markDirty("inst-1");
      useDiagramStore.getState().markDirty("inst-1");

      expect(useDiagramStore.getState().diagrams["inst-1"].isDirty).toBe(true);
    });

    it("does nothing for an unknown instanceId", () => {
      useDiagramStore.getState().markDirty("nonexistent");

      expect(useDiagramStore.getState().diagrams["nonexistent"]).toBeUndefined();
    });

    it("does not affect sibling diagrams", async () => {
      await useDiagramStore.getState().loadDiagram("inst-1", "/ws/a.excalidraw");
      await useDiagramStore.getState().loadDiagram("inst-2", "/ws/b.excalidraw");

      useDiagramStore.getState().markDirty("inst-1");

      expect(useDiagramStore.getState().diagrams["inst-2"].isDirty).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // saveDiagram (W2: dirty cleared after save)
  // -------------------------------------------------------------------------
  describe("saveDiagram", () => {
    it("clears isDirty after a successful save", async () => {
      await useDiagramStore.getState().loadDiagram("inst-1", "/ws/file.excalidraw");
      useDiagramStore.getState().markDirty("inst-1");
      expect(useDiagramStore.getState().diagrams["inst-1"].isDirty).toBe(true);

      await useDiagramStore.getState().saveDiagram("inst-1", [], {}, {});

      expect(useDiagramStore.getState().diagrams["inst-1"].isDirty).toBe(false);
    });

    it("does nothing when instanceId has no filePath", async () => {
      // Manually inject a diagram without a filePath
      useDiagramStore.setState({
        diagrams: {
          "inst-orphan": { elements: [], appState: {}, files: {}, isDirty: true, filePath: "" },
        },
      });

      await useDiagramStore.getState().saveDiagram("inst-orphan", [], {}, {});

      // Should not throw and should not change state
      expect(useDiagramStore.getState().diagrams["inst-orphan"].isDirty).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // closeDiagram
  // -------------------------------------------------------------------------
  describe("closeDiagram", () => {
    it("removes the diagram from the store", async () => {
      await useDiagramStore.getState().loadDiagram("inst-1", "/ws/file.excalidraw");
      useDiagramStore.getState().closeDiagram("inst-1");

      expect(useDiagramStore.getState().diagrams["inst-1"]).toBeUndefined();
    });

    it("does not affect other diagrams", async () => {
      await useDiagramStore.getState().loadDiagram("inst-1", "/ws/a.excalidraw");
      await useDiagramStore.getState().loadDiagram("inst-2", "/ws/b.excalidraw");

      useDiagramStore.getState().closeDiagram("inst-1");

      expect(useDiagramStore.getState().diagrams["inst-2"]).toBeDefined();
    });
  });
});
