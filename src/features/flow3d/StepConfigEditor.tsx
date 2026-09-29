import { useMemo } from "react";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { Switch } from "@/shared/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { PluginManager } from "@/plugins/plugin-manager";
import type { ConditionOperator, FlowNode, StepConfig } from "./model";
import { STEP_TYPES, defaultStepConfig } from "./executor";

const NONE = "none";

const TYPE_ITEMS = [
  { value: NONE, label: "Solo simulación" },
  ...Object.entries(STEP_TYPES).map(([value, info]) => ({ value, label: info.label })),
];

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m }));

const OPERATORS: Array<{ value: ConditionOperator; label: string }> = [
  { value: "==", label: "es igual a" },
  { value: "!=", label: "es distinto de" },
  { value: ">", label: "mayor que" },
  { value: "<", label: "menor que" },
  { value: ">=", label: "mayor o igual" },
  { value: "<=", label: "menor o igual" },
  { value: "contains", label: "contiene" },
  { value: "exists", label: "existe" },
  { value: "truthy", label: "es verdadero" },
];

function blankConfig(type: StepConfig["type"], kind: FlowNode["kind"]): StepConfig {
  const suggested = defaultStepConfig(kind);
  if (suggested?.type === type) return suggested;
  switch (type) {
    case "http":
      return { type, method: "GET", url: "https://" };
    case "command":
      return { type, command: "", timeout: 30 };
    case "appCommand":
      return { type, command: "" };
    case "ai":
      return { type, prompt: "{{input}}" };
    case "writeNote":
      return { type, path: "salida.md", content: "{{input}}", append: true };
    case "template":
      return { type, template: '{\n  "valor": "{{input}}"\n}' };
    case "condition":
      return { type, field: "", operator: "==", value: "" };
    case "schedule":
      return { type, every: 60 };
    case "fileWatch":
      return { type, path: "." };
    default:
      return { type: "manual", payload: "{}" };
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SmallSelect<T extends string>({
  items,
  value,
  onChange,
  disabled,
  label,
}: {
  items: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Select
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as T)}
    >
      <SelectTrigger size="sm" aria-label={label} className="w-full text-xs">
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

const inputClass = "h-7 text-xs md:text-xs";
const codeClass = "min-h-14 font-mono text-[11px] md:text-[11px]";

/** Fields of the executable step (what "Ejecutar" does for this node). */
export function StepConfigEditor({
  node,
  editable,
  onChange,
}: {
  node: FlowNode;
  editable: boolean;
  onChange: (config: StepConfig | undefined) => void;
}) {
  const config = node.config;
  const commands = useMemo(
    () =>
      config?.type === "appCommand"
        ? PluginManager.getCommands()
            .filter((c) => !c.id.startsWith("flow3d."))
            .map((c) => ({ value: c.id, label: c.name || c.id }))
        : [],
    [config?.type]
  );
  const patch = (fields: Partial<StepConfig>) =>
    config && onChange({ ...config, ...fields } as StepConfig);

  const text = (
    key: string,
    label: string,
    options: { placeholder?: string; code?: boolean } = {}
  ) => {
    const value = ((config as Record<string, unknown> | undefined)?.[key] as string) ?? "";
    return (
      <Row label={label}>
        {options.code ? (
          <Textarea
            className={codeClass}
            value={value}
            placeholder={options.placeholder}
            disabled={!editable}
            spellCheck={false}
            onChange={(event) => patch({ [key]: event.target.value } as Partial<StepConfig>)}
          />
        ) : (
          <Input
            className={inputClass}
            value={value}
            placeholder={options.placeholder}
            disabled={!editable}
            spellCheck={false}
            onChange={(event) => patch({ [key]: event.target.value } as Partial<StepConfig>)}
          />
        )}
      </Row>
    );
  };

  const toggle = (key: string, label: string) => (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      {label}
      <Switch
        size="sm"
        checked={Boolean((config as Record<string, unknown> | undefined)?.[key])}
        disabled={!editable}
        onCheckedChange={(checked) => patch({ [key]: checked } as Partial<StepConfig>)}
      />
    </label>
  );

  return (
    <div className="space-y-2" data-step-config={config?.type ?? NONE}>
      <Row label="Al ejecutar">
        <SmallSelect
          label="Tipo de ejecución"
          items={TYPE_ITEMS}
          value={config?.type ?? NONE}
          disabled={!editable}
          onChange={(type) =>
            onChange(type === NONE ? undefined : blankConfig(type as StepConfig["type"], node.kind))
          }
        />
      </Row>
      {config?.type === "manual" && text("payload", "Datos iniciales (JSON)", { code: true })}
      {config?.type === "schedule" && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Row label="Cada (minutos)">
              <Input
                type="number"
                min={1}
                className={inputClass}
                value={config.every ?? ""}
                placeholder="—"
                disabled={!editable}
                onChange={(event) =>
                  patch({ every: Number(event.target.value) || undefined } as Partial<StepConfig>)
                }
              />
            </Row>
            <Row label="o cada día a las">
              <Input
                type="time"
                className={inputClass}
                value={config.at ?? ""}
                disabled={!editable || Boolean(config.every)}
                onChange={(event) =>
                  patch({ at: event.target.value || undefined } as Partial<StepConfig>)
                }
              />
            </Row>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Recibe {"{ trigger, at }"}. Funciona mientras la app está abierta con esta carpeta.
          </p>
        </>
      )}
      {config?.type === "fileWatch" && (
        <>
          {text("path", "Archivo o carpeta (relativo al flujo)", {
            placeholder: "notas/  ·  datos.csv",
          })}
          <p className="text-[10px] text-muted-foreground">
            Recibe {"{ trigger, path, paths }"}. Ignora los cambios que hace el propio flujo.
          </p>
        </>
      )}
      {config?.type === "http" && (
        <>
          <div className="grid grid-cols-[5.5rem_1fr] gap-1.5">
            <SmallSelect
              label="Método"
              items={METHODS}
              value={(config.method ?? "GET").toUpperCase()}
              disabled={!editable}
              onChange={(method) => patch({ method })}
            />
            <Input
              aria-label="URL"
              className={inputClass}
              value={config.url ?? ""}
              placeholder="https://api…/{{input.id}}"
              disabled={!editable}
              spellCheck={false}
              onChange={(event) => patch({ url: event.target.value })}
            />
          </div>
          {text("headers", "Cabeceras (Nombre: valor)", {
            code: true,
            placeholder: "Authorization: Bearer …",
          })}
          {(config.method ?? "GET").toUpperCase() !== "GET" &&
            text("body", "Cuerpo (JSON)", { code: true, placeholder: '{"id": "{{input.id}}"}' })}
          {toggle("allowErrors", "Continuar si responde 4xx/5xx")}
        </>
      )}
      {config?.type === "command" && (
        <>
          {text("command", "Comando", { code: true, placeholder: "git status --short" })}
          <div className="grid grid-cols-[1fr_4.5rem] gap-1.5">
            {text("cwd", "Carpeta", { placeholder: "junto al flujo" })}
            <Row label="Límite (s)">
              <Input
                type="number"
                min={1}
                className={inputClass}
                value={config.timeout ?? 30}
                disabled={!editable}
                onChange={(event) => patch({ timeout: Number(event.target.value) || 30 })}
              />
            </Row>
          </div>
          {toggle("allowErrors", "Continuar si falla (código ≠ 0)")}
        </>
      )}
      {config?.type === "appCommand" && (
        <Row label="Comando">
          {commands.length > 0 ? (
            <SmallSelect
              label="Comando de la app"
              items={[{ value: NONE, label: "Elige un comando…" }, ...commands]}
              value={config.command || NONE}
              disabled={!editable}
              onChange={(command) => patch({ command: command === NONE ? "" : command })}
            />
          ) : (
            <Input
              className={inputClass}
              value={config.command ?? ""}
              placeholder="id.del.comando"
              disabled={!editable}
              onChange={(event) => patch({ command: event.target.value })}
            />
          )}
        </Row>
      )}
      {config?.type === "ai" && (
        <>
          {text("prompt", "Prompt", { code: true })}
          {text("system", "Instrucciones (opcional)", { code: true })}
          {toggle("json", "Interpretar la respuesta como JSON")}
        </>
      )}
      {config?.type === "writeNote" && (
        <>
          {text("path", "Archivo", { placeholder: "notas/registro.md" })}
          {text("content", "Contenido", { code: true })}
          {toggle("append", "Añadir al final (no reemplazar)")}
        </>
      )}
      {config?.type === "template" && text("template", "Plantilla (JSON)", { code: true })}
      {config?.type === "condition" && (
        <>
          {text("field", "Campo", { placeholder: "status  ·  body.total" })}
          <div className="grid grid-cols-2 gap-1.5">
            <SmallSelect
              label="Operador"
              items={OPERATORS}
              value={config.operator ?? "=="}
              disabled={!editable}
              onChange={(operator) => patch({ operator })}
            />
            {config.operator !== "exists" && config.operator !== "truthy" && (
              <Input
                aria-label="Valor"
                className={inputClass}
                value={config.value ?? ""}
                disabled={!editable}
                onChange={(event) => patch({ value: event.target.value })}
              />
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Sale por la conexión «sí» si se cumple y por «no» si no.
          </p>
        </>
      )}
      {config && !["condition", "manual", "schedule", "fileWatch"].includes(config.type) && (
        <details className="rounded-md border border-border/70 px-2 py-1.5 text-[11px]">
          <summary className="cursor-pointer text-muted-foreground select-none">
            Repetir y reintentar
            {config.forEach || config.retries ? " · activo" : ""}
          </summary>
          <div className="mt-2 space-y-2">
            {text("forEach", "Repetir por cada elemento de", {
              placeholder: "body.items  ·  input",
            })}
            <div className="grid grid-cols-2 gap-1.5">
              <Row label="Reintentos si falla">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  className={inputClass}
                  value={config.retries ?? 0}
                  disabled={!editable}
                  onChange={(event) =>
                    patch({
                      retries: Number(event.target.value) || undefined,
                    } as Partial<StepConfig>)
                  }
                />
              </Row>
              <Row label="Espera (s)">
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  className={inputClass}
                  value={config.retryDelay ?? 2}
                  disabled={!editable || !config.retries}
                  onChange={(event) =>
                    patch({ retryDelay: Number(event.target.value) } as Partial<StepConfig>)
                  }
                />
              </Row>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Al repetir, usa <code>{"{{item}}"}</code> e <code>{"{{index}}"}</code>; la salida es
              la lista de resultados.
            </p>
          </div>
        </details>
      )}
      {config && !["condition", "manual", "schedule", "fileWatch"].includes(config.type) && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Usa <code>{"{{input.campo}}"}</code>, <code>{"{{steps.id.output.campo}}"}</code> o{" "}
          <code>{"{{secrets.NOMBRE}}"}</code> para insertar datos.
        </p>
      )}
    </div>
  );
}
