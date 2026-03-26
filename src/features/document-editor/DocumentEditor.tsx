import "@blocknote/react/style.css";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useCreateBlockNote, useEditorChange } from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { useEffect, useRef } from "react";
import { DiagramEmbedBlock } from "./blocks/DiagramEmbedBlock";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  theme: "light" | "dark";
}

// ---------------------------------------------------------------------------
// Custom schema — extends default block specs with DiagramEmbedBlock
// ---------------------------------------------------------------------------

// createReactBlockSpec returns a factory — must be called to get the spec object
const documentSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    diagramEmbed: DiagramEmbedBlock(),
  },
});

// ---------------------------------------------------------------------------
// DocumentEditor — pure presentational component
//
// Does NOT own persistence. The container manages save cycles.
// BlockNote's built-in bubble menu handles formatting on text selection.
//
// NOTE on tryParseMarkdownToBlocks:
//   - It is SYNCHRONOUS in BlockNote 0.47.x (contrary to earlier notes).
//   - We initialize with an empty document and populate via useEffect on mount
//     because useCreateBlockNote runs before the editor instance is available
//     at the call-site of initialContent.
// ---------------------------------------------------------------------------

export function DocumentEditor({ content, onChange, theme }: DocumentEditorProps) {
  const initializedRef = useRef(false);
  const editor = useCreateBlockNote({ schema: documentSchema });

  // Populate editor with file content on first mount only.
  // We guard with initializedRef so re-renders (e.g. theme changes) don't
  // re-populate and clobber in-progress edits.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (!content) return;

    const blocks = editor.tryParseMarkdownToBlocks(content);
    if (blocks.length > 0) {
      editor.replaceBlocks(editor.document, blocks);
    }
  }, [editor, content]);

  // Subscribe to editor content changes and emit markdown upward.
  // useEditorChange handles subscription cleanup on unmount automatically.
  useEditorChange(() => {
    const markdown = editor.blocksToMarkdownLossy();
    onChange(markdown);
  }, editor);

  return (
    <div className="h-full w-full overflow-y-auto bg-muted">
      <div className="max-w-7xl mx-auto my-6 px-12 py-8 bg-background rounded-lg shadow-sm">
        <BlockNoteView editor={editor} theme={theme} />
      </div>
    </div>
  );
}
