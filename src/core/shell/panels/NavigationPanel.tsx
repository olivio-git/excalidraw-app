import { useNavigate, useLocation, matchPath } from "react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { protectedRoutes } from "@/core/routing/route-config";
import { useState } from "react";

export const NavigationPanel = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [expanded, setExpanded] = useState<string[]>([]);

  const visibleRoutes = protectedRoutes.filter((r) => r.showSidebar);

  const isActive = (path: string) => Boolean(matchPath({ path, end: true }, pathname));

  const isParentActive = (subPaths: string[]) =>
    subPaths.some((p) => Boolean(matchPath({ path: p, end: false }, pathname)));

  const toggle = (name: string) =>
    setExpanded((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        {visibleRoutes.map((route) => {
          const Icon = route.icon;
          const hasSubRoutes = route.subRoutes && route.subRoutes.length > 0;
          const isExpanded = expanded.includes(route.name);
          const subPaths = route.subRoutes?.map((s) => s.path ?? "") ?? [];
          const parentActive = hasSubRoutes && isParentActive(subPaths);

          if (route.isHeader && hasSubRoutes) {
            return (
              <div key={route.id}>
                <Button
                  variant="ghost"
                  onClick={() => toggle(route.name)}
                  className={cn(
                    "flex items-center justify-between w-full h-7 px-3 text-xs font-medium hover:text-foreground",
                    parentActive && !isExpanded ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {Icon && <Icon className="size-3.5 shrink-0" />}
                    <span className="uppercase tracking-wide text-[10px]">{route.name}</span>
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
                          onClick={() => navigate(sub.path!)}
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
                          <span className="truncate">{sub.name}</span>
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
                onClick={() => navigate(route.path!)}
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
                <span className="truncate">{route.name}</span>
              </Button>
            );
          }

          return null;
        })}
      </div>
    </ScrollArea>
  );
};
