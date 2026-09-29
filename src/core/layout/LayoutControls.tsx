import { PanelBottom, PanelLeft, PanelRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { useSidebar } from "@/shared/components/ui/sidebar";
import { useLayoutStore } from "./layout-store";

/**
 * Title bar toggles for the primary side bar, the panel and the secondary
 * side bar, drawn on the side each one currently is (like VS Code).
 */
export function LayoutControls() {
  const { open: primaryOpen, toggleSidebar } = useSidebar();
  const sidebarSide = useLayoutStore((s) => s.sidebarSide);
  const panelOpen = useLayoutStore((s) => s.parts.panel.open);
  const panelPosition = useLayoutStore((s) => s.panelPosition);
  const secondaryOpen = useLayoutStore((s) => s.parts.secondary.open);
  const togglePart = useLayoutStore((s) => s.togglePart);

  const buttons = [
    {
      id: "primary",
      label: "Barra lateral principal (Ctrl+B)",
      Icon: sidebarSide === "left" ? PanelLeft : PanelRight,
      active: primaryOpen,
      onClick: toggleSidebar,
    },
    {
      id: "panel",
      label: "Panel (Ctrl+J)",
      Icon: panelPosition === "bottom" ? PanelBottom : PanelRight,
      active: panelOpen,
      onClick: () => togglePart("panel"),
    },
    {
      id: "secondary",
      label: "Barra lateral secundaria (Ctrl+Alt+B)",
      Icon: sidebarSide === "left" ? PanelRight : PanelLeft,
      active: secondaryOpen,
      onClick: () => togglePart("secondary"),
    },
  ];
  // Left-to-right in the order the parts appear on screen.
  const ordered = sidebarSide === "left" ? buttons : [...buttons].reverse();

  return (
    <div className="flex items-center gap-0.5 px-1" aria-label="Diseño">
      {ordered.map(({ id, label, Icon, active, onClick }) => (
        <TooltipWrapper key={id} tooltip={label} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={active}
            data-layout-toggle={id}
            onClick={onClick}
            className={cn(
              "size-7",
              active ? "text-foreground" : "text-muted-foreground/70 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
          </Button>
        </TooltipWrapper>
      ))}
    </div>
  );
}
