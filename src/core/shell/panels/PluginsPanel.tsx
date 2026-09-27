import { useNavigate } from "react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { usePluginSidebarResources } from "@/plugins/hooks/usePluginSidebarResources";
import { useState } from "react";

export const PluginsPanel = () => {
  const { pluginSections } = usePluginSidebarResources();
  const [expanded, setExpanded] = useState<string[]>([]);
  const navigate = useNavigate();

  if (pluginSections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <p className="text-xs text-muted-foreground">No hay plugins activos con paneles</p>
      </div>
    );
  }

  const toggle = (id: string) =>
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        {pluginSections.map((section) => {
          const Icon = section.icon;
          const isExpanded = expanded.includes(section.id);
          const visibleItems = section.items.filter((r) => r.showSidebar);
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.id}>
              <Button
                variant="ghost"
                onClick={() => toggle(section.id)}
                className="flex items-center justify-between w-full h-7 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <div className="flex items-center gap-1.5">
                  {Icon && <Icon className="size-3.5 shrink-0" />}
                  <span className="uppercase tracking-wide text-[10px]">{section.label}</span>
                </div>
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform duration-150",
                    isExpanded && "rotate-90"
                  )}
                />
              </Button>

              {isExpanded &&
                visibleItems.map((route) => {
                  const RouteIcon = route.icon;
                  return (
                    <Button
                      key={route.id}
                      variant="ghost"
                      onClick={() => navigate(route.path || "#")}
                      className="flex items-center gap-1.5 w-full justify-start h-7 px-3 pl-7 text-xs text-foreground/80"
                    >
                      {RouteIcon && (
                        <RouteIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{route.name}</span>
                    </Button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
};
