import type React from "react";
import { viewRegistry } from "@/core/layout/view-registry";

/**
 * Views that start in the panel (Terminal, Output, extension views of the
 * `panel` container). The user can move them anywhere: they are regular
 * workbench views (see core/layout).
 */
export interface PanelView {
  id: string;
  title: string;
  /** Lower first. Built-in views use 0–99; extension views start at 100. */
  order: number;
  component: React.ComponentType;
  icon?: React.ComponentType<{ className?: string }>;
  /** Toolbar shown in the header while the view is active. */
  actions?: React.ComponentType;
}

export const panelRegistry = {
  register(view: PanelView): () => void {
    return viewRegistry.register({ ...view, defaultLocation: "panel" });
  },
  unregister(id: string): void {
    viewRegistry.unregister(id);
  },
};
