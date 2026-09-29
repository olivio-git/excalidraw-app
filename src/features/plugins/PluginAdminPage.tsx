import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type React from "react";
import {
  ChevronDown,
  FileImage,
  Palette,
  PlugZap,
  RotateCcw,
  TerminalSquare,
  Trash2,
  Upload,
} from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
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

const NO_THEME = "__none__";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

/** One muted line: host state and what the extension contributes. */
function ExtensionSummary({ extension }: { extension: InstalledExtension }) {
  const parts = summarizeContributions(extension);
  const active = useExtensionHostStore((s) => s.activated.includes(extension.id));
  const failure = useExtensionHostStore((s) => s.failed[extension.id]);
  const state = extension.main && (failure ? "error al activar" : active ? "activa" : null);
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={failure}>
      {state && (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            failure ? "bg-destructive" : "bg-emerald-500"
          )}
        />
      )}
      <span className="truncate">
        {[state, ...parts].filter(Boolean).join(" · ") || extension.id}
      </span>
    </p>
  );
}

interface ThemeOption {
  key: string;
  label: string;
}

/** Pick one of the extension's themes, or none (use the app's). */
function ThemeSelect({
  label,
  icon: Icon,
  themes,
  activeKey,
  onChange,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  themes: ThemeOption[];
  activeKey: string | null;
  onChange: (key: string | null, label?: string) => void;
}) {
  const ownsActive = themes.some((theme) => theme.key === activeKey);
  const items = [
    { value: NO_THEME, label: "Sin usar" },
    ...themes.map((theme) => ({ value: theme.key, label: theme.label })),
  ];
  return (
    <Select
      items={items}
      value={ownsActive ? activeKey : NO_THEME}
      onValueChange={(value) => {
        if (value === NO_THEME) {
          if (ownsActive) onChange(null);
          return;
        }
        onChange(value as string, themes.find((theme) => theme.key === value)?.label);
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="w-44 text-xs" title={label}>
        <Icon className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} className="text-xs">
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The plugin's commands in one menu; picking one runs it. */
function CommandSelect({
  commands,
  disabled,
}: {
  commands: Array<{ id: string; name: string }>;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={<Button variant="outline" size="sm" className="w-32 justify-between text-xs" />}
      >
        <span className="flex items-center gap-1.5">
          <TerminalSquare className="size-3.5 text-muted-foreground" />
          {commands.length} {commands.length === 1 ? "comando" : "comandos"}
        </span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Ejecutar comando</DropdownMenuLabel>
          {commands.map((command) => (
            <DropdownMenuItem
              key={command.id}
              className="text-xs"
              onClick={() => void PluginManager.executeCommand(command.id)}
            >
              <span className="truncate">{command.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExtensionHostButton() {
  const status = useExtensionHostStore((s) => s.status);
  const error = useExtensionHostStore((s) => s.error);
  if (status === "idle" || status === "unavailable") return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      title={error ?? "Reiniciar el Extension Host"}
      disabled={status === "starting"}
      className="text-xs text-muted-foreground"
      onClick={() => void extensionHost.restart()}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "running"
            ? "bg-emerald-500"
            : status === "error"
              ? "bg-destructive"
              : "bg-amber-500"
        )}
      />
      {status === "starting" ? "Iniciando host…" : "Extension Host"}
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
      <div className="mx-auto max-w-5xl space-y-5 px-5 py-4">
        <header className="flex items-center gap-2">
          <PlugZap className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Plugins</h1>
          <span className="text-xs text-muted-foreground">
            {activeCount}/{plugins.length} activos
            {iconThemeState.extensions.length > 0 &&
              ` · ${iconThemeState.extensions.length} extensiones`}
          </span>
          <div className="flex-1" />
          <ExtensionHostButton />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleInstallVsix()}
            disabled={isInstalling}
          >
            <Upload />
            Instalar VSIX
          </Button>
          <TooltipWrapper tooltip="Recargar plugins" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleRefresh}
              aria-label="Recargar plugins"
              disabled={isRefreshing}
            >
              <RotateCcw className={cn(isRefreshing && "animate-spin")} />
            </Button>
          </TooltipWrapper>
        </header>

        {iconThemeState.extensions.length > 0 && (
          <section aria-label="Extensiones VS Code instaladas">
            <SectionTitle>Extensiones VS Code</SectionTitle>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {iconThemeState.extensions.map((extension) => {
                const colorThemes = colorThemeState.themes.filter(
                  (theme) => theme.extension.id === extension.id
                );
                const iconThemes = iconThemeState.themes.filter(
                  (theme) => theme.extension.id === extension.id
                );
                return (
                  <li key={extension.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline gap-1.5 truncate text-sm font-medium">
                        {extension.displayName}
                        <span className="text-[11px] font-normal text-muted-foreground">
                          v{extension.version}
                        </span>
                      </p>
                      <ExtensionSummary extension={extension} />
                    </div>
                    {colorThemes.length > 0 && (
                      <ThemeSelect
                        label="Tema de color"
                        icon={Palette}
                        themes={colorThemes}
                        activeKey={colorThemeState.activeKey}
                        onChange={(key, label) => void handleActivateColorTheme(key, label)}
                      />
                    )}
                    {iconThemes.length > 0 && (
                      <ThemeSelect
                        label="Tema de iconos"
                        icon={FileImage}
                        themes={iconThemes}
                        activeKey={iconThemeState.activeKey}
                        onChange={(key, label) => void handleActivateIconTheme(key, label)}
                      />
                    )}
                    <TooltipWrapper tooltip="Desinstalar" side="left">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Desinstalar ${extension.displayName}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          void handleUninstallExtension(extension.id, extension.displayName)
                        }
                      >
                        <Trash2 />
                      </Button>
                    </TooltipWrapper>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <ExtensionStore />

        <section aria-label="Plugins internos">
          <SectionTitle>Plugins internos</SectionTitle>
          {plugins.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
              Todavía no hay plugins registrados.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {plugins.map(({ manifest, isActive }) => (
                <li
                  key={manifest.id}
                  className={cn("flex items-center gap-3 px-3 py-2", !isActive && "opacity-60")}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-1.5 truncate text-sm font-medium">
                      {manifest.name}
                      <span className="text-[11px] font-normal text-muted-foreground">
                        v{manifest.version}
                      </span>
                    </p>
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={[manifest.description, manifest.author && `por ${manifest.author}`]
                        .filter(Boolean)
                        .join(" — ")}
                    >
                      {manifest.description || manifest.id}
                    </p>
                  </div>
                  {manifest.commands && manifest.commands.length > 0 && (
                    <CommandSelect commands={manifest.commands} disabled={!isActive} />
                  )}
                  <Switch
                    aria-label={`${isActive ? "Desactivar" : "Activar"} ${manifest.name}`}
                    checked={isActive}
                    disabled={isToggling === manifest.id}
                    onCheckedChange={(checked) => void handleTogglePlugin(manifest.id, checked)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
