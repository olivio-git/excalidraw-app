import { useLayoutStore } from "@/core/layout/layout-store";

/** View id of an extension view container ("ext:<containerId>"). */
export const extensionPanelId = (containerId: string) => `ext:${containerId}`;

/** Reveal a view (Explorer, AI chat, an extension container...) wherever it is placed. */
export function revealView(viewId: string): void {
  useLayoutStore.getState().showView(viewId);
}
