import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { FileImage, Palette, PlugZap, RotateCcw, Trash2, Upload } from "lucide-react";

import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { PluginManager } from "@/plugins/plugin-manager";
import { usePluginsState } from "@/plugins/hooks/usePluginsState";
import { setActiveIconTheme, useIconThemeState } from "@/plugins/vscode/icon-theme-service";
import { setActiveColorTheme, useColorThemeState } from "@/plugins/vscode/color-theme-service";
import { installVsixExtension, uninstallVsixExtension } from "@/plugins/vscode/extension-manager";
import type { InstalledExtension } from "@/plugins/vscode/extension-storage";
import { summarizeContributions } from "@/plugins/vscode/contributions";
import { useExtensionHostStore } from "@/plugins/vscode/host/host-store";
import { extensionHost } from "@/plugins/vscode/host/extension-host-service";
import { notify } from "@/shared/lib/notify";
import { ExtensionStore } from "./ExtensionStore";

function ExtensionContributionBadges({ extension }: { extension: InstalledExtension }) {
  const parts = summarizeContributions(extension);
  const active = useExtensionHostStore((s) => s.activated.includes(extension.id));
  const failure = useExtensionHostStore((s) => s.failed[extension.id]);
  if (parts.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1" aria-label="Aportes de la extensión">
      {extension.main && (active || failure) && (
        <span
          title={failure}
          className={
            failure
              ? "rounded border border-destructive/40 bg-destructive/10 px-1.5 py-px text-[10px] text-destructive"
              : "rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-px text-[10px] text-emerald-600 dark:text-emerald-400"
          }
        >
          {failure ? "error al activar" : "activa"}
        </span>
      )}
      {parts.map((part) => (
        <span
          key={part}
          className="rounded border border-border/60 bg-muted/50 px-1.5 py-px text-[10px] text-muted-foreground"
        >
          {part}
        </span>
      ))}
    </div>
  );
}

function ExtensionHostButton() {
  const status = useExtensionHostStore((s) => s.status);
  const error = useExtensionHostStore((s) => s.error);
  if (status === "idle" || status === "unavailable") return null;
  return (
    <Button
      size="sm"
      variant="outline"
      title={error ?? undefined}
      disabled={status === "starting"}
      onClick={() => void extensionHost.restart()}
    >
      <RotateCcw className="mr-1 size-3.5" />
      {status === "starting" ? "Iniciando…" : "Reiniciar Extension Host"}
    </Button>
  );
}

export default function PluginAdminPage() {
  const [isToggling, setIsToggling] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const iconThemeState = useIconThemeState();
  const colorThemeState = useColorThemeState();
  const plugins = usePluginsState();

  const handleInstallVsix = async () => {
    const selected = await open({ filters: [{ name: "VS Code Extension", extensions: ["vsix"] }] });
    if (!selected || Array.isArray(selected)) return;
    setIsInstalling(true);
    try {
      const extension = await installVsixExtension(await readFile(selected));
      notify(`${extension.displayName} instalado y activado`, { type: "success" });
    } catch (error) {
      console.error("Failed to install VSIX extension", error);
      notify("No se pudo instalar la extensión", { type: "error", description: String(error) });
    } finally {
      setIsInstalling(false);
    }
  };

  const handleActivateIconTheme = async (key: string | null, label?: string) => {
    try {
      await setActiveIconTheme(key);
      notify(key ? `Tema activo: ${label}` : "Tema de iconos desactivado", {
        type: key ? "success" : "info",
      });
    } catch (error) {
      notify("No se pudo cambiar el tema de iconos", { type: "error", description: String(error) });
    }
  };

  const handleActivateColorTheme = async (key: string | null, label?: string) => {
    try {
      await setActiveColorTheme(key);
      notify(key ? `Tema de color activo: ${label}` : "Tema de color desactivado", {
        type: key ? "success" : "info",
      });
    } catch (error) {
      notify("No se pudo cambiar el tema de color", { type: "error", description: String(error) });
    }
  };

  const handleUninstallExtension = async (id: string, name: string) => {
    try {
      await uninstallVsixExtension(id);
      notify(`${name} desinstalado`, { type: "info" });
    } catch (error) {
      notify("No se pudo desinstalar la extensión", { type: "error", description: String(error) });
    }
  };

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
    <div className="h-full overflow-y-auto">
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
              variant="outline"
              size="sm"
              onClick={() => void handleInstallVsix()}
              disabled={isInstalling}
              className="gap-2"
            >
              <Upload className="size-4" />
              Instalar VSIX
            </Button>
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

        {iconThemeState.extensions.length > 0 && (
          <section className="rounded-xl border border-border bg-card/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Extensiones VS Code instaladas</h2>
              <div className="flex gap-2">
                <ExtensionHostButton />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!colorThemeState.activeKey}
                  onClick={() => void handleActivateColorTheme(null)}
                >
                  Desactivar tema de color
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!iconThemeState.activeKey}
                  onClick={() => void handleActivateIconTheme(null)}
                >
                  Desactivar tema de iconos
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {iconThemeState.extensions.map((extension) => (
                <div
                  key={extension.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2"
                >
                  <div className="mr-auto min-w-0">
                    <p className="text-sm font-medium leading-tight">
                      {extension.displayName}
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        v{extension.version}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{extension.id}</p>
                    <ExtensionContributionBadges extension={extension} />
                  </div>
                  {colorThemeState.themes
                    .filter((theme) => theme.extension.id === extension.id)
                    .map((theme) => {
                      const isActive = colorThemeState.activeKey === theme.key;
                      return (
                        <Button
                          key={theme.key}
                          size="sm"
                          variant={isActive ? "outline" : "ghost"}
                          disabled={isActive}
                          title="Tema de color"
                          className="gap-1.5"
                          onClick={() => void handleActivateColorTheme(theme.key, theme.label)}
                        >
                          <Palette className="size-3.5" />
                          {theme.label}
                          {isActive ? " · Activo" : ""}
                        </Button>
                      );
                    })}
                  {iconThemeState.themes
                    .filter((theme) => theme.extension.id === extension.id)
                    .map((theme) => {
                      const isActive = iconThemeState.activeKey === theme.key;
                      return (
                        <Button
                          key={theme.key}
                          size="sm"
                          variant={isActive ? "outline" : "ghost"}
                          disabled={isActive}
                          title="Tema de iconos"
                          className="gap-1.5"
                          onClick={() => void handleActivateIconTheme(theme.key, theme.label)}
                        >
                          <FileImage className="size-3.5" />
                          {theme.label}
                          {isActive ? " · Activo" : ""}
                        </Button>
                      );
                    })}
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Desinstalar"
                    onClick={() =>
                      void handleUninstallExtension(extension.id, extension.displayName)
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        <ExtensionStore />

        {plugins.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center text-sm text-muted-foreground">
            <p className="font-medium mb-1">No plugins registered yet.</p>
            <p className="text-xs">
              Internal and external plugins will appear here once they are loaded by the
              application.
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
                  <Badge variant="outline" className="shrink-0 gap-1.5 text-[11px] font-normal">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 rounded-full",
                        isActive ? "bg-emerald-500" : "bg-muted-foreground/40"
                      )}
                    />
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
    </div>
  );
}
