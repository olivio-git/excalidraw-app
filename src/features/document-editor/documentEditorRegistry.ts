import type { BlockNoteEditor } from "@blocknote/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;

/**
 * Registry of mounted BlockNote editor instances, keyed by filePath.
 *
 * Follows the same pattern as DiagramController's static instance registry.
 * DocumentEditorContainer registers/unregisters its editor on mount/unmount.
 * The MCP bridge reads from here to apply block-level styling that cannot
 * be expressed in plain markdown (e.g. textColor, backgroundColor).
 */
const _registry = new Map<string, AnyEditor>();

export const documentEditorRegistry = {
  register(filePath: string, editor: AnyEditor): void {
    _registry.set(filePath, editor);
  },

  unregister(filePath: string): void {
    _registry.delete(filePath);
  },

  getEditor(filePath: string): AnyEditor | undefined {
    return _registry.get(filePath);
  },
};
