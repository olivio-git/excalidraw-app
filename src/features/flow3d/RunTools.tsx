import { useEffect, useState } from "react";
import { Clock, History, KeyRound, Plus, Trash2, Zap } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { cn } from "@/shared/lib/utils";
import { useFlowEditor, type FlowEditorStore } from "./editor-store";
import { describePlan, planAutomations } from "./automation";
import { sideEffectSteps, STEP_TYPES, type RunTrigger } from "./executor";
import { relativeTime, type RunHistoryEntry } from "./run-history";
import { SECRET_NAME, type SecretStore } from "./secrets";

const TRIGGER_LABEL: Record<RunTrigger, string> = {
  manual: "Manual",
  schedule: "Horario",
  file: "Archivo",
};

export function StatusDot({ status }: { status: RunHistoryEntry["status"] }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "done" && "bg-emerald-500",
        status === "error" && "bg-red-500",
        status === "cancelled" && "bg-muted-foreground/50",
        status === "running" && "animate-pulse bg-sky-500"
      )}
    />
  );
}

/** Past runs of the flow: pick one to see its results and replay it. */
export function HistoryMenu({ store, onClear }: { store: FlowEditorStore; onClear?: () => void }) {
  const history = useFlowEditor(store, (s) => s.history);
  const shown = useFlowEditor(store, (s) => s.shownRunId);
  const running = useFlowEditor(store, (s) => s.run?.status === "running");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Historial de ejecuciones"
            title="Historial de ejecuciones"
            disabled={running}
            className="relative"
          >
            <History />
            {history.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-primary px-0.5 text-[9px] leading-3.5 text-primary-foreground">
                {history.length}
              </span>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs">Últimas ejecuciones</DropdownMenuLabel>
        </DropdownMenuGroup>
        {history.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Todavía no se ha ejecutado. Las ejecuciones manuales y automáticas aparecen aquí.
          </p>
        )}
        {history.map((entry) => (
          <DropdownMenuItem
            key={entry.id}
            data-history-entry={entry.status}
            className={cn("gap-2 text-xs", shown === entry.id && "bg-accent")}
            onClick={() => store.getState().showRun(entry)}
          >
            <StatusDot status={entry.status} />
            <span className="flex-1 truncate">{relativeTime(entry.startedAt)}</span>
            <span className="text-[10px] text-muted-foreground">
              {TRIGGER_LABEL[entry.trigger]} · {entry.duration.toFixed(1)}s
            </span>
          </DropdownMenuItem>
        ))}
        {history.length > 0 && onClear && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs" onClick={onClear}>
              <Trash2 />
              Borrar historial
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Values for `{{secrets.NAME}}`: kept in app data, never in the flow file. */
export function SecretsDialog({
  secrets,
  open,
  onOpenChange,
}: {
  secrets: SecretStore;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const refresh = () => void secrets.names().then(setNames);
  useEffect(() => {
    if (open) void secrets.names().then(setNames);
  }, [open, secrets]);
  const valid = SECRET_NAME.test(name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-flow3d-secrets>
        <DialogHeader>
          <DialogTitle>Secretos</DialogTitle>
          <DialogDescription>
            Úsalos en cualquier paso como <code>{"{{secrets.NOMBRE}}"}</code>. Se guardan en la
            carpeta de datos de la app (no en el flujo) y se ocultan en los datos de cada ejecución.
            No están cifrados.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {names.length === 0 && (
            <li className="text-xs text-muted-foreground">Aún no hay secretos.</li>
          )}
          {names.map((secret) => (
            <li
              key={secret}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
            >
              <KeyRound className="size-3.5 text-muted-foreground" />
              <code className="flex-1 truncate">{secret}</code>
              <span className="text-muted-foreground">••••••</span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Borrar ${secret}`}
                onClick={() => void secrets.remove(secret).then(refresh)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="grid grid-cols-[1fr_1fr_auto] gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || !value) return;
            void secrets
              .set(name, value)
              .then(() => {
                setName("");
                setValue("");
                refresh();
              })
              .catch((error: unknown) => notify(String(error), { type: "error" }));
          }}
        >
          <Input
            aria-label="Nombre del secreto"
            className="h-7 font-mono text-xs md:text-xs"
            placeholder="API_KEY"
            value={name}
            aria-invalid={name !== "" && !valid}
            onChange={(event) => setName(event.target.value.trim())}
          />
          <Input
            aria-label="Valor del secreto"
            type="password"
            className="h-7 text-xs md:text-xs"
            placeholder="valor"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={!valid || !value}>
            <Plus />
            Guardar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SecretsButton({ secrets }: { secrets: SecretStore }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Secretos"
        title="Secretos ({{secrets.NOMBRE}})"
        onClick={() => setOpen(true)}
      >
        <KeyRound />
      </Button>
      <SecretsDialog secrets={secrets} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** "Automático" chip: this flow runs by itself (schedule / file). */
export function AutomationBadge({ store }: { store: FlowEditorStore }) {
  const doc = useFlowEditor(store, (s) => s.doc);
  const plans = planAutomations(doc);
  if (plans.length === 0) return null;
  return (
    <span
      data-flow3d-automation
      title={plans.map((p) => `${p.label}: ${describePlan(p)}`).join("\n")}
      className="flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
    >
      <Clock className="size-3" />
      {plans.length === 1 ? describePlan(plans[0]) : `${plans.length} disparadores`}
    </span>
  );
}

/** Switch that lets a flow run by itself (asks once, listing what it will do). */
export function AutomationToggle({
  store,
  editable,
}: {
  store: FlowEditorStore;
  editable: boolean;
}) {
  const doc = useFlowEditor(store, (s) => s.doc);
  const enabled = Boolean(doc.settings?.automation);
  const plans = planAutomations({ ...doc, settings: { ...doc.settings, automation: true } });
  const toggle = async (checked: boolean) => {
    if (checked) {
      const risky = sideEffectSteps(doc);
      const when = plans.map(describePlan).join(", ") || "según sus disparadores";
      const steps = risky
        .slice(0, 5)
        .map((n) => `• ${n.label || n.id}: ${STEP_TYPES[n.config!.type].label}`)
        .join("\n");
      const ok = await confirm({
        title: "Ejecutar este flujo automáticamente",
        description: `Se ejecutará solo, ${when}, sin pedir confirmación${
          risky.length ? `, incluidos estos pasos:\n${steps}` : "."
        }\n\nPuedes pausar todas las automatizaciones con el comando «Pausar / reanudar automatizaciones».`,
        confirmLabel: "Activar",
        cancelLabel: "Cancelar",
      });
      if (!ok) return;
    }
    const current = store.getState().doc;
    store
      .getState()
      .setDoc({ ...current, settings: { ...current.settings, automation: checked || undefined } });
  };
  return (
    <label className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-[11px]">
      <span className="flex items-center gap-1.5 font-medium">
        <Zap className="size-3.5 text-emerald-600" />
        Automatización {enabled ? "activa" : "apagada"}
      </span>
      <Switch
        size="sm"
        checked={enabled}
        disabled={!editable || plans.length === 0}
        onCheckedChange={(checked) => void toggle(checked)}
      />
    </label>
  );
}
