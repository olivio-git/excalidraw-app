import { useEffect, useRef } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { useOutputStore } from "./output-store";

/** "Salida" view of the bottom panel: the selected output channel's text. */
export function OutputPanel() {
  const channel = useOutputStore((s) => s.channels.find((c) => c.id === s.activeId));
  const scrollRef = useRef<HTMLPreElement>(null);

  // Follow new output while the view is scrolled to the bottom.
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [channel?.text]);

  if (!channel) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        No hay salida todavía. Las extensiones escriben aquí sus registros.
      </p>
    );
  }
  return (
    <pre
      ref={scrollRef}
      aria-label={`Salida: ${channel.name}`}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="h-full overflow-auto px-3 py-2 text-xs leading-5 whitespace-pre-wrap break-words"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {channel.text}
    </pre>
  );
}

export function OutputPanelActions() {
  const channels = useOutputStore((s) => s.channels);
  const activeId = useOutputStore((s) => s.activeId);
  const setActive = useOutputStore((s) => s.setActive);
  const clear = useOutputStore((s) => s.clear);
  if (channels.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      <select
        aria-label="Canal de salida"
        value={activeId ?? ""}
        onChange={(e) => setActive(e.target.value)}
        className="h-6 max-w-48 rounded border border-border bg-background px-1 text-xs"
      >
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <TooltipWrapper tooltip="Limpiar salida" side="top">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Limpiar salida"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => activeId && clear(activeId)}
        >
          <Eraser className="size-3.5" />
        </Button>
      </TooltipWrapper>
    </div>
  );
}
