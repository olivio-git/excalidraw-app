import {
  PANEL_DEFAULT_HEIGHT,
  PANEL_MIN_SIZE,
  isViewVisible,
  useLayoutStore,
} from "@/core/layout/layout-store";

export const PANEL_MIN_HEIGHT = PANEL_MIN_SIZE;
export { PANEL_DEFAULT_HEIGHT };

/**
 * Show, hide and query views wherever the user placed them (panel or side
 * bars). Views that start in the panel use this; see core/layout.
 */
export const panelViews = {
  show: (viewId: string) => useLayoutStore.getState().showView(viewId),
  hide: (viewId: string) => useLayoutStore.getState().hideView(viewId),
  isVisible: (viewId: string) => isViewVisible(viewId),
  /** Hide the view if it is showing, show it otherwise. */
  toggle: (viewId: string) =>
    isViewVisible(viewId)
      ? useLayoutStore.getState().hideView(viewId)
      : useLayoutStore.getState().showView(viewId),
};
