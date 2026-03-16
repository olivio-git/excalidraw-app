import {
  Sidebar as SidebarPrimitive,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/shared/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/core/auth/store/auth-store";
import { useThemeStore } from "@/stores/themeStore";
import { useTabStore } from "@/core/tabs/store/tab-store";
import type { RouteConfig } from "@/core/routing/types";
import type { SidebarSection } from "@/plugins/types";
import {
  ChevronRight,
  LogOut,
  Settings,
  SquarePlus,
  CopyMinus,
  Puzzle,
  Palette,
  Sun,
  Moon,
  Monitor,
  PlugZap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, matchPath, useLocation, useNavigate } from "react-router";

import { usePluginSidebarResources } from "@/plugins/hooks/usePluginSidebarResources";
// import ThemeToggle from "@/shared/common/ThemeToggle";

// Section footer

// Constants for plugin section resizing
const PLUGINS_HEIGHT_DEFAULT = 200;
const PLUGINS_HEIGHT_MIN = 80;
const PLUGINS_HEIGHT_MAX = 500;
const COMPACT_THRESHOLD = 100;

// NavItem
const NavItem = ({
  href,
  icon: Icon,
  children,
  handleNavigation,
  badge,
  isCompact,
  className,
}: {
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  handleNavigation: () => void;
  badge?: number | null;
  isCompact?: boolean;
  className?: string;
}) => {
  const { pathname } = useLocation();
  const tabs = useTabStore((s) => s.tabs);
  const urlMatches = Boolean(matchPath({ path: href, end: true }, pathname));
  const isActive = urlMatches && tabs.some((t) => t.path === href);

  const link = (
    <Link
      to={href}
      onClick={handleNavigation}
      className={cn(
        "flex items-center w-full gap-2 text-sm transition-all h-full",
        isCompact ? "justify-center p-2" : className || "px-4 py-2",
        isActive
          ? "bg-secondary text-primary font-semibold"
          : "text-foreground hover:bg-secondary hover:text-secondary-foreground"
      )}
      title={typeof children === "string" ? children : undefined}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {!isCompact && (
        <>
          <span className="flex-1 truncate block min-w-0">{children}</span>
          {badge !== null && badge !== undefined && badge > 0 && (
            <Badge
              variant="destructive"
              className="h-5 w-5 flex items-center justify-center p-0 text-xs shrink-0"
            >
              {badge}
            </Badge>
          )}
        </>
      )}
    </Link>
  );

  if (isCompact) {
    return link;
  }

  return link;
};

// HeaderTagRoute
const HeaderTagRoute = ({
  route,
  expandedHeaders,
  toggleHeader,
  handleNavigation,
  isCompact,
}: {
  route: RouteConfig;
  expandedHeaders: string[];
  toggleHeader: (headerName: string) => void;
  handleNavigation: () => void;
  isCompact?: boolean;
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const hasSubRoutes = route.subRoutes && route.subRoutes.length > 0;

  const isInSubRoute = hasSubRoutes
    ? (route.subRoutes ?? []).some(
        (sub) => sub.path && matchPath({ path: sub.path, end: false }, location.pathname)
      )
    : false;

  const isExpanded = expandedHeaders.includes(route.name);

  if (!route.showSidebar) return null;

  // Leaf route
  if (!route.isHeader) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild>
          <NavItem
            href={route.path || "/"}
            icon={route.icon}
            handleNavigation={handleNavigation}
            isCompact={isCompact}
          >
            {route.name}
          </NavItem>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  // Header/collapsible — compact: icon only, no expansion
  if (isCompact) {
    // Header con subrutas: mostramos un único icono que despliega un dropdown
    // con las subrutas, similar al botón de Settings del footer.
    if (hasSubRoutes) {
      const Icon = route.icon;

      return (
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                className="flex items-center justify-center p-2 transition-colors bg-primary/90 text-primary-foreground hover:bg-primary/80"
                title={route.name}
              >
                {Icon ? (
                  <Icon className="size-4 flex-shrink-0" />
                ) : (
                  <span className="size-4 rounded-full bg-primary-foreground/30" />
                )}
              </SidebarMenuButton>
            </DropdownMenuTrigger>

            <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-56">
              <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wider">
                {route.name}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {route.subRoutes
                ?.filter((sub) => sub.showSidebar && sub.path)
                .map((sub, i) => {
                  const SubIcon = sub.icon;
                  return (
                    <DropdownMenuItem
                      key={`${route.name}-${sub.path}-${i}`}
                      onClick={() => {
                        handleNavigation();
                        navigate(sub.path || "#");
                      }}
                    >
                      {SubIcon && <SubIcon className="mr-2 size-4" />}
                      <span>{sub.name}</span>
                    </DropdownMenuItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      );
    }

    // Header sin subrutas: mantenemos el comportamiento actual de solo icono.
    const Icon = route.icon;
    const button = (
      <SidebarMenuButton
        onClick={() => toggleHeader(route.name)}
        className="flex items-center justify-center p-2 transition-colors bg-primary/90 text-primary-foreground hover:bg-primary/80"
        title={route.name}
      >
        {Icon ? (
          <Icon className="size-4 flex-shrink-0" />
        ) : (
          <span className="size-4 rounded-full bg-primary-foreground/30" />
        )}
      </SidebarMenuButton>
    );

    return <SidebarMenuItem>{button}</SidebarMenuItem>;
  }

  // Header/collapsible — full mode
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => toggleHeader(route.name)}
        className={cn(
          "flex items-center justify-between px-4 py-2 text-sm font-medium cursor-pointer transition-colors",
          "bg-primary/90 text-primary-foreground hover:bg-primary/80"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          {route.icon && <route.icon className="h-4 w-4 flex-shrink-0" />}
          <span className="text-xs font-semibold uppercase tracking-wider truncate">
            {route.name}
          </span>
          {isInSubRoute && !isExpanded && (
            <span className="h-2 w-2 rounded-full bg-primary-foreground animate-pulse flex-shrink-0" />
          )}
        </div>
        {hasSubRoutes && (
          <ChevronRight
            className={cn(
              "size-4 flex-shrink-0 transition-transform duration-200",
              isExpanded && "rotate-90"
            )}
          />
        )}
      </SidebarMenuButton>

      {hasSubRoutes && isExpanded && (
        <SidebarMenuSub className="m-0 border-none p-0">
          {route.subRoutes
            ?.filter((sub) => sub.showSidebar && sub.path)
            .map((sub, i) => (
              <SidebarMenuSubItem key={`${sub.path}-${i}`}>
                <SidebarMenuSubButton asChild>
                  <NavItem
                    href={sub.path || "#"}
                    icon={sub.icon}
                    handleNavigation={handleNavigation}
                    className="pl-8 pr-4 py-2"
                  >
                    {sub.name}
                  </NavItem>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
};

// PluginSectionItem
const PluginSectionItem = ({
  section,
  isExpanded,
  onToggle,
  handleNavigation,
  isCompact,
}: {
  section: SidebarSection;
  isExpanded: boolean;
  onToggle: () => void;
  handleNavigation: () => void;
  isCompact?: boolean;
}) => {
  const navigate = useNavigate();
  const visibleItems = section.items.filter((r) => r.showSidebar);
  if (visibleItems.length === 0) return null;

  const Icon = section.icon ?? Puzzle;

  // Compact: un solo icono por sección de plugin, que abre un dropdown
  // con todas las rutas registradas en esa sección.
  if (isCompact) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="flex items-center justify-center p-2 transition-colors hover:bg-accent"
              title={section.label}
            >
              <Icon className="size-4 flex-shrink-0 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-56">
            <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wider">
              {section.label}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {visibleItems.map((route, i) => {
              const RouteIcon = route.icon ?? Icon;
              return (
                <DropdownMenuItem
                  key={`${route.id}-${i}`}
                  onClick={() => {
                    handleNavigation();
                    navigate(route.path || "#");
                  }}
                >
                  <RouteIcon className="mr-2 size-4" />
                  <span>{route.name}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  // Full mode
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={onToggle}
        className="flex items-center justify-between px-4 py-2 text-sm cursor-pointer transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="size-4 flex-shrink-0 text-muted-foreground" />
          <span className="text-xs font-medium truncate">{section.label}</span>
        </div>
        <ChevronRight
          className={cn(
            "size-3.5 flex-shrink-0 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />
      </SidebarMenuButton>

      {isExpanded && (
        <SidebarMenuSub className="m-0 border-none p-0">
          {visibleItems.map((route, i) => (
            <SidebarMenuSubItem key={`${route.id}-${i}`}>
              <SidebarMenuSubButton asChild>
                <NavItem
                  href={route.path || "#"}
                  icon={route.icon}
                  handleNavigation={handleNavigation}
                >
                  {route.name}
                </NavItem>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
};

// Main AppSidebar
interface AppSidebarProps {
  routes: RouteConfig[];
}

const AppSidebar = ({ routes }: AppSidebarProps) => {
  const [expandedHeaders, setExpandedHeaders] = useState<string[]>([]);
  const [expandedPlugins, setExpandedPlugins] = useState<string[]>([]);
  const [pluginsCollapsed, setPluginsCollapsed] = useState(false);
  const [pluginsHeight, setPluginsHeight] = useState(PLUGINS_HEIGHT_DEFAULT);
  const [prevSidebarWidth, setPrevSidebarWidth] = useState<number | null>(null);

  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const isDragging = useRef(false);

  const { setOpenMobile, isMobile, sidebarWidth, setSidebarWidth } = useSidebar();
  const isCompact = sidebarWidth < COMPACT_THRESHOLD;

  const logout = useAuthStore((s) => s.logout);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const closeAllTabs = useTabStore((s) => s.closeAllTabs);
  const navigate = useNavigate();

  const filteredRoutes = useMemo(() => routes.filter((r) => r.showSidebar), [routes]);

  // Plugin sidebar sections and footer actions from registered plugins
  const { pluginSections, pluginFooterActions } = usePluginSidebarResources();

  const handleNavigation = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const handleLogout = useCallback(() => {
    closeAllTabs();
    logout();
  }, [closeAllTabs, logout]);

  const toggleHeader = useCallback((headerName: string) => {
    setExpandedHeaders((prev) =>
      prev.includes(headerName) ? prev.filter((n) => n !== headerName) : [...prev, headerName]
    );
  }, []);

  const togglePlugin = useCallback((sectionId: string) => {
    setExpandedPlugins((prev) =>
      prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId]
    );
  }, []);

  const toggleExpandCollapse = useCallback(() => {
    if (expandedHeaders.length > 0) {
      setExpandedHeaders([]);
    } else {
      const allHeaders = filteredRoutes
        .filter((r) => r.isHeader && r.subRoutes?.length)
        .map((r) => r.name);
      setExpandedHeaders(allHeaders);
    }
  }, [expandedHeaders, filteredRoutes]);

  const toggleCompactWidth = useCallback(() => {
    // Si ya estamos en modo compacto (solo iconos), restauramos el ancho previo
    if (sidebarWidth < COMPACT_THRESHOLD) {
      const nextWidth = prevSidebarWidth ?? 210;
      setSidebarWidth(nextWidth);
      return;
    }

    // Estamos en modo "normal": guardamos el ancho actual y colapsamos a iconos
    setPrevSidebarWidth(sidebarWidth);
    // Usamos el mínimo definido en el componente base del sidebar (50px)
    setSidebarWidth(50);
  }, [sidebarWidth, prevSidebarWidth, setSidebarWidth]);

  const handleDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartHeight.current = pluginsHeight;
    },
    [pluginsHeight]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartY.current - e.clientY;
      const next = Math.max(
        PLUGINS_HEIGHT_MIN,
        Math.min(PLUGINS_HEIGHT_MAX, dragStartHeight.current + delta)
      );
      setPluginsHeight(next);
    };
    const onMouseUp = () => {
      isDragging.current = false;
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <SidebarPrimitive collapsible="offcanvas" className="h-full bg-background">
      {/* Navigation */}
      <SidebarContent className="bg-sidebar">
        <SidebarGroup>
          <div className="flex items-center justify-between px-1 mt-2 mb-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-accent flex-shrink-0"
              onClick={toggleCompactWidth}
              title={isCompact ? "Expandir sidebar" : "Colapsar a solo iconos"}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform",
                  isCompact && "rotate-180"
                )}
              />
            </Button>

            {!isCompact && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-accent flex-shrink-0"
                onClick={toggleExpandCollapse}
                title={expandedHeaders.length > 0 ? "Collapse all" : "Expand all"}
              >
                {expandedHeaders.length > 0 ? (
                  <CopyMinus className="h-3.5! w-3.5! transform scale-x-[-1] text-muted-foreground" />
                ) : (
                  <SquarePlus className="h-3.5! w-3.5! text-muted-foreground" />
                )}
              </Button>
            )}
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredRoutes.map((route, index) => (
                <HeaderTagRoute
                  key={`${route.name}-${index}`}
                  route={route}
                  expandedHeaders={expandedHeaders}
                  toggleHeader={toggleHeader}
                  handleNavigation={handleNavigation}
                  isCompact={isCompact}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Plugins panel */}
      {pluginSections.length > 0 && (
        <div
          className="flex flex-col flex-shrink-0 border-t border-border bg-sidebar"
          style={{ height: pluginsCollapsed ? "auto" : pluginsHeight }}
        >
          {!pluginsCollapsed && (
            <div
              onMouseDown={handleDragMouseDown}
              className="h-1.5 w-full cursor-row-resize hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0"
            />
          )}

          <div
            className={cn(
              "flex items-center flex-shrink-0 px-3 py-1.5",
              isCompact ? "justify-center" : "justify-between"
            )}
          >
            {!isCompact && (
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Plugins
              </span>
            )}
            <button
              onClick={() => setPluginsCollapsed((v) => !v)}
              className="p-0.5 rounded hover:bg-accent transition-colors text-muted-foreground"
              title={pluginsCollapsed ? "Expand plugins" : "Collapse plugins"}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform duration-200",
                  !pluginsCollapsed && "rotate-90"
                )}
              />
            </button>
          </div>

          {!pluginsCollapsed && (
            <div className="flex-1 overflow-y-auto pb-1">
              <SidebarMenu>
                {pluginSections.map((section) => (
                  <PluginSectionItem
                    key={section.id}
                    section={section}
                    isExpanded={expandedPlugins.includes(section.id)}
                    onToggle={() => togglePlugin(section.id)}
                    handleNavigation={handleNavigation}
                    isCompact={isCompact}
                  />
                ))}
              </SidebarMenu>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <SidebarFooter className="border-t border-border bg-card bg-sidebar">
        <div
          className={cn("flex items-center justify-end py-2 px-3 gap-1", isCompact && "flex-col")}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors"
                title="Settings"
              >
                <Settings className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56" sideOffset={8}>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    handleNavigation();
                    navigate("/settings");
                  }}
                >
                  <Settings className="mr-2 size-4" />
                  <span>Settings</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    handleNavigation();
                    navigate("/settings/plugins");
                  }}
                >
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
                      <Sun className="mr-2 size-4" />
                      <span>Light</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setTheme("dark")}
                      className={cn(theme === "dark" && "bg-accent text-accent-foreground")}
                    >
                      <Moon className="mr-2 size-4" />
                      <span>Dark</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setTheme("system")}
                      className={cn(theme === "system" && "bg-accent text-accent-foreground")}
                    >
                      <Monitor className="mr-2 size-4" />
                      <span>System</span>
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

          <button
            onClick={handleLogout}
            className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title="Logout"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </SidebarFooter>
    </SidebarPrimitive>
  );
};

export default AppSidebar;
