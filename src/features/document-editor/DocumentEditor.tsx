import "@blocknote/react/style.css";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useEditorChange } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import { useEffect, useRef } from "react";
import { usePageSettingsStore } from "@/stores/pageSettingsStore";
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

  // Page settings — reactive
  const pageWidthPx = usePageSettingsStore((s) => s.getPageWidthPx());
  const pageHeightPx = usePageSettingsStore((s) => s.getPageHeightPx());
  const margin = usePageSettingsStore((s) => s.margin);
  const orientation = usePageSettingsStore((s) => s.orientation);
  const zoom = usePageSettingsStore((s) => s.zoom);

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
    <div className="document-scroll h-full w-full">
      <div className="document-zoom-wrapper" style={{ transform: `scale(${zoom})` }}>
        <div
          className="document-paper"
          style={
            {
              "--page-width": `${pageWidthPx}px`,
              "--page-margin": `${margin}px`,
              "--page-height": orientation === "portrait" ? `${pageHeightPx}px` : "auto",
            } as React.CSSProperties
          }
        >
          <BlockNoteView editor={editor} theme={theme} />
        </div>
      </div>
    </div>
  );
}
