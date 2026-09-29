import { Facet } from "@codemirror/state";

/** Host services the editor extensions need, provided by the tab container. */
export interface NoteContext {
  /** Absolute path of the note being edited (may change on rename). */
  getFilePath: () => string;
  getWorkspaceDir: () => string | null;
  isDark: () => boolean;
  /** Resolve a link destination written in the note to an absolute path. */
  resolve: (href: string) => Promise<string>;
  /** Open a link (note, diagram, URL, `#heading`) the way the workbench does. */
  open: (href: string, options?: { beside?: boolean }) => void;
  readFile: (path: string) => Promise<Uint8Array>;
  /** Last modification time (ms) of a file, to know when a preview is stale. */
  modifiedAt: (path: string) => Promise<number | null>;
  renderDiagram: (path: string, dark: boolean) => Promise<Blob>;
}

export const noteContext = Facet.define<NoteContext, NoteContext>({
  combine: (values) => values[0],
});
