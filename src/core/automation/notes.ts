import { exists, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { dirname } from "@tauri-apps/api/path";
import type { PartialBlock } from "@blocknote/core";
import type { DocumentSchema } from "@/features/document-editor/documentSchema";
import {
  encodeDocument,
  isRichNote,
  projectDocument,
  documentOutline,
  type DocumentBlock,
} from "@/features/document-editor/note-format";
import { getDocumentController } from "@/features/document-editor/documentController.singleton";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { createFileReference } from "@/core/shell/services/file-navigation";
import {
  AutomationError,
  group,
  integer,
  object,
  optionalBoolean,
  text,
  workspacePath,
} from "./validation";
import { workbenchActions } from "./workbench";
import type { EditorGroupId } from "@/core/tabs/types";
import { fileHandlerRegistry } from "@/core/shell/panels/file-handler-registry";
import { isValidEntryName } from "@/core/shell/panels/explorer-file-operations";

export interface BlockInput {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlockInput[];
}
export interface BlockPlacement {
  parentId?: string | null;
  index?: number;
}
export interface NoteCreateInput {
  filePath: string;
  blocks?: BlockInput[];
  markdown?: string;
  open?: boolean;
  groupId?: EditorGroupId;
}
export interface NoteMutation {
  filePath: string;
  expectedRevision?: string;
}
export interface BlockReadOptions {
  offset?: number;
  limit?: number;
  includeDataUrls?: boolean;
}
type PartialDocumentBlock = PartialBlock<
  DocumentSchema["blockSchema"],
  DocumentSchema["inlineContentSchema"],
  DocumentSchema["styleSchema"]
>;

async function codec() {
  return (await import("@/features/document-editor/note-codec")).getDocumentCodec();
}
function visit(
  blocks: DocumentBlock[],
  id: string
): { block: DocumentBlock; siblings: DocumentBlock[]; index: number } | undefined {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.id === id) return { block, siblings: blocks, index };
    const found = visit(block.children, id);
    if (found) return found;
  }
}
function place(
  blocks: DocumentBlock[],
  placement: BlockPlacement
): { siblings: DocumentBlock[]; index: number } {
  if (placement.parentId !== undefined && placement.parentId !== null)
    text(placement.parentId, "parentId");
  const parent = placement.parentId ? visit(blocks, placement.parentId) : undefined;
  if (placement.parentId && !parent)
    throw new AutomationError("BLOCK_NOT_FOUND", "Parent block not found.");
  const siblings = parent ? parent.block.children : blocks;
  return {
    siblings,
    index:
      placement.index === undefined
        ? siblings.length
        : integer(placement.index, "index", 0, siblings.length),
  };
}
async function normalizeBlocks(input: BlockInput[]): Promise<DocumentBlock[]> {
  if (!Array.isArray(input))
    throw new AutomationError("INVALID_BLOCKS", "blocks must be an array.");
  const editor = await codec();
  const ids = new Set<string>();
  const rejectPlaceholders = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(rejectPlaceholders);
      return;
    }
    if (!object(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (["url", "href", "src", "diagramPath"].includes(key) && child === "[embedded-image]")
        throw new AutomationError(
          "REDACTED_DATA",
          "Do not write an embedded-image placeholder back. Omit that property or read with includeDataUrls=true."
        );
      if (typeof child === "object") rejectPlaceholders(child);
    }
  };
  rejectPlaceholders(input);
  const schema = editor.schema.blockSchema as Record<
    string,
    {
      content: string;
      propSchema: Record<string, { default?: unknown; type?: string; values?: readonly unknown[] }>;
    }
  >;
  const validate = (blocks: BlockInput[]): BlockInput[] =>
    blocks.map((block) => {
      if (!object(block))
        throw new AutomationError("INVALID_BLOCKS", "Each block must be an object.");
      if (
        Object.keys(block).some(
          (key) => !["id", "type", "props", "content", "children"].includes(key)
        )
      )
        throw new AutomationError("INVALID_BLOCKS", "Unknown block field.");
      const type = text(block.type, "block.type"),
        spec = schema[type];
      if (!Object.hasOwn(schema, type))
        throw new AutomationError("INVALID_BLOCK_TYPE", `Unsupported block type: ${type}`);
      if (
        block.content !== undefined &&
        (spec.content === "none" ||
          (spec.content === "inline" &&
            typeof block.content !== "string" &&
            !Array.isArray(block.content)))
      )
        throw new AutomationError("INVALID_BLOCK_CONTENT", `Invalid content for ${type}.`);
      const id = block.id === undefined ? crypto.randomUUID() : text(block.id, "block.id");
      if (ids.has(id)) throw new AutomationError("DUPLICATE_BLOCK_ID", `Duplicate block ID: ${id}`);
      ids.add(id);
      if (block.props !== undefined) {
        if (!object(block.props))
          throw new AutomationError("INVALID_BLOCK_PROPS", "props must be an object.");
        for (const [key, value] of Object.entries(block.props)) {
          const rule = spec.propSchema[key];
          if (
            !Object.hasOwn(spec.propSchema, key) ||
            typeof value !== (rule.type ?? typeof rule.default) ||
            (rule.values && !rule.values.includes(value))
          )
            throw new AutomationError("INVALID_BLOCK_PROPS", `Invalid ${type} property: ${key}`);
        }
      }
      if (block.children !== undefined && !Array.isArray(block.children))
        throw new AutomationError("INVALID_BLOCKS", "children must be an array.");
      return { ...block, id, children: validate(block.children ?? []) };
    });
  const checked = validate(input);
  // Validate/normalize in a detached codec; a failed request never touches a live editor.
  editor.replaceBlocks(
    editor.document,
    (checked.length
      ? checked
      : [{ type: "paragraph", id: crypto.randomUUID() }]) as PartialDocumentBlock[]
  );
  const blocks = structuredClone(editor.document);
  encodeDocument("validation.note", { blocks, content: "", documentId: "validation" });
  return blocks;
}

async function loadNote(filePath: string) {
  const path = await workspacePath(filePath);
  if (!isRichNote(path))
    throw new AutomationError(
      "UNSUPPORTED_FORMAT",
      "Native block operations require a .note file. Use document text tools for Markdown."
    );
  if (!useDocumentStore.getState().documents[path])
    await getDocumentController().openDocument(path, false);
  if (!useDocumentStore.getState().documents[path]?.blocks) {
    const editor = await codec();
    const doc = useDocumentStore.getState().documents[path];
    if (!doc) throw new AutomationError("DOCUMENT_NOT_FOUND", "Document not found.");
    if (!doc.blocks)
      useDocumentStore
        .getState()
        .updateEditorContent(path, doc.content, editor.tryParseMarkdownToBlocks(doc.content), true);
  }
  const doc = useDocumentStore.getState().documents[path];
  return { path, doc };
}
const revisionToken = (doc: { bufferId: string; revision: number }) =>
  `${doc.bufferId}:${doc.revision}`;
function checkRevision(actual: string, expected?: string) {
  if (expected !== undefined && text(expected, "expectedRevision") !== actual)
    throw new AutomationError(
      "REVISION_CONFLICT",
      "The note changed. Read its blocks again before applying this edit.",
      { expectedRevision: expected, actualRevision: actual }
    );
}
async function mutate(
  input: NoteMutation,
  update: (blocks: DocumentBlock[]) => Promise<BlockInput[]> | BlockInput[]
) {
  const { path, doc } = await loadNote(input.filePath);
  checkRevision(revisionToken(doc), input.expectedRevision);
  const proposed = await update(structuredClone(doc.blocks ?? []));
  const blocks = await normalizeBlocks(proposed);
  const editor = await codec();
  const latest = useDocumentStore.getState().documents[path];
  if (!latest || latest.documentId !== doc.documentId || latest.bufferId !== doc.bufferId)
    throw new AutomationError(
      "REVISION_CONFLICT",
      "The document was closed or replaced. Read it again."
    );
  checkRevision(revisionToken(latest), revisionToken(doc));
  useDocumentStore.getState().setExternalContent(path, projectDocument(editor, blocks), blocks);
  const appliedRevision = revisionToken(useDocumentStore.getState().documents[path]);
  try {
    await getDocumentController().saveDocument(path);
  } catch (error) {
    throw new AutomationError(
      "SAVE_FAILED",
      "Edit applied in memory but not saved. Retry document_save; do not repeat the mutation.",
      { filePath: path, appliedRevision, cause: String(error) }
    );
  }
  const current = useDocumentStore.getState().documents[path];
  return {
    filePath: path,
    appliedRevision,
    revision: current ? revisionToken(current) : appliedRevision,
    isDirty: current?.isDirty ?? false,
    blockIds: blocks.map((block) => block.id),
  };
}

export const noteActions = {
  async getSchema() {
    const editor = await codec();
    return {
      format: "workspace-note",
      version: 1,
      blockTypes: structuredClone(editor.schema.blockSchema),
    };
  },
  async create(input: NoteCreateInput) {
    if (input.groupId !== undefined) group(input.groupId);
    optionalBoolean(input.open, "open");
    if (input.markdown !== undefined && typeof input.markdown !== "string")
      throw new AutomationError("INVALID_INPUT", "markdown must be a string.");
    const path = await workspacePath(input.filePath);
    if (!isRichNote(path))
      throw new AutomationError("UNSUPPORTED_FORMAT", "Use a .note extension.");
    if (!isValidEntryName(path.split(/[\\/]/).pop() ?? ""))
      throw new AutomationError("INVALID_INPUT", "Invalid note filename.");
    if (input.open !== false && !fileHandlerRegistry.resolve(path))
      throw new AutomationError(
        "NOT_READY",
        "The note editor plugin is not ready. Create with open=false or enable it first."
      );
    if (input.blocks !== undefined && input.markdown !== undefined)
      throw new AutomationError("INVALID_INPUT", "Supply blocks or markdown, not both.");
    const editor = await codec();
    const blocks = await normalizeBlocks(
      input.blocks ?? editor.tryParseMarkdownToBlocks(input.markdown ?? "")
    );
    if ((await exists(path)) || useDocumentStore.getState().documents[path])
      throw new AutomationError("ALREADY_EXISTS", "The destination already exists.");
    const raw = encodeDocument(path, {
      blocks,
      content: projectDocument(editor, blocks),
      documentId: crypto.randomUUID(),
    });
    await mkdir(await dirname(path), { recursive: true });
    await writeTextFile(path, raw, { createNew: true });
    useDocumentStore.getState().openDocument(path, raw, false);
    const tab =
      input.open === false
        ? null
        : await workbenchActions.openFile({ filePath: path, groupId: input.groupId });
    return { ...(await noteActions.getBlocks(path)), tab };
  },
  async getBlocks(filePath: string, options: BlockReadOptions = {}) {
    const offset = integer(options.offset ?? 0, "offset"),
      limit = integer(options.limit ?? 100, "limit", 1, 200);
    optionalBoolean(options.includeDataUrls, "includeDataUrls");
    const { path, doc } = await loadNote(filePath);
    const all = doc.blocks ?? [];
    const blocks = structuredClone(all.slice(offset, offset + limit));
    let omittedDataUrls = 0;
    const redact = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(redact);
        return;
      }
      if (!object(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (
          ["url", "href", "src", "diagramPath"].includes(key) &&
          typeof child === "string" &&
          child.startsWith("data:")
        ) {
          value[key] = "[embedded-image]";
          omittedDataUrls++;
        } else if (typeof child === "object") redact(child);
      }
    };
    if (!options.includeDataUrls) redact(blocks);
    return {
      filePath: path,
      documentId: doc.documentId,
      revision: revisionToken(doc),
      isDirty: doc.isDirty,
      blocks,
      total: all.length,
      offset,
      hasMore: offset + limit < all.length,
      omittedDataUrls,
    };
  },
  async getOutline(filePath: string) {
    const { path, doc } = await loadNote(filePath);
    return {
      filePath: path,
      revision: revisionToken(doc),
      headings: documentOutline(doc.blocks ?? []),
    };
  },
  insertBlocks(input: NoteMutation & BlockPlacement & { blocks: BlockInput[] }) {
    if (!Array.isArray(input.blocks) || !input.blocks.length)
      throw new AutomationError("INVALID_INPUT", "blocks must be a non-empty array.");
    return mutate(input, async (blocks) => {
      const normalized = await normalizeBlocks(input.blocks);
      const target = place(blocks, input);
      target.siblings.splice(target.index, 0, ...normalized);
      return blocks;
    });
  },
  updateBlock(input: NoteMutation & { blockId: string; changes: Omit<Partial<BlockInput>, "id"> }) {
    return mutate(input, async (blocks) => {
      const found = visit(blocks, text(input.blockId, "blockId"));
      if (!found) throw new AutomationError("BLOCK_NOT_FOUND", "Block not found.");
      if (!object(input.changes) || "id" in input.changes)
        throw new AutomationError(
          "INVALID_INPUT",
          "changes must be an object and cannot change the block ID."
        );
      if (input.changes.type !== undefined) text(input.changes.type, "type");
      if (input.changes.props !== undefined && !object(input.changes.props))
        throw new AutomationError("INVALID_INPUT", "props must be an object.");
      if (input.changes.children !== undefined && !Array.isArray(input.changes.children))
        throw new AutomationError("INVALID_INPUT", "children must be an array.");
      const changedType = input.changes.type && input.changes.type !== found.block.type;
      const type = input.changes.type ?? found.block.type;
      const schema = (await codec()).schema.blockSchema as Record<string, { content: string }>;
      const content =
        input.changes.content !== undefined
          ? input.changes.content
          : changedType && schema[type]?.content !== "inline"
            ? undefined
            : found.block.content;
      found.siblings[found.index] = {
        ...found.block,
        ...input.changes,
        id: found.block.id,
        type,
        content,
        children: input.changes.children ?? found.block.children,
        props: changedType
          ? (input.changes.props ?? {})
          : { ...found.block.props, ...input.changes.props },
      } as DocumentBlock;
      return blocks;
    });
  },
  deleteBlocks(input: NoteMutation & { blockIds: string[] }) {
    return mutate(input, (blocks) => {
      if (!Array.isArray(input.blockIds) || !input.blockIds.length)
        throw new AutomationError("INVALID_INPUT", "blockIds must be a non-empty array.");
      const ids = new Set(input.blockIds.map((id) => text(id, "blockId")));
      for (const id of ids)
        if (!visit(blocks, id))
          throw new AutomationError("BLOCK_NOT_FOUND", `Block not found: ${id}`);
      const remove = (items: DocumentBlock[]): DocumentBlock[] =>
        items
          .filter((block) => !ids.has(block.id))
          .map((block) => ({ ...block, children: remove(block.children) }));
      return remove(blocks);
    });
  },
  moveBlock(input: NoteMutation & BlockPlacement & { blockId: string }) {
    return mutate(input, (blocks) => {
      const found = visit(blocks, text(input.blockId, "blockId"));
      if (!found) throw new AutomationError("BLOCK_NOT_FOUND", "Block not found.");
      if (
        input.parentId === found.block.id ||
        (input.parentId && visit(found.block.children, input.parentId))
      )
        throw new AutomationError(
          "INVALID_INPUT",
          "A block cannot be moved into itself or a descendant."
        );
      const [block] = found.siblings.splice(found.index, 1);
      const target = place(blocks, input);
      target.siblings.splice(target.index, 0, block);
      return blocks;
    });
  },
  async insertLinkedDiagram(
    input: NoteMutation & BlockPlacement & { diagramPath: string; caption?: string }
  ) {
    const path = await workspacePath(input.diagramPath, "diagramPath");
    if (!/\.excalidraw$/i.test(path) || !(await exists(path)))
      throw new AutomationError("FILE_NOT_FOUND", "Choose an existing .excalidraw diagram.");
    return noteActions.insertBlocks({
      ...input,
      blocks: [
        {
          type: "diagramEmbed",
          props: {
            diagramPath: createFileReference(path, useWorkspaceStore.getState().workspaceDir),
            caption: input.caption ?? path.split(/[\\/]/).pop() ?? "",
          },
        },
      ],
    });
  },
};
