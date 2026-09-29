import { useMemo, useState } from "react";
import {
  Copy,
  CopyPlus,
  ExternalLink,
  FoldVertical,
  Group,
  Link2,
  Trash2,
  Ungroup,
  UnfoldVertical,
  X,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";
import {
  DEFAULT_GROUP_COLOR,
  NODE_KIND_ORDER,
  NODE_KINDS,
  nodeColor,
  nodeDuration,
  type FlowNode,
  type FlowNodeKind,
} from "./model";
import { useFlowEditor, type FlowEditorStore } from "./editor-store";
import { StepConfigEditor } from "./StepConfigEditor";
import type { StepRecord } from "./executor";

const KIND_ITEMS = NODE_KIND_ORDER.map((kind) => ({ value: kind, label: NODE_KINDS[kind].label }));

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

interface InspectorProps {
  store: FlowEditorStore;
  editable: boolean;
  onLinkFile: (node: FlowNode) => void;
  onOpenLink: (node: FlowNode) => void;
}

type NodeTab = "step" | "run" | "data";

/** Properties of the selection: a step, a connection, a group or several steps. */
export function Inspector({ store, editable, onLinkFile, onOpenLink }: InspectorProps) {
  const selection = useFlowEditor(store, (s) => s.selection);
  const selectedCount = useFlowEditor(store, (s) => s.selectedNodes.length);
  const doc = useFlowEditor(store, (s) => s.doc);
  const running = useFlowEditor(store, (s) => s.run?.status === "running");
  const canEdit = editable && !running;
  if (!selection) return null;
  const close = () => store.getState().select(null);

  if (selectedCount > 1)
    return <MultiPanel store={store} editable={canEdit} count={selectedCount} />;

  if (selection.type === "group") {
    return <GroupPanel store={store} editable={canEdit} groupId={selection.id} onClose={close} />;
  }

  if (selection.type === "edge") {
    const edge = doc.edges.find((e) => e.id === selection.id);
    if (!edge) return null;
    const from = doc.nodes.find((n) => n.id === edge.from);
    const to = doc.nodes.find((n) => n.id === edge.to);
    return (
      <Panel title="Conexión" onClose={close}>
        <p className="truncate text-xs text-muted-foreground">
          {from?.label ?? "?"} → {to?.label ?? "?"}
        </p>
        <Field label="Etiqueta">
          <Input
            className="h-7 text-xs md:text-xs"
            value={edge.label ?? ""}
            placeholder="p. ej. sí / no"
            disabled={!canEdit}
            onChange={(event) =>
              store.getState().updateEdge(edge.id, { label: event.target.value || undefined })
            }
          />
        </Field>
        {canEdit && (
          <Button
            size="xs"
            variant="destructive"
            className="w-full"
            onClick={() => store.getState().removeSelection()}
          >
            <Trash2 />
            Eliminar conexión
          </Button>
        )}
      </Panel>
    );
  }

  const node = doc.nodes.find((n) => n.id === selection.id);
  if (!node) return null;
  return (
    <NodePanel
      key={node.id}
      store={store}
      node={node}
      editable={canEdit}
      onClose={close}
      onLinkFile={onLinkFile}
      onOpenLink={onOpenLink}
    />
  );
}

function NodePanel({
  store,
  node,
  editable,
  onClose,
  onLinkFile,
  onOpenLink,
}: {
  store: FlowEditorStore;
  node: FlowNode;
  editable: boolean;
  onClose: () => void;
  onLinkFile: (node: FlowNode) => void;
  onOpenLink: (node: FlowNode) => void;
}) {
  const doc = useFlowEditor(store, (s) => s.doc);
  const step = useFlowEditor(store, (s) => s.run?.steps[node.id]);
  const stale = useFlowEditor(store, (s) => s.runStale);
  const executes = NODE_KINDS[node.kind].executes;
  const [tab, setTab] = useState<NodeTab>(step && executes ? "data" : "step");
  const update = (patch: Partial<FlowNode>) => store.getState().updateNode(node.id, patch);
  const outgoing = doc.edges.filter((e) => e.from === node.id);
  const linkName = node.link ? decodeURIComponent(node.link.split("/").pop() ?? node.link) : null;

  return (
    <Panel
      title={NODE_KINDS[node.kind].label}
      color={step?.status === "error" && !stale ? "#ef4444" : nodeColor(node)}
      onClose={onClose}
    >
      {executes && (
        <SegmentedControl
          size="sm"
          ariaLabel="Sección"
          value={tab}
          onChange={setTab}
          fullWidth
          options={[
            { value: "step", label: "Paso" },
            { value: "run", label: "Ejecución" },
            { value: "data", label: "Datos" },
          ]}
        />
      )}

      {tab === "run" && executes && (
        <StepConfigEditor
          node={node}
          editable={editable}
          onChange={(config) => update({ config })}
        />
      )}

      {tab === "data" && executes && <StepData step={step} stale={stale} />}

      {(tab === "step" || !executes) && (
        <>
          <Field label="Nombre">
            <Input
              className="h-7 text-xs md:text-xs"
              value={node.label}
              disabled={!editable}
              onChange={(event) => update({ label: event.target.value })}
            />
          </Field>
          <Field label="Tipo">
            <Select
              items={KIND_ITEMS}
              value={node.kind}
              disabled={!editable}
              onValueChange={(value) => update({ kind: value as FlowNodeKind })}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {KIND_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="text-xs">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: NODE_KINDS[item.value].color }}
                    />
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Descripción">
            <Textarea
              className="min-h-12 text-xs md:text-xs"
              value={node.description ?? ""}
              disabled={!editable}
              onChange={(event) => update({ description: event.target.value || undefined })}
            />
          </Field>
          {executes && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Duración (s)">
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  className="h-7 text-xs md:text-xs"
                  value={nodeDuration(node)}
                  disabled={!editable}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    update({ duration: Number.isFinite(value) && value >= 0 ? value : undefined });
                  }}
                />
              </Field>
              <Field label="Color">
                <input
                  type="color"
                  aria-label="Color"
                  className="h-7 w-full cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                  value={nodeColor(node)}
                  disabled={!editable}
                  onChange={(event) => update({ color: event.target.value })}
                />
              </Field>
            </div>
          )}
          {node.kind === "condition" &&
            outgoing.length > 1 &&
            node.config?.type !== "condition" && (
              <Field label="Rama al reproducir">
                <Select
                  items={outgoing.map((edge) => ({
                    value: edge.id,
                    label: edge.label || doc.nodes.find((n) => n.id === edge.to)?.label || edge.to,
                  }))}
                  value={
                    node.branch && outgoing.some((e) => e.id === node.branch)
                      ? node.branch
                      : outgoing[0].id
                  }
                  disabled={!editable}
                  onValueChange={(value) => update({ branch: value as string })}
                >
                  <SelectTrigger size="sm" className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {outgoing.map((edge) => (
                      <SelectItem key={edge.id} value={edge.id} className="text-xs">
                        {edge.label || doc.nodes.find((n) => n.id === edge.to)?.label || edge.to}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          <Field label="Archivo vinculado">
            {node.link ? (
              <div className="flex items-center gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  className="min-w-0 flex-1 justify-start"
                  title={node.link}
                  onClick={() => onOpenLink(node)}
                >
                  <ExternalLink />
                  <span className="truncate">{linkName}</span>
                </Button>
                {editable && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Quitar vínculo"
                    onClick={() => update({ link: undefined })}
                  >
                    <X />
                  </Button>
                )}
              </div>
            ) : (
              <Button
                size="xs"
                variant="outline"
                className="w-full"
                disabled={!editable}
                onClick={() => onLinkFile(node)}
              >
                <Link2 />
                Vincular nota, markdown o diagrama…
              </Button>
            )}
          </Field>
          <p
            className="truncate text-[10px] text-muted-foreground"
            title="Id para enlaces y plantillas"
          >
            Id: <code className="select-all">{node.id}</code>
          </p>
          {editable && (
            <Button
              size="xs"
              variant="destructive"
              className="w-full"
              onClick={() => store.getState().removeSelection()}
            >
              <Trash2 />
              Eliminar paso
            </Button>
          )}
        </>
      )}
    </Panel>
  );
}

function formatData(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function DataBlock({ label, value, tone }: { label: string; value: string; tone?: "error" }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Copiar ${label.toLowerCase()}`}
          onClick={() => void navigator.clipboard?.writeText(value)}
        >
          <Copy />
        </Button>
      </div>
      <pre
        className={cn(
          "max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[10.5px] leading-snug whitespace-pre-wrap break-all",
          tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive"
        )}
      >
        {value}
      </pre>
    </div>
  );
}

const STATUS_LABEL: Record<StepRecord["status"], string> = {
  running: "En ejecución…",
  done: "Completado",
  error: "Error",
  skipped: "No se ejecutó",
};

/** Input and output of the step in the last run. */
function StepData({ step, stale }: { step: StepRecord | undefined; stale: boolean }) {
  if (!step) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin datos todavía. Pulsa «Ejecutar» para correr el flujo de verdad y ver aquí la entrada y
        la salida de este paso.
      </p>
    );
  }
  const ms =
    step.end !== undefined ? Math.max(0, Math.round((step.end - step.start) * 1000)) : null;
  return (
    <div className="space-y-2" data-step-data={step.status}>
      <div className="flex items-center gap-2 text-[11px]">
        <span
          className={cn(
            "size-2 rounded-full",
            step.status === "done" && "bg-emerald-500",
            step.status === "error" && "bg-red-500",
            step.status === "running" && "animate-pulse bg-sky-500",
            step.status === "skipped" && "bg-muted-foreground/40"
          )}
        />
        <span className="font-medium">{STATUS_LABEL[step.status]}</span>
        {ms !== null && step.status !== "skipped" && (
          <span className="text-muted-foreground tabular-nums">{ms} ms</span>
        )}
      </div>
      {stale && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">
          El flujo cambió después de esta ejecución.
        </p>
      )}
      {step.error && <DataBlock label="Error" value={step.error} tone="error" />}
      {step.status !== "skipped" && <DataBlock label="Entrada" value={formatData(step.input)} />}
      {step.status === "done" && <DataBlock label="Salida" value={formatData(step.output)} />}
    </div>
  );
}

function MultiPanel({
  store,
  editable,
  count,
}: {
  store: FlowEditorStore;
  editable: boolean;
  count: number;
}) {
  const s = store.getState();
  return (
    <Panel title={`${count} pasos seleccionados`} onClose={() => s.select(null)}>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="xs" variant="outline" disabled={!editable} onClick={() => s.groupSelection()}>
          <Group />
          Agrupar
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={!editable}
          onClick={() => s.duplicateSelection()}
        >
          <CopyPlus />
          Duplicar
        </Button>
        <Button size="xs" variant="outline" onClick={() => s.copySelection()}>
          <Copy />
          Copiar
        </Button>
        <Button
          size="xs"
          variant="destructive"
          disabled={!editable}
          onClick={() => s.removeSelection()}
        >
          <Trash2 />
          Eliminar
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Arrastra cualquiera para mover todos · Ctrl+G agrupa · Ctrl+D duplica
      </p>
    </Panel>
  );
}

function GroupPanel({
  store,
  editable,
  groupId,
  onClose,
}: {
  store: FlowEditorStore;
  editable: boolean;
  groupId: string;
  onClose: () => void;
}) {
  const group = useFlowEditor(store, (s) => s.doc.groups?.find((g) => g.id === groupId));
  const nodes = useFlowEditor(store, (s) => s.doc.nodes);
  const members = useMemo(() => nodes.filter((n) => n.group === groupId), [nodes, groupId]);
  if (!group) return null;
  const s = store.getState();
  const height = members.length > 0 ? Math.min(...members.map((n) => n.position[1])) : 0;
  return (
    <Panel title="Grupo" color={group.color ?? DEFAULT_GROUP_COLOR} onClose={onClose}>
      <Field label="Nombre">
        <Input
          className="h-7 text-xs md:text-xs"
          value={group.label}
          disabled={!editable}
          onChange={(event) => s.updateGroup(group.id, { label: event.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Altura (nivel)">
          <Input
            type="number"
            step={0.5}
            min={-2}
            max={12}
            className="h-7 text-xs md:text-xs"
            value={Math.round(height * 100) / 100}
            disabled={!editable}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value))
                s.setGroupHeight(group.id, Math.max(-2, Math.min(12, value)));
            }}
          />
        </Field>
        <Field label="Color">
          <input
            type="color"
            aria-label="Color del grupo"
            className="h-7 w-full cursor-pointer rounded-md border border-input bg-transparent p-0.5"
            value={group.color ?? DEFAULT_GROUP_COLOR}
            disabled={!editable}
            onChange={(event) => s.updateGroup(group.id, { color: event.target.value })}
          />
        </Field>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {members.length} pasos · súbelo de nivel para apilar subflujos en 3D.
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="xs" variant="outline" onClick={() => s.toggleGroup(group.id)}>
          {group.collapsed ? <UnfoldVertical /> : <FoldVertical />}
          {group.collapsed ? "Desplegar" : "Plegar"}
        </Button>
        <Button size="xs" variant="outline" onClick={() => s.selectNodes(members.map((n) => n.id))}>
          Seleccionar pasos
        </Button>
        <Button
          size="xs"
          variant="outline"
          className="col-span-2"
          disabled={!editable}
          onClick={() => s.ungroup(group.id)}
        >
          <Ungroup />
          Desagrupar
        </Button>
      </div>
    </Panel>
  );
}

function Panel({
  title,
  color,
  onClose,
  children,
}: {
  title: string;
  color?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label="Propiedades"
      className="pointer-events-auto max-h-full w-72 space-y-2.5 overflow-y-auto rounded-lg border border-border bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        {color && <span className="size-2.5 rounded-full" style={{ background: color }} />}
        <h3 className="flex-1 truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <Button size="icon-xs" variant="ghost" aria-label="Cerrar propiedades" onClick={onClose}>
          <X />
        </Button>
      </div>
      {children}
    </aside>
  );
}
