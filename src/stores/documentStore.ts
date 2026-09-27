import { create } from "zustand";
import { decodeDocument, type DocumentBlock } from "@/features/document-editor/note-format";
import { isSameOrDescendant } from "@/core/shell/panels/explorer-file-operations";

export interface DocumentTab {
  id: string;
  filePath: string;
  title: string;
  content: string;
  isDirty: boolean;
  lastSavedAt: number | null;
  /** Incremented on every external (agent/MCP) write. Used to force editor re-sync. */
  externalVersion: number;
  blocks: DocumentBlock[] | null;
  blocksJson: string | null;
  documentId: string | null;
  revision: number;
  /** Distinguishes reloads of the same persisted document for external optimistic edits. */
  bufferId: string;
}

interface DocumentState {
  documents: Record<string, DocumentTab>;
  activeDocumentId: string | null;
  openDocument: (filePath: string, content: string, activate?: boolean) => void;
  updateContent: (id: string, content: string) => void;
  updateEditorContent: (
    id: string,
    content: string,
    blocks: DocumentBlock[],
    initialize?: boolean
  ) => void;
  /** Like updateContent but increments externalVersion — use for agent/MCP writes. */
  setExternalContent: (id: string, content: string, blocks?: DocumentBlock[]) => void;
  markSaved: (id: string, savedContent?: string, savedRevision?: number) => void;
  closeDocument: (id: string) => void;
  setActive: (id: string) => void;
  moveDocuments: (oldPath: string, newPath: string) => void;
}

export const useDocumentStore = create<DocumentState>()((set, get) => ({
  documents: {},
  activeDocumentId: null,

  openDocument: (filePath: string, content: string, activate = true) => {
    const existing = get().documents[filePath];
    if (existing) {
      if (activate) set({ activeDocumentId: filePath });
      return;
    }
    const snapshot = decodeDocument(filePath, content);
    const title =
      filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? filePath;
    const tab: DocumentTab = {
      id: filePath,
      filePath,
      title,
      ...snapshot,
      blocksJson: snapshot.blocks ? JSON.stringify(snapshot.blocks) : null,
      revision: 0,
      bufferId: crypto.randomUUID(),
      isDirty: false,
      lastSavedAt: null,
      externalVersion: 0,
    };
    set((state) => ({
      documents: { ...state.documents, [filePath]: tab },
      activeDocumentId: activate ? filePath : state.activeDocumentId,
    }));
  },

  updateContent: (id: string, content: string) => {
    set((state) => {
      const doc = state.documents[id];
      if (!doc) return state;
      if (doc.content === content) return state;
      return {
        documents: {
          ...state.documents,
          [id]: {
            ...doc,
            content,
            blocks: null,
            blocksJson: null,
            isDirty: true,
            revision: doc.revision + 1,
          },
        },
      };
    });
  },

  updateEditorContent: (id, content, blocks, initialize = false) => {
    const blocksJson = JSON.stringify(blocks);
    set((state) => {
      const doc = state.documents[id];
      if (!doc || (doc.content === content && doc.blocksJson === blocksJson)) return state;
      return {
        documents: {
          ...state.documents,
          [id]: {
            ...doc,
            content,
            blocks: JSON.parse(blocksJson) as DocumentBlock[],
            blocksJson,
            documentId: doc.documentId ?? crypto.randomUUID(),
            isDirty: initialize ? doc.isDirty : true,
            revision: initialize ? doc.revision : doc.revision + 1,
          },
        },
      };
    });
  },

  setExternalContent: (id: string, content: string, blocks) => {
    set((state) => {
      const doc = state.documents[id];
      if (!doc) return state;
      return {
        documents: {
          ...state.documents,
          [id]: {
            ...doc,
            content,
            blocks: blocks ?? null,
            blocksJson: blocks ? JSON.stringify(blocks) : null,
            isDirty: true,
            revision: doc.revision + 1,
            externalVersion: doc.externalVersion + 1,
          },
        },
      };
    });
  },

  markSaved: (id: string, savedContent?: string, savedRevision?: number) => {
    set((state) => {
      const doc = state.documents[id];
      if (!doc) return state;
      return {
        documents: {
          ...state.documents,
          [id]: {
            ...doc,
            isDirty:
              savedRevision !== undefined
                ? doc.revision !== savedRevision
                : savedContent !== undefined && doc.content !== savedContent,
            lastSavedAt: Date.now(),
          },
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
  moveDocuments: (oldPath, newPath) =>
    set((state) => {
      const documents = { ...state.documents };
      for (const [path, doc] of Object.entries(state.documents)) {
        if (!isSameOrDescendant(path, oldPath)) continue;
        const target = newPath + path.slice(oldPath.length);
        delete documents[path];
        documents[target] = {
          ...doc,
          id: target,
          filePath: target,
          title:
            target
              .split(/[\\/]/)
              .pop()
              ?.replace(/\.[^.]+$/, "") ?? target,
        };
      }
      const activeDocumentId =
        state.activeDocumentId && isSameOrDescendant(state.activeDocumentId, oldPath)
          ? newPath + state.activeDocumentId.slice(oldPath.length)
          : state.activeDocumentId;
      return { documents, activeDocumentId };
    }),
}));
