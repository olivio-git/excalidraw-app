import { beforeEach, describe, expect, it, vi } from "vitest";
import { posix } from "node:path";
import { readDir, readTextFile, type DirEntry } from "@tauri-apps/plugin-fs";
import { extractFileReferences, scanWorkspaceReferences } from "./workspace-references";
import { encodeDocument } from "@/features/document-editor/note-format";
import { getDocumentCodec } from "@/features/document-editor/note-codec";
import { act } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-fs", () => ({ readDir: vi.fn(), readTextFile: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => posix.join(...parts),
  dirname: async (path: string) => posix.dirname(path),
  normalize: async (path: string) => posix.normalize(path),
}));
const file = (name: string): DirEntry => ({
  name,
  isFile: true,
  isDirectory: false,
  isSymlink: false,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readDir).mockResolvedValue([]);
});

describe("workspace references", () => {
  it("extracts real Markdown links but ignores code examples and external URLs", async () => {
    const refs = await extractFileReferences(
      "/ws/a.md",
      "# Overview\n\n[B](b.note#section)\n\n[Web](https://example.com)\n\n```md\n[Not a link](fake.md)\n```"
    );
    expect(refs).toEqual([{ href: "b.note#section", anchor: "overview", label: "B" }]);
  });
  it("indexes native embedded diagrams with the persistent source block ID", async () => {
    const editor = getDocumentCodec();
    act(() =>
      editor.replaceBlocks(editor.document, [
        {
          type: "diagramEmbed",
          props: { diagramPath: "/@workspace/map.excalidraw", caption: "Map" },
        },
      ])
    );
    const blocks = editor.document;
    let markdown = "";
    act(() => {
      markdown = editor.blocksToMarkdownLossy(blocks);
    });
    const raw = encodeDocument("a.note", { content: markdown, blocks, documentId: "a" });
    const refs = await extractFileReferences("/ws/a.note", raw);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ href: "/@workspace/map.excalidraw", anchor: blocks[0].id });
  });
  it("resolves both note-to-diagram and diagram-to-note links", async () => {
    vi.mocked(readDir).mockResolvedValue([file("a.md"), file("map.excalidraw")]);
    vi.mocked(readTextFile).mockImplementation(async (path) =>
      String(path).endsWith(".md")
        ? "[Map](map.excalidraw)"
        : JSON.stringify({ elements: [{ id: "node", link: "a.md#overview" }] })
    );
    const index = await scanWorkspaceReferences("/ws", {}, new AbortController().signal);
    expect(index.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourcePath: "/ws/a.md", targetPath: "/ws/map.excalidraw" }),
        expect.objectContaining({
          sourcePath: "/ws/map.excalidraw",
          targetPath: "/ws/a.md",
          sourceAnchor: "node",
          targetAnchor: "overview",
        }),
      ])
    );
  });
  it("uses open buffers, reports partial reads and skips symlink directories", async () => {
    vi.mocked(readDir).mockResolvedValue([
      file("a.md"),
      file("broken.note"),
      { name: "cycle", isFile: false, isDirectory: true, isSymlink: true },
    ]);
    vi.mocked(readTextFile).mockRejectedValue(new Error("permission denied"));
    const index = await scanWorkspaceReferences(
      "/ws",
      { "/ws/a.md": { content: "[Fresh](fresh.md)", blocks: null, documentId: null } },
      new AbortController().signal
    );
    expect(index.references[0].targetPath).toBe("/ws/fresh.md");
    expect(index.failures).toBe(1);
    expect(readDir).toHaveBeenCalledOnce();
  });
  it("marks capped scans as partial and rejects cancellation", async () => {
    vi.mocked(readDir).mockResolvedValue([file("a.md"), file("b.md")]);
    vi.mocked(readTextFile).mockResolvedValue("");
    expect(
      (await scanWorkspaceReferences("/ws", {}, new AbortController().signal, 1)).truncated
    ).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(scanWorkspaceReferences("/ws", {}, controller.signal)).rejects.toThrow();
  });
});
