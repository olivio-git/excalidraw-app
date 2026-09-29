import { useCallback, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { PANEL_MIN_SIZE, useLayoutStore } from "@/core/layout/layout-store";
import { ViewPart } from "@/core/layout/ViewPart";
import { useLocationViews } from "@/core/layout/layout-dnd";

/** Space always left to the editor next to the panel. */
const EDITOR_MIN_SIZE = 120;

/**
 * VS Code-style panel (Terminal, Output, extension views and whatever the
 * user drags here), below the editor area or at its right.
 */
export function BottomPanel() {
  const { views, open } = useLocationViews("panel");
  const position = useLayoutStore((s) => s.panelPosition);
  const size = useLayoutStore((s) => (s.panelPosition === "bottom" ? s.panelHeight : s.panelWidth));
  const setPanelSize = useLayoutStore((s) => s.setPanelSize);
  const setPartOpen = useLayoutStore((s) => s.setPartOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const vertical = position === "bottom";

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const panel = panelRef.current;
      const container = panel?.parentElement;
      if (!panel || !container) return;
      event.preventDefault();
      const start = vertical ? event.clientY : event.clientX;
      const rect = panel.getBoundingClientRect();
      const startSize = vertical ? rect.height : rect.width;
      const containerRect = container.getBoundingClientRect();
      const max = (vertical ? containerRect.height : containerRect.width) - EDITOR_MIN_SIZE;
      const onMove = (e: PointerEvent) => {
        const next = startSize + (start - (vertical ? e.clientY : e.clientX));
        setPanelSize(Math.min(Math.max(next, PANEL_MIN_SIZE), Math.max(max, PANEL_MIN_SIZE)));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.classList.remove("qori-resizing");
        document.body.style.removeProperty("cursor");
      };
      document.body.classList.add("qori-resizing");
      document.body.style.cursor = vertical ? "row-resize" : "col-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setPanelSize, vertical]
  );

  if (views.length === 0) return null;

  return (
    <div
      ref={panelRef}
      data-panel="bottom"
      data-panel-position={position}
      className={cn(
        "relative flex flex-col shrink-0 bg-background min-h-0 min-w-0",
        vertical ? "border-t border-border/60" : "border-l border-border/60",
        !open && "hidden"
      )}
      style={vertical ? { height: size } : { width: size }}
    >
      <div
        role="separator"
        aria-orientation={vertical ? "horizontal" : "vertical"}
        aria-label="Redimensionar panel"
        onPointerDown={startResize}
        className={cn(
          "absolute z-10 hover:bg-primary/30 transition-colors",
          vertical
            ? "-top-1 left-0 right-0 h-2 cursor-row-resize"
            : "-left-1 top-0 bottom-0 w-2 cursor-col-resize"
        )}
      />
      <ViewPart
        location="panel"
        variant="panel"
        headerEnd={
          <TooltipWrapper tooltip="Cerrar panel" side="top">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => setPartOpen("panel", false)}
              aria-label="Cerrar panel"
            >
              <X className="size-3.5" />
            </Button>
          </TooltipWrapper>
        }
      />
    </div>
  );
}
