import { create } from "zustand";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { DiagramState } from "../types";
import { diagramFileService } from "../services/diagram-file.service";

interface DiagramStoreState {
  diagrams: Record<string, DiagramState>;

  loadDiagram: (instanceId: string, filePath: string) => Promise<void>;
  updateDiagram: (
    instanceId: string,
    elements: readonly ExcalidrawElement[],
    appState: Partial<AppState>
  ) => void;
  saveDiagram: (instanceId: string) => Promise<void>;
  closeDiagram: (instanceId: string) => void;
  getDiagram: (instanceId: string) => DiagramState | undefined;
}

export const useDiagramStore = create<DiagramStoreState>()((set, get) => ({
  diagrams: {},

  loadDiagram: async (instanceId, filePath) => {
    const existing = get().diagrams[instanceId];
    if (existing) return;

    const { elements, appState } = await diagramFileService.readDiagram(filePath);

    set((state) => ({
      diagrams: {
        ...state.diagrams,
        [instanceId]: {
          elements,
          appState,
          isDirty: false,
          filePath,
        },
      },
    }));
  },

  updateDiagram: (instanceId, elements, appState) => {
    set((state) => {
      const current = state.diagrams[instanceId];
      if (!current) {
        console.warn("[Store] updateDiagram: diagram not found for", instanceId);
        return state;
      }
      return {
        diagrams: {
          ...state.diagrams,
          [instanceId]: { ...current, elements, appState, isDirty: true },
        },
      };
    });
  },

  saveDiagram: async (instanceId) => {
    const diagram = get().diagrams[instanceId];
    if (!diagram?.filePath) return;

    await diagramFileService.writeDiagram(diagram.filePath, {
      elements: diagram.elements,
      appState: diagram.appState,
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
