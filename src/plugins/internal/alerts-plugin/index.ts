import type { Plugin } from "@/plugins/types";
import manifest from "./manifest.json";
import { lazy } from "react";
import { AlertCircle, AlertCircleIcon, AlertOctagon } from "lucide-react";

const alertPageRoute = {
  id: "alert-plugin-page",
  path: "/alert",
  name: "Alert Page",
  type: "protected" as const,
  security: { requiresAuth: true },
  component: lazy(() => import("./alertas")),
  showSidebar: true,
  icon: AlertCircle,
};
const alertPageSegundaRoute = {
  id: "alert-plugin-page-segunda",
  path: "/alert/segunda",
  name: "Alert Page Segunda",
  type: "protected" as const,
  security: { requiresAuth: true },
  component: lazy(() => import("./segunda")),
  showSidebar: true,
  icon: AlertOctagon,
};

const alertsPlugin: Plugin = {
  manifest,

  activate: (_api) => {
    // Comando: debe usar el mismo id que en manifest.json
    _api.registerCommand("alert.command.write", () => {
      const { isAuthenticated, user } = _api.getAuthState();
      if (!isAuthenticated) {
        alert("Debes iniciar sesión para crear alertas.");
        return;
      }
      const msg = prompt("Texto de la alerta rápida:");
      if (msg) alert(`Alerta creada (como ${user?.name ?? "usuario"}): ${msg}`);
    });

    _api.registerCommand("alert.command.openPage", () => {
      window.location.href = "/alert";
    });

    _api.registerCommand("alert.command.showHelloWorld", () => {
      alert("¡Hola mundo desde el plugin de alertas!");
    });
    _api.registerCommand("alert.command.saludo", () => {
      const msg = prompt("¿Cómo quieres ser saludado?");
      if (msg) alert(`¡Hola ${msg}! Bienvenido al plugin de alertas.`);
    });

    _api.registerRoutes([alertPageRoute, alertPageSegundaRoute]);
    _api.registerSidebarSection({
      id: "alerts",
      label: "Alerts",
      order: 50,
      icon: AlertCircle,
      items: [alertPageRoute, alertPageSegundaRoute],
    });
  },

  deactivate: () => {
    console.log("[AlertsPlugin] Deactivated");
  },
};

export default alertsPlugin;
