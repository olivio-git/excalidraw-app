import "@blocknote/react/style.css";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useEditorChange } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import { useEffect, useRef } from "react";
import type { DocumentSchema } from "./documentSchema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EditorInstance = BlockNoteEditor<
  DocumentSchema["blockSchema"],
  DocumentSchema["inlineContentSchema"],
  DocumentSchema["styleSchema"]
>;

interface DocumentEditorProps {
  editor: EditorInstance;
  content: string;
  externalVersion: number;
  onChange: (markdown: string) => void;
  theme: "light" | "dark";
}

// ---------------------------------------------------------------------------
// DocumentEditor — pure presentational component
//
// Does NOT own persistence or the editor instance — both are managed by
// DocumentEditorContainer. Receives the editor as a prop so the container
// can call editor.blocksToFullHTML() / blocksToMarkdownLossy() for exports.
//
// NOTE on tryParseMarkdownToBlocks:
//   - It is SYNCHRONOUS in BlockNote 0.47.x (contrary to earlier notes).
//   - We initialize with an empty document and populate via useEffect on mount
//     because useCreateBlockNote runs before the editor instance is available
//     at the call-site of initialContent.
// ---------------------------------------------------------------------------

export function DocumentEditor({
  editor,
  content,
  externalVersion,
  onChange,
  theme,
}: DocumentEditorProps) {
  // Tracks the last externalVersion the editor was populated from.
  // null = never populated (first mount). Re-populates when version changes (agent writes).
  // Regular user edits go through onChange → updateContent (no version bump), so they skip this.
  const lastAppliedVersionRef = useRef<number | null>(null);

  useEffect(() => {
    const isFirstMount = lastAppliedVersionRef.current === null;
    const isExternalUpdate = lastAppliedVersionRef.current !== externalVersion;

    if (!isFirstMount && !isExternalUpdate) return;

    lastAppliedVersionRef.current = externalVersion;

    if (!content) return;

    const blocks = editor.tryParseMarkdownToBlocks(content);
    if (blocks.length > 0) {
      editor.replaceBlocks(editor.document, blocks);
    }
  }, [editor, content, externalVersion]);

  // Subscribe to editor content changes and emit markdown upward.
  useEditorChange(() => {
    const markdown = editor.blocksToMarkdownLossy();
    onChange(markdown);
  }, editor);

  return (
    <div className="h-full w-full overflow-y-auto bg-muted">
      <div className="document-paper max-w-[794px] mx-auto mb-8 px-16 py-12 bg-background shadow-md">
        <BlockNoteView editor={editor} theme={theme} />
      </div>
    </div>
  );
}
