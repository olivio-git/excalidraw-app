import type React from "react";
import { useSyncExternalStore } from "react";

/**
 * Views shown in the bottom panel (VS Code's "Panel": Terminal, Output, and
 * views contributed by extensions to the `panel` container).
 */
export interface PanelView {
  id: string;
  title: string;
  /** Lower first. Built-in views use 0–99; extension views start at 100. */
  order: number;
  component: React.ComponentType;
  /** Toolbar rendered at the right of the tab strip while the view is active. */
  actions?: React.ComponentType;
}

type Listener = () => void;

class PanelRegistryClass {
  private views: PanelView[] = [];
  private listeners = new Set<Listener>();

  register(view: PanelView): () => void {
    this.views = [...this.views.filter((v) => v.id !== view.id), view].sort(
      (a, b) => a.order - b.order
    );
    this.emit();
    return () => this.unregister(view.id);
  }

  unregister(id: string): void {
    const next = this.views.filter((v) => v.id !== id);
    if (next.length === this.views.length) return;
    this.views = next;
    this.emit();
  }

  get(id: string): PanelView | undefined {
    return this.views.find((v) => v.id === id);
  }

  getAll(): PanelView[] {
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

export const panelRegistry = new PanelRegistryClass();

export function usePanelViews(): PanelView[] {
  return useSyncExternalStore(panelRegistry.subscribe, () => panelRegistry.getAll());
}
