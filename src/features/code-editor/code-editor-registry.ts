import type { EditorView } from "@codemirror/view";

/** Open code editor buffers, so workbench flows (save all, reveal) can reach them. */
export interface CodeEditorHandle {
  save(): Promise<boolean>;
  isDirty(): boolean;
  getView(): EditorView | null;
}

class CodeEditorRegistry {
  private handles = new Map<string, CodeEditorHandle>();

  register(filePath: string, handle: CodeEditorHandle): () => void {
    this.handles.set(filePath, handle);
    return () => {
      if (this.handles.get(filePath) === handle) this.handles.delete(filePath);
    };
  }

  get(filePath: string): CodeEditorHandle | undefined {
    return this.handles.get(filePath);
  }

  getAll(): Array<[string, CodeEditorHandle]> {
    return [...this.handles.entries()];
  }
}

export const codeEditorRegistry = new CodeEditorRegistry();
