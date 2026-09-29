import { panelViews } from "@/core/panel/panel-store";
import { cn } from "@/shared/lib/utils";
import { getActiveThemeColors } from "../color-theme-service";
import { Codicon, LabelWithIcons } from "./codicons";
import { extensionHost } from "./extension-host-service";
import { useExtensionHostStore } from "./host-store";
import { HOST_LOG_CHANNEL, useOutputStore } from "./output-store";
import { sortStatusBarItems, useStatusBarStore, type StatusBarItem } from "./statusbar-store";
import { OUTPUT_VIEW_ID } from "./host-handlers";

function resolveColor(color: StatusBarItem["color"]): string | undefined {
  if (!color) return undefined;
  if (typeof color === "string") return color;
  const themeColors = getActiveThemeColors();
  if (themeColors[color.themeColor]) return themeColors[color.themeColor];
  if (color.themeColor.includes("error")) return "hsl(var(--destructive))";
  if (color.themeColor.includes("warning")) return "#d97706";
  return undefined;
}

function Item({ item }: { item: StatusBarItem }) {
  const style = {
    color: resolveColor(item.color),
    backgroundColor: resolveColor(item.backgroundColor),
  };
  const content = <LabelWithIcons text={item.text} iconClassName="text-[12px]" />;
  if (!item.hasCommand) {
    return (
      <span
        title={item.tooltip}
        style={style}
        className="flex h-full items-center gap-1 px-1.5 whitespace-nowrap"
      >
        {content}
      </span>
    );
  }
  return (
    <button
      title={item.tooltip}
      aria-label={item.name ?? item.text.replace(/\$\([^)]+\)/g, "").trim()}
      style={style}
      onClick={() => void extensionHost.request("statusBar.click", { id: item.id })}
      className="flex h-full items-center gap-1 px-1.5 whitespace-nowrap hover:bg-accent"
    >
      {content}
    </button>
  );
}

function HostIndicator() {
  const status = useExtensionHostStore((s) => s.status);
  const activated = useExtensionHostStore((s) => s.activated.length);
  const failed = useExtensionHostStore((s) => Object.keys(s.failed).length);
  const error = useExtensionHostStore((s) => s.error);
  if (status === "idle") return null;

  const showLog = () => {
    useOutputStore.getState().setActive(HOST_LOG_CHANNEL);
    panelViews.show(OUTPUT_VIEW_ID);
  };
  const label =
    status === "starting"
      ? "Iniciando extensiones…"
      : status === "running"
        ? `${activated} activa${activated === 1 ? "" : "s"}${failed ? ` · ${failed} con error` : ""}`
        : status === "unavailable"
          ? "Extensiones no disponibles"
          : status === "stopped"
            ? "Extension Host detenido"
            : "Extension Host con error";
  return (
    <button
      onClick={showLog}
      title={error ?? "Ver el registro del Extension Host"}
      className={cn(
        "flex h-full items-center gap-1 px-1.5 whitespace-nowrap hover:bg-accent",
        (status === "error" || failed > 0) && "text-destructive"
      )}
    >
      <Codicon
        name={status === "starting" ? "sync~spin" : status === "running" ? "extensions" : "warning"}
        className="text-[12px]"
      />
      <span>{label}</span>
    </button>
  );
}

/** Bottom status bar: extension items (left/right) and transient messages. */
export function StatusBar() {
  const items = useStatusBarStore((s) => s.items);
  const messages = useStatusBarStore((s) => s.messages);
  const status = useExtensionHostStore((s) => s.status);
  const list = Object.values(items);
  const messageList = Object.entries(messages);
  if (status === "idle" && list.length === 0 && messageList.length === 0) return null;

  return (
    <footer
      role="status"
      aria-label="Barra de estado"
      className="flex h-6 shrink-0 items-stretch justify-between border-t border-border/60 bg-background text-[11px] text-muted-foreground"
    >
      <div className="flex min-w-0 items-stretch overflow-hidden">
        <HostIndicator />
        {sortStatusBarItems(list, "left").map((item) => (
          <Item key={item.id} item={item} />
        ))}
        {messageList.map(([id, text]) => (
          <span key={id} className="flex items-center gap-1 px-1.5 whitespace-nowrap">
            <LabelWithIcons text={text} iconClassName="text-[12px]" />
          </span>
        ))}
      </div>
      <div className="flex min-w-0 items-stretch overflow-hidden">
        {sortStatusBarItems(list, "right").map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </div>
    </footer>
  );
}
