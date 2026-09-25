import type { Block, BlockNoteEditor } from "@blocknote/core";
import type { DocumentSchema } from "./documentSchema";

export type DocumentBlock = Block<
  DocumentSchema["blockSchema"],
  DocumentSchema["inlineContentSchema"],
  DocumentSchema["styleSchema"]
>;
export type DocumentEditorInstance = BlockNoteEditor<
  DocumentSchema["blockSchema"],
  DocumentSchema["inlineContentSchema"],
  DocumentSchema["styleSchema"]
>;

export interface DocumentSnapshot {
  content: string;
  blocks: DocumentBlock[] | null;
  documentId: string | null;
}

const NOTE_FORMAT = "workspace-note";
export const isRichNote = (path: string) => /\.note$/i.test(path);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validateBlocks(value: unknown): asserts value is DocumentBlock[] {
  if (!Array.isArray(value)) throw new Error("Invalid note: blocks must be an array.");
  const ids = new Set<string>();
  const visit = (blocks: unknown[]) => {
    for (const block of blocks) {
      if (
        !isRecord(block) ||
        typeof block.id !== "string" ||
        !block.id ||
        typeof block.type !== "string" ||
        !block.type ||
        !isRecord(block.props)
      )
        throw new Error("Invalid note block.");
      if (ids.has(block.id)) throw new Error(`Duplicate note block ID: ${block.id}`);
      ids.add(block.id);
      if (!Array.isArray(block.children)) throw new Error("Invalid note children.");
      visit(block.children);
    }
  };
  visit(value);
}

/** Legacy .note files remain readable as Markdown until the next explicit/user edit save. */
export function decodeDocument(path: string, raw: string): DocumentSnapshot {
  const legacy: DocumentSnapshot = { content: raw, blocks: null, documentId: null };
  if (!isRichNote(path) || !raw.trimStart().startsWith("{")) return legacy;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (/"format"\s*:\s*"workspace-note"/.test(raw)) throw error;
    return legacy;
  }
  if (!isRecord(parsed) || parsed.format !== NOTE_FORMAT) return legacy;
  if (parsed.version !== 1)
    throw new Error("Unsupported note version. The original file has not been changed.");
  if (typeof parsed.id !== "string" || !parsed.id || typeof parsed.markdown !== "string")
    throw new Error("Invalid note metadata.");
  validateBlocks(parsed.blocks);
  return { content: parsed.markdown, blocks: parsed.blocks, documentId: parsed.id };
}

export function encodeDocument(path: string, snapshot: DocumentSnapshot): string {
  if (!isRichNote(path)) return snapshot.content;
  if (!snapshot.blocks) throw new Error("Rich note blocks have not been initialized.");
  validateBlocks(snapshot.blocks);
  return JSON.stringify(
    {
      format: NOTE_FORMAT,
      version: 1,
      id: snapshot.documentId ?? crypto.randomUUID(),
      markdown: snapshot.content,
      blocks: snapshot.blocks,
    },
    null,
    2
  );
}

export function createEmptyNote(): string {
  return encodeDocument("new.note", { content: "", blocks: [], documentId: crypto.randomUUID() });
}

/** Project linked blocks using standard nodes: React block renderers must not run in editor effects. */
export function projectDocument(
  editor: DocumentEditorInstance,
  blocks: DocumentBlock[] = editor.document
): string {
  const prepare = (items: DocumentBlock[]): DocumentBlock[] =>
    items.map((block) => {
      const children = prepare(block.children);
      if (block.type !== "diagramEmbed") return { ...block, children };
      return {
        id: block.id,
        type: "paragraph",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        content: [
          {
            type: "link",
            href: block.props.diagramPath,
            content: [{ type: "text", text: block.props.caption || "Diagram", styles: {} }],
          },
        ],
        children,
      };
    });
  return editor.blocksToMarkdownLossy(prepare(blocks));
}

export function inlineText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(inlineText).join("");
  if (isRecord(value))
    return typeof value.text === "string" ? value.text : inlineText(value.content);
  return "";
}

export function documentOutline(blocks: DocumentBlock[]) {
  const headings: { id: string; title: string; level: number }[] = [];
  const visit = (items: DocumentBlock[]) => {
    for (const block of items) {
      if (block.type === "heading")
        headings.push({ id: block.id, title: inlineText(block.content), level: block.props.level });
      if (block.children.length) visit(block.children);
    }
  };
  visit(blocks);
  return headings;
}
