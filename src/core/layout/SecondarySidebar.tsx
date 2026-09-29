import { useCallback } from "react";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { SECONDARY_MAX_WIDTH, SECONDARY_MIN_WIDTH, useLayoutStore } from "./layout-store";
import { ViewPart } from "./ViewPart";
import { useLocationViews } from "./layout-dnd";

/**
 * Secondary side bar (VS Code's auxiliary bar), on the side opposite to the
 * primary one. Shown while open and holding views, or while dragging a view
 * so it can be dropped here.
 */
export function SecondarySidebar() {
  const { views, open } = useLocationViews("secondary");
  const side = useLayoutStore((s) => (s.sidebarSide === "left" ? "right" : "left"));
  const width = useLayoutStore((s) => s.secondaryWidth);
  const setWidth = useLayoutStore((s) => s.setSecondaryWidth);
  const setPartOpen = useLayoutStore((s) => s.setPartOpen);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = useLayoutStore.getState().secondaryWidth;
      const onMove = (e: PointerEvent) => {
        const delta = e.clientX - startX;
        const next = side === "right" ? startWidth - delta : startWidth + delta;
        setWidth(Math.min(Math.max(next, SECONDARY_MIN_WIDTH), SECONDARY_MAX_WIDTH));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.classList.remove("qori-resizing");
        document.body.style.removeProperty("cursor");
      };
      document.body.classList.add("qori-resizing");
      document.body.style.cursor = "col-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setWidth, side]
  );

  if (!open || views.length === 0) return null;

  return (
    <aside
      data-panel="secondary"
      data-side={side}
      tabIndex={-1}
      style={{ width, minWidth: width }}
      className={cn(
        "relative flex h-full shrink-0 flex-col bg-sidebar text-sidebar-foreground outline-none",
        side === "right" ? "border-l border-border/50" : "border-r border-border/50"
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar barra lateral secundaria"
        onPointerDown={startResize}
        className={cn(
          "absolute inset-y-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/30 transition-colors",
          side === "right" ? "-left-1" : "-right-1"
        )}
      />
      <ViewPart
        location="secondary"
        variant="sidebar"
        headerEnd={
          <>
            <div className="flex-1" />
            <TooltipWrapper tooltip="Cerrar barra lateral secundaria" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => setPartOpen("secondary", false)}
                aria-label="Cerrar barra lateral secundaria"
              >
                <X className="size-3.5" />
              </Button>
            </TooltipWrapper>
          </>
        }
      />
    </aside>
  );
}
