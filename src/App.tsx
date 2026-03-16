import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import TitleBar from "@/core/shell/TitleBar";
import Shell from "@/core/shell/Shell";
import LoginPage from "@/features/auth/LoginPage";
import { useAuthStore } from "@/core/auth/store/auth-store";
import { registerFeatureRoutes } from "@/features/_registry";
import { protectedRoutes } from "@/core/routing/route-config";
import { TabRouter } from "@/core/routing/tab-router";
import { PluginManager } from "@/plugins/plugin-manager";
import SplashScreen from "@/shared/common/SplashScreen";
import { ErrorBoundary } from "@/shared/components/error/ErrorBoundary";
import { ErrorFallback } from "@/shared/components/error/ErrorFallback";
import { registerDefaultKeybindings } from "@/core/keybindings/default-keybindings";
import { initializeCoreCommands } from "@/core/keybindings/default-commands";

// Register routes and plugins at module level.
// Init order: routes → default keybindings → core commands → internal plugins.
// Default keybindings must come before plugins so plugins can override them.
registerFeatureRoutes();
registerDefaultKeybindings();
initializeCoreCommands();

// PluginManager.register(examplePlugin);
PluginManager.loadInternalPlugins(); // Load and register internal plugins

function AuthGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function PublicGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (isAuthenticated) {
    return <Navigate to="/home" replace />;
  }
  return <>{children}</>;
}

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
                path="/login"
                element={
                  <PublicGuard>
                    <TitleBar />
                    <LoginPage />
                  </PublicGuard>
                }
              />
              <Route
                path="/*"
                element={
                  <AuthGuard>
                    <TabRouter />
                    <Shell routes={protectedRoutes} />
                  </AuthGuard>
                }
              />
            </Routes>
          </div>
        </TooltipProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
