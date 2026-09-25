import { useEffect, useState } from "react";
import { watch, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useDocumentStore } from "@/stores/documentStore";
import { scanWorkspaceReferences, type ReferenceIndex } from "../services/workspace-references";

export function useWorkspaceReferences() {
  const workspace = useWorkspaceStore((state) => state.workspaceDir);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    root: string | null;
    index: ReferenceIndex | null;
    loading: boolean;
    error: string | null;
  }>({ root: null, index: null, loading: false, error: null });
  useEffect(() => {
    if (!workspace) return;
    let controller: AbortController | undefined;
    let disposed = false;
    let stop: UnwatchFn | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (disposed) return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      setState((previous) => ({
        root: workspace,
        index: previous.root === workspace ? previous.index : null,
        loading: true,
        error: null,
      }));
      try {
        const index = await scanWorkspaceReferences(
          workspace,
          useDocumentStore.getState().documents,
          current.signal
        );
        if (!disposed && !current.signal.aborted)
          setState({ root: workspace, index, loading: false, error: null });
      } catch (error) {
        if (!disposed && !current.signal.aborted)
          setState({ root: workspace, index: null, loading: false, error: String(error) });
      }
    };
    // Defer the first scan so mount stays synchronous and cleanup can cancel it.
    timer = setTimeout(() => void refresh(), 0);
    void watch(
      workspace,
      (event) => {
        if (disposed) return;
        if (typeof event.type === "object" && "access" in event.type) return;
        clearTimeout(timer);
        timer = setTimeout(() => void refresh(), 600);
      },
      { recursive: true }
    )
      .then((unwatch) => {
        stop = unwatch;
        if (disposed) unwatch();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      stop?.();
    };
  }, [workspace, revision]);
  return {
    index: state.root === workspace ? state.index : null,
    loading: !!workspace && (state.root !== workspace || state.loading),
    error: state.root === workspace ? state.error : null,
    workspace,
    refresh: () => setRevision((value) => value + 1),
  };
}
