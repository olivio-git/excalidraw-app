import { ExternalLink, Link2, Trash2, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";
import {
  NODE_KIND_ORDER,
  NODE_KINDS,
  nodeColor,
  nodeDuration,
  type FlowNode,
  type FlowNodeKind,
} from "./model";
import { useFlowEditor, type FlowEditorStore } from "./editor-store";

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

/** Properties of the selected node or edge. */
export function Inspector({ store, editable, onLinkFile, onOpenLink }: InspectorProps) {
  const selection = useFlowEditor(store, (s) => s.selection);
  const doc = useFlowEditor(store, (s) => s.doc);
  if (!selection) return null;
  const close = () => store.getState().select(null);

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
            disabled={!editable}
            onChange={(event) =>
              store.getState().updateEdge(edge.id, { label: event.target.value || undefined })
            }
          />
        </Field>
        {editable && (
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
  const update = (patch: Partial<FlowNode>) => store.getState().updateNode(node.id, patch);
  const outgoing = doc.edges.filter((e) => e.from === node.id);
  const linkName = node.link ? decodeURIComponent(node.link.split("/").pop() ?? node.link) : null;

  return (
    <Panel title={NODE_KINDS[node.kind].label} color={nodeColor(node)} onClose={close}>
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
      {NODE_KINDS[node.kind].executes && (
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
      {node.kind === "condition" && outgoing.length > 1 && (
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
      className="pointer-events-auto w-64 space-y-2.5 rounded-lg border border-border bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        {color && <span className="size-2.5 rounded-full" style={{ background: color }} />}
        <h3
          className={cn(
            "flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          )}
        >
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
