import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, SquareTerminal, Trash2 } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { isPtyAvailable, type ShellInfo } from "./pty";
import {
  createShellTerminal,
  getAvailableShells,
  getTerminalSession,
  killActiveTerminal,
  killTerminal,
  setActiveTerminal,
  useTerminalStore,
} from "./terminal-service";

/** The Terminal view of the bottom panel. */
export function TerminalPanel() {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeId = useTerminalStore((s) => s.activeId);
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-parent the active session's xterm into the view and keep it fitted.
  useEffect(() => {
    const container = containerRef.current;
    const session = activeId ? getTerminalSession(activeId) : undefined;
    if (!container || !session) return;
    session.attach(container);
    session.focus();
    const observer = new ResizeObserver(() => session.fit());
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeId]);

  if (terminals.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-4">
        <SquareTerminal className="size-6 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {isPtyAvailable()
            ? "No hay terminales abiertas."
            : "La terminal integrada solo está disponible en la app de escritorio."}
        </p>
        {isPtyAvailable() && (
          <Button size="sm" variant="outline" onClick={() => void createShellTerminal()}>
            <Plus className="mr-1 size-3.5" /> Nueva terminal
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div ref={containerRef} data-terminal className="flex-1 min-w-0 h-full pl-2 pt-1" />
      {terminals.length > 1 && (
        <ul
          aria-label="Terminales"
          className="w-44 shrink-0 border-l border-border/40 overflow-y-auto py-1 text-xs"
        >
          {terminals.map((terminal) => (
            <li key={terminal.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setActiveTerminal(terminal.id)}
                onKeyDown={(e) => e.key === "Enter" && setActiveTerminal(terminal.id)}
                className={cn(
                  "group flex items-center gap-1.5 h-6 px-2 cursor-pointer",
                  terminal.id === activeId
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                )}
              >
                <SquareTerminal className="size-3.5 shrink-0" />
                <span
                  className={cn("truncate flex-1", terminal.exited && "line-through opacity-70")}
                >
                  {terminal.title}
                </span>
                <button
                  aria-label={`Cerrar ${terminal.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    killTerminal(terminal.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-foreground"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Toolbar of the Terminal view: new terminal (with shell picker) and kill. */
export function TerminalPanelActions() {
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const hasTerminals = useTerminalStore((s) => s.terminals.length > 0);

  useEffect(() => {
    let cancelled = false;
    void getAvailableShells().then((list) => !cancelled && setShells(list));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isPtyAvailable()) return null;

  return (
    <div className="flex items-center">
      <TooltipWrapper tooltip="Nueva terminal (Ctrl+Shift+`)" side="top">
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => void createShellTerminal()}
          aria-label="Nueva terminal"
        >
          <Plus className="size-3.5" />
        </Button>
      </TooltipWrapper>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Elegir shell"
            >
              <ChevronDown className="size-3" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs">Nueva terminal con…</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {shells.length === 0 && (
            <DropdownMenuItem disabled>No se detectaron shells</DropdownMenuItem>
          )}
          {shells.map((shell) => (
            <DropdownMenuItem
              key={shell.path}
              onClick={() =>
                void createShellTerminal({ shell: shell.path, args: shell.args, name: shell.name })
              }
            >
              <SquareTerminal className="mr-2 size-4" />
              <span className="flex-1">{shell.name}</span>
              {shell.isDefault && (
                <span className="text-[10px] text-muted-foreground">predeterminada</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {hasTerminals && (
        <TooltipWrapper tooltip="Cerrar terminal" side="top">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={killActiveTerminal}
            aria-label="Cerrar terminal"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </TooltipWrapper>
      )}
    </div>
  );
}
