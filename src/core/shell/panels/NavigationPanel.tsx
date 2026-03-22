import { useNavigate, useLocation, matchPath } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { protectedRoutes } from "@/core/routing/route-config";
import { PluginManager } from "@/plugins/plugin-manager";
import { useState } from "react";
import type { RouteConfig } from "@/core/routing/types";

export const NavigationPanel = () => {
  const { t } = useTranslation("commands");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [expanded, setExpanded] = useState<string[]>([]);

  const visibleRoutes = protectedRoutes.filter((r) => r.showSidebar);

  const isActive = (path: string) => Boolean(matchPath({ path, end: true }, pathname));

  const isParentActive = (subPaths: string[]) =>
    subPaths.some((p) => Boolean(matchPath({ path: p, end: false }, pathname)));

  // Use route.id as state key (stable) instead of route.name (translatable)
  const toggle = (id: string) =>
    setExpanded((prev) => (prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]));

  const openRoute = (route: RouteConfig) => {
    if (route.commandId) {
      PluginManager.executeCommand(route.commandId);
    } else if (route.path) {
      navigate(route.path);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        {visibleRoutes.map((route) => {
          const Icon = route.icon;
          const hasSubRoutes = route.subRoutes && route.subRoutes.length > 0;
          const isExpanded = expanded.includes(route.id);
          const subPaths = route.subRoutes?.map((s) => s.path ?? "") ?? [];
          const parentActive = hasSubRoutes && isParentActive(subPaths);

          if (route.isHeader && hasSubRoutes) {
            return (
              <div key={route.id}>
                <Button
                  variant="ghost"
                  onClick={() => toggle(route.id)}
                  className={cn(
                    "flex items-center justify-between w-full h-7 px-3 text-xs font-medium hover:text-foreground",
                    parentActive && !isExpanded ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {Icon && <Icon className="size-3.5 shrink-0" />}
                    <span className="uppercase tracking-wide text-[10px]">
                      {t(`routes.${route.id}`, { defaultValue: route.name })}
                    </span>
                    {parentActive && !isExpanded && (
                      <span className="size-1.5 rounded-full bg-primary shrink-0" />
                    )}
                  </div>
                  <ChevronRight
                    className={cn(
                      "size-3 transition-transform duration-150",
                      isExpanded && "rotate-90"
                    )}
                  />
                </Button>

                {isExpanded &&
                  route.subRoutes
                    ?.filter((s) => s.showSidebar && s.path)
                    .map((sub) => {
                      const SubIcon = sub.icon;
                      const active = isActive(sub.path!);
                      return (
                        <Button
                          key={sub.id}
                          variant="ghost"
                          onClick={() => openRoute(sub)}
                          className={cn(
                            "flex items-center gap-1.5 w-full justify-start h-7 px-3 pl-7 text-xs",
                            active
                              ? "bg-accent text-foreground font-medium"
                              : "text-foreground/80 hover:text-foreground"
                          )}
                        >
                          {SubIcon && (
                            <SubIcon
                              className={cn(
                                "size-3.5 shrink-0",
                                active ? "text-foreground" : "text-muted-foreground"
                              )}
                            />
                          )}
                          <span className="truncate">
                            {t(`routes.${sub.id}`, { defaultValue: sub.name })}
                          </span>
                        </Button>
                      );
                    })}
              </div>
            );
          }

          if (route.path) {
            const active = isActive(route.path);
            return (
              <Button
                key={route.id}
                variant="ghost"
                onClick={() => openRoute(route)}
                className={cn(
                  "flex items-center gap-1.5 w-full justify-start h-7 px-3 text-xs",
                  active
                    ? "bg-accent text-foreground font-medium"
                    : "text-foreground/80 hover:text-foreground"
                )}
              >
                {Icon && (
                  <Icon
                    className={cn(
                      "size-3.5 shrink-0",
                      active ? "text-foreground" : "text-muted-foreground"
                    )}
                  />
                )}
                <span className="truncate">
                  {t(`routes.${route.id}`, { defaultValue: route.name })}
                </span>
              </Button>
            );
          }

          return null;
        })}
      </div>
    </ScrollArea>
  );
};
