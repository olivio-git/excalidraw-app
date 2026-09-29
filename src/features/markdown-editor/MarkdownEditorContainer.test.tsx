import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writes: [] as Array<[string, string]>,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (path: string) => {
    const content = fs.files.get(path);
    if (content === undefined) throw new Error(`ENOENT ${path}`);
    return content;
  }),
  writeTextFile: vi.fn(async (path: string, content: string) => {
    fs.writes.push([path, content]);
    fs.files.set(path, content);
  }),
  readFile: vi.fn(async () => new Uint8Array()),
  stat: vi.fn(async () => ({ mtime: new Date(1) })),
  exists: vi.fn(async () => true),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/features/document-editor/diagram-preview", () => ({
  renderDiagramPreview: vi.fn(async () => new Blob(["<svg/>"])),
}));
vi.mock("katex/dist/katex.min.css", () => ({}));

import { TabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { requestCloseTab } from "@/core/tabs/tab-lifecycle";
import MarkdownEditorContainer from "./MarkdownEditorContainer";
import { markdownEditorRegistry } from "./editor-registry";

const PATH = "/ws/notes/idea.md";

function openTab(): string {
  return useTabStore.getState().addTab({
    routeId: "markdown-editor",
    path: "/markdown-editor",
    title: "idea",
    instanceId: PATH,
    metadata: { filePath: PATH },
  });
}

function mount(tabId: string) {
  const result = render(
    <TabContext.Provider value={{ tabId, isActive: true }}>
      <MarkdownEditorContainer />
    </TabContext.Provider>
  );
  const view = () => {
    const dom = result.container.querySelector<HTMLElement>(".cm-editor");
    return dom ? EditorView.findFromDOM(dom) : null;
  };
  return { ...result, view };
}

function type(view: EditorView, text: string) {
  view.dispatch({ changes: { from: view.state.doc.length, insert: text }, userEvent: "input" });
}

describe("MarkdownEditorContainer", () => {
  beforeEach(() => {
    fs.files.clear();
    fs.writes.length = 0;
    fs.files.set(PATH, "# Idea\n");
    useTabStore.setState({ tabs: [], activeTabId: null });
  });

  it("loads the file and autosaves plain Markdown exactly as typed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const tabId = openTab();
      const { view } = mount(tabId);
      await waitFor(() => expect(view()?.state.doc.toString()).toBe("# Idea\n"));

      act(() => type(view()!, "Texto con **negrita** y $x^2$."));
      await waitFor(() =>
        expect(useTabStore.getState().getTab(tabId)?.metadata?.isDirty).toBe(true)
      );
      expect(fs.writes).toEqual([]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(fs.writes).toEqual([[PATH, "# Idea\nTexto con **negrita** y $x^2$."]]);
      await waitFor(() =>
        expect(useTabStore.getState().getTab(tabId)?.metadata?.isDirty).toBe(false)
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves pending changes before the tab closes", async () => {
    // The app never closes the last tab, so keep another one open.
    useTabStore.getState().addTab({ routeId: "settings", path: "/settings", title: "Settings" });
    const tabId = openTab();
    const { view } = mount(tabId);
    await waitFor(() => expect(view()).toBeTruthy());
    act(() => type(view()!, "cambio"));

    await act(async () => {
      await requestCloseTab(tabId);
    });
    expect(fs.files.get(PATH)).toBe("# Idea\ncambio");
    expect(useTabStore.getState().getTab(tabId)).toBeUndefined();
  });

  it("exposes its buffer to workbench flows through the registry", async () => {
    const tabId = openTab();
    const { view } = mount(tabId);
    await waitFor(() => expect(view()).toBeTruthy());
    act(() => type(view()!, "desde MCP"));

    const handle = markdownEditorRegistry.get(PATH)!;
    expect(handle.isDirty()).toBe(true);
    await act(async () => {
      expect(await handle.save()).toBe(true);
    });
    expect(handle.isDirty()).toBe(false);
    expect(fs.files.get(PATH)).toBe("# Idea\ndesde MCP");
  });

  it("shows an error instead of an empty editor when the file can't be read", async () => {
    fs.files.clear();
    const { findByText } = mount(openTab());
    expect(await findByText("No se pudo abrir la nota")).toBeTruthy();
  });
});
