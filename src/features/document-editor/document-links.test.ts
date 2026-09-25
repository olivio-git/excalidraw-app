import { describe, expect, it } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { createFileReference } from "@/core/shell/services/file-navigation";

describe("document link portability", () => {
  it("preserves workspace references through the real editor's Markdown round trip", () => {
    const href = createFileReference("/ws/maps/My plan.excalidraw", "/ws");
    const editor = BlockNoteEditor.create({
      initialContent: [
        { type: "paragraph", content: [{ type: "link", href, content: "My plan" }] },
      ],
    });
    const markdown = editor.blocksToMarkdownLossy();
    expect(markdown).toContain("/@workspace/maps/My%20plan.excalidraw");
    const restored = editor.tryParseMarkdownToBlocks(markdown);
    expect(restored[0].content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "link", href })])
    );
  });
});
