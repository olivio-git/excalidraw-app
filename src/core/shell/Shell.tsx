import {
  SidebarInset,
  SidebarProvider,
  SidebarResizeHandle,
  SidebarTrigger,
} from "@/shared/components/ui/sidebar";
import { Separator } from "@/shared/components/ui/separator";
import TabBar from "@/core/tabs/components/TabBar";
import TabContent from "@/core/tabs/components/TabContent";
import TitleBar from "./TitleBar";
import AppSidebar from "./Sidebar";
import type { RouteConfig } from "@/core/routing/types";
import { useKeybindingBridge } from "@/core/keybindings/hooks/useKeybindingBridge";
import CommandPalette from "@/features/command-palette/CommandPalette";

export interface ShellProps {
  routes: RouteConfig[];
}

export default function Shell({ routes }: ShellProps) {
  useKeybindingBridge();

  // Removed useEffect causing cascading renders
  // The Shell should just return the provider immediately

  return (
    <SidebarProvider className="h-full w-full flex flex-col overflow-hidden relative min-h-0">
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
        <AppSidebar routes={routes} />
        <SidebarResizeHandle />
        <SidebarInset className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
          <div className="bg-secondary flex-1 min-h-0 overflow-hidden">
            <TabContent />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
