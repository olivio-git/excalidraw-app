import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { DocumentEditor } from "./DocumentEditor";
import { getDocumentCodec } from "./note-codec";
import { inlineText, projectDocument } from "./note-format";
const callbacks = vi.hoisted(() => ({ changed: () => {} }));
vi.mock("@blocknote/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@blocknote/react")>()),
  useEditorChange: (callback: () => void) => {
    callbacks.changed = callback;
  },
}));
vi.mock("@blocknote/shadcn", () => ({ BlockNoteView: () => <div /> }));

describe("native editor synchronization", () => {
  it("restores full blocks without making initialization dirty, then reports style-only edits", () => {
    const editor = getDocumentCodec();
    const blocks = editor.tryParseMarkdownToBlocks("# Overview");
    blocks[0].props = { ...blocks[0].props, backgroundColor: "blue" };
    const initialize = vi.fn();
    const changed = vi.fn();
    render(
      <DocumentEditor
        editor={editor}
        filePath="/ws/a.note"
        content="# Overview"
        blocks={blocks}
        externalVersion={0}
        onInitialize={initialize}
        onChange={changed}
        theme="light"
      />
    );
    expect(editor.document[0].id).toBe(blocks[0].id);
    expect(editor.document[0].props).toMatchObject({ backgroundColor: "blue" });
    expect(initialize).toHaveBeenCalledOnce();
    act(() => callbacks.changed());
    expect(changed).not.toHaveBeenCalled();
    act(() => {
      editor.updateBlock(blocks[0].id, { props: { backgroundColor: "red" } });
      callbacks.changed();
    });
    expect(changed).toHaveBeenCalledOnce();
    expect(changed.mock.calls[0][1][0].props.backgroundColor).toBe("red");
  });
  it("replaces content after an external edit and supports clearing a document", () => {
    const editor = getDocumentCodec();
    const blocks = editor.tryParseMarkdownToBlocks("Initial text");
    const initialize = vi.fn();
    const changed = vi.fn();
    const { rerender } = render(
      <DocumentEditor
        editor={editor}
        filePath="/ws/a.note"
        content="Initial text"
        blocks={blocks}
        externalVersion={0}
        onInitialize={initialize}
        onChange={changed}
        theme="light"
      />
    );
    rerender(
      <DocumentEditor
        editor={editor}
        filePath="/ws/a.note"
        content=""
        blocks={[]}
        externalVersion={1}
        onInitialize={initialize}
        onChange={changed}
        theme="light"
      />
    );
    expect(inlineText(editor.document[0].content)).toBe("");
    expect(projectDocument(editor).trim()).toBe("");
    act(() => callbacks.changed());
    expect(changed).not.toHaveBeenCalled();
  });
});
