import { create } from "zustand";

export interface DocumentTab {
  id: string;
  filePath: string;
  title: string;
  content: string;
  isDirty: boolean;
  lastSavedAt: number | null;
  /** Incremented on every external (agent/MCP) write. Used to force editor re-sync. */
  externalVersion: number;
}

interface DocumentState {
  documents: Record<string, DocumentTab>;
  activeDocumentId: string | null;
  openDocument: (filePath: string, content: string) => void;
  updateContent: (id: string, content: string) => void;
  /** Like updateContent but increments externalVersion — use for agent/MCP writes. */
  setExternalContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  closeDocument: (id: string) => void;
  setActive: (id: string) => void;
}

export const useDocumentStore = create<DocumentState>()((set, get) => ({
  documents: {},
  activeDocumentId: null,

  openDocument: (filePath: string, content: string) => {
    const existing = get().documents[filePath];
    if (existing) {
      set({ activeDocumentId: filePath });
      return;
    }
    const title =
      filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? filePath;
    const tab: DocumentTab = {
      id: filePath,
      filePath,
      title,
      content,
      isDirty: false,
      lastSavedAt: null,
      externalVersion: 0,
    };
    set((state) => ({
      documents: { ...state.documents, [filePath]: tab },
      activeDocumentId: filePath,
    }));
  },

  updateContent: (id: string, content: string) => {
    set((state) => {
      const doc = state.documents[id];
      if (!doc) return state;
      return {
        documents: {
          ...state.documents,
          [id]: { ...doc, content, isDirty: true },
        },
      };
    });
  },

  setExternalContent: (id: string, content: string) => {
    set((state) => {
      const doc = state.documents[id];
      if (!doc) return state;
      return {
        documents: {
          ...state.documents,
          [id]: { ...doc, content, isDirty: true, externalVersion: doc.externalVersion + 1 },
        },
      };
    });
  },

  markSaved: (id: string) => {
    set((state) => {
      const doc = state.documents[id];
      if (!doc) return state;
      return {
        documents: {
          ...state.documents,
          [id]: { ...doc, isDirty: false, lastSavedAt: Date.now() },
        },
      };
    });
  },

  closeDocument: (id: string) => {
    set((state) => {
      const { [id]: _removed, ...remaining } = state.documents;
      const wasActive = state.activeDocumentId === id;
      const nextActive = wasActive ? (Object.keys(remaining)[0] ?? null) : state.activeDocumentId;
      return {
        documents: remaining,
        activeDocumentId: nextActive,
      };
    });
  },

  setActive: (id: string) => {
    set({ activeDocumentId: id });
  },
}));
