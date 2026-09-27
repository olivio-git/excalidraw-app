import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { posix } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../src/index";
import { automationDefinitions } from "../src/automation-tools";
import { dispatchMcpTool } from "../../src/core/shell/hooks/useMcpBridge";
import { AUTOMATION_TOOLS } from "../../src/core/automation/dispatch";
import { referenceActions } from "../../src/core/automation/references";
import { useTabStore } from "../../src/core/tabs/store/tab-store";
import { initialEditorLayout } from "../../src/core/tabs/store/editor-layout";
import { useWorkspaceStore } from "../../src/stores/workspaceStore";
import { useDocumentStore } from "../../src/stores/documentStore";
import { useTabsSettingsStore } from "../../src/stores/tabsSettingsStore";
import { useDiagramStore } from "../../src/core/diagram/store/diagram-store";
import { fileHandlerRegistry } from "../../src/core/shell/panels/file-handler-registry";
import { decodeDocument } from "../../src/features/document-editor/note-format";
import { createPluginAPI } from "../../src/plugins/plugin-api";

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Set<string>(),
  failWrite: false,
}));
const scene = vi.hoisted(() => ({ values: [] as unknown[], ready: true }));
vi.mock("@tauri-apps/api/path", () => ({
  normalize: async (path: string) => posix.normalize(path),
  join: async (...parts: string[]) => posix.join(...parts),
  dirname: async (path: string) => posix.dirname(path),
  basename: async (path: string) => posix.basename(path),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => fs.files.has(path) || fs.directories.has(path),
  mkdir: async (path: string) => {
    fs.directories.add(path);
  },
  readTextFile: async (path: string) => {
    if (!fs.files.has(path)) throw new Error("ENOENT");
    return fs.files.get(path)!;
  },
  writeTextFile: async (path: string, value: string, options?: { createNew?: boolean }) => {
    if (fs.failWrite) throw new Error("Disk full");
    if (options?.createNew && fs.files.has(path)) throw new Error("EEXIST");
    fs.files.set(path, value);
  },
  readDir: async (path: string) =>
    [...fs.files.keys()]
      .filter((file) => posix.dirname(file) === path)
      .map((file) => ({
        name: posix.basename(file),
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      })),
  remove: async (path: string) => {
    fs.files.delete(path);
  },
  rename: vi.fn(),
  stat: vi.fn(),
  copyFile: vi.fn(),
  lstat: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (value: unknown) => value,
  exportToSvg: vi.fn(),
}));
vi.mock("@/core/diagram/DiagramController", () => ({
  DiagramController: {
    getActiveInstanceId: () => {
      const s = useTabStore.getState();
      const tab = s.tabs.find((item) => item.id === s.activeTabId);
      return tab?.routeId === "diagram" ? tab.instanceId : undefined;
    },
    getElements: () => scene.values,
    getApi: () =>
      scene.ready
        ? {
            getSceneElements: () => scene.values,
            getAppState: () => ({}),
            getFiles: () => ({}),
            updateScene: ({ elements }: { elements?: unknown[] }) => {
              if (elements) scene.values = elements;
            },
            scrollToContent: vi.fn(),
          }
        : undefined,
    exportToSVG: vi.fn(),
  },
}));

const client = new Client({ name: "automation-contract-test", version: "1" });
beforeAll(async () => {
  for (const extension of ["md", "note"])
    fileHandlerRegistry.register(extension, {
      routeId: "document-editor",
      defaultExtension: extension,
      create: async (dir, name) => `${dir}/${name}`,
    });
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const { tool, input } = JSON.parse(String(init.body));
    return new Response(JSON.stringify(await dispatchMcpTool(tool, input)), {
      headers: { "Content-Type": "application/json" },
    });
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});
afterAll(async () => {
  referenceActions.dispose();
  await client.close();
  await server.close();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  fs.files.clear();
  fs.directories.clear();
  fs.directories.add("/ws");
  fs.failWrite = false;
  scene.values = [];
  scene.ready = true;
  referenceActions.dispose();
  useWorkspaceStore.setState({ workspaceDir: "/ws" });
  useTabStore.setState({ ...initialEditorLayout(), tabs: [], activeTabId: null });
  useDocumentStore.setState({ documents: {}, activeDocumentId: null });
  useDiagramStore.setState({ diagrams: {} });
  useTabsSettingsStore.setState({ allowCloseLastTab: true });
  fs.files.set("/ws/map.excalidraw", JSON.stringify({ elements: [], appState: {}, files: {} }));
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  let value: unknown;
  try {
    value = JSON.parse(content[0].text);
  } catch {
    value = content[0].text;
  }
  return { error: result.isError === true, value };
}
async function createNote() {
  const response = await call("document_create_rich", {
    filePath: "/ws/study.note",
    groupId: "primary",
    blocks: [
      { id: "heading", type: "heading", props: { level: 1 }, content: "Study" },
      { id: "body", type: "paragraph", content: "Notes" },
    ],
  });
  expect(response.error, JSON.stringify(response.value)).toBe(false);
  return response.value as { revision: string; tab: { id: string } };
}

describe("MCP → JSON bridge → shared app services", () => {
  it("advertises every new tool and explicit targets on legacy diagram tools", async () => {
    expect(Object.keys(automationDefinitions).sort()).toEqual([...AUTOMATION_TOOLS].sort());
    const { tools } = await client.listTools();
    for (const name of AUTOMATION_TOOLS)
      expect(
        tools.some((tool) => tool.name === name),
        name
      ).toBe(true);
    expect(
      tools.find((tool) => tool.name === "get_elements")?.inputSchema.properties
    ).toHaveProperty("tabId");
  });
  it("discovers block capabilities and navigates a native outline reference", async () => {
    expect((await call("document_get_schema")).value).toMatchObject({
      version: 1,
      blockTypes: { diagramEmbed: expect.any(Object), heading: expect.any(Object) },
    });
    const created = await createNote();
    expect(
      (await call("document_get_outline", { filePath: "/ws/study.note" })).value
    ).toMatchObject({ headings: [{ id: "heading", title: "Study", level: 1 }] });
    const reference = (
      await call("reference_create", { filePath: "/ws/study.note", anchor: "heading" })
    ).value as { href: string };
    await call("open_to_side", { filePath: "/ws/map.excalidraw", groupId: "primary" });
    const opened = await call("open_reference", {
      href: reference.href,
      sourcePath: "/ws/map.excalidraw",
      groupId: "secondary",
      beside: true,
    });
    expect(opened.value).toMatchObject({ id: created.tab.id, groupId: "primary" });
    expect(useTabStore.getState().getTab(created.tab.id)?.metadata?.navigationAnchor.text).toBe(
      "heading"
    );
    expect((await call("list_tabs")).value).toHaveLength(2);
  });
  it("moves tabs, navigates the selected group and closes it through the shared lifecycle", async () => {
    const first = await createNote();
    const second = (await call("document_create_rich", { filePath: "/ws/second.note" })).value as {
      tab: { id: string };
    };
    await call("workspace_move_tab", { tabId: second.tab.id, groupId: "secondary" });
    await call("document_create_rich", { filePath: "/ws/third.note", groupId: "secondary" });
    expect(
      (await call("workspace_navigate", { direction: "back", groupId: "secondary" })).value
    ).toMatchObject({ activeTabId: second.tab.id });
    const closed = await call("workspace_close_group", { groupId: "secondary" });
    expect(closed.value).toMatchObject({
      results: [
        expect.objectContaining({ closed: true }),
        expect.objectContaining({ closed: true }),
      ],
      state: { direction: null, activeTabId: first.tab.id },
    });
  });
  it("creates a rich note, edits native blocks and rejects stale revisions without mutation", async () => {
    const created = await createNote();
    const update = await call("document_update_block", {
      filePath: "/ws/study.note",
      blockId: "heading",
      changes: { props: { backgroundColor: "blue" } },
      expectedRevision: created.revision,
    });
    expect(update.error, JSON.stringify(update.value)).toBe(false);
    const saved = fs.files.get("/ws/study.note")!;
    expect(decodeDocument("a.note", saved).blocks?.[0].props).toMatchObject({
      backgroundColor: "blue",
    });
    const stale = await call("document_delete_blocks", {
      filePath: "/ws/study.note",
      blockIds: ["heading"],
      expectedRevision: created.revision,
    });
    expect(stale.error).toBe(true);
    expect(stale.value).toMatchObject({ details: { code: "REVISION_CONFLICT" } });
    expect(fs.files.get("/ws/study.note")).toBe(saved);
  });
  it("arranges panes and reads an explicit diagram without changing focus", async () => {
    const created = await createNote();
    await call("open_to_side", { filePath: "/ws/map.excalidraw", groupId: "primary" });
    await call("workspace_set_layout", { direction: "vertical", ratio: 65 });
    await call("workspace_focus_group", { groupId: "primary" });
    scene.values = [{ id: "node", type: "rectangle" }];
    expect((await call("get_elements", { filePath: "/ws/map.excalidraw" })).value).toEqual(
      scene.values
    );
    expect(useTabStore.getState().activeTabId).toBe(created.tab.id);
    expect((await call("workspace_get_state")).value).toMatchObject({
      direction: "vertical",
      ratio: 65,
      activeGroupId: "primary",
    });
  });
  it("inserts a live linked block and exposes the resulting backlink snapshot", async () => {
    await createNote();
    const inserted = await call("document_insert_linked_diagram", {
      filePath: "/ws/study.note",
      diagramPath: "/ws/map.excalidraw",
      caption: "System",
    });
    expect(inserted.error, JSON.stringify(inserted.value)).toBe(false);
    expect(
      decodeDocument("a.note", fs.files.get("/ws/study.note")!).blocks?.some(
        (block) => block.type === "diagramEmbed"
      )
    ).toBe(true);
    await call("references_refresh");
    await vi.waitFor(async () =>
      expect((await call("references_status")).value).toMatchObject({ status: "ready" })
    );
    const refs = await call("references_get", {
      filePath: "/ws/map.excalidraw",
      direction: "incoming",
    });
    expect(refs.value).toMatchObject({
      status: "ready",
      references: [
        expect.objectContaining({ sourcePath: "/ws/study.note", targetPath: "/ws/map.excalidraw" }),
      ],
    });
  });
  it("reports native document dirtiness and saves before a normal MCP close", async () => {
    const created = await createNote();
    useDocumentStore.getState().updateContent("/ws/study.note", "Latest edit");
    expect((await call("get_tab_metadata", { tabId: created.tab.id })).value).toMatchObject({
      isDirty: true,
      groupId: "primary",
    });
    const closed = await call("close_tab", { tabId: created.tab.id });
    expect(closed.value).toMatchObject({ closed: true, wasDirty: true });
    expect(decodeDocument("a.note", fs.files.get("/ws/study.note")!).content).toContain(
      "Latest edit"
    );
  });
  it("retains the tab on save failure and explicitly discards only with force", async () => {
    const created = await createNote();
    const saved = fs.files.get("/ws/study.note");
    useDocumentStore.getState().updateContent("/ws/study.note", "Unsaved");
    fs.failWrite = true;
    expect((await call("close_tab", { tabId: created.tab.id })).value).toMatchObject({
      closed: false,
      reason: "save_failed",
    });
    expect(useTabStore.getState().getTab(created.tab.id)).toBeDefined();
    fs.failWrite = false;
    expect((await call("close_tab", { tabId: created.tab.id, force: true })).value).toMatchObject({
      closed: true,
    });
    expect(fs.files.get("/ws/study.note")).toBe(saved);
    expect(useDocumentStore.getState().documents["/ws/study.note"]).toBeUndefined();
  });
  it("shares the same state and actions with plugin SDK callers", async () => {
    await createNote();
    const sdk = createPluginAPI(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      () => vi.fn(),
      vi.fn(),
      "test",
      vi.fn(),
      async () => {},
      vi.fn()
    );
    expect(await sdk.notes.getBlocks("/ws/study.note")).toEqual(
      (await call("document_get_blocks", { filePath: "/ws/study.note" })).value
    );
    sdk.workbench.setLayout({ direction: "horizontal", ratio: 60 });
    expect((await call("workspace_get_state")).value).toMatchObject({
      direction: "horizontal",
      ratio: 60,
    });
  });
  it("validates workspace boundaries, duplicate IDs and group inputs before writing", async () => {
    expect((await call("document_create_rich", { filePath: "/ws-other/a.note" })).error).toBe(true);
    expect(
      (
        await call("document_create_rich", {
          filePath: "/ws/a.note",
          blocks: [
            { id: "same", type: "paragraph" },
            { id: "same", type: "paragraph" },
          ],
        })
      ).error
    ).toBe(true);
    expect(fs.files.has("/ws/a.note")).toBe(false);
    expect((await call("workspace_focus_group", { groupId: "invalid" })).error).toBe(true);
  });
  it("inserts, moves and removes nested blocks while preventing cycles", async () => {
    await createNote();
    expect(
      (
        await call("document_insert_blocks", {
          filePath: "/ws/study.note",
          parentId: "heading",
          blocks: [{ id: "child", type: "paragraph", content: "Nested" }],
        })
      ).error
    ).toBe(false);
    expect(
      (
        await call("document_move_block", {
          filePath: "/ws/study.note",
          blockId: "heading",
          parentId: "child",
        })
      ).error
    ).toBe(true);
    expect(
      (
        await call("document_move_block", {
          filePath: "/ws/study.note",
          blockId: "child",
          parentId: null,
          index: 0,
        })
      ).error
    ).toBe(false);
    expect(decodeDocument("a.note", fs.files.get("/ws/study.note")!).blocks?.[0].id).toBe("child");
    expect(
      (await call("document_delete_blocks", { filePath: "/ws/study.note", blockIds: ["child"] }))
        .error
    ).toBe(false);
    expect(
      decodeDocument("a.note", fs.files.get("/ws/study.note")!).blocks?.some(
        (block) => block.id === "child"
      )
    ).toBe(false);
  });
  it("rejects a revision from a previous load of the same note", async () => {
    const original = await createNote();
    await call("close_tab", { tabId: original.tab.id, force: true });
    const reopened = (await call("document_get_blocks", { filePath: "/ws/study.note" })).value as {
      revision: string;
    };
    expect(reopened.revision).not.toBe(original.revision);
    const response = await call("document_update_block", {
      filePath: "/ws/study.note",
      blockId: "heading",
      changes: { content: "Stale" },
      expectedRevision: original.revision,
    });
    expect(response.value).toMatchObject({ details: { code: "REVISION_CONFLICT" } });
  });
  it("reports an applied revision on a failed write so callers can retry saving only", async () => {
    await createNote();
    fs.failWrite = true;
    const response = await call("document_update_block", {
      filePath: "/ws/study.note",
      blockId: "heading",
      changes: { props: { backgroundColor: "blue" } },
    });
    expect(response.value).toMatchObject({
      details: { code: "SAVE_FAILED", appliedRevision: expect.any(String) },
    });
    fs.failWrite = false;
    expect((await call("save_tab", { filePath: "/ws/study.note" })).value).toMatchObject({
      saved: true,
    });
    expect(
      decodeDocument("a.note", fs.files.get("/ws/study.note")!).blocks?.[0].props
    ).toMatchObject({ backgroundColor: "blue" });
  });
  it("respects pinned and last-tab constraints even for forced closes", async () => {
    const created = await createNote();
    useDocumentStore.getState().updateContent("/ws/study.note", "Dirty");
    await call("set_tab_pinned", { tabId: created.tab.id, pinned: true });
    expect((await call("close_tab", { tabId: created.tab.id, force: true })).value).toMatchObject({
      closed: false,
      wasDirty: true,
      reason: "pinned",
    });
    await call("set_tab_pinned", { tabId: created.tab.id, pinned: false });
    useTabsSettingsStore.setState({ allowCloseLastTab: false });
    expect((await call("close_tab", { tabId: created.tab.id, force: true })).value).toMatchObject({
      closed: false,
      reason: "last_tab",
    });
  });
  it("saves both documents and diagrams in a single batch", async () => {
    await createNote();
    await call("open_to_side", { filePath: "/ws/map.excalidraw", groupId: "primary" });
    await useDiagramStore.getState().loadDiagram("/ws/map.excalidraw", "/ws/map.excalidraw");
    scene.values = [{ id: "new-shape", type: "rectangle" }];
    useDiagramStore.getState().markDirty("/ws/map.excalidraw");
    useDocumentStore.getState().updateContent("/ws/study.note", "New content");
    expect((await call("save_all_tabs")).value).toMatchObject({ saved: 2, failed: 0 });
    expect(JSON.parse(fs.files.get("/ws/map.excalidraw")!).elements[0].id).toBe("new-shape");
  });
  it("paginates native blocks, redacts images and prevents writing placeholders back", async () => {
    await createNote();
    await call("document_insert_blocks", {
      filePath: "/ws/study.note",
      blocks: [{ id: "image", type: "image", props: { url: "data:image/png;base64,aGVsbG8=" } }],
    });
    const page = (
      await call("document_get_blocks", { filePath: "/ws/study.note", offset: 0, limit: 1 })
    ).value;
    expect(page).toMatchObject({
      offset: 0,
      hasMore: true,
      blocks: [expect.objectContaining({ id: "heading" })],
    });
    const data = (await call("document_get_blocks", { filePath: "/ws/study.note" })).value as {
      blocks: { id: string; props: Record<string, unknown> }[];
      omittedDataUrls: number;
    };
    expect(data.omittedDataUrls).toBe(1);
    expect(data.blocks.find((block) => block.id === "image")?.props.url).toBe("[embedded-image]");
    expect(
      (
        await call("document_update_block", {
          filePath: "/ws/study.note",
          blockId: "image",
          changes: { props: { url: "[embedded-image]" } },
        })
      ).value
    ).toMatchObject({ details: { code: "REDACTED_DATA" } });
  });
});
