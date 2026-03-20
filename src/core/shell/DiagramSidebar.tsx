import { useState, useRef, useCallback } from "react";
import { useNavigate, useLocation, matchPath } from "react-router";
import {
  Files,
  Blocks,
  Compass,
  ChevronRight,
  Settings,
  PlugZap,
  Palette,
  Sun,
  Moon,
  Monitor,
  Bot,
  BookOpen,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { useThemeStore } from "@/stores/themeStore";
import { usePluginSidebarResources } from "@/plugins/hooks/usePluginSidebarResources";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Sidebar as SidebarPrimitive,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from "@/shared/components/ui/sidebar";
import { ExplorerPanel } from "./panels/ExplorerPanel";
import { PluginsPanel } from "./panels/PluginsPanel";
import { NavigationPanel } from "./panels/NavigationPanel";
import { AIChatPanel } from "@/features/ai-chat/AIChatPanel";
import { LibraryBrowserPanel } from "@/features/library-browser/LibraryBrowserPanel";

const COMPACT_THRESHOLD = 100;

type Panel = "explorer" | "plugins" | "navigation" | "ai-chat" | "library";

interface PanelTab {
  id: Panel;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const PANEL_TABS: PanelTab[] = [
  { id: "explorer", icon: Files, label: "Explorador" },
  { id: "plugins", icon: Blocks, label: "Plugins" },
  { id: "navigation", icon: Compass, label: "Navegación" },
  { id: "ai-chat", icon: Bot, label: "AI Chat" },
  { id: "library", icon: BookOpen, label: "Libraries" },
];

const DiagramSidebar = () => {
  const [activePanel, setActivePanel] = useState<Panel>("explorer");
  const prevWidthRef = useRef<number | null>(null);

  const { sidebarWidth, setSidebarWidth } = useSidebar();
  const isCompact = sidebarWidth < COMPACT_THRESHOLD;

  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isOnSettings = Boolean(matchPath({ path: "/settings", end: false }, pathname));
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const { pluginSections, pluginFooterActions } = usePluginSidebarResources();

  const toggleCompact = useCallback(() => {
    if (isCompact) {
      setSidebarWidth(prevWidthRef.current ?? 210);
    } else {
      prevWidthRef.current = sidebarWidth;
      setSidebarWidth(50);
    }
  }, [isCompact, sidebarWidth, setSidebarWidth]);

  const visibleTabs = PANEL_TABS.filter((t) => t.id !== "plugins" || pluginSections.length > 0);

  const resolvedPanel = visibleTabs.some((t) => t.id === activePanel) ? activePanel : "explorer";

  return (
    <SidebarPrimitive
      collapsible="offcanvas"
      className="h-full bg-background border-r border-border/50 outline-none focus-within:ring-1 focus-within:ring-inset focus-within:ring-muted-foreground/40"
      data-panel="sidebar"
      tabIndex={-1}
    >
      {/* Header: UN solo flex container, sin anidación de dirección */}
      <div
        className={cn(
          "flex gap-0.5 p-1.5 border-b border-border/50 shrink-0",
          isCompact ? "flex-col items-center" : "flex-row items-center"
        )}
      >
        <TooltipWrapper tooltip={isCompact ? "Expandir" : "Colapsar"} side="right">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCompact}
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-200",
                !isCompact && "rotate-180"
              )}
            />
          </Button>
        </TooltipWrapper>

        {/* Separador visual entre toggle y tabs — solo en expanded */}
        {!isCompact && <div className="w-px h-4 bg-border/60 shrink-0" />}

        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = resolvedPanel === tab.id;
          return (
            <TooltipWrapper key={tab.id} tooltip={tab.label} side="right">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setActivePanel(tab.id)}
                className={cn(
                  "size-7 shrink-0",
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
              </Button>
            </TooltipWrapper>
          );
        })}
      </div>

      {/* Content: siempre en DOM con flex-1 para mantener el footer abajo.
          El contenido interno se oculta en compact. */}
      <SidebarContent className="p-0">
        {!isCompact && (
          <>
            {resolvedPanel === "explorer" && <ExplorerPanel />}
            {resolvedPanel === "plugins" && <PluginsPanel />}
            {resolvedPanel === "navigation" && <NavigationPanel />}
            {resolvedPanel === "ai-chat" && <AIChatPanel />}
            {resolvedPanel === "library" && <LibraryBrowserPanel />}
          </>
        )}
      </SidebarContent>

      {/* Footer: siempre al fondo gracias al flex-1 del SidebarContent */}
      <SidebarFooter className="border-t border-border/50 p-1.5 shrink-0">
        <div
          className={cn(
            "flex gap-0.5",
            isCompact ? "flex-col items-center" : "flex-row items-center"
          )}
        >
          <TooltipWrapper tooltip="Settings" side="right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-7",
                    isOnSettings
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Settings className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-56" sideOffset={8}>
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => navigate("/settings")}>
                    <Settings className="mr-2 size-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/settings/plugins")}>
                    <PlugZap className="mr-2 size-4" />
                    <span>Plugin Administration</span>
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Palette className="mr-2 size-4" />
                      <span>Theme</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        onClick={() => setTheme("light")}
                        className={cn(theme === "light" && "bg-accent text-accent-foreground")}
                      >
                        <Sun className="mr-2 size-4" /> Light
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setTheme("dark")}
                        className={cn(theme === "dark" && "bg-accent text-accent-foreground")}
                      >
                        <Moon className="mr-2 size-4" /> Dark
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setTheme("system")}
                        className={cn(theme === "system" && "bg-accent text-accent-foreground")}
                      >
                        <Monitor className="mr-2 size-4" /> System
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuGroup>

                {pluginFooterActions.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      {pluginFooterActions.map((action) => {
                        const Icon = action.icon;
                        if (action.submenu && action.submenu.length > 0) {
                          return (
                            <DropdownMenuSub key={action.id}>
                              <DropdownMenuSubTrigger
                                className={cn(
                                  action.destructive && "text-destructive focus:text-destructive"
                                )}
                              >
                                {Icon && <Icon className="mr-2 size-4" />}
                                <span>{action.label}</span>
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                {action.submenu.map((item) => {
                                  const ItemIcon = item.icon;
                                  return (
                                    <DropdownMenuItem
                                      key={item.id}
                                      onClick={item.onClick}
                                      className={cn(
                                        item.isActive && "bg-accent text-accent-foreground"
                                      )}
                                    >
                                      {ItemIcon && <ItemIcon className="mr-2 size-4" />}
                                      <span>{item.label}</span>
                                    </DropdownMenuItem>
                                  );
                                })}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          );
                        }
                        return (
                          <DropdownMenuItem
                            key={action.id}
                            onClick={action.onClick}
                            className={cn(
                              action.destructive && "text-destructive focus:text-destructive"
                            )}
                          >
                            {Icon && <Icon className="mr-2 size-4" />}
                            <span>{action.label}</span>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuGroup>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </TooltipWrapper>
        </div>
      </SidebarFooter>
    </SidebarPrimitive>
  );
};

export default DiagramSidebar;
