import { useCallback } from "react";
import {
  Crosshair,
  FileInput,
  Maximize,
  Pause,
  Play,
  Redo2,
  RefreshCw,
  Square,
  Undo2,
  Workflow,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Slider } from "@/shared/components/ui/slider";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { cn } from "@/shared/lib/utils";
import { NODE_KIND_ORDER, NODE_KINDS, type FlowNode } from "./model";
import { useFlowEditor, type FlowEditorStore } from "./editor-store";
import { FlowScene } from "./scene/FlowScene";
import { Inspector } from "./Inspector";

const SPEEDS = [
  { value: "0.5", label: "0.5×" },
  { value: "1", label: "1×" },
  { value: "1.5", label: "1.5×" },
  { value: "2", label: "2×" },
];

function ToolButton({
  label,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <TooltipWrapper tooltip={label} side="bottom">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={cn(pressed && "bg-muted text-foreground")}
      >
        {children}
      </Button>
    </TooltipWrapper>
  );
}

function PlaybackControls({ store }: { store: FlowEditorStore }) {
  const playing = useFlowEditor(store, (s) => s.playing);
  const time = useFlowEditor(store, (s) => s.displayTime);
  const duration = useFlowEditor(store, (s) => s.timeline.duration);
  const speed = useFlowEditor(store, (s) => s.speed);
  const state = store.getState();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <ToolButton
        label={playing ? "Pausar (Espacio)" : "Reproducir (Espacio)"}
        onClick={state.togglePlay}
        disabled={duration <= 0}
      >
        {playing ? <Pause /> : <Play />}
      </ToolButton>
      <ToolButton label="Detener" onClick={state.stop} disabled={duration <= 0}>
        <Square className="size-3.5" />
      </ToolButton>
      <Slider
        aria-label="Línea de tiempo"
        className="mx-1 max-w-sm min-w-24 flex-1"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.01}
        value={Math.min(time, duration)}
        onValueChange={(value) => state.seek(Array.isArray(value) ? value[0] : (value as number))}
        disabled={duration <= 0}
      />
      <span
        className="w-20 shrink-0 text-[11px] tabular-nums text-muted-foreground"
        aria-live="off"
      >
        {time.toFixed(1)}s / {duration.toFixed(1)}s
      </span>
      <Select
        items={SPEEDS}
        value={String(speed)}
        onValueChange={(value) => state.setSpeed(Number(value))}
      >
        <SelectTrigger size="sm" aria-label="Velocidad" className="h-7 w-16 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {SPEEDS.map((item) => (
            <SelectItem key={item.value} value={item.value} className="text-xs">
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Palette({ store }: { store: FlowEditorStore }) {
  const selection = useFlowEditor(store, (s) => s.selection);
  const after = selection?.type === "node" ? selection.id : undefined;
  return (
    <div
      role="toolbar"
      aria-label="Añadir paso"
      className="pointer-events-auto flex flex-col gap-0.5 rounded-lg border border-border bg-popover/95 p-1 shadow-md backdrop-blur"
    >
      {NODE_KIND_ORDER.map((kind) => (
        <TooltipWrapper
          key={kind}
          tooltip={
            after && kind !== "note"
              ? `Añadir ${NODE_KINDS[kind].label.toLowerCase()} después del seleccionado`
              : `Añadir ${NODE_KINDS[kind].label.toLowerCase()}`
          }
          side="right"
        >
          <button
            type="button"
            aria-label={`Añadir ${NODE_KINDS[kind].label}`}
            data-palette-kind={kind}
            onClick={() => store.getState().addNode(kind)}
            className="flex size-7 items-center justify-center rounded-md hover:bg-muted"
          >
            <span
              className={cn(
                "size-3",
                kind === "condition"
                  ? "rotate-45 rounded-[2px]"
                  : kind === "note"
                    ? "rounded-[2px]"
                    : "rounded-full"
              )}
              style={{ background: NODE_KINDS[kind].color }}
            />
          </button>
        </TooltipWrapper>
      ))}
    </div>
  );
}

interface Flow3DEditorProps {
  store: FlowEditorStore;
  editable?: boolean;
  active?: boolean;
  status?: React.ReactNode;
  onLinkFile?: (node: FlowNode) => void;
  onOpenLink?: (node: FlowNode) => void;
  onImportExcalidraw?: () => void;
  onSyncSource?: () => void;
}

/**
 * Flow 3D editor: the scene plus the playback bar, a palette of step kinds
 * and the inspector. Keyboard: Space play/pause, Delete remove, F fit,
 * Ctrl+Z / Ctrl+Shift+Z undo/redo, Escape deselect.
 */
export function Flow3DEditor({
  store,
  editable = true,
  active = true,
  status,
  onLinkFile,
  onOpenLink,
  onImportExcalidraw,
  onSyncSource,
}: Flow3DEditorProps) {
  const follow = useFlowEditor(store, (s) => s.follow);
  const view = useFlowEditor(store, (s) => s.view);
  const canUndo = useFlowEditor(store, (s) => s.past.length > 0);
  const canRedo = useFlowEditor(store, (s) => s.future.length > 0);
  const empty = useFlowEditor(store, (s) => s.doc.nodes.length === 0);
  const source = useFlowEditor(store, (s) => s.doc.source);
  const state = store.getState();

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true], [role=listbox], [role=menu]"))
        return;
      const s = store.getState();
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === " ") {
        event.preventDefault();
        s.togglePlay();
      } else if (editable && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        s.removeSelection();
      } else if (event.key === "Escape") {
        s.select(null);
      } else if (!mod && (event.key === "f" || event.key === "F")) {
        s.requestFit();
      } else if (editable && mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) s.redo();
        else s.undo();
      } else if (editable && mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        s.redo();
      }
    },
    [editable, store]
  );

  const openLink = useCallback((node: FlowNode) => onOpenLink?.(node), [onOpenLink]);

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-flow3d-editor
      onKeyDown={onKeyDown}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <PlaybackControls store={store} />
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolButton
          label="Seguir el paso en ejecución"
          pressed={follow}
          onClick={() => state.setFollow(!follow)}
        >
          <Crosshair />
        </ToolButton>
        <SegmentedControl
          size="sm"
          ariaLabel="Vista"
          value={view}
          onChange={state.setView}
          options={[
            { value: "perspective", label: "3D" },
            { value: "top", label: "Planta" },
          ]}
        />
        <ToolButton label="Encuadrar (F)" onClick={state.requestFit}>
          <Maximize />
        </ToolButton>
        {editable && (
          <>
            <div className="mx-1 h-4 w-px bg-border" />
            <ToolButton label="Organizar automáticamente" onClick={state.layout}>
              <Workflow />
            </ToolButton>
            <ToolButton label="Deshacer (Ctrl+Z)" onClick={state.undo} disabled={!canUndo}>
              <Undo2 />
            </ToolButton>
            <ToolButton label="Rehacer (Ctrl+Shift+Z)" onClick={state.redo} disabled={!canRedo}>
              <Redo2 />
            </ToolButton>
            {onImportExcalidraw && (
              <ToolButton label="Importar diagrama de Excalidraw…" onClick={onImportExcalidraw}>
                <FileInput />
              </ToolButton>
            )}
            {source && onSyncSource && (
              <ToolButton
                label={`Volver a convertir desde ${decodeURIComponent(source.split("/").pop() ?? source)}`}
                onClick={onSyncSource}
              >
                <RefreshCw />
              </ToolButton>
            )}
          </>
        )}
        {status && (
          <span className="ml-1 shrink-0 text-[11px] text-muted-foreground">{status}</span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <FlowScene store={store} editable={editable} active={active} onOpenLink={openLink} />
        {editable && (
          <div className="pointer-events-none absolute top-2 left-2">
            <Palette store={store} />
          </div>
        )}
        <div className="pointer-events-none absolute top-2 right-2">
          <Inspector
            store={store}
            editable={editable}
            onLinkFile={(node) => onLinkFile?.(node)}
            onOpenLink={openLink}
          />
        </div>
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-lg bg-popover/90 px-4 py-3 text-center text-xs text-muted-foreground shadow-sm">
              Flujo vacío. Añade un disparador desde la paleta de la izquierda
              {onImportExcalidraw ? " o importa un diagrama de Excalidraw." : "."}
            </p>
          </div>
        )}
        {editable && (
          <p className="pointer-events-none absolute bottom-2 left-2 hidden text-[11px] text-muted-foreground md:block">
            Arrastra para mover · Shift+arrastra: altura · Arrastra el punto derecho para conectar ·
            Doble clic: enfocar
          </p>
        )}
      </div>
    </div>
  );
}
