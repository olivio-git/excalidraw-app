import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BottomPanel } from "./BottomPanel";
import { panelRegistry } from "./panel-registry";
import { usePanelStore } from "./panel-store";

const disposers: Array<() => void> = [];

function registerView(id: string, title: string, order: number) {
  disposers.push(
    panelRegistry.register({ id, title, order, component: () => <p>{`${title} content`}</p> })
  );
}

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  usePanelStore.setState({ open: false, activeViewId: null });
});

describe("BottomPanel", () => {
  it("is hidden while closed", () => {
    registerView("terminal", "Terminal", 10);
    const { container } = render(<BottomPanel />);
    expect(container.querySelector("[data-panel='bottom']")).toHaveClass("hidden");
  });

  it("shows the active view and switches tabs, keeping visited views mounted", () => {
    registerView("output", "Salida", 20);
    registerView("terminal", "Terminal", 10);
    usePanelStore.setState({ open: true, activeViewId: "terminal" });
    render(<BottomPanel />);

    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Terminal", "Salida"]);
    expect(screen.getByText("Terminal content")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Salida" }));
    expect(usePanelStore.getState().activeViewId).toBe("output");
    expect(screen.getByText("Salida content")).toBeInTheDocument();
    expect(screen.getByText("Terminal content").closest("[role='tabpanel']")).toHaveClass("hidden");
  });

  it("closes from the header button", () => {
    registerView("terminal", "Terminal", 10);
    usePanelStore.setState({ open: true, activeViewId: "terminal" });
    render(<BottomPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar panel" }));
    expect(usePanelStore.getState().open).toBe(false);
  });

  it("reacts to views registered later (e.g. by extensions)", () => {
    usePanelStore.setState({ open: true, activeViewId: null });
    render(<BottomPanel />);
    act(() => registerView("ext.view", "Extensión", 100));
    expect(screen.getByRole("tab", { name: "Extensión" })).toBeInTheDocument();
  });
});
