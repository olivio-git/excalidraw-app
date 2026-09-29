import "@/core/i18n/i18n";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import Shell from "@/core/shell/Shell";
import { registerFeatureRoutes } from "@/features/_registry";
import { TabRouter } from "@/core/routing/tab-router";
import { PluginManager } from "@/plugins/plugin-manager";
import { ensureColorThemesInitialized } from "@/plugins/vscode/color-theme-service";
import { initThemeCommands } from "@/plugins/vscode/theme-commands";
import SplashScreen from "@/shared/common/SplashScreen";
import { ErrorBoundary } from "@/shared/components/error/ErrorBoundary";
import { ErrorFallback } from "@/shared/components/error/ErrorFallback";
import { registerDefaultKeybindings } from "@/core/keybindings/default-keybindings";
import { initializeCoreCommands } from "@/core/keybindings/default-commands";
import { initTerminal } from "@/features/terminal";
import { initCodeEditor } from "@/features/code-editor";
import { initExtensionContributions } from "@/plugins/vscode/contribution-service";
import { initExtensionHostUi } from "@/plugins/vscode/host";
import { useLanguageStore } from "@/stores/languageStore";
import i18n from "@/core/i18n/i18n";

registerFeatureRoutes();
registerDefaultKeybindings();
initializeCoreCommands();
initTerminal();
initCodeEditor();
PluginManager.loadInternalPlugins();

export default function App() {
  const [ready, setReady] = useState(false);
  const language = useLanguageStore((s) => s.language);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    const init = async () => {
      await PluginManager.loadExternalPlugins();
      await PluginManager.activateAll();
      // Restore the VS Code color theme before the first paint of the shell.
      await ensureColorThemesInitialized();
      await initThemeCommands();
      await initExtensionContributions();
      initExtensionHostUi();
      if (import.meta.env.DEV) {
        (window as any).__pluginManager = PluginManager;
      }
      setReady(true);
    };
    init();
  }, []);

  if (!ready) {
    return <SplashScreen message="Initializing..." />;
  }

  return (
    <ErrorBoundary fallback={ErrorFallback} name="RootApp">
      <BrowserRouter>
        <TooltipProvider delay={300}>
          <div className="flex flex-col h-screen w-screen overflow-hidden">
            <Routes>
              <Route
                path="/*"
                element={
                  <>
                    <TabRouter />
                    <Shell />
                  </>
                }
              />
            </Routes>
          </div>
        </TooltipProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
