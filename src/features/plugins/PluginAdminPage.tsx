import { useState } from "react";
import { PlugZap, RotateCcw } from "lucide-react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { PluginManager } from "@/plugins/plugin-manager";
import { usePluginsState } from "@/plugins/hooks/usePluginsState";

export default function PluginAdminPage() {
  const [isToggling, setIsToggling] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const plugins = usePluginsState();

  const handleTogglePlugin = async (id: string, nextActive: boolean) => {
    setIsToggling(id);
    try {
      if (nextActive) {
        await PluginManager.activate(id);
      } else {
        await PluginManager.deactivate(id);
      }
    } finally {
      setIsToggling(null);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Reload external plugins from disk (if any) and ensure all are activated.
      await PluginManager.loadExternalPlugins();
      await PluginManager.activateAll();
    } finally {
      setIsRefreshing(false);
    }
  };

  const activeCount = plugins.filter((p) => p.isActive).length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
            <PlugZap className="size-3.5 text-primary" />
            <span>Plugin Management</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Plugin Administration</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Inspect, activate and deactivate internal and external plugins.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            Installed: <span className="ml-1 font-semibold">{plugins.length}</span>
          </Badge>
          <Badge variant="secondary">
            Active: <span className="ml-1 font-semibold">{activeCount}</span>
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            title="Refresh plugins"
            disabled={isRefreshing}
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </header>

      {plugins.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center text-sm text-muted-foreground">
          <p className="font-medium mb-1">No plugins registered yet.</p>
          <p className="text-xs">
            Internal and external plugins will appear here once they are loaded by the application.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plugins.map(({ manifest, isActive }) => (
            <article
              key={manifest.id}
              className="relative flex flex-col gap-3 rounded-xl border border-border bg-card/70 p-4 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold leading-tight">{manifest.name}</h2>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      v{manifest.version}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-3">
                    {manifest.description || "No description provided."}
                  </p>
                </div>
                <Badge
                  variant={isActive ? "default" : "outline"}
                  className="text-[10px] uppercase tracking-wide"
                >
                  {isActive ? "Active" : "Inactive"}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline" className="text-[10px]">
                  ID: {manifest.id}
                </Badge>
                {manifest.author && (
                  <Badge variant="outline" className="text-[10px]">
                    Author: {manifest.author}
                  </Badge>
                )}
                {manifest.dependencies && manifest.dependencies.length > 0 && (
                  <span className="truncate">Depends on: {manifest.dependencies.join(", ")}</span>
                )}
              </div>

              {manifest.commands && manifest.commands.length > 0 && (
                <div className="mt-1 space-y-1">
                  <p className="text-[11px] font-medium text-muted-foreground">Commands</p>
                  <div className="flex flex-wrap gap-1">
                    {manifest.commands.map((cmd) => (
                      <Badge key={cmd.id} variant="outline" className="text-[10px] px-1.5 py-0.5">
                        {cmd.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant={isActive ? "outline" : "default"}
                  onClick={() => handleTogglePlugin(manifest.id, !isActive)}
                  disabled={isToggling === manifest.id}
                  className="gap-1.5"
                >
                  {isActive ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
