import { useMemo } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import { NODE_KINDS, nodeColor, type FlowNodeKind, type StepConfig } from "./model";
import { defaultStepConfig } from "./executor";
import { useFlowEditor, type FlowEditorStore } from "./editor-store";

export type FlowSearchMode = "add" | "find";

interface StepTemplate {
  id: string;
  kind: FlowNodeKind;
  label: string;
  hint: string;
  config?: StepConfig;
}

/** What Tab can insert: every kind, with the executable step types ready to fill. */
const STEP_TEMPLATES: StepTemplate[] = [
  {
    id: "trigger-manual",
    kind: "trigger",
    label: "Disparador con datos",
    hint: "JSON inicial del flujo",
    config: defaultStepConfig("trigger"),
  },
  {
    id: "action-http",
    kind: "action",
    label: "Petición HTTP",
    hint: "GET/POST a una URL",
    config: { type: "http", method: "GET", url: "https://" },
  },
  {
    id: "action-command",
    kind: "action",
    label: "Comando de terminal",
    hint: "Ejecuta y captura la salida",
    config: { type: "command", command: "echo {{input}}", timeout: 30 },
  },
  {
    id: "action-app",
    kind: "action",
    label: "Comando de la app",
    hint: "Lanza un comando registrado",
    config: { type: "appCommand", command: "" },
  },
  {
    id: "condition-compare",
    kind: "condition",
    label: "Condición",
    hint: "Compara un campo: sí / no",
    config: defaultStepConfig("condition"),
  },
  {
    id: "transform-template",
    kind: "transform",
    label: "Plantilla JSON",
    hint: "Construye datos con {{input}}",
    config: defaultStepConfig("transform"),
  },
  {
    id: "ai-prompt",
    kind: "ai",
    label: "Llamada a IA",
    hint: "Proveedor de IA activo",
    config: defaultStepConfig("ai"),
  },
  {
    id: "output-note",
    kind: "output",
    label: "Escribir nota",
    hint: "Escribe o añade a un markdown",
    config: defaultStepConfig("output"),
  },
  { id: "action-plain", kind: "action", label: "Acción (solo simulación)", hint: "Sin ejecución" },
  { id: "output-plain", kind: "output", label: "Salida (solo simulación)", hint: "Sin ejecución" },
  { id: "note", kind: "note", label: "Nota", hint: "Anotación que no se ejecuta" },
];

interface FlowSearchProps {
  store: FlowEditorStore;
  mode: FlowSearchMode;
  onClose: () => void;
}

/**
 * Keyboard-first overlay. "add" (Tab) inserts a step after the selection,
 * already connected; "find" (Ctrl+F) jumps to a step by name.
 */
export function FlowSearch({ store, mode, onClose }: FlowSearchProps) {
  const nodes = useFlowEditor(store, (s) => s.doc.nodes);
  const selection = useFlowEditor(store, (s) => s.selection);
  const anchor = selection?.type === "node" ? nodes.find((n) => n.id === selection.id) : undefined;
  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => a.position[0] - b.position[0]),
    [nodes]
  );

  return (
    <div
      className="pointer-events-auto absolute top-12 left-1/2 z-20 w-80 -translate-x-1/2 overflow-hidden rounded-xl border border-border shadow-xl"
      data-flow3d-search={mode}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || (event.key === "Tab" && mode === "add")) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <Command loop>
        <CommandInput
          autoFocus
          placeholder={
            mode === "add"
              ? anchor
                ? `Añadir después de «${anchor.label}»…`
                : "Añadir paso…"
              : "Buscar paso por nombre…"
          }
          onBlur={(event) => {
            // Closing on blur, but not when clicking an item of the list.
            if (!event.currentTarget.closest("[cmdk-root]")?.contains(event.relatedTarget as Node))
              onClose();
          }}
        />
        <CommandList className="max-h-72">
          <CommandEmpty>Sin resultados</CommandEmpty>
          {mode === "add" ? (
            <CommandGroup heading={anchor ? "Se conecta al paso seleccionado" : "Pasos"}>
              {STEP_TEMPLATES.map((template) => (
                <CommandItem
                  key={template.id}
                  value={`${template.label} ${NODE_KINDS[template.kind].label} ${template.hint}`}
                  onSelect={() => {
                    store.getState().addNode(template.kind, {
                      config: template.config,
                      label: template.config ? template.label : undefined,
                    });
                    onClose();
                  }}
                  className="text-xs"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: NODE_KINDS[template.kind].color }}
                  />
                  <span className="flex-1 truncate">{template.label}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {template.hint}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : (
            <CommandGroup heading={`${nodes.length} pasos`}>
              {sortedNodes.map((node) => (
                <CommandItem
                  key={node.id}
                  value={`${node.label} ${NODE_KINDS[node.kind].label} ${node.id}`}
                  onSelect={() => {
                    store.getState().focusNode(node.id);
                    onClose();
                  }}
                  className="text-xs"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: nodeColor(node) }}
                  />
                  <span className="flex-1 truncate">{node.label || node.id}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {NODE_KINDS[node.kind].label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>
  );
}
