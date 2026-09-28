import { lazy } from "react";
import { FileCode } from "lucide-react";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { RouteRegistry } from "@/core/routing/route-registry";
import type { RouteConfig } from "@/core/routing/types";
import { fileHandlerRegistry, type FileHandler } from "@/core/shell/panels/file-handler-registry";
import { openFileInWorkbench } from "@/core/shell/services/file-navigation";
import { PluginManager } from "@/plugins/plugin-manager";
import { notify } from "@/shared/lib/notify";
import { getLanguageRegistry } from "./language-registry";
import { initExtensionLanguages } from "./extension-languages";
import { editorContributions } from "./editor-contributions";

const CodeEditorContainer = lazy(() => import("./CodeEditorContainer"));

export const CODE_EDITOR_ROUTE_ID = "code-editor";

const codeEditorRoute: RouteConfig = {
  id: CODE_EDITOR_ROUTE_ID,
  path: "/code-editor",
  name: "Code Editor",
  type: "protected",
  icon: FileCode as unknown as React.ComponentType<{ className?: string }>,
  component: CodeEditorContainer,
  security: { requiresAuth: false },
  // Keeps undo history, folding and scroll position while switching tabs.
  tabConfig: { singleton: false, closable: true, keepMounted: true },
  showSidebar: false,
  showInCommandPalette: false,
};

export const codeFileHandler: FileHandler = {
  routeId: CODE_EDITOR_ROUTE_ID,
  defaultExtension: "txt",
  create: async (dir, name) => {
    const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    const filePath = `${dir.replace(/[\\/]$/, "")}${separator}${name}`;
    await writeTextFile(filePath, "", { createNew: true });
    return filePath;
  },
  displayName: (filename) => filename,
};

/** Files the code editor opens: anything a known language (or plain text) claims. */
export function resolveCodeFile(filename: string): FileHandler | null {
  return getLanguageRegistry().resolve(filename) ? codeFileHandler : null;
}

let initialized = false;

/** Register the code editor route, the text-file fallback and its commands. Call once. */
export function initCodeEditor(): void {
  if (initialized) return;
  initialized = true;
  RouteRegistry.register([codeEditorRoute]);
  fileHandlerRegistry.setFallbackResolver(resolveCodeFile);
  void initExtensionLanguages().catch((error) =>
    console.error("[code-editor] Failed to load extension languages", error)
  );

  // Editing the extension settings file applies it right away.
  editorContributions.register({
    id: "extension-settings-file",
    onDidSave: (doc) => {
      void import("@/plugins/vscode/extension-settings").then((settings) => {
        if (settings.isExtensionSettingsFile(doc.filePath)) void settings.reloadExtensionSettings();
      });
    },
  });

  PluginManager.registerDynamicCommand(
    {
      id: "workbench.action.openExtensionSettingsJson",
      name: "Preferencias: Abrir configuración de extensiones (JSON)",
      category: "Preferences",
    },
    async () => {
      try {
        const { extensionSettingsPath, ensureExtensionSettingsFile } =
          await import("@/plugins/vscode/extension-settings");
        await ensureExtensionSettingsFile();
        openFileInWorkbench(await extensionSettingsPath());
      } catch (error) {
        notify("No se pudo abrir la configuración", { type: "error", description: String(error) });
      }
    }
  );
}
