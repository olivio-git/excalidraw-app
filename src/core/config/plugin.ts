import type { Plugin, PluginAPI } from "@/plugins/types";
import { notify } from "@/shared/lib/notify";
import { openConfigFile, reloadConfig, startUserConfig } from "./user-config";
import { useConfigStore } from "./config-store";
import { PluginManager } from "@/plugins/plugin-manager";
import { editorContributions } from "@/features/code-editor/editor-contributions";
import {
  configCompletionSource,
  configEditorExtensions,
  type ConfigFileKind,
} from "./config-intellisense";

const same = (a: string, b: string) => a.replaceAll("\\", "/") === b.replaceAll("\\", "/");

/** Which config file a path is, if any. */
function configKind(filePath: string): ConfigFileKind | null {
  const files = useConfigStore.getState().files;
  if (files) {
    if (same(filePath, files.config) || (files.workspace && same(filePath, files.workspace)))
      return "config";
    if (same(filePath, files.keymap)) return "keymap";
    if (same(filePath, files.vimrc)) return "vimrc";
  }
  // Another project's .qori/config.toml.
  return /[\\/]\.qori[\\/]config\.toml$/.test(filePath) ? "config" : null;
}

const commands = () =>
  PluginManager.getCommands().map((command) => ({ id: command.id, name: command.name }));

function activate(api: PluginAPI): void {
  void startUserConfig();
  // Suggestions, problems on their line and hover docs while editing the config files.
  editorContributions.register({
    id: "user-config-intellisense",
    extensions: (doc) => {
      const kind = configKind(doc.filePath);
      return kind ? configEditorExtensions(kind, commands) : [];
    },
    completionSources: (doc) => {
      const kind = configKind(doc.filePath);
      return kind ? [configCompletionSource(kind, commands)] : [];
    },
  });
  api.registerCommand("config.open", () => openConfigFile("config"));
  api.registerCommand("config.openKeymap", () => openConfigFile("keymap"));
  api.registerCommand("config.openStyles", () => openConfigFile("styles"));
  api.registerCommand("config.openVimrc", () => openConfigFile("vimrc"));
  api.registerCommand("config.openWorkspace", () => openConfigFile("workspace"));
  api.registerCommand("config.reload", async () => {
    await reloadConfig();
    const { issues } = useConfigStore.getState();
    if (issues.length === 0) notify("Configuración recargada", { type: "success" });
  });
  api.registerCommand("config.showProblems", () => {
    const { issues } = useConfigStore.getState();
    notify(
      issues.length
        ? `${issues.length} problemas en la configuración`
        : "La configuración no tiene problemas",
      {
        type: issues.length ? "warning" : "success",
        description: issues.map((i) => `${i.file.split(/[\\/]/).pop()}: ${i.message}`).join("\n"),
      }
    );
  });
}

export const userConfigPlugin: Plugin = {
  manifest: {
    id: "user-config",
    name: "Configuración por archivos",
    version: "0.1.0",
    description: "config.toml, keymap.toml y styles.css en ~/.config/qori",
    author: "excalidraw-app",
    commands: [
      { id: "config.open", name: "Preferencias: Abrir config.toml" },
      { id: "config.openKeymap", name: "Preferencias: Abrir keymap.toml (atajos)" },
      { id: "config.openStyles", name: "Preferencias: Abrir styles.css (CSS propio)" },
      { id: "config.openVimrc", name: "Preferencias: Abrir vimrc (mapeos de Vim)" },
      {
        id: "config.openWorkspace",
        name: "Preferencias: Abrir configuración del proyecto (.qori/config.toml)",
      },
      { id: "config.reload", name: "Preferencias: Recargar configuración" },
      { id: "config.showProblems", name: "Preferencias: Ver problemas de la configuración" },
    ],
  },
  activate,
};
