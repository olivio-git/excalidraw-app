import {
  SidebarInset,
  SidebarProvider,
  SidebarResizeHandle,
  SidebarTrigger,
} from "@/shared/components/ui/sidebar";
import { cn } from "@/shared/lib/utils";
import { useLayoutStore } from "@/core/layout/layout-store";
import { useLocationViews } from "@/core/layout/layout-dnd";
import { EdgeDropZone, WorkbenchDnd } from "@/core/layout/WorkbenchDnd";
import { SecondarySidebar } from "@/core/layout/SecondarySidebar";
import { LayoutControls } from "@/core/layout/LayoutControls";
import { initLayoutCommands } from "@/core/layout/layout-commands";
import { registerBuiltinViews } from "./builtin-views";
import { Separator } from "@/shared/components/ui/separator";
import { Toaster } from "sonner";
import { WorkbenchToolbar } from "@/core/tabs/components/WorkbenchToolbar";
import TabContent from "@/core/tabs/components/TabContent";
import TitleBar from "./TitleBar";
import DiagramSidebar from "./DiagramSidebar";
import { useKeybindingBridge } from "@/core/keybindings/hooks/useKeybindingBridge";
import { useMcpBridge } from "@/core/shell/hooks/useMcpBridge";
import CommandPalette from "@/features/command-palette/CommandPalette";
import { useThemeStore } from "@/stores/themeStore";
import { ConfirmDialog } from "@/shared/lib/confirm";
import { PromptDialog } from "@/shared/lib/prompt";
import { ToolPermissionDialog } from "@/features/ai-chat/components/ToolPermissionDialog";
import { BottomPanel } from "@/core/panel/BottomPanel";
import { QuickInputHost, StatusBar } from "@/plugins/vscode/host";

registerBuiltinViews();
initLayoutCommands();

export default function Shell() {
  useKeybindingBridge();
  useMcpBridge();
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const sidebarSide = useLayoutStore((s) => s.sidebarSide);
  const panelPosition = useLayoutStore((s) => s.panelPosition);
  const primaryLeft = sidebarSide === "left";
  const panelViews = useLocationViews("panel");
  const secondaryViews = useLocationViews("secondary");
  const panel = { shown: panelViews.open && panelViews.views.length > 0 };
  const secondary = { shown: secondaryViews.open && secondaryViews.views.length > 0 };
  // Mirrored from the sidebar provider by DiagramSidebar.
  const primaryOpen = useLayoutStore((s) => s.parts.primary.open);

  return (
    <SidebarProvider className="qori-workbench h-full w-full flex flex-col overflow-hidden relative min-h-0">
      <Toaster position="bottom-right" theme={resolvedTheme} richColors />
      <ConfirmDialog />
      <PromptDialog />
      <ToolPermissionDialog />
      <QuickInputHost />
      {/* Command palette — always mounted, manages its own open/close state */}
      <CommandPalette />
      {/* TitleBar at the very top, full width, with TabBar inside */}
      <TitleBar>
        <SidebarTrigger className="ml-2 size-7 flex-shrink-0" />
        <Separator orientation="vertical" className="mx-1.5 !h-4" />
        <div className="flex-1 min-w-0">
          <WorkbenchToolbar />
        </div>
        <LayoutControls />
      </TitleBar>

      {/* Side bars, editor and panel below the TitleBar. The parts keep their
          DOM order and are placed with CSS `order`, so moving a side bar to the
          other side does not remount its views. */}
      <WorkbenchDnd>
        <div className="flex flex-1 min-h-0 overflow-hidden relative">
          <div className="flex h-full min-h-0" style={{ order: primaryLeft ? 0 : 4 }}>
            <DiagramSidebar />
          </div>
          <SidebarResizeHandle side={sidebarSide} style={{ order: primaryLeft ? 1 : 3 }} />
          <SidebarInset
            data-panel="main"
            tabIndex={-1}
            style={{ order: 2 }}
            className={cn(
              "relative flex-1 min-w-0 flex min-h-0 overflow-hidden outline-none",
              panelPosition === "bottom" ? "flex-col" : "flex-row"
            )}
          >
            <div className="bg-secondary flex-1 min-h-0 min-w-0 overflow-hidden">
              <TabContent />
            </div>
            <BottomPanel />
            {!panel.shown && (
              <EdgeDropZone
                location="panel"
                edge={panelPosition === "bottom" ? "bottom" : "right"}
              />
            )}
          </SidebarInset>
          <div className="flex h-full min-h-0" style={{ order: primaryLeft ? 4 : 0 }}>
            <SecondarySidebar />
          </div>
          {!secondary.shown && (
            <EdgeDropZone location="secondary" edge={primaryLeft ? "right" : "left"} />
          )}
          {!primaryOpen && <EdgeDropZone location="primary" edge={sidebarSide} />}
        </div>
      </WorkbenchDnd>
      <StatusBar />
    </SidebarProvider>
  );
}
