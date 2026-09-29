import type React from "react";
import { useSyncExternalStore } from "react";

/**
 * Where a view can live, like VS Code's workbench parts: the primary side
 * bar, the secondary side bar (opposite side) and the panel.
 */
export type ViewLocation = "primary" | "secondary" | "panel";

export const VIEW_LOCATIONS: ViewLocation[] = ["primary", "secondary", "panel"];

export const LOCATION_LABELS: Record<ViewLocation, string> = {
  primary: "Barra lateral principal",
  secondary: "Barra lateral secundaria",
  panel: "Panel",
};

/**
 * A view the user can move between locations and reorder: Explorer, AI chat,
 * Terminal, Output, extension view containers...
 */
export interface WorkbenchView {
  id: string;
  /** A function when the title depends on the UI language. */
  title: string | (() => string);
  icon?: React.ComponentType<{ className?: string }>;
  component: React.ComponentType;
  /** Toolbar shown in the location's header while the view is active. */
  actions?: React.ComponentType;
  defaultLocation: ViewLocation;
  /** Default position among the views of its default location (lower first). */
  order: number;
}

type Listener = () => void;

class ViewRegistryClass {
  private views: WorkbenchView[] = [];
  private listeners = new Set<Listener>();

  register(view: WorkbenchView): () => void {
    this.views = [...this.views.filter((v) => v.id !== view.id), view].sort(
      (a, b) => a.order - b.order
    );
    this.emit();
    return () => this.unregister(view.id, view);
  }

  /** With `instance`, only removes that registration (not a newer one with the same id). */
  unregister(id: string, instance?: WorkbenchView): void {
    const next = this.views.filter((v) => v.id !== id || (instance && v !== instance));
    if (next.length === this.views.length) return;
    this.views = next;
    this.emit();
  }

  get(id: string): WorkbenchView | undefined {
    return this.views.find((v) => v.id === id);
  }

  getAll(): WorkbenchView[] {
    return this.views;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const viewRegistry = new ViewRegistryClass();

export function useWorkbenchViews(): WorkbenchView[] {
  return useSyncExternalStore(viewRegistry.subscribe, () => viewRegistry.getAll());
}

export function viewTitle(view: WorkbenchView): string {
  return typeof view.title === "function" ? view.title() : view.title;
}
