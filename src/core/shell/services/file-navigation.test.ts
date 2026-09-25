import { beforeEach, describe, expect, it, vi } from "vitest";
import { posix } from "node:path";
import { exists } from "@tauri-apps/plugin-fs";
import {
  createFileReference,
  openFileInWorkbench,
  openFileReference,
  resolveFileReference,
} from "./file-navigation";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { initialEditorLayout } from "@/core/tabs/store/editor-layout";
vi.mock("@tauri-apps/api/path", () => ({
  dirname: async (path: string) => posix.dirname(path),
  join: async (...paths: string[]) => posix.join(...paths),
  normalize: async (path: string) => posix.normalize(path),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: vi.fn() }));
vi.mock("@/core/i18n/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("../panels/file-handler-registry", () => ({
  fileHandlerRegistry: {
    resolve: (name: string) =>
      /\.(md|excalidraw)$/.test(name)
        ? {
            routeId: name.endsWith(".md") ? "document-editor" : "diagram",
            displayName: (value: string) => value,
          }
        : null,
  },
}));
beforeEach(() => {
  useTabStore.setState({ ...initialEditorLayout(), tabs: [], activeTabId: null });
  vi.mocked(exists).mockResolvedValue(true);
});

describe("workspace file references", () => {
  it("round-trips generated workspace links including spaces and literal hashes", async () => {
    const path = "/ws/maps/plan #1.excalidraw";
    const href = createFileReference(path, "/ws");
    expect(await resolveFileReference(href, "/ws/note.md", "/ws")).toEqual({
      filePath: path,
      anchor: "",
    });
  });
  it("round-trips references outside the workspace", async () => {
    const path = "/other/plan #1.md";
    expect(
      await resolveFileReference(createFileReference(path, "/ws"), "/ws/note.md", "/ws")
    ).toEqual({ filePath: path, anchor: "" });
  });
  it("resolves escaped relative paths and heading fragments", async () => {
    expect(
      await resolveFileReference(
        "../diagrams/My%20map.excalidraw#flow",
        "/ws/notes/design.md",
        "/ws"
      )
    ).toEqual({ filePath: "/ws/diagrams/My map.excalidraw", anchor: "flow" });
  });
  it("resolves workspace references independently of the source folder", async () => {
    expect(
      await resolveFileReference("workspace:/notes/intro.md", "/ws/deep/folder/source.md", "/ws")
    ).toEqual({ filePath: "/ws/notes/intro.md", anchor: "" });
  });
  it("opens linked files in the adjacent group without replacing the source", async () => {
    const source = openFileInWorkbench("/ws/notes/design.md");
    await openFileReference("../map.excalidraw", "/ws/notes/design.md", {
      beside: true,
      groupId: "primary",
    });
    expect(useTabStore.getState().groupActiveTabIds.primary).toBe(source);
    expect(
      useTabStore.getState().getTab(useTabStore.getState().groupActiveTabIds.secondary!)?.instanceId
    ).toBe("/ws/map.excalidraw");
  });
  it("focuses a local heading without creating a duplicate or splitting", async () => {
    const id = openFileInWorkbench("/ws/design.md");
    await openFileReference("#overview", "/ws/design.md", { groupId: "primary" });
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(useTabStore.getState().splitDirection).toBeNull();
    expect(useTabStore.getState().getTab(id!)?.metadata?.navigationAnchor.text).toBe("overview");
  });
  it("rejects missing files before adding a tab", async () => {
    vi.mocked(exists).mockResolvedValue(false);
    await expect(openFileReference("gone.md", "/ws/source.md")).rejects.toThrow();
    expect(useTabStore.getState().tabs).toHaveLength(0);
  });
  it("does not interpret an external URL as a local filename", async () => {
    await expect(
      resolveFileReference("https://example.com/a.md", "/ws/a.md", "/ws")
    ).rejects.toThrow();
  });
});
