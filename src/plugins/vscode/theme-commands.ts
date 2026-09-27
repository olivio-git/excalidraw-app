import { PluginManager } from "@/plugins/plugin-manager";
import { notify } from "@/shared/lib/notify";
import type { InstalledExtension } from "./extension-storage";
import { loadInstalledExtensions, onInstalledExtensionsChanged } from "./extension-registry";
import { colorThemeKey, setActiveColorTheme } from "./color-theme-service";
import { iconThemeKey, setActiveIconTheme } from "./icon-theme-service";

/**
 * Command palette entries for installed themes, the equivalent of VS Code's
 * "Preferences: Color Theme" / "File Icon Theme" pickers: one command per
 * theme plus one to turn each kind off. Kept in sync with installs/uninstalls.
 */

const CATEGORY = "Preferences";
const COLOR_PREFIX = "vscode.colorTheme.select:";
const ICON_PREFIX = "vscode.iconTheme.select:";

let registeredIds: string[] = [];
let initialized = false;

function run(action: () => Promise<void>, message: string): () => Promise<void> {
  return async () => {
    try {
      await action();
      notify(message, { type: "success" });
    } catch (error) {
      notify("No se pudo cambiar el tema", { type: "error", description: String(error) });
    }
  };
}

function register(id: string, name: string, handler: () => Promise<void>): void {
  PluginManager.registerDynamicCommand({ id, name, category: CATEGORY }, handler);
  registeredIds.push(id);
}

export function syncThemeCommands(extensions: InstalledExtension[]): void {
  for (const id of registeredIds) PluginManager.unregisterDynamicCommand(id);
  registeredIds = [];

  for (const extension of extensions) {
    for (const theme of extension.colorThemes) {
      const key = colorThemeKey(extension, theme);
      const label = theme.label ?? key;
      register(
        `${COLOR_PREFIX}${key}`,
        `Tema de color: ${label} (${extension.displayName})`,
        run(() => setActiveColorTheme(key), `Tema de color: ${label}`)
      );
    }
    for (const theme of extension.iconThemes) {
      const key = iconThemeKey(extension, theme.id);
      const label = theme.label ?? theme.id;
      register(
        `${ICON_PREFIX}${key}`,
        `Tema de iconos: ${label} (${extension.displayName})`,
        run(() => setActiveIconTheme(key), `Tema de iconos: ${label}`)
      );
    }
  }

  if (extensions.some((extension) => extension.colorThemes.length > 0)) {
    register(
      "vscode.colorTheme.disable",
      "Tema de color: desactivar (usar el de la app)",
      run(() => setActiveColorTheme(null), "Tema de color desactivado")
    );
  }
  if (extensions.some((extension) => extension.iconThemes.length > 0)) {
    register(
      "vscode.iconTheme.disable",
      "Tema de iconos: desactivar (usar los de la app)",
      run(() => setActiveIconTheme(null), "Tema de iconos desactivado")
    );
  }
}

/** Register the theme commands and keep them updated. Call once at startup. */
export async function initThemeCommands(): Promise<void> {
  if (initialized) return;
  initialized = true;
  onInstalledExtensionsChanged(syncThemeCommands);
  syncThemeCommands(await loadInstalledExtensions());
}
