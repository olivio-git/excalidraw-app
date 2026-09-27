/**
 * Open Markdown editors by file path, so workbench flows (save from
 * automation/MCP, wait for saves before closing) can reach their buffers.
 */
export interface MarkdownEditorHandle {
  /** Write pending changes; resolves false if the save failed. */
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

const editors = new Map<string, MarkdownEditorHandle>();

export const markdownEditorRegistry = {
  register(path: string, handle: MarkdownEditorHandle): () => void {
    editors.set(path, handle);
    return () => {
      if (editors.get(path) === handle) editors.delete(path);
    };
  },
  get(path: string): MarkdownEditorHandle | undefined {
    return editors.get(path);
  },
};
