import { notify } from "@/shared/lib/notify";
import { confirm } from "@/shared/lib/confirm";
import { prompt } from "@/shared/lib/prompt";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useThemeStore } from "@/stores/themeStore";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Btn({
  label,
  onClick,
  variant = "default",
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "success" | "warning" | "danger";
}) {
  const colors = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    success: "bg-green-600 text-white hover:bg-green-700",
    warning: "bg-yellow-500 text-white hover:bg-yellow-600",
    danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  };

  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${colors[variant]}`}
    >
      {label}
    </button>
  );
}

export default function PlaygroundView() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const theme = useThemeStore((s) => s.theme);

  const handleNotifyCascade = () => {
    notify("Mensaje informativo", { type: "info" });
    setTimeout(() => notify("¡Operación exitosa!", { type: "success" }), 700);
    setTimeout(() => notify("Cuidado con esto", { type: "warning" }), 1400);
    setTimeout(() => notify("Error simulado", { type: "error" }), 2100);
  };

  const handleConfirm = async () => {
    const ok = await confirm({
      title: "¿Confirmar acción?",
      description: "Esta es una confirmación de prueba generada por Canvas Playground.",
      confirmLabel: "Sí, confirmar",
      cancelLabel: "Cancelar",
    });
    notify(ok ? "Confirmado ✓" : "Cancelado", { type: ok ? "success" : "warning" });
  };

  const handlePrompt = async () => {
    const result = await prompt({
      title: "Formulario de Prueba",
      description: "Completá los campos para ver cómo funciona el sistema de prompts.",
      fields: [
        { id: "nombre", label: "Nombre", placeholder: "ej: Ronald Gallardo", required: true },
        { id: "numero", label: "Número favorito", type: "number", placeholder: "ej: 42" },
      ],
    });

    if (result) {
      const num = result.numero ? ` / favorito: ${result.numero}` : "";
      notify(`Recibido → ${result.nombre}${num}`, { type: "success", duration: 5000 });
    } else {
      notify("Prompt cancelado", { type: "warning" });
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-2xl mx-auto p-8 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Canvas Playground</h1>
          <p className="text-sm text-muted-foreground">
            Plugin interno para testear la API de plugins: notificaciones, diálogos, tabs y más.
          </p>
        </div>

        {/* Notificaciones */}
        <Section title="Notificaciones">
          <p className="text-sm text-muted-foreground">Dispara los 4 tipos de toast en cascada.</p>
          <div className="flex flex-wrap gap-2">
            <Btn label="Info" onClick={() => notify("Mensaje informativo", { type: "info" })} />
            <Btn
              label="Success"
              variant="success"
              onClick={() => notify("¡Operación exitosa!", { type: "success" })}
            />
            <Btn
              label="Warning"
              variant="warning"
              onClick={() => notify("Cuidado con esto", { type: "warning" })}
            />
            <Btn
              label="Error"
              variant="danger"
              onClick={() => notify("Error simulado", { type: "error" })}
            />
            <Btn label="Cascada completa" onClick={handleNotifyCascade} />
          </div>
        </Section>

        {/* Diálogos */}
        <Section title="Diálogos">
          <p className="text-sm text-muted-foreground">
            Confirm y Prompt son promesas — el resultado aparece como notificación.
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn label="Confirm dialog" onClick={handleConfirm} />
            <Btn label="Prompt dialog" onClick={handlePrompt} />
          </div>
        </Section>

        {/* Estado de tabs */}
        <Section title="Tabs abiertas">
          <div className="space-y-1.5">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`flex items-center justify-between px-3 py-2 rounded-md text-sm ${
                  tab.id === activeTabId
                    ? "bg-primary/10 text-primary font-medium"
                    : "bg-muted/50 text-muted-foreground"
                }`}
              >
                <span>{tab.title}</span>
                <span className="text-xs opacity-60">{tab.routeId}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Info del entorno */}
        <Section title="Entorno">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Tab activa</dt>
            <dd className="font-mono truncate">{activeTab?.title ?? "–"}</dd>

            <dt className="text-muted-foreground">Route ID</dt>
            <dd className="font-mono">{activeTab?.routeId ?? "–"}</dd>

            <dt className="text-muted-foreground">Tema</dt>
            <dd className="font-mono">{theme}</dd>

            <dt className="text-muted-foreground">Tabs abiertas</dt>
            <dd className="font-mono">{tabs.length}</dd>
          </dl>
        </Section>
      </div>
    </div>
  );
}
