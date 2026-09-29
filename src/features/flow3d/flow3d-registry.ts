import type { FlowEditorStore } from "./editor-store";

/** Open Flow 3D editors by file path, so commands can act on the active one. */
export interface Flow3DEditorHandle {
  store: FlowEditorStore;
  save: () => Promise<boolean>;
}

const editors = new Map<string, Flow3DEditorHandle>();

export const flow3dRegistry = {
  register(filePath: string, handle: Flow3DEditorHandle): () => void {
    editors.set(filePath, handle);
    return () => {
      if (editors.get(filePath) === handle) editors.delete(filePath);
    };
  },
  get(filePath: string | undefined | null): Flow3DEditorHandle | undefined {
    return filePath ? editors.get(filePath) : undefined;
  },
};
