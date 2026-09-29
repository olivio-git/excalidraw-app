import { useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Settings, PlugZap, Palette, Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { useTabStore } from "@/core/tabs/store/tab-store";
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
import { PluginManager } from "@/plugins/plugin-manager";
import { viewRegistry } from "@/core/layout/view-registry";
import { useLayoutStore } from "@/core/layout/layout-store";
import { ViewPart } from "@/core/layout/ViewPart";
import { PLUGINS_VIEW } from "./builtin-views";

const COMPACT_THRESHOLD = 100;

/** Registers the Plugins view only while plugins contribute sidebar sections. */
function usePluginsView(hasSections: boolean) {
  useEffect(() => (hasSections ? viewRegistry.register(PLUGINS_VIEW) : undefined), [hasSections]);
}

const DiagramSidebar = () => {
  const { t } = useTranslation("common");
  const prevWidthRef = useRef<number | null>(null);
  const sidebarSide = useLayoutStore((s) => s.sidebarSide);

  const { sidebarWidth, setSidebarWidth, toggleSidebar, open, setOpen } = useSidebar();

  // Core commands are registered before plugins activate; React only handles the UI event.
  const toggleSidebarRef = useRef(toggleSidebar);
  useEffect(() => {
    toggleSidebarRef.current = toggleSidebar;
  }, [toggleSidebar]);

  useEffect(() => {
    const handleToggle = () => {
      toggleSidebarRef.current();
    };
    window.addEventListener("workbench:toggle-sidebar", handleToggle);
    return () => window.removeEventListener("workbench:toggle-sidebar", handleToggle);
  }, []);
  const isCompact = sidebarWidth < COMPACT_THRESHOLD;

  // The sidebar provider owns visibility; mirror it so views know whether they show.
  useEffect(() => {
    if (useLayoutStore.getState().parts.primary.open !== open) {
      useLayoutStore.setState((state) => ({
        parts: { ...state.parts, primary: { ...state.parts.primary, open } },
      }));
    }
  }, [open]);

  // Revealing a view here (command, drop, extension) opens and expands the side bar.
  const reveal = useLayoutStore((s) => s.parts.primary.reveal);
  const lastReveal = useRef(reveal);
  useEffect(() => {
    if (reveal === lastReveal.current) return;
    lastReveal.current = reveal;
    setOpen(true);
    if (sidebarWidth < COMPACT_THRESHOLD) setSidebarWidth(prevWidthRef.current ?? 210);
  }, [reveal, setOpen, sidebarWidth, setSidebarWidth]);

  // From the tab store (a boolean), not useLocation(): the URL changes on every
  // tab switch, which re-rendered the whole sidebar and file tree.
  const isOnSettings = useTabStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.routeId === "settings"
  );
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const { pluginSections, pluginFooterActions } = usePluginSidebarResources();
  usePluginsView(pluginSections.length > 0);

  const toggleCompact = useCallback(() => {
    if (isCompact) {
      setSidebarWidth(prevWidthRef.current ?? 210);
    } else {
      prevWidthRef.current = sidebarWidth;
      setSidebarWidth(50);
    }
  }, [isCompact, sidebarWidth, setSidebarWidth]);

  return (
    <SidebarPrimitive
      collapsible="offcanvas"
      side={sidebarSide}
      className={cn(
        "h-full bg-background border-border/50 outline-none focus-within:ring-1 focus-within:ring-inset focus-within:ring-muted-foreground/40",
        sidebarSide === "left" ? "border-r" : "border-l"
      )}
      data-panel="sidebar"
      tabIndex={-1}
    >
      <SidebarContent className="p-0">
        <ViewPart
          location="primary"
          variant="sidebar"
          compact={isCompact}
          headerStart={
            <>
              <TooltipWrapper
                tooltip={isCompact ? t("sidebar.expand") : t("sidebar.collapse")}
                side={sidebarSide === "left" ? "right" : "left"}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleCompact}
                  className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 transition-transform duration-200",
                      !isCompact === (sidebarSide === "left") && "rotate-180"
                    )}
                  />
                </Button>
              </TooltipWrapper>
              {/* Separador visual entre toggle y tabs — solo en expanded */}
              {!isCompact && <div className="w-px h-4 bg-border/60 shrink-0" />}
            </>
          }
        />
      </SidebarContent>

      {/* Footer: siempre al fondo gracias al flex-1 del SidebarContent */}
      <SidebarFooter className="border-t border-border/50 p-1.5 shrink-0">
        <div
          className={cn(
            "flex gap-0.5",
            isCompact ? "flex-col items-center" : "flex-row items-center"
          )}
        >
          <TooltipWrapper tooltip={t("panels.settings")} side="right">
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
                  <DropdownMenuItem
                    onClick={() => PluginManager.executeCommand("workbench.action.openSettings")}
                  >
                    <Settings className="mr-2 size-4" />
                    <span>{t("panels.settings")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => PluginManager.executeCommand("workbench.action.openPluginAdmin")}
                  >
                    <PlugZap className="mr-2 size-4" />
                    <span>{t("panels.pluginAdmin")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Palette className="mr-2 size-4" />
                      <span>{t("panels.theme")}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        onClick={() => setTheme("light")}
                        className={cn(theme === "light" && "bg-accent text-accent-foreground")}
                      >
                        <Sun className="mr-2 size-4" /> {t("panels.themeLight")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setTheme("dark")}
                        className={cn(theme === "dark" && "bg-accent text-accent-foreground")}
                      >
                        <Moon className="mr-2 size-4" /> {t("panels.themeDark")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setTheme("system")}
                        className={cn(theme === "system" && "bg-accent text-accent-foreground")}
                      >
                        <Monitor className="mr-2 size-4" /> {t("panels.themeSystem")}
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
