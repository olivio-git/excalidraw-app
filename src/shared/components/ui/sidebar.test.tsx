import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SidebarProvider, SidebarResizeHandle, useSidebar } from "./sidebar";
import { mockPointerCapture, pointer } from "@/test/pointer";

const rendered = vi.fn();
let frame: FrameRequestCallback;
function Inspector() {
  const { sidebarWidth, isResizing } = useSidebar();
  rendered();
  return (
    <output data-testid="width" data-resizing={isResizing}>
      {sidebarWidth}
    </output>
  );
}
function setup() {
  const view = render(
    <SidebarProvider>
      <Inspector />
      <SidebarResizeHandle />
    </SidebarProvider>
  );
  const handle = view.container.querySelector<HTMLElement>("[data-sidebar-resize]")!;
  const root = view.container.querySelector<HTMLElement>("[data-sidebar-wrapper]")!;
  mockPointerCapture(handle);
  return { ...view, handle, root };
}
beforeEach(() => {
  rendered.mockClear();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 123;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("sidebar resize preview", () => {
  it("keeps pointer movement out of the sidebar context and commits once on release", () => {
    const { handle, root } = setup();
    pointer(handle, "pointerdown", 240);
    rendered.mockClear();
    for (let x = 220; x <= 400; x += 10) pointer(handle, "pointermove", x);
    expect(window.requestAnimationFrame).toHaveBeenCalledOnce();
    act(() => frame(0));
    expect(root.style.getPropertyValue("--sidebar-width")).toBe("400px");
    expect(screen.getByTestId("width")).toHaveTextContent("240");
    expect(rendered).not.toHaveBeenCalled();
    pointer(handle, "pointerup", 400);
    expect(screen.getByTestId("width")).toHaveTextContent("400");
    expect(root.style.getPropertyValue("--sidebar-width")).toBe("400px");
    expect(screen.getByTestId("width")).toHaveAttribute("data-resizing", "false");
    expect(rendered).toHaveBeenCalledOnce();
  });

  it.each(["pointercancel", "lostpointercapture", "blur"])(
    "cancels on %s without persisting the preview",
    (event) => {
      const { handle, root } = setup();
      const cursor = document.body.style.cursor;
      pointer(handle, "pointerdown", 240);
      pointer(handle, "pointermove", 400);
      act(() => frame(0));
      if (event === "blur") fireEvent(window, new Event("blur"));
      else pointer(handle, event, 400);
      expect(screen.getByTestId("width")).toHaveTextContent("240");
      expect(root.style.getPropertyValue("--sidebar-width")).toBe("240px");
      expect(screen.getByTestId("width")).toHaveAttribute("data-resizing", "false");
      expect(document.body.style.cursor).toBe(cursor);
    }
  );

  it("cleans up a pending frame and body styles when unmounted during drag", () => {
    const { handle, unmount } = setup();
    const cursor = document.body.style.cursor;
    const userSelect = document.body.style.userSelect;
    pointer(handle, "pointerdown", 240);
    pointer(handle, "pointermove", 800);
    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(123);
    expect(document.body.style.cursor).toBe(cursor);
    expect(document.body.style.userSelect).toBe(userSelect);
  });
});
