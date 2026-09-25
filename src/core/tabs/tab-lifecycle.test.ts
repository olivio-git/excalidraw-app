import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeTabManaged,
  prepareResourceMove,
  registerTabCloseHandler,
  requestCloseTab,
} from "./tab-lifecycle";
import { useTabStore } from "./store/tab-store";
import { initialEditorLayout } from "./store/editor-layout";
import { useTabsSettingsStore } from "@/stores/tabsSettingsStore";
import { notify } from "@/shared/lib/notify";

vi.mock("@/core/i18n/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/shared/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/shared/lib/confirm", () => ({ confirm: vi.fn().mockResolvedValue(false) }));
beforeEach(() => {
  vi.clearAllMocks();
  useTabsSettingsStore.setState({ allowCloseLastTab: true });
  useTabStore.setState({ ...initialEditorLayout(), tabs: [], activeTabId: null });
});
const open = () =>
  useTabStore.getState().addTab({
    routeId: "document-editor",
    path: "/document-editor",
    title: "Note",
    instanceId: "/ws/note.md",
    metadata: { isDirty: true },
  });

describe("editor close lifecycle", () => {
  it("resumes paused autosave when a forced close becomes blocked while waiting", async () => {
    const id = open();
    const resume = vi.fn();
    let finish: (resume: () => void) => void = () => undefined;
    const unregister = registerTabCloseHandler(
      id,
      async () => true,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const closing = closeTabManaged(id, { discard: true });
    useTabStore.getState().pinTab(id);
    finish(resume);
    expect(await closing).toMatchObject({ closed: false, reason: "pinned" });
    expect(resume).toHaveBeenCalledOnce();
    unregister();
  });
  it("flushes a dirty resource before a move without closing it", async () => {
    const id = open();
    const save = vi.fn().mockResolvedValue(true);
    const unregister = registerTabCloseHandler(id, save);
    await prepareResourceMove("/ws");
    expect(save).toHaveBeenCalledOnce();
    expect(useTabStore.getState().getTab(id)).toBeDefined();
    unregister();
  });
  it("aborts a move if newer edits remain unsaved", async () => {
    const id = open();
    const unregister = registerTabCloseHandler(id, async () => false);
    await expect(prepareResourceMove("/ws")).rejects.toThrow();
    unregister();
  });
  it("waits for the live editor to finish saving before removing its tab", async () => {
    const id = open();
    let finish: (value: boolean) => void = () => undefined;
    const unregister = registerTabCloseHandler(
      id,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const closing = requestCloseTab(id);
    expect(useTabStore.getState().getTab(id)).toBeDefined();
    finish(true);
    await closing;
    expect(useTabStore.getState().getTab(id)).toBeUndefined();
    unregister();
  });
  it("retains the tab when a save fails", async () => {
    const id = open();
    const unregister = registerTabCloseHandler(id, async () => {
      throw new Error("disk full");
    });
    await requestCloseTab(id);
    expect(useTabStore.getState().getTab(id)).toBeDefined();
    expect(notify).toHaveBeenCalled();
    unregister();
  });
  it("retains the tab if the editor reports newer unsaved changes", async () => {
    const id = open();
    const unregister = registerTabCloseHandler(id, async () => false);
    await requestCloseTab(id);
    expect(useTabStore.getState().getTab(id)).toBeDefined();
    unregister();
  });
  it("does not discard a dirty unmounted editor without confirmation", async () => {
    const id = open();
    await requestCloseTab(id);
    expect(useTabStore.getState().getTab(id)).toBeDefined();
  });
});
