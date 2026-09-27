import { create } from "zustand";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { DiagramState } from "../types";
import { isSameOrDescendant } from "@/core/shell/panels/explorer-file-operations";

// Track changes without publishing every pointer update to React subscribers.
const revisions = new Map<string, number>();
const saves = new Map<string, Promise<void>>();
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
  waitForSaves: (instanceId: string, ignoreErrors?: boolean) => Promise<void>;
  moveDiagrams: (oldPath: string, newPath: string) => void;
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
    if (get().diagrams[instanceId]) revisions.set(instanceId, (revisions.get(instanceId) ?? 0) + 1);
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

    const revision = revisions.get(instanceId) ?? 0;
    const filePath = diagram.filePath;
    const task = (saves.get(instanceId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        await diagramFileService.writeDiagram(filePath, { elements, appState, files });
        set((state) => {
          const current = state.diagrams[instanceId];
          if (!current || current.filePath !== filePath) return state;
          return {
            diagrams: {
              ...state.diagrams,
              [instanceId]: {
                ...current,
                isDirty: (revisions.get(instanceId) ?? 0) !== revision,
                elements,
                appState,
                files,
              },
            },
          };
        });
      });
    saves.set(instanceId, task);
    try {
      await task;
    } finally {
      if (saves.get(instanceId) === task) saves.delete(instanceId);
    }
  },

  closeDiagram: (instanceId) => {
    revisions.delete(instanceId);
    set((state) => {
      const next = { ...state.diagrams };
      delete next[instanceId];
      return { diagrams: next };
    });
  },

  getDiagram: (instanceId) => get().diagrams[instanceId],
  waitForSaves: async (instanceId, ignoreErrors = false) => {
    while (saves.has(instanceId)) {
      try {
        await saves.get(instanceId);
      } catch (error) {
        if (!ignoreErrors) throw error;
      }
    }
  },
  moveDiagrams: (oldPath, newPath) =>
    set((state) => {
      const diagrams = { ...state.diagrams };
      for (const [id, diagram] of Object.entries(state.diagrams)) {
        if (!diagram.filePath || !isSameOrDescendant(diagram.filePath, oldPath)) continue;
        const target = newPath + diagram.filePath.slice(oldPath.length);
        delete diagrams[id];
        diagrams[target] = { ...diagram, filePath: target };
        revisions.set(target, revisions.get(id) ?? 0);
        revisions.delete(id);
      }
      return { diagrams };
    }),
}));
