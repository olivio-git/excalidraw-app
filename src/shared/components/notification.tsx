import type React from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";

export type NotificationLevel = "info" | "success" | "warning" | "error" | "progress";

export interface NotificationAction {
  label: string;
  /** The first primary action is drawn filled, like VS Code's main button. */
  primary?: boolean;
  onClick: () => void;
}

export interface NotificationOptions {
  /** Reuse an id to update a notification in place (progress). */
  id?: string | number;
  level?: NotificationLevel;
  message: React.ReactNode;
  detail?: React.ReactNode;
  /** Who raised it ("Extension Host", an extension name...). */
  source?: string;
  actions?: NotificationAction[];
  /** ms; Infinity keeps it until closed. Defaults depend on level and actions. */
  duration?: number;
  onClose?: () => void;
}

const ICONS: Record<NotificationLevel, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  progress: Loader2,
};

// Only the icon carries color, like VS Code notifications.
const ICON_COLORS: Record<NotificationLevel, string> = {
  info: "text-sky-500",
  success: "text-emerald-500",
  warning: "text-amber-500",
  error: "text-red-500",
  progress: "text-muted-foreground animate-spin",
};

export function NotificationCard({
  level = "info",
  message,
  detail,
  source,
  actions = [],
  onDismiss,
}: Omit<NotificationOptions, "id" | "duration" | "onClose"> & { onDismiss: () => void }) {
  const Icon = ICONS[level];
  return (
    <div
      role={level === "error" ? "alert" : "status"}
      data-notification={level}
      className="group/notification relative w-[360px] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-black/5 dark:ring-white/5"
    >
      <div className="flex gap-2.5 py-2.5 pr-8 pl-3">
        <Icon className={cn("mt-px size-4 shrink-0", ICON_COLORS[level])} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-[13px] leading-snug break-words">{message}</div>
          {detail && (
            <div className="text-xs leading-snug break-words text-muted-foreground">{detail}</div>
          )}
        </div>
      </div>
      {(source || actions.length > 0) && (
        <div className="flex items-center gap-1.5 px-3 pb-2.5">
          {source && (
            <span className="truncate text-[11px] text-muted-foreground">Origen: {source}</span>
          )}
          <div className="flex-1" />
          {actions.map((action, index) => (
            <Button
              key={`${action.label}-${index}`}
              size="xs"
              variant={action.primary ? "default" : "secondary"}
              onClick={() => {
                action.onClick();
                onDismiss();
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-label="Cerrar notificación"
        onClick={onDismiss}
        className="absolute top-2 right-2 flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/notification:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function defaultDuration(level: NotificationLevel, hasActions: boolean): number {
  if (level === "progress") return Infinity;
  if (hasActions) return 20000;
  return level === "error" ? 8000 : 4500;
}

/** Show (or update, with the same `id`) a VS Code-style notification. */
export function showNotification(options: NotificationOptions): string | number {
  const { id, level = "info", actions = [], duration, onClose, ...content } = options;
  return toast.custom(
    (toastId) => (
      <NotificationCard
        level={level}
        actions={actions}
        {...content}
        onDismiss={() => toast.dismiss(toastId)}
      />
    ),
    {
      id,
      duration: duration ?? defaultDuration(level, actions.length > 0),
      onDismiss: onClose,
      onAutoClose: onClose,
    }
  );
}

export function dismissNotification(id: string | number): void {
  toast.dismiss(id);
}
