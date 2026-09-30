import { useCallback, useState } from "react";
import {
  CircleStop,
  Crosshair,
  Download,
  FileInput,
  Image,
  Map as MapIcon,
  Maximize,
  Pause,
  PenTool,
  Play,
  Redo2,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Undo2,
  Video,
  WandSparkles,
  Workflow,
  Zap,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { cn } from "@/shared/lib/utils";
import { NODE_KIND_ORDER, NODE_KINDS, type FlowNode } from "./model";
import { flowClipboard, useFlowEditor, type FlowEditorStore } from "./editor-store";
import { FlowScene } from "./scene/FlowScene";
import { Inspector } from "./Inspector";
import { FlowSearch, type FlowSearchMode } from "./FlowSearch";
import { Minimap } from "./Minimap";
import { AutomationBadge, HistoryMenu, SecretsButton } from "./RunTools";
import type { SecretStore } from "./secrets";

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

function PlaybackControls({
  store,
  onExecute,
}: {
  store: FlowEditorStore;
  onExecute?: () => void;
}) {
  const playing = useFlowEditor(store, (s) => s.playing);
  const time = useFlowEditor(store, (s) => s.displayTime);
  const duration = useFlowEditor(store, (s) => s.timeline.duration);
  const speed = useFlowEditor(store, (s) => s.speed);
  const mode = useFlowEditor(store, (s) => s.mode);
  const running = useFlowEditor(store, (s) => s.run?.status === "running");
  const state = store.getState();
  const finite = Number.isFinite(duration);
  const hasTimeline = finite && duration > 0;
  return (
    <div className="flex flex-1 items-center gap-1.5">
      {onExecute && (
        <SegmentedControl
          size="sm"
          ariaLabel="Modo"
          value={mode}
          disabled={running}
          onChange={state.setMode}
          options={[
            { value: "simulate", label: "Simular" },
            { value: "run", label: "Ejecutar" },
          ]}
        />
      )}
      {mode === "run" && onExecute ? (
        running ? (
          <Button size="xs" variant="destructive" onClick={state.cancelRun}>
            <CircleStop />
            Cancelar
          </Button>
        ) : (
          <Button size="xs" onClick={onExecute} data-flow3d-execute>
            <Zap />
            Ejecutar
          </Button>
        )
      ) : null}
      <ToolButton
        label={
          mode === "run"
            ? playing
              ? "Pausar"
              : "Repetir la última ejecución"
            : playing
              ? "Pausar (Espacio)"
              : "Reproducir (Espacio)"
        }
        onClick={state.togglePlay}
        disabled={!hasTimeline || running}
      >
        {playing && !running ? <Pause /> : <Play />}
      </ToolButton>
      <ToolButton label="Detener" onClick={state.stop} disabled={!hasTimeline && !running}>
        <Square className="size-3.5" />
      </ToolButton>
      <Slider
        aria-label="Línea de tiempo"
        className="mx-1 max-w-sm min-w-16 flex-1"
        min={0}
        max={hasTimeline ? duration : 1}
        step={0.01}
        value={hasTimeline ? Math.min(time, duration) : running ? 1 : 0}
        onValueChange={(value) => state.seek(Array.isArray(value) ? value[0] : (value as number))}
        disabled={!hasTimeline || running}
      />
      <span
        className="w-20 shrink-0 text-[11px] tabular-nums text-muted-foreground"
        aria-live="off"
      >
        {time.toFixed(1)}s{finite ? ` / ${duration.toFixed(1)}s` : ""}
      </span>
      {mode === "simulate" && (
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
      )}
    </div>
  );
}

/** Where the last real run stands: progress, time, or the failing step. */
function RunStatus({ store }: { store: FlowEditorStore }) {
  const run = useFlowEditor(store, (s) => s.run);
  const stale = useFlowEditor(store, (s) => s.runStale);
  const nodes = useFlowEditor(store, (s) => s.doc.nodes);
  if (!run) return null;
  const steps = Object.values(run.steps);
  const done = steps.filter((s) => s.status === "done").length;
  const failed = steps.find((s) => s.status === "error");
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const seconds =
    run.finishedAt !== undefined ? ((run.finishedAt - run.startedAt) / 1000).toFixed(1) : null;
  let text: string;
  let tone = "text-muted-foreground";
  if (run.status === "running") {
    const current = steps.find((s) => s.status === "running");
    text = current ? `Ejecutando «${label(current.nodeId)}»… (${done} listos)` : "Ejecutando…";
    tone = "text-sky-600 dark:text-sky-400";
  } else if (run.status === "cancelled") {
    text = "Ejecución cancelada";
  } else if (failed) {
    text = `Error en «${label(failed.nodeId)}»`;
    tone = "text-destructive";
  } else {
    text = `Completado: ${done} pasos en ${seconds}s`;
    tone = "text-emerald-600 dark:text-emerald-400";
  }
  return (
    <button
      type="button"
      data-flow3d-run-status={run.status}
      className={cn(
        "max-w-56 shrink-0 truncate text-[11px] font-medium",
        tone,
        stale && "opacity-60"
      )}
      title={stale ? `${text} (el flujo cambió después)` : (failed?.error ?? text)}
      onClick={() => failed && store.getState().focusNode(failed.nodeId)}
    >
      {text}
    </button>
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

function MarqueeOverlay({ store }: { store: FlowEditorStore }) {
  const marquee = useFlowEditor(store, (s) => s.marquee);
  if (!marquee) return null;
  return (
    <div
      className="pointer-events-none absolute rounded-sm border border-primary bg-primary/10"
      style={{
        left: Math.min(marquee.x0, marquee.x1),
        top: Math.min(marquee.y0, marquee.y1),
        width: Math.abs(marquee.x1 - marquee.x0),
        height: Math.abs(marquee.y1 - marquee.y0),
      }}
    />
  );
}

export interface Flow3DExportActions {
  image?: () => void;
  video?: () => void;
  excalidraw?: () => void;
}

interface Flow3DEditorProps {
  store: FlowEditorStore;
  editable?: boolean;
  active?: boolean;
  status?: React.ReactNode;
  /** Minimap shown at start (the embed hides it). */
  minimap?: boolean;
  onLinkFile?: (node: FlowNode) => void;
  onOpenLink?: (node: FlowNode) => void;
  onImportExcalidraw?: () => void;
  onSyncSource?: () => void;
  /** Run the flow for real (the container confirms side effects). */
  onExecute?: () => void;
  exports?: Flow3DExportActions;
  /** Recording a video: shows a badge. */
  recording?: boolean;
  /** Secrets store: shows the Secrets button. */
  secrets?: SecretStore;
  onClearHistory?: () => void;
  /** Create the flow from a description (AI). */
  onGenerate?: () => void;
  /** Ask the AI why a step failed. */
  onDiagnose?: (nodeId: string) => Promise<string>;
}

/**
 * Flow 3D editor: the scene plus the playback bar, a palette of step kinds
 * and the inspector. Keyboard: Space play/pause, Tab add a step, Ctrl+F find,
 * Delete remove, F fit, M minimap, Ctrl+C/V/D copy/paste/duplicate, Ctrl+A
 * select all, Ctrl+G group, Ctrl+Z / Ctrl+Shift+Z undo/redo, Escape deselect.
 */
export function Flow3DEditor({
  store,
  editable = true,
  active = true,
  status,
  minimap: initialMinimap = true,
  onLinkFile,
  onOpenLink,
  onImportExcalidraw,
  onSyncSource,
  onExecute,
  exports,
  recording,
  secrets,
  onClearHistory,
  onGenerate,
  onDiagnose,
}: Flow3DEditorProps) {
  const follow = useFlowEditor(store, (s) => s.follow);
  const view = useFlowEditor(store, (s) => s.view);
  const canUndo = useFlowEditor(store, (s) => s.past.length > 0);
  const canRedo = useFlowEditor(store, (s) => s.future.length > 0);
  const empty = useFlowEditor(store, (s) => s.doc.nodes.length === 0);
  const source = useFlowEditor(store, (s) => s.doc.source);
  const running = useFlowEditor(store, (s) => s.run?.status === "running");
  const effects = useFlowEditor(store, (s) => s.effects);
  const [search, setSearch] = useState<FlowSearchMode | null>(null);
  const [minimap, setMinimap] = useState(initialMinimap);
  const state = store.getState();
  const canEdit = editable && !running;
  const hasExports = Boolean(exports && (exports.image || exports.video || exports.excalidraw));

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true], [role=listbox], [role=menu]"))
        return;
      const s = store.getState();
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const edit = editable && s.run?.status !== "running";
      if (event.key === " ") {
        event.preventDefault();
        s.togglePlay();
      } else if (event.key === "Tab" && edit && !mod) {
        event.preventDefault();
        setSearch("add");
      } else if (mod && key === "f") {
        event.preventDefault();
        setSearch("find");
      } else if (edit && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        s.removeSelection();
      } else if (event.key === "Escape") {
        s.select(null);
      } else if (mod && key === "a") {
        event.preventDefault();
        s.selectAll();
      } else if (mod && key === "c") {
        s.copySelection();
      } else if (edit && mod && key === "v") {
        const clipboard = flowClipboard.get();
        if (clipboard) {
          event.preventDefault();
          s.paste(clipboard);
        }
      } else if (edit && mod && key === "d") {
        event.preventDefault();
        s.duplicateSelection();
      } else if (edit && mod && key === "g") {
        event.preventDefault();
        if (event.shiftKey) {
          if (s.selection?.type === "group") s.ungroup(s.selection.id);
        } else {
          s.groupSelection();
        }
      } else if (!mod && key === "f") {
        s.requestFit();
      } else if (!mod && key === "m") {
        setMinimap((value) => !value);
      } else if (edit && mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) s.redo();
        else s.undo();
      } else if (edit && mod && key === "y") {
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
      {/* Narrow panes (split view, embeds) scroll the toolbar instead of squeezing it. */}
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border/60 px-2 [scrollbar-width:none] [&>*]:shrink-0">
        <PlaybackControls store={store} onExecute={onExecute} />
        <RunStatus store={store} />
        <AutomationBadge store={store} />
        {onExecute && <HistoryMenu store={store} onClear={onClearHistory} />}
        {secrets && editable && <SecretsButton secrets={secrets} />}
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolButton label="Buscar paso (Ctrl+F)" onClick={() => setSearch("find")}>
          <Search />
        </ToolButton>
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
        <ToolButton label="Minimapa (M)" pressed={minimap} onClick={() => setMinimap(!minimap)}>
          <MapIcon />
        </ToolButton>
        <ToolButton
          label="Efectos: luz de estudio, sombras y brillo"
          pressed={effects}
          onClick={() => state.setEffects(!effects)}
        >
          <Sparkles />
        </ToolButton>
        {editable && (
          <>
            <div className="mx-1 h-4 w-px bg-border" />
            {onGenerate && (
              <ToolButton
                label="Crear o cambiar con el agente (Ctrl+Alt+I)"
                onClick={onGenerate}
                disabled={!canEdit}
              >
                <WandSparkles />
              </ToolButton>
            )}
            <ToolButton
              label="Organizar automáticamente"
              onClick={state.layout}
              disabled={!canEdit}
            >
              <Workflow />
            </ToolButton>
            <ToolButton
              label="Deshacer (Ctrl+Z)"
              onClick={state.undo}
              disabled={!canUndo || !canEdit}
            >
              <Undo2 />
            </ToolButton>
            <ToolButton
              label="Rehacer (Ctrl+Shift+Z)"
              onClick={state.redo}
              disabled={!canRedo || !canEdit}
            >
              <Redo2 />
            </ToolButton>
            {onImportExcalidraw && (
              <ToolButton
                label="Importar diagrama de Excalidraw…"
                onClick={onImportExcalidraw}
                disabled={!canEdit}
              >
                <FileInput />
              </ToolButton>
            )}
            {source && onSyncSource && (
              <ToolButton
                label={`Volver a convertir desde ${decodeURIComponent(source.split("/").pop() ?? source)}`}
                onClick={onSyncSource}
                disabled={!canEdit}
              >
                <RefreshCw />
              </ToolButton>
            )}
          </>
        )}
        {hasExports && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Exportar" title="Exportar">
                  <Download />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-52">
              {exports?.image && (
                <DropdownMenuItem onClick={exports.image}>
                  <Image />
                  Imagen PNG de la vista
                </DropdownMenuItem>
              )}
              {exports?.video && (
                <DropdownMenuItem onClick={exports.video} disabled={recording || running}>
                  <Video />
                  Vídeo de la reproducción (WebM)
                </DropdownMenuItem>
              )}
              {exports?.excalidraw && (
                <DropdownMenuItem onClick={exports.excalidraw}>
                  <PenTool />
                  Diagrama de Excalidraw
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {status && (
          <span className="ml-1 shrink-0 text-[11px] text-muted-foreground">{status}</span>
        )}
      </div>

      {/* Container queries: overlays adapt to the pane width (split views), not the window. */}
      <div className="@container relative min-h-0 flex-1">
        <FlowScene store={store} editable={canEdit} active={active} onOpenLink={openLink} />
        <MarqueeOverlay store={store} />
        {editable && (
          <div className="pointer-events-none absolute top-2 left-2">
            <Palette store={store} />
          </div>
        )}
        <div className="pointer-events-none absolute top-2 right-2 bottom-2 flex flex-col">
          <Inspector
            store={store}
            editable={editable}
            onLinkFile={(node) => onLinkFile?.(node)}
            onOpenLink={openLink}
            onDiagnose={onDiagnose}
          />
        </div>
        {search && <FlowSearch store={store} mode={search} onClose={() => setSearch(null)} />}
        {minimap && !empty && (
          <div
            className={cn(
              "pointer-events-none absolute bottom-2",
              // Leave room for the inspector on the right.
              "left-2 @3xl:left-auto @3xl:right-[19.5rem]"
            )}
          >
            <Minimap store={store} />
          </div>
        )}
        {recording && (
          <div className="pointer-events-none absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white shadow">
            <span className="size-2 animate-pulse rounded-full bg-white" />
            Grabando vídeo…
          </div>
        )}
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto space-y-2 rounded-lg bg-popover/90 px-4 py-3 text-center text-xs text-muted-foreground shadow-sm">
              <p>
                Flujo vacío. Pulsa Tab o usa la paleta de la izquierda para añadir un paso
                {onImportExcalidraw ? ", o importa un diagrama de Excalidraw." : "."}
              </p>
              {onGenerate && editable && (
                <Button size="xs" onClick={onGenerate}>
                  <WandSparkles />
                  Crear con el agente
                </Button>
              )}
            </div>
          </div>
        )}
        {editable && (
          <p className="pointer-events-none absolute bottom-2 left-2 hidden text-[11px] text-muted-foreground @5xl:block">
            Tab: añadir · Shift+arrastrar fondo: seleccionar · Ctrl+clic: sumar · Ctrl+G: agrupar ·
            Shift+arrastrar paso: altura
          </p>
        )}
      </div>
    </div>
  );
}
