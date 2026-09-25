import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentEditorPlugin } from "./index";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { initialEditorLayout } from "@/core/tabs/store/editor-layout";
import { useDocumentStore } from "@/stores/documentStore";
import type { CommandHandler, PluginAPI } from "@/plugins/types";
import type { KeybindingDeclaration } from "@/core/keybindings/types";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile, rename } from "@tauri-apps/plugin-fs";
import { prompt } from "@/shared/lib/prompt";
import { createEmptyNote, decodeDocument } from "./note-format";
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("./documentController.singleton", () => ({
  getDocumentController: () => ({ saveDocument: mocks.save }),
}));
vi.mock("@/core/i18n/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/plugin-fs")>()),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
}));
vi.mock("@/shared/lib/prompt", () => ({ prompt: vi.fn() }));
vi.mock("@/shared/lib/notify", () => ({ notify: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  useTabStore.setState({ ...initialEditorLayout(), tabs: [], activeTabId: null });
  useDocumentStore.setState({ documents: {}, activeDocumentId: null });
});

describe("document commands in split panes", () => {
  async function commandHarness() {
    const commands = new Map<string, CommandHandler>();
    const openFile = vi.fn();
    await documentEditorPlugin.activate({
      registerRoutes: vi.fn(),
      registerFileHandler: vi.fn(),
      registerKeybinding: vi.fn(),
      registerCommand: (id: string, handler: CommandHandler) => commands.set(id, handler),
      openFile,
    } as unknown as PluginAPI);
    return { commands, openFile };
  }
  it("creates a valid rich note and opens it through the registered file handler", async () => {
    vi.mocked(saveDialog).mockResolvedValue("/ws/new.note");
    const { commands, openFile } = await commandHarness();
    await commands.get("document.newNote")!();
    expect(writeTextFile).toHaveBeenCalledOnce();
    const [path, raw] = vi.mocked(writeTextFile).mock.calls[0];
    expect(decodeDocument(String(path), raw)).toMatchObject({ blocks: [], content: "" });
    expect(openFile).toHaveBeenCalledWith("/ws/new.note");
  });
  it("does not overwrite an already-open destination while creating a rich note", async () => {
    useTabStore.getState().addTab({
      routeId: "document-editor",
      path: "/document-editor",
      title: "existing",
      instanceId: "/ws/existing.note",
    });
    vi.mocked(saveDialog).mockResolvedValue("/ws/existing.note");
    const { commands } = await commandHarness();
    await commands.get("document.newNote")!();
    expect(writeTextFile).not.toHaveBeenCalled();
  });
  it("does not reinterpret a native note as Markdown through the rename command", async () => {
    useTabStore.getState().addTab({
      routeId: "document-editor",
      path: "/document-editor",
      title: "native",
      instanceId: "/ws/native.note",
    });
    useDocumentStore.getState().openDocument("/ws/native.note", createEmptyNote());
    vi.mocked(prompt).mockResolvedValue({ name: "native.md" });
    const { commands } = await commandHarness();
    await commands.get("document.rename")!();
    expect(rename).not.toHaveBeenCalled();
  });
  it("saves the focused tab rather than the last loaded document", async () => {
    const commands = new Map<string, CommandHandler>();
    const bindings: KeybindingDeclaration[] = [];
    const api = {
      registerRoutes: vi.fn(),
      registerFileHandler: vi.fn(),
      registerCommand: (id: string, handler: CommandHandler) => commands.set(id, handler),
      registerKeybinding: (binding: KeybindingDeclaration) => bindings.push(binding),
    } as unknown as PluginAPI;
    await documentEditorPlugin.activate(api);
    const first = useTabStore.getState().addTab({
      routeId: "document-editor",
      path: "/document-editor",
      title: "first",
      instanceId: "/ws/first.md",
    });
    useTabStore.getState().addTab({
      routeId: "document-editor",
      path: "/document-editor",
      title: "second",
      instanceId: "/ws/second.md",
      groupId: "secondary",
    });
    useDocumentStore.getState().openDocument("/ws/first.md", "first");
    useDocumentStore.getState().openDocument("/ws/second.md", "second");
    useTabStore.getState().setActiveTab(first);
    await commands.get("document.save")!();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith("/ws/first.md");
    expect(bindings.find((binding) => binding.commandId === "document.save")?.allowInInput).toBe(
      true
    );
  });
});
