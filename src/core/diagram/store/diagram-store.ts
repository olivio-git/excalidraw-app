import { create } from "zustand";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { DiagramState } from "../types";
import { diagramFileService } from "../services/diagram-file.service";

interface DiagramStoreState {
  diagrams: Record<string, DiagramState>;

  loadDiagram: (instanceId: string, filePath: string) => Promise<void>;
  // Only marks the diagram dirty — appState is NOT stored here to avoid
  // feedback loops between onChange → store → re-render → initialData changes.
  // Live appState is read from the ExcalidrawAPI at save time.
  markDirty: (instanceId: string) => void;
  saveDiagram: (
    instanceId: string,
    elements: readonly ExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles
  ) => Promise<void>;
  closeDiagram: (instanceId: string) => void;
  getDiagram: (instanceId: string) => DiagramState | undefined;
}

export const useDiagramStore = create<DiagramStoreState>()((set, get) => ({
  diagrams: {},

  loadDiagram: async (instanceId, filePath) => {
    const existing = get().diagrams[instanceId];
    if (existing) return;

    const { elements, appState, files } = await diagramFileService.readDiagram(filePath);

    set((state) => ({
      diagrams: {
        ...state.diagrams,
        [instanceId]: {
          elements,
          appState,
          files,
          isDirty: false,
          filePath,
        },
      },
    }));
  },

  markDirty: (instanceId) => {
    set((state) => {
      const current = state.diagrams[instanceId];
      if (!current || current.isDirty) return state;
      return {
        diagrams: {
          ...state.diagrams,
          [instanceId]: { ...current, isDirty: true },
        },
      };
    });
  },

  saveDiagram: async (instanceId, elements, appState, files) => {
    const diagram = get().diagrams[instanceId];
    if (!diagram?.filePath) return;

    await diagramFileService.writeDiagram(diagram.filePath, {
      elements,
      appState,
      files,
    });

    set((state) => ({
      diagrams: {
        ...state.diagrams,
        [instanceId]: { ...state.diagrams[instanceId], isDirty: false },
      },
    }));
  },

  closeDiagram: (instanceId) => {
    set((state) => {
      const next = { ...state.diagrams };
      delete next[instanceId];
      return { diagrams: next };
    });
  },

  getDiagram: (instanceId) => get().diagrams[instanceId],
}));
