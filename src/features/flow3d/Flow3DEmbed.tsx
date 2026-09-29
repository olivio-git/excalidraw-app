import { useEffect, useRef, useState } from "react";
import { readTextFile, watch, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { openFileReference, resolveFileReference } from "@/core/shell/services/file-navigation";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { notify } from "@/shared/lib/notify";
import type { EditorGroupId } from "@/core/tabs/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { NODE_KINDS, findStep, parseFlow } from "./model";
import { createFlowEditorStore, useFlowEditor, type FlowEditorStore } from "./editor-store";
import { Flow3DEditor } from "./Flow3DEditor";

interface Flow3DEmbedProps {
  /** Reference to the `.flow3d` file, as stored in the note. */
  flowPath: string;
  /** The note embedding it (relative references resolve from here). */
  sourcePath: string;
  groupId?: EditorGroupId;
  /** Store a new reference in the note (e.g. `flujo.flow3d#paso` to start at a step). */
  onChangePath?: (path: string) => void;
}

const FROM_START = "__start__";

/** Show the flow at a step: selected, camera on it, playback from there. */
function startAt(store: FlowEditorStore, anchor: string) {
  const state = store.getState();
  const step = anchor ? findStep(state.doc, anchor) : undefined;
  if (!step) return;
  // Camera and playback only: a note shouldn't open the inspector over the flow.
  state.focusPoint(step.position);
  const span = state.timeline.nodes.find((s) => s.id === step.id);
  if (span) state.seek(span.start);
}

function StartStepSelect({
  store,
  anchor,
  onChange,
}: {
  store: FlowEditorStore;
  anchor: string;
  onChange: (stepId: string | null) => void;
}) {
  const nodes = useFlowEditor(store, (s) => s.doc.nodes);
  const steps = nodes.filter((n) => NODE_KINDS[n.kind].executes);
  const current = anchor ? findStep(store.getState().doc, anchor)?.id : undefined;
  const items = [
    { value: FROM_START, label: "Desde el inicio" },
    ...steps.map((n) => ({ value: n.id, label: n.label || n.id })),
  ];
  return (
    <Select
      items={items}
      value={current ?? FROM_START}
      onValueChange={(value) => onChange(value === FROM_START ? null : (value as string))}
    >
      <SelectTrigger size="sm" aria-label="Empezar en" className="h-6 max-w-40 text-[11px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} className="text-xs">
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A flow playing inside a note: read-only 3D view with its playback bar.
 * Follows changes to the file (when the platform can watch it).
 */
export default function Flow3DEmbed({
  flowPath,
  sourcePath,
  groupId,
  onChangePath,
}: Flow3DEmbedProps) {
  const workspace = useWorkspaceStore((s) => s.workspaceDir);
  const [state, setState] = useState<{ store?: FlowEditorStore; error?: string }>({});
  const [revision, setRevision] = useState(0);
  const storeRef = useRef<FlowEditorStore | null>(null);
  const hash = flowPath.indexOf("#");
  const anchor = hash < 0 ? "" : decodeURIComponent(flowPath.slice(hash + 1));
  const basePath = hash < 0 ? flowPath : flowPath.slice(0, hash);

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
          // Notes can embed several flows: keep them light.
          storeRef.current.getState().setEffects(false, { remember: false });
          setState({ store: storeRef.current });
          startAt(storeRef.current, anchor);
        }
      } catch (error) {
        if (!disposed) setState({ error: String(error) });
      }
    };
    void (async () => {
      try {
        const { filePath } = await resolveFileReference(basePath, sourcePath, workspace);
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
    // The anchor is applied on load and below when it changes, not by reloading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, sourcePath, workspace, revision]);

  useEffect(() => {
    if (storeRef.current) startAt(storeRef.current, anchor);
  }, [anchor]);

  return (
    <div
      // Note styles enlarge SVGs: keep the viewer's icons at toolbar size.
      className="flex flex-col [&_button_svg]:size-3.5!"
      data-flow3d-embed
      // Keys go to the viewer (Space plays), never to the note being edited.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Flujo 3D vinculado</span>
        {state.store && onChangePath && (
          <StartStepSelect
            store={state.store}
            anchor={anchor}
            onChange={(stepId) =>
              onChangePath(stepId ? `${basePath}#${encodeURIComponent(stepId)}` : basePath)
            }
          />
        )}
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
          <Flow3DEditor store={state.store} editable={false} minimap={false} />
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
