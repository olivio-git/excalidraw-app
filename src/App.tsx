import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import Shell from "@/core/shell/Shell";
import { registerFeatureRoutes } from "@/features/_registry";
import { TabRouter } from "@/core/routing/tab-router";
import { PluginManager } from "@/plugins/plugin-manager";
import SplashScreen from "@/shared/common/SplashScreen";
import { ErrorBoundary } from "@/shared/components/error/ErrorBoundary";
import { ErrorFallback } from "@/shared/components/error/ErrorFallback";
import { registerDefaultKeybindings } from "@/core/keybindings/default-keybindings";
import { initializeCoreCommands } from "@/core/keybindings/default-commands";

registerFeatureRoutes();
registerDefaultKeybindings();
initializeCoreCommands();
PluginManager.loadInternalPlugins();

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      await PluginManager.loadExternalPlugins();
      await PluginManager.activateAll();
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
        <TooltipProvider delayDuration={300}>
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
