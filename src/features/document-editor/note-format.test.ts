import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyNote, decodeDocument, documentOutline, encodeDocument } from "./note-format";
import { getDocumentCodec, reconcileMarkdownBlocks } from "./note-codec";
import { useDocumentStore } from "@/stores/documentStore";
import { DocumentController } from "./DocumentController";
import { act } from "@testing-library/react";

const codec = getDocumentCodec();
const styledBlocks = () => {
  const blocks = codec.tryParseMarkdownToBlocks("# Overview\n\nBody text");
  blocks[0].props = { ...blocks[0].props, backgroundColor: "blue" };
  return blocks;
};
beforeEach(() => useDocumentStore.setState({ documents: {}, activeDocumentId: null }));

describe("native note format", () => {
  it("keeps rich content and block IDs when an open note is moved", () => {
    const blocks = styledBlocks();
    useDocumentStore
      .getState()
      .openDocument(
        "/ws/folder/a.note",
        encodeDocument("a.note", { content: "# Overview", blocks, documentId: "stable-note" })
      );
    useDocumentStore.getState().moveDocuments("/ws/folder", "/ws/renamed");
    const moved = useDocumentStore.getState().documents["/ws/renamed/a.note"];
    expect(moved.blocks).toEqual(blocks);
    expect(moved.documentId).toBe("stable-note");
    expect(useDocumentStore.getState().documents["/ws/folder/a.note"]).toBeUndefined();
  });
  it("round-trips complete blocks, styles and stable heading identities", () => {
    const blocks = styledBlocks();
    const snapshot = {
      content: codec.blocksToMarkdownLossy(blocks),
      blocks,
      documentId: "note-one",
    };
    const loaded = decodeDocument("/ws/study.note", encodeDocument("/ws/study.note", snapshot));
    expect(loaded).toEqual(snapshot);
    expect(documentOutline(loaded.blocks!)[0].id).toBe(blocks[0].id);
  });
  it("reads old plain-text .note files and keeps .md files as text", () => {
    expect(decodeDocument("old.note", "# Old note").blocks).toBeNull();
    const raw = createEmptyNote();
    expect(decodeDocument("example.md", raw).content).toBe(raw);
    expect(decodeDocument("example.md", raw).blocks).toBeNull();
  });
  it("rejects unknown versions and duplicate block IDs", () => {
    const data = JSON.parse(createEmptyNote());
    expect(() => decodeDocument("future.note", JSON.stringify({ ...data, version: 42 }))).toThrow(
      "Unsupported note version"
    );
    const [block] = styledBlocks();
    expect(() =>
      decodeDocument("broken.note", JSON.stringify({ ...data, blocks: [block, block] }))
    ).toThrow("Duplicate note block ID");
    expect(() => decodeDocument("broken.note", '{"format":"workspace-note","version":')).toThrow();
  });
  it("keeps distinct references for repeated headings", () => {
    const blocks = codec.tryParseMarkdownToBlocks("# Same\n\nOne\n\n# Same\n\nTwo");
    const headings = documentOutline(blocks);
    expect(headings).toHaveLength(2);
    expect(headings[0].id).not.toBe(headings[1].id);
  });
  it("preserves unchanged styled blocks when a Markdown agent appends text", () => {
    const blocks = styledBlocks();
    const changed = reconcileMarkdownBlocks(
      codec.blocksToMarkdownLossy(blocks) + "\n\nMore text",
      blocks
    );
    expect(changed[0]).toEqual(blocks[0]);
    expect(changed[1]).toEqual(blocks[1]);
    expect(changed.length).toBeGreaterThan(blocks.length);
  });
  it("keeps native diagram embeds when a text-based edit leaves their projection unchanged", () => {
    const editor = getDocumentCodec();
    act(() => {
      editor.replaceBlocks(editor.document, [
        {
          type: "diagramEmbed",
          props: { diagramPath: "/@workspace/map.excalidraw", caption: "Map" },
        },
      ]);
      const blocks = editor.document;
      const changed = reconcileMarkdownBlocks(
        editor.blocksToMarkdownLossy(blocks) + "\n\nAdditional context",
        blocks
      );
      expect(changed[0]).toEqual(blocks[0]);
      expect(changed[0].type).toBe("diagramEmbed");
    });
  });
  it("marks style-only changes dirty and serializes the native note on save", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const controller = new DocumentController(useDocumentStore, {
      readDocumentFile: vi.fn(),
      writeDocumentFile: write,
      deleteDocumentFile: vi.fn(),
      listDocumentFiles: vi.fn(),
    });
    const blocks = styledBlocks();
    const content = codec.blocksToMarkdownLossy(blocks);
    useDocumentStore
      .getState()
      .openDocument("/ws/a.note", encodeDocument("a.note", { content, blocks, documentId: "a" }));
    const edited = structuredClone(blocks);
    edited[0].props = { ...edited[0].props, backgroundColor: "red" };
    useDocumentStore.getState().updateEditorContent("/ws/a.note", content, edited);
    expect(useDocumentStore.getState().documents["/ws/a.note"].isDirty).toBe(true);
    await controller.saveDocument("/ws/a.note");
    const saved = decodeDocument("a.note", write.mock.calls[0][1]);
    expect(saved.blocks?.[0].props).toMatchObject({ backgroundColor: "red" });
    expect(saved.blocks?.[0].id).toBe(blocks[0].id);
  });
  it("does not clear a newer style edit when the Markdown projection has not changed", async () => {
    let finish: () => void = () => undefined;
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const controller = new DocumentController(useDocumentStore, {
      readDocumentFile: vi.fn(),
      writeDocumentFile: write,
      deleteDocumentFile: vi.fn(),
      listDocumentFiles: vi.fn(),
    });
    const blocks = styledBlocks();
    const content = codec.blocksToMarkdownLossy(blocks);
    useDocumentStore
      .getState()
      .openDocument("/ws/a.note", encodeDocument("a.note", { content, blocks, documentId: "a" }));
    const saving = controller.saveDocument("/ws/a.note");
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const edited = structuredClone(blocks);
    edited[0].props = { ...edited[0].props, backgroundColor: "red" };
    useDocumentStore.getState().updateEditorContent("/ws/a.note", content, edited);
    finish();
    await saving;
    expect(useDocumentStore.getState().documents["/ws/a.note"].isDirty).toBe(true);
  });
  it("migrates a legacy note on save and keeps Markdown compatibility for agents", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const controller = new DocumentController(useDocumentStore, {
      readDocumentFile: vi.fn(),
      writeDocumentFile: write,
      deleteDocumentFile: vi.fn(),
      listDocumentFiles: vi.fn(),
    });
    useDocumentStore.getState().openDocument("/ws/legacy.note", "# Legacy\n\nContent");
    await controller.saveDocument("/ws/legacy.note");
    expect(decodeDocument("legacy.note", write.mock.calls[0][1]).blocks?.length).toBe(2);
    expect(controller.getContent("/ws/legacy.note")).toContain("# Legacy");
  });
});
