import { useEffect } from "react";
import {
  SidebarInset,
  SidebarProvider,
  SidebarResizeHandle,
  SidebarTrigger,
} from "@/shared/components/ui/sidebar";
import { Separator } from "@/shared/components/ui/separator";
import { Toaster } from "sonner";
import TabBar from "@/core/tabs/components/TabBar";
import TabContent from "@/core/tabs/components/TabContent";
import TitleBar from "./TitleBar";
import DiagramSidebar from "./DiagramSidebar";
import { useKeybindingBridge } from "@/core/keybindings/hooks/useKeybindingBridge";
import { useMcpBridge } from "@/core/shell/hooks/useMcpBridge";
import CommandPalette from "@/features/command-palette/CommandPalette";
import { useThemeStore } from "@/stores/themeStore";
import { ConfirmDialog } from "@/shared/lib/confirm";
import { PromptDialog } from "@/shared/lib/prompt";

export default function Shell() {
  useKeybindingBridge();
  useMcpBridge();
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  // -------------------------------------------------------------------------
  // Ctrl+H / Ctrl+L — Vim-style directional focus between sidebar and canvas
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      const sidebar = document.querySelector<HTMLElement>("[data-panel='sidebar']");
      const main = document.querySelector<HTMLElement>("[data-panel='main']");

      if (e.key === "h") {
        // Ctrl+H → focus sidebar (explorer container preferred)
        e.preventDefault();
        const explorerContainer = sidebar?.querySelector<HTMLElement>(
          ".flex.flex-col.h-full.overflow-hidden[tabindex='-1']"
        );
        (explorerContainer ?? sidebar)?.focus();
      } else if (e.key === "l") {
        // Ctrl+L → focus main canvas
        e.preventDefault();
        main?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <SidebarProvider className="h-full w-full flex flex-col overflow-hidden relative min-h-0">
      <Toaster position="bottom-right" theme={resolvedTheme} richColors />
      <ConfirmDialog />
      <PromptDialog />
      {/* Command palette — always mounted, manages its own open/close state */}
      <CommandPalette />
      {/* TitleBar at the very top, full width, with TabBar inside */}
      <TitleBar>
        <SidebarTrigger className="ml-2 size-7 flex-shrink-0" />
        <Separator orientation="vertical" className="mx-1.5 !h-4" />
        <div className="flex-1 min-w-0">
          <TabBar alwaysVisible />
        </div>
      </TitleBar>

      {/* Sidebar + Content below the TitleBar */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <DiagramSidebar />
        <SidebarResizeHandle />
        <SidebarInset
          data-panel="main"
          tabIndex={-1}
          className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden outline-none focus-within:ring-1 focus-within:ring-inset focus-within:ring-muted-foreground/40"
        >
          <div className="bg-secondary flex-1 min-h-0 overflow-hidden">
            <TabContent />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
