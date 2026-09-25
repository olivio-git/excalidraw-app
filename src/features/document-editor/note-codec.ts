import { BlockNoteEditor } from "@blocknote/core";
import { documentSchema } from "./documentSchema";
import { projectDocument, type DocumentBlock, type DocumentEditorInstance } from "./note-format";

let codec: DocumentEditorInstance | undefined;
export function getDocumentCodec(): DocumentEditorInstance {
  codec ??= BlockNoteEditor.create({ schema: documentSchema });
  return codec;
}

/** Preserve complete unchanged native blocks when a text-based agent edits the Markdown projection. */
export function reconcileMarkdownBlocks(
  content: string,
  previous: DocumentBlock[],
  editor = getDocumentCodec()
): DocumentBlock[] {
  const parsed = editor.tryParseMarkdownToBlocks(content);
  const buckets = new Map<string, DocumentBlock[]>();
  for (const block of previous) {
    const key = projectDocument(editor, [block]).trim();
    buckets.set(key, [...(buckets.get(key) ?? []), block]);
  }
  const reused = new Set<string>();
  const result = parsed.map((block) => {
    const existing = buckets.get(projectDocument(editor, [block]).trim())?.shift();
    if (!existing) return block;
    reused.add(existing.id);
    return existing;
  });
  return result.map((block, index) => {
    if (reused.has(block.id)) return block;
    const old = previous[index];
    if (!old || reused.has(old.id) || old.type !== block.type) return block;
    // Markdown cannot express these presentation properties; keep the user's styling.
    const props = { ...block.props } as Record<string, unknown>;
    for (const key of ["textColor", "backgroundColor", "textAlignment"]) {
      if (key in old.props) props[key] = (old.props as Record<string, unknown>)[key];
    }
    return { ...block, id: old.id, props } as DocumentBlock;
  });
}
