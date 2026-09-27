import "@blocknote/react/style.css";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useEditorChange } from "@blocknote/react";
import { useEffect, useRef } from "react";
import { usePageSettingsStore } from "@/stores/pageSettingsStore";
import { projectDocument, type DocumentBlock, type DocumentEditorInstance } from "./note-format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentEditorProps {
  editor: DocumentEditorInstance;
  filePath: string;
  content: string;
  blocks: DocumentBlock[] | null;
  externalVersion: number;
  onChange: (markdown: string, blocks: DocumentBlock[]) => void;
  onInitialize: (markdown: string, blocks: DocumentBlock[]) => void;
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
  filePath,
  content,
  blocks,
  externalVersion,
  onChange,
  onInitialize,
  theme,
}: DocumentEditorProps) {
  // Tracks the last externalVersion the editor was populated from.
  // null = never populated (first mount). Re-populates when version changes (agent writes).
  // Regular user edits go through onChange → updateContent (no version bump), so they skip this.
  const lastAppliedVersionRef = useRef<{ path: string; version: number } | null>(null);
  const applying = useRef(false);
  const lastSnapshot = useRef("");

  // Page settings — reactive
  const pageWidthPx = usePageSettingsStore((s) => s.getPageWidthPx());
  const pageHeightPx = usePageSettingsStore((s) => s.getPageHeightPx());
  const margin = usePageSettingsStore((s) => s.margin);
  const orientation = usePageSettingsStore((s) => s.orientation);
  const zoom = usePageSettingsStore((s) => s.zoom);

  useEffect(() => {
    const previous = lastAppliedVersionRef.current;
    if (previous?.path === filePath && previous.version === externalVersion) return;
    applying.current = true;
    try {
      const next = blocks ?? editor.tryParseMarkdownToBlocks(content);
      editor.replaceBlocks(editor.document, next.length ? next : [{ type: "paragraph" }]);
      lastAppliedVersionRef.current = { path: filePath, version: externalVersion };
      lastSnapshot.current = JSON.stringify(editor.document);
      onInitialize(projectDocument(editor), editor.document);
    } finally {
      applying.current = false;
    }
  }, [editor, filePath, content, blocks, externalVersion, onInitialize]);

  // Subscribe to editor content changes and emit markdown upward.
  useEditorChange(() => {
    if (
      applying.current ||
      lastAppliedVersionRef.current?.path !== filePath ||
      lastAppliedVersionRef.current.version !== externalVersion
    )
      return;
    const snapshot = JSON.stringify(editor.document);
    if (snapshot === lastSnapshot.current) return;
    lastSnapshot.current = snapshot;
    const markdown = projectDocument(editor);
    onChange(markdown, editor.document);
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
