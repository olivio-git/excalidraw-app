import { useEffect, useRef, useState } from "react";
import { readTextFile, watch, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { openFileReference, resolveFileReference } from "@/core/shell/services/file-navigation";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { notify } from "@/shared/lib/notify";
import type { EditorGroupId } from "@/core/tabs/types";
import { parseFlow } from "./model";
import { createFlowEditorStore, type FlowEditorStore } from "./editor-store";
import { Flow3DEditor } from "./Flow3DEditor";

interface Flow3DEmbedProps {
  /** Reference to the `.flow3d` file, as stored in the note. */
  flowPath: string;
  /** The note embedding it (relative references resolve from here). */
  sourcePath: string;
  groupId?: EditorGroupId;
}

/**
 * A flow playing inside a note: read-only 3D view with its playback bar.
 * Follows changes to the file (when the platform can watch it).
 */
export default function Flow3DEmbed({ flowPath, sourcePath, groupId }: Flow3DEmbedProps) {
  const workspace = useWorkspaceStore((s) => s.workspaceDir);
  const [state, setState] = useState<{ store?: FlowEditorStore; error?: string }>({});
  const [revision, setRevision] = useState(0);
  const storeRef = useRef<FlowEditorStore | null>(null);

  useEffect(() => {
    let disposed = false;
    let stop: UnwatchFn | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (path: string) => {
      try {
        const doc = parseFlow(await readTextFile(path));
        if (disposed) return;
        // Keep camera and playback when the file changes: swap the document in place.
        if (storeRef.current) {
          storeRef.current.getState().setDoc(doc, { history: false });
          setState({ store: storeRef.current });
        } else {
          storeRef.current = createFlowEditorStore(doc);
          setState({ store: storeRef.current });
        }
      } catch (error) {
        if (!disposed) setState({ error: String(error) });
      }
    };
    void (async () => {
      try {
        const { filePath } = await resolveFileReference(flowPath, sourcePath, workspace);
        if (disposed) return;
        await load(filePath);
        stop = await watch(
          filePath,
          (event) => {
            if (typeof event.type === "object" && "access" in event.type) return;
            clearTimeout(timer);
            timer = setTimeout(() => void load(filePath), 300);
          },
          { recursive: false }
        ).catch(() => undefined);
        if (disposed) stop?.();
      } catch (error) {
        if (!disposed) setState({ error: String(error) });
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(timer);
      stop?.();
    };
  }, [flowPath, sourcePath, workspace, revision]);

  return (
    <div
      className="flex flex-col"
      data-flow3d-embed
      // Keys go to the viewer (Space plays), never to the note being edited.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Flujo 3D vinculado</span>
        <button aria-label="Recargar" title="Recargar" onClick={() => setRevision((n) => n + 1)}>
          <RefreshCw className="size-3.5" />
        </button>
        <button
          aria-label="Abrir al lado"
          title="Abrir al lado"
          onClick={() =>
            void openFileReference(flowPath, sourcePath, { beside: true, groupId }).catch(
              (error: unknown) => notify(String(error), { type: "error" })
            )
          }
        >
          <ExternalLink className="size-3.5" />
        </button>
      </div>
      <div className="h-80">
        {state.error ? (
          <p role="alert" className="break-words p-4 text-xs text-destructive">
            {state.error}
          </p>
        ) : state.store ? (
          <Flow3DEditor store={state.store} editable={false} />
        ) : (
          <div
            role="status"
            className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"
          >
            <LoaderCircle className="size-4 animate-spin" />
            Cargando flujo…
          </div>
        )}
      </div>
    </div>
  );
}
