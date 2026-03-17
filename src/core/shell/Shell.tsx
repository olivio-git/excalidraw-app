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
        <SidebarInset className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
          <div className="bg-secondary flex-1 min-h-0 overflow-hidden">
            <TabContent />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
