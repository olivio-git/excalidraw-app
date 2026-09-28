import { Suspense, useCallback, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { usePanelViews } from "./panel-registry";
import { PANEL_MIN_HEIGHT, usePanelStore } from "./panel-store";

/** Space always left to the editor above the panel. */
const EDITOR_MIN_HEIGHT = 120;

/**
 * VS Code-style bottom panel below the editor area. Views (Terminal, Output,
 * extension views) come from the panel registry; every view stays mounted
 * once shown so terminals keep their scrollback while hidden.
 */
export function BottomPanel() {
  const views = usePanelViews();
  const open = usePanelStore((s) => s.open);
  const height = usePanelStore((s) => s.height);
  const activeViewId = usePanelStore((s) => s.activeViewId);
  const setHeight = usePanelStore((s) => s.setHeight);
  const showView = usePanelStore((s) => s.showView);
  const setOpen = usePanelStore((s) => s.setOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mountedViews, setMountedViews] = useState<string[]>([]);

  const activeView = views.find((v) => v.id === activeViewId) ?? views[0];
  // Mount views on first show and keep them mounted (adjusting state during render).
  if (open && activeView && !mountedViews.includes(activeView.id)) {
    setMountedViews([...mountedViews, activeView.id]);
  }

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const panel = panelRef.current;
      const container = panel?.parentElement;
      if (!panel || !container) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = panel.getBoundingClientRect().height;
      const maxHeight = container.getBoundingClientRect().height - EDITOR_MIN_HEIGHT;
      const onMove = (e: PointerEvent) => {
        const next = startHeight + (startY - e.clientY);
        setHeight(
          Math.min(Math.max(next, PANEL_MIN_HEIGHT), Math.max(maxHeight, PANEL_MIN_HEIGHT))
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.removeProperty("cursor");
      };
      document.body.style.cursor = "row-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setHeight]
  );

  if (!activeView) return null;
  const Actions = activeView.actions;

  return (
    <div
      ref={panelRef}
      data-panel="bottom"
      className={cn(
        "relative flex flex-col shrink-0 border-t border-border/60 bg-background min-h-0",
        !open && "hidden"
      )}
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Redimensionar panel"
        onPointerDown={startResize}
        className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize z-10 hover:bg-primary/30 transition-colors"
      />
      <div className="flex items-center h-8 shrink-0 px-2 gap-1 border-b border-border/40">
        <div role="tablist" className="flex items-center gap-0.5 min-w-0 overflow-x-auto">
          {views.map((view) => {
            const isActive = view.id === activeView.id;
            return (
              <button
                key={view.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => showView(view.id)}
                className={cn(
                  "h-7 px-2 text-[11px] uppercase tracking-wide whitespace-nowrap border-b-2 transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {view.title}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        {Actions && <Actions />}
        <TooltipWrapper tooltip="Cerrar panel" side="top">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
            aria-label="Cerrar panel"
          >
            <X className="size-3.5" />
          </Button>
        </TooltipWrapper>
      </div>
      <div className="relative flex-1 min-h-0">
        {views
          .filter((view) => mountedViews.includes(view.id))
          .map((view) => {
            const View = view.component;
            return (
              <div
                key={view.id}
                role="tabpanel"
                className={cn("absolute inset-0", view.id !== activeView.id && "hidden")}
              >
                <Suspense fallback={null}>
                  <View />
                </Suspense>
              </div>
            );
          })}
      </div>
    </div>
  );
}
