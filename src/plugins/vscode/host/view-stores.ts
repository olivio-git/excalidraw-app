import { create } from "zustand";

// ── Tree views ────────────────────────────────────────────────────────────────

let sequence = 0;
/** Monotonic counter to order reveal requests and user selections. */
export function nextSequence(): number {
  sequence += 1;
  return sequence;
}

export interface TreeViewState {
  viewId: string;
  extensionId?: string;
  canSelectMany: boolean;
  showCollapseAll: boolean;
  title?: string;
  description?: string;
  message?: string;
  badge?: { value: number; tooltip?: string } | null;
  /** Bumped on `onDidChangeTreeData`; the view refetches. */
  version: number;
  reveal?: { handle?: string; token: number };
}

interface TreeStore {
  views: Record<string, TreeViewState>;
  register: (
    view: Pick<TreeViewState, "viewId" | "extensionId" | "canSelectMany" | "showCollapseAll">
  ) => void;
  update: (viewId: string, changes: Partial<TreeViewState>) => void;
  refresh: (viewId: string) => void;
  reveal: (viewId: string, handle?: string) => void;
  remove: (viewId: string) => void;
  reset: () => void;
}

export const useTreeStore = create<TreeStore>()((set) => ({
  views: {},
  register: (view) =>
    set((state) => ({
      views: {
        ...state.views,
        [view.viewId]: {
          ...state.views[view.viewId],
          ...view,
          version: (state.views[view.viewId]?.version ?? 0) + 1,
        },
      },
    })),
  update: (viewId, changes) =>
    set((state) =>
      state.views[viewId]
        ? { views: { ...state.views, [viewId]: { ...state.views[viewId], ...changes } } }
        : state
    ),
  refresh: (viewId) =>
    set((state) =>
      state.views[viewId]
        ? {
            views: {
              ...state.views,
              [viewId]: { ...state.views[viewId], version: state.views[viewId].version + 1 },
            },
          }
        : state
    ),
  reveal: (viewId, handle) =>
    set((state) =>
      state.views[viewId]
        ? {
            views: {
              ...state.views,
              [viewId]: { ...state.views[viewId], reveal: { handle, token: nextSequence() } },
            },
          }
        : state
    ),
  remove: (viewId) =>
    set((state) => {
      const views = { ...state.views };
      delete views[viewId];
      return { views };
    }),
  reset: () => set({ views: {} }),
}));

// ── Webviews ──────────────────────────────────────────────────────────────────

export interface WebviewOptions {
  enableScripts: boolean;
  enableForms: boolean;
  retainContextWhenHidden: boolean;
  enableCommandUris: boolean;
}

export interface WebviewState {
  handle: string;
  kind: "panel" | "view";
  viewType: string;
  title?: string;
  extensionId?: string;
  html: string;
  options: WebviewOptions;
}

interface WebviewStore {
  webviews: Record<string, WebviewState>;
  /** Webview views: view id → webview handle once resolved. */
  viewHandles: Record<string, string>;
  /** View ids with a registered WebviewViewProvider. */
  providers: Record<string, true>;
  viewMeta: Record<string, { title?: string; description?: string }>;
  upsert: (handle: string, changes: Partial<WebviewState>) => void;
  remove: (handle: string) => void;
  registerProvider: (viewId: string) => void;
  setViewHandle: (viewId: string, handle: string) => void;
  setViewMeta: (viewId: string, meta: { title?: string; description?: string }) => void;
  reset: () => void;
}

const DEFAULT_OPTIONS: WebviewOptions = {
  enableScripts: false,
  enableForms: false,
  retainContextWhenHidden: false,
  enableCommandUris: false,
};

export const useWebviewStore = create<WebviewStore>()((set) => ({
  webviews: {},
  viewHandles: {},
  providers: {},
  viewMeta: {},
  upsert: (handle, changes) =>
    set((state) => {
      const base: WebviewState = state.webviews[handle] ?? {
        handle,
        kind: "panel",
        viewType: "",
        html: "",
        options: DEFAULT_OPTIONS,
      };
      return { webviews: { ...state.webviews, [handle]: { ...base, ...changes } } };
    }),
  remove: (handle) =>
    set((state) => {
      const webviews = { ...state.webviews };
      delete webviews[handle];
      const viewHandles = Object.fromEntries(
        Object.entries(state.viewHandles).filter(([, h]) => h !== handle)
      );
      return { webviews, viewHandles };
    }),
  registerProvider: (viewId) =>
    set((state) => ({ providers: { ...state.providers, [viewId]: true } })),
  setViewHandle: (viewId, handle) =>
    set((state) => ({ viewHandles: { ...state.viewHandles, [viewId]: handle } })),
  setViewMeta: (viewId, meta) =>
    set((state) => ({
      viewMeta: { ...state.viewMeta, [viewId]: { ...state.viewMeta[viewId], ...meta } },
    })),
  reset: () => set({ webviews: {}, viewHandles: {}, providers: {}, viewMeta: {} }),
}));

type MessageListener = (message: unknown) => void;
const webviewListeners = new Map<string, Set<MessageListener>>();
const pendingMessages = new Map<string, unknown[]>();

/** Messages from the extension to a webview (delivered to its iframe). */
export const webviewMessages = {
  post(handle: string, message: unknown): void {
    const listeners = webviewListeners.get(handle);
    if (listeners && listeners.size > 0) listeners.forEach((listener) => listener(message));
    else pendingMessages.set(handle, [...(pendingMessages.get(handle) ?? []), message]);
  },
  subscribe(handle: string, listener: MessageListener): () => void {
    const listeners = webviewListeners.get(handle) ?? new Set();
    listeners.add(listener);
    webviewListeners.set(handle, listeners);
    for (const message of pendingMessages.get(handle) ?? []) listener(message);
    pendingMessages.delete(handle);
    return () => listeners.delete(listener);
  },
  clear(handle?: string): void {
    if (handle) {
      webviewListeners.delete(handle);
      pendingMessages.delete(handle);
    } else {
      webviewListeners.clear();
      pendingMessages.clear();
    }
  },
};

// ── Diagnostics (language bridge) ────────────────────────────────────────────

export interface HostDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  message: string;
  severity: number;
  source?: string;
  code?: string;
  tags?: number[];
}

interface DiagnosticsStore {
  /** path → owner → diagnostics */
  byPath: Record<string, Record<string, HostDiagnostic[]>>;
  set: (owner: string, path: string, diagnostics: HostDiagnostic[]) => void;
  reset: () => void;
}

export const useDiagnosticsStore = create<DiagnosticsStore>()((set) => ({
  byPath: {},
  set: (owner, path, diagnostics) =>
    set((state) => {
      const owners = { ...state.byPath[path] };
      if (diagnostics.length === 0) delete owners[owner];
      else owners[owner] = diagnostics;
      const byPath = { ...state.byPath };
      if (Object.keys(owners).length === 0) delete byPath[path];
      else byPath[path] = owners;
      return { byPath };
    }),
  reset: () => set({ byPath: {} }),
}));

export function diagnosticsForPath(path: string): HostDiagnostic[] {
  return Object.values(useDiagnosticsStore.getState().byPath[path] ?? {}).flat();
}
