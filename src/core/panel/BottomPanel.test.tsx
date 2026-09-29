import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { BottomPanel } from "./BottomPanel";
import { panelRegistry } from "./panel-registry";
import { defaultLayout, useLayoutStore } from "@/core/layout/layout-store";

const disposers: Array<() => void> = [];

function registerView(id: string, title: string, order: number) {
  disposers.push(
    panelRegistry.register({ id, title, order, component: () => <p>{`${title} content`}</p> })
  );
}

const renderPanel = () =>
  render(
    <DndContext>
      <BottomPanel />
    </DndContext>
  );

beforeEach(() => useLayoutStore.setState(defaultLayout()));
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

describe("BottomPanel", () => {
  it("is hidden while closed", () => {
    registerView("terminal", "Terminal", 10);
    const { container } = renderPanel();
    expect(container.querySelector("[data-panel='bottom']")).toHaveClass("hidden");
  });

  it("shows the active view and switches tabs, keeping visited views mounted", () => {
    registerView("output", "Salida", 20);
    registerView("terminal", "Terminal", 10);
    act(() => {
      useLayoutStore.getState().showView("terminal");
    });
    renderPanel();

    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Terminal", "Salida"]);
    expect(screen.getByText("Terminal content")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Salida" }));
    expect(useLayoutStore.getState().parts.panel.active).toBe("output");
    expect(screen.getByText("Salida content")).toBeInTheDocument();
    expect(screen.getByText("Terminal content").closest("[role='tabpanel']")).toHaveClass("hidden");
  });

  it("closes from the header button", () => {
    registerView("terminal", "Terminal", 10);
    act(() => {
      useLayoutStore.getState().showView("terminal");
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar panel" }));
    expect(useLayoutStore.getState().parts.panel.open).toBe(false);
  });

  it("reacts to views registered later (e.g. by extensions)", () => {
    registerView("terminal", "Terminal", 10);
    act(() => {
      useLayoutStore.getState().setPartOpen("panel", true);
    });
    renderPanel();
    act(() => registerView("ext.view", "Extensión", 100));
    expect(screen.getByRole("tab", { name: "Extensión" })).toBeInTheDocument();
  });

  it("drops views moved to a side bar and renders on the right when asked", () => {
    registerView("terminal", "Terminal", 10);
    registerView("output", "Salida", 20);
    act(() => {
      useLayoutStore.getState().showView("terminal");
      useLayoutStore.getState().moveView("output", "secondary");
      useLayoutStore.getState().setPanelPosition("right");
    });
    const { container } = renderPanel();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Terminal"]);
    expect(container.querySelector("[data-panel='bottom']")).toHaveAttribute(
      "data-panel-position",
      "right"
    );
  });
});
