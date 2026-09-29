import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { viewRegistry, type WorkbenchView } from "./view-registry";
import {
  activeViewIn,
  defaultLayout,
  isViewVisible,
  locationOf,
  useLayoutStore,
  viewsIn,
} from "./layout-store";
import { resolveDrop } from "./layout-dnd";
import { WorkbenchDnd } from "./WorkbenchDnd";
import { ViewPart } from "./ViewPart";

const disposers: Array<() => void> = [];

function view(id: string, defaultLocation: WorkbenchView["defaultLocation"], order: number) {
  disposers.push(
    viewRegistry.register({
      id,
      title: id.toUpperCase(),
      defaultLocation,
      order,
      component: () => <p>{`${id} content`}</p>,
    })
  );
}

const ids = (location: Parameters<typeof viewsIn>[0]) =>
  viewsIn(location, useLayoutStore.getState()).map((v) => v.id);

beforeEach(() => {
  useLayoutStore.setState({ ...defaultLayout(), dragging: null });
  view("explorer", "primary", 0);
  view("search", "primary", 1);
  view("chat", "primary", 2);
  view("terminal", "panel", 10);
  view("output", "panel", 20);
});
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

describe("layout store", () => {
  it("places views in their default location, in registration order", () => {
    expect(ids("primary")).toEqual(["explorer", "search", "chat"]);
    expect(ids("panel")).toEqual(["terminal", "output"]);
    expect(ids("secondary")).toEqual([]);
    expect(locationOf("terminal", useLayoutStore.getState())).toBe("panel");
  });

  it("reorders within a location", () => {
    act(() => {
      useLayoutStore.getState().moveView("chat", "primary", 0);
    });
    expect(ids("primary")).toEqual(["chat", "explorer", "search"]);
    act(() => {
      useLayoutStore.getState().moveView("chat", "primary", 2);
    });
    expect(ids("primary")).toEqual(["explorer", "search", "chat"]);
  });

  it("moves views between locations, opening the target and fixing the source", () => {
    act(() => {
      useLayoutStore.getState().showView("terminal");
    });
    act(() => {
      useLayoutStore.getState().moveView("terminal", "secondary");
    });
    const state = useLayoutStore.getState();
    expect(ids("secondary")).toEqual(["terminal"]);
    expect(state.parts.secondary).toMatchObject({ open: true, active: "terminal" });
    expect(ids("panel")).toEqual(["output"]);
    expect(state.parts.panel.active).toBe("output");
    expect(isViewVisible("terminal")).toBe(true);

    // Emptying the panel closes it.
    act(() => {
      useLayoutStore.getState().moveView("output", "primary", 1);
    });
    expect(useLayoutStore.getState().parts.panel.open).toBe(false);
    expect(ids("primary")).toEqual(["explorer", "output", "search", "chat"]);
  });

  it("shows and hides views wherever they are", () => {
    act(() => {
      useLayoutStore.getState().moveView("chat", "secondary");
    });
    act(() => {
      useLayoutStore.getState().setPartOpen("secondary", false);
    });
    act(() => {
      useLayoutStore.getState().showView("chat");
    });
    expect(useLayoutStore.getState().parts.secondary.open).toBe(true);
    act(() => {
      useLayoutStore.getState().hideView("chat");
    });
    expect(useLayoutStore.getState().parts.secondary.open).toBe(false);
    // Hiding a view that is not the active one leaves the location alone.
    act(() => {
      useLayoutStore.getState().showView("explorer");
    });
    act(() => {
      useLayoutStore.getState().hideView("search");
    });
    expect(useLayoutStore.getState().parts.primary.open).toBe(true);
  });

  it("falls back to the first view when the active one goes away", () => {
    act(() => {
      useLayoutStore.getState().setActive("primary", "gone");
    });
    expect(activeViewIn("primary", useLayoutStore.getState())?.id).toBe("explorer");
  });

  it("keeps placements for views registered later and resets the layout", () => {
    act(() => {
      useLayoutStore.getState().moveView("output", "secondary");
    });
    disposers.pop()?.(); // output unregistered (extension host restart)...
    expect(ids("secondary")).toEqual([]);
    view("output", "panel", 20); // ...and back where the user left it.
    expect(ids("secondary")).toEqual(["output"]);

    act(() => {
      useLayoutStore.getState().setSidebarSide("right");
      useLayoutStore.getState().resetLayout();
    });
    expect(ids("panel")).toEqual(["terminal", "output"]);
    expect(useLayoutStore.getState().sidebarSide).toBe("left");
  });

  it("resolves drops on tabs and on locations", () => {
    expect(resolveDrop("chat", { location: "primary", viewId: "explorer" })).toEqual({
      location: "primary",
      index: 0,
    });
    expect(resolveDrop("chat", { location: "panel", viewId: "output" })).toEqual({
      location: "panel",
      index: 1,
    });
    expect(resolveDrop("chat", { location: "secondary" })).toEqual({ location: "secondary" });
    expect(resolveDrop("chat", { location: "primary", viewId: "chat" })).toBeNull();
    expect(resolveDrop("chat", undefined)).toBeNull();
  });

  it("clamps sizes", () => {
    act(() => {
      useLayoutStore.getState().setSecondaryWidth(10);
    });
    expect(useLayoutStore.getState().secondaryWidth).toBe(180);
    act(() => {
      useLayoutStore.getState().setPanelSize(50);
    });
    expect(useLayoutStore.getState().panelHeight).toBe(120);
  });
});

describe("ViewPart", () => {
  const renderPart = () =>
    render(
      <WorkbenchDnd>
        <ViewPart location="primary" variant="sidebar" />
      </WorkbenchDnd>
    );

  it("renders the location's views as tabs and switches between them", () => {
    renderPart();
    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "EXPLORER",
      "SEARCH",
      "CHAT",
    ]);
    expect(screen.getByText("explorer content")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "CHAT" }));
    expect(screen.getByText("chat content")).toBeInTheDocument();
    expect(screen.getByText("explorer content").closest("[role='tabpanel']")).toHaveClass("hidden");
  });

  it("moves a view from its context menu", () => {
    renderPart();
    fireEvent.contextMenu(screen.getByRole("tab", { name: "SEARCH" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mover a panel" }));
    expect(ids("panel")).toEqual(["terminal", "output", "search"]);
    expect(screen.queryByRole("tab", { name: "SEARCH" })).not.toBeInTheDocument();
  });

  it("starts and cancels a drag from the keyboard", async () => {
    renderPart();
    const tab = screen.getByRole("tab", { name: "EXPLORER" });
    tab.focus();
    fireEvent.keyDown(tab, { key: " ", code: "Space" });
    expect(useLayoutStore.getState().dragging).toBe("explorer");
    // The sensor starts listening on the next tick.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(useLayoutStore.getState().dragging).toBeNull();
  });

  it("offers a hint when a location is empty", () => {
    act(() => {
      useLayoutStore.getState().setPartOpen("secondary", true);
    });
    render(
      <WorkbenchDnd>
        <ViewPart location="secondary" variant="sidebar" />
      </WorkbenchDnd>
    );
    expect(screen.getByText(/Arrastra aquí una vista/)).toBeInTheDocument();
  });
});

describe("view errors", () => {
  it("contains a crashing view to its own tab", () => {
    disposers.push(
      viewRegistry.register({
        id: "broken",
        title: "BROKEN",
        defaultLocation: "primary",
        order: -1,
        component: () => {
          throw new Error("boom");
        },
      })
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <WorkbenchDnd>
        <ViewPart location="primary" variant="sidebar" />
      </WorkbenchDnd>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("tab", { name: "EXPLORER" })).toBeInTheDocument();
    spy.mockRestore();
  });
});
