import { beforeEach, describe, expect, it, vi } from "vitest";
import { lazy, useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TabContent from "./TabContent";
import { useTabStore } from "../store/tab-store";
import { initialEditorLayout } from "../store/editor-layout";
import { RouteRegistry } from "@/core/routing/route-registry";
import { useTabContext } from "../hooks/use-tab-context";
import { contextKeyService } from "@/core/keybindings/context-key-service";
import { registerTabCloseHandler } from "../tab-lifecycle";
import { mockPointerCapture, pointer } from "@/test/pointer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));
vi.mock("@/core/i18n/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/shared/hooks/useHomeDir", () => ({ useHomeDir: () => "" }));
const mounted = vi.fn();
const unmounted = vi.fn();
const rendered = vi.fn();
function FakeEditor() {
  const { tabId, isActive } = useTabContext();
  // Real editors subscribe to their own tab metadata as well as the focus context.
  useTabStore((state) => state.getTab(tabId));
  rendered(tabId);
  const [value, setValue] = useState("");
  useEffect(() => {
    mounted(tabId);
    return () => {
      unmounted(tabId);
    };
  }, [tabId]);
  return (
    <div>
      <input
        aria-label={`editor-${tabId}`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <span data-testid={`focused-${tabId}`}>{String(isActive)}</span>
    </div>
  );
}
const add = (name: string, routeId = "document-editor") =>
  useTabStore
    .getState()
    .addTab({ routeId, path: `/${routeId}`, title: name, instanceId: `/ws/${name}` });

beforeEach(() => {
  vi.clearAllMocks();
  useTabStore.setState({ ...initialEditorLayout(), tabs: [], activeTabId: null });
  RouteRegistry.clear();
  for (const id of ["document-editor", "diagram"])
    RouteRegistry.register([
      {
        id,
        path: `/${id}`,
        name: id,
        type: "public",
        security: { requiresAuth: false },
        component: lazy(async () => ({ default: FakeEditor })),
        tabConfig: { keepMounted: true },
      },
    ]);
});

describe("split editor workspace", () => {
  it("previews a drag without editor renders or persistence and commits only the final ratio", async () => {
    add("first.md");
    const second = add("second.md");
    useTabStore.getState().openToSide(second);
    const { container } = render(<TabContent />);
    await screen.findByRole("textbox", { name: `editor-${second}` });
    const root = container.querySelector<HTMLElement>("[data-editor-workspace]")!;
    const handle = screen.getByRole("separator");
    mockPointerCapture(handle);
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
    } as DOMRect);
    let frame: FrameRequestCallback = () => undefined;
    const animation = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frame = callback;
      return 123;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const writes = vi.spyOn(useTabStore.persist.getOptions().storage!, "setItem");
    rendered.mockClear();
    try {
      pointer(handle, "pointerdown", 500);
      for (let x = 510; x <= 700; x += 10) pointer(handle, "pointermove", x);
      expect(animation).toHaveBeenCalledOnce();
      act(() => frame(0));
      expect(root.style.getPropertyValue("--editor-split-ratio")).toBe("70%");
      expect(rendered).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
      expect(useTabStore.getState().splitRatio).toBe(50);
      // Release before the next frame: commit the latest pointer, not a stale render.
      pointer(handle, "pointermove", 750);
      pointer(handle, "pointerup", 750);
      expect(cancel).toHaveBeenCalledWith(123);
      expect(useTabStore.getState().splitRatio).toBe(75);
      expect(root.style.getPropertyValue("--editor-split-ratio")).toBe("75%");
      expect(writes).toHaveBeenCalledOnce();
      expect(unmounted).not.toHaveBeenCalled();
    } finally {
      animation.mockRestore();
      cancel.mockRestore();
      writes.mockRestore();
    }
  });

  it("only renders the two affected editors when switching among many open tabs", async () => {
    const ids = Array.from({ length: 16 }, (_, index) => add(`note-${index}.md`));
    render(<TabContent />);
    await screen.findByRole("textbox", { name: `editor-${ids[15]}` });
    await waitFor(() => expect(mounted).toHaveBeenCalledTimes(16));
    rendered.mockClear();

    act(() => useTabStore.getState().setActiveTab(ids[0]));

    expect(new Set(rendered.mock.calls.map(([id]) => id))).toEqual(new Set([ids[0], ids[15]]));
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("does not render unrelated editors when opening and closing a background tab", async () => {
    const first = add("first.md");
    render(<TabContent />);
    await screen.findByRole("textbox", { name: `editor-${first}` });
    let second = "";
    act(() => {
      second = add("second.md");
    });
    await screen.findByRole("textbox", { name: `editor-${second}` });
    rendered.mockClear();
    let third = "";
    act(() => {
      third = add("third.md");
    });
    await screen.findByRole("textbox", { name: `editor-${third}` });
    expect(rendered.mock.calls.some(([id]) => id === first)).toBe(false);
    rendered.mockClear();

    act(() => useTabStore.getState().removeTab(second));

    expect(rendered).not.toHaveBeenCalled();
    expect(unmounted).toHaveBeenCalledWith(second);
  });

  it("lets an already-empty parallel pane be closed with its own X", async () => {
    const user = userEvent.setup();
    const first = add("notes.md");
    useTabStore.getState().setSplitDirection("horizontal");
    render(<TabContent />);
    await screen.findByRole("textbox", { name: `editor-${first}` });
    await user.click(
      within(screen.getByRole("region", { name: "workbench.secondary" })).getByRole("button", {
        name: "workbench.closeEmptyGroup",
      })
    );
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(useTabStore.getState().activeTabId).toBe(first);
  });
  it("expands the surviving editor after closing the upper pane of a vertical split", async () => {
    const user = userEvent.setup();
    const first = add("notes.md");
    const second = add("map.excalidraw", "diagram");
    useTabStore.getState().openToSide(second);
    useTabStore.getState().setSplitDirection("vertical");
    render(<TabContent />);
    const editor = await screen.findByRole("textbox", { name: `editor-${second}` });
    fireEvent.change(editor, { target: { value: "preserve this editor" } });
    await user.click(
      within(screen.getByRole("region", { name: "workbench.primary" })).getByLabelText(
        "tab.closeTab"
      )
    );
    await waitFor(() => expect(useTabStore.getState().getTab(first)).toBeUndefined());
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: `editor-${second}` })).toBe(editor);
    expect(editor).toHaveValue("preserve this editor");
    expect(useTabStore.getState().activeTabId).toBe(second);
    expect(unmounted).not.toHaveBeenCalledWith(second);
  });

  it("keeps the pane open while saving or when the editor refuses to close", async () => {
    const user = userEvent.setup();
    add("notes.md");
    const second = add("map.excalidraw", "diagram");
    useTabStore.getState().openToSide(second);
    let finish: (allow: boolean) => void = () => undefined;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    const unregister = registerTabCloseHandler(second, save);
    render(<TabContent />);
    await screen.findByRole("textbox", { name: `editor-${second}` });
    const close = within(
      screen.getByRole("region", { name: "workbench.secondary" })
    ).getByLabelText("tab.closeTab");
    try {
      await user.click(close);
      expect(save).toHaveBeenCalledOnce();
      expect(screen.getByRole("separator")).toBeInTheDocument();
      await act(async () => finish(false));
      expect(useTabStore.getState().getTab(second)).toBeDefined();
      expect(screen.getByRole("separator")).toBeInTheDocument();
      await user.click(close);
      await act(async () => finish(true));
      await waitFor(() => expect(screen.queryByRole("separator")).not.toBeInTheDocument());
    } finally {
      unregister();
    }
  });
  it("closes the parallel pane when its last tab is closed with the X", async () => {
    const user = userEvent.setup();
    const first = add("notes.md");
    const second = add("map.excalidraw", "diagram");
    useTabStore.getState().openToSide(second);
    render(<TabContent />);
    await screen.findByRole("textbox", { name: `editor-${second}` });
    const remainingEditor = screen.getByRole("textbox", { name: `editor-${first}` });
    fireEvent.change(remainingEditor, { target: { value: "keep my work" } });
    const secondary = screen.getByRole("region", { name: "workbench.secondary" });
    await user.click(within(secondary).getByLabelText("tab.closeTab"));
    await waitFor(() => expect(useTabStore.getState().getTab(second)).toBeUndefined());
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "workbench.secondary" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: `editor-${first}` })).toBe(remainingEditor);
    expect(remainingEditor).toHaveValue("keep my work");
    expect(useTabStore.getState().activeTabId).toBe(first);
  });
  it("navigates the focused group's tab strip with the keyboard", async () => {
    const first = add("first.md");
    const second = add("second.md");
    render(<TabContent />);
    await screen.findByRole("textbox", { name: `editor-${second}` });
    fireEvent.keyDown(screen.getByRole("tab", { name: /second.md/ }), { key: "ArrowLeft" });
    expect(useTabStore.getState().activeTabId).toBe(first);
    expect(screen.getByRole("tab", { name: /first.md/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: /first.md/ }), { key: "End" });
    expect(useTabStore.getState().activeTabId).toBe(second);
  });
  it("shows both editors and retains local state while moving and merging", async () => {
    const first = add("notes.md");
    const second = add("map.excalidraw", "diagram");
    useTabStore.getState().openToSide(second);
    render(<TabContent />);
    const input = await screen.findByRole("textbox", { name: `editor-${second}` });
    fireEvent.change(input, { target: { value: "unsaved local content" } });
    expect(screen.getByRole("textbox", { name: `editor-${first}` })).toBeVisible();
    expect(input).toBeVisible();
    await act(async () => {
      useTabStore.getState().moveTabToGroup(second, "primary");
      useTabStore.getState().setSplitDirection(null);
    });
    expect(screen.getByRole("textbox", { name: `editor-${second}` })).toBe(input);
    expect(input).toHaveValue("unsaved local content");
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("sets commands to the focused editor while the other remains visible", async () => {
    const first = add("notes.md");
    const second = add("map.excalidraw", "diagram");
    useTabStore.getState().openToSide(second);
    render(<TabContent />);
    expect(contextKeyService.get("documentEditorActive")).toBe(false);
    const input = await screen.findByRole("textbox", { name: `editor-${first}` });
    fireEvent.pointerDown(input);
    expect(useTabStore.getState().activeTabId).toBe(first);
    expect(contextKeyService.get("documentEditorActive")).toBe(true);
    expect(screen.getByTestId(`focused-${first}`)).toHaveTextContent("true");
    expect(screen.getByRole("textbox", { name: `editor-${second}` })).toBeVisible();
  });

  it("supports keyboard resizing and independent tab strips", async () => {
    const first = add("notes.md");
    const second = add("map.excalidraw", "diagram");
    useTabStore.getState().openToSide(second);
    render(<TabContent />);
    await screen.findByRole("textbox", { name: `editor-${second}` });
    expect(
      within(screen.getByRole("region", { name: "workbench.primary" })).getAllByRole("tab")
    ).toHaveLength(1);
    expect(
      within(screen.getByRole("region", { name: "workbench.secondary" })).getAllByRole("tab")
    ).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(useTabStore.getState().splitRatio).toBe(55);
    expect(useTabStore.getState().groupActiveTabIds).toEqual({ primary: first, secondary: second });
  });
});
