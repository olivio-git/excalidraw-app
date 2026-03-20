import { lazy } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { definePlugin } from "@/plugins/sdk";
import { useTabStore } from "@/core/tabs/store/tab-store";

const ROUTE_ID = "canvas-playground";

const PlaygroundView = lazy(() => import("./PlaygroundView"));

let unsubTabChange: (() => void) | null = null;

export default definePlugin({
  manifest: {
    id: "canvas-playground",
    name: "Canvas Playground",
    version: "1.0.0",
    description:
      "Plugin interno para probar la API: notificaciones, prompts, confirmaciones y canvas.",
    author: "internal",
    commands: [
      {
        id: "canvas-playground.open",
        name: "Playground: Abrir Vista",
        category: "Playground",
      },
      {
        id: "canvas-playground.notify",
        name: "Playground: Test Notificaciones",
        category: "Playground",
      },
      {
        id: "canvas-playground.confirm",
        name: "Playground: Test Confirmación",
        category: "Playground",
      },
      {
        id: "canvas-playground.prompt",
        name: "Playground: Test Prompt",
        category: "Playground",
      },
      {
        id: "canvas-playground.canvas-info",
        name: "Playground: Info del Canvas",
        category: "Playground",
      },
      {
        id: "canvas-playground.draw-shape",
        name: "Playground: Dibujar Forma de Prueba",
        category: "Playground",
      },
    ],
  },

  activate(api) {
    // Registrar la ruta/vista en el tab bar
    api.registerRoutes([
      {
        id: ROUTE_ID,
        path: "/canvas-playground",
        name: "Canvas Playground",
        type: "protected",
        component: PlaygroundView,
        security: { requiresAuth: false },
        tabConfig: { singleton: true, closable: true, keepMounted: false },
        showSidebar: true,
        showInCommandPalette: true,
      },
    ]);

    // ⓪ Abre la vista en una nueva tab
    api.registerCommand("canvas-playground.open", () => {
      useTabStore.getState().addTab({
        routeId: ROUTE_ID,
        path: "/canvas-playground",
        title: "Canvas Playground",
      });
    });

    // ① Dispara los 4 tipos de notificación en cascada
    api.registerCommand("canvas-playground.notify", () => {
      api.notify("Esto es un mensaje informativo", { type: "info" });
      setTimeout(() => api.notify("¡Operación exitosa!", { type: "success" }), 700);
      setTimeout(() => api.notify("Cuidado con esto", { type: "warning" }), 1400);
      setTimeout(() => api.notify("Algo salió mal (simulado)", { type: "error" }), 2100);
    });

    // ② Diálogo de confirmación
    api.registerCommand("canvas-playground.confirm", async () => {
      const ok = await api.confirm({
        title: "¿Confirmar acción?",
        description: "Esta es una confirmación de prueba generada por el plugin Canvas Playground.",
        confirmLabel: "Sí, confirmar",
        cancelLabel: "Cancelar",
      });
      api.notify(ok ? "Confirmado ✓" : "Cancelado por el usuario", {
        type: ok ? "success" : "warning",
      });
    });

    // ③ Formulario prompt con múltiples campos
    api.registerCommand("canvas-playground.prompt", async () => {
      const result = await api.prompt({
        title: "Formulario de Prueba",
        description: "Completá los campos para ver cómo funciona el sistema de prompts.",
        fields: [
          {
            id: "nombre",
            label: "Nombre",
            placeholder: "ej: Ronald Gallardo",
            required: true,
          },
          {
            id: "numero",
            label: "Número favorito",
            type: "number",
            placeholder: "ej: 42",
          },
        ],
      });

      if (result) {
        const num = result.numero ? ` / favorito: ${result.numero}` : "";
        api.notify(`Recibido → nombre: ${result.nombre}${num}`, {
          type: "success",
          duration: 5000,
        });
      } else {
        api.notify("Prompt cancelado", { type: "warning" });
      }
    });

    // ④ Info del canvas activo
    api.registerCommand("canvas-playground.canvas-info", () => {
      const tab = api.getActiveTab();
      const elements = api.diagram.getElements();
      const workspace = api.getWorkspaceDir();
      const theme = api.getTheme();

      const tabName = tab?.title ?? "sin pestaña";
      const wsDir = workspace ? workspace.split("/").pop() : "–";

      api.notify(`📄 ${tabName} | 🔷 ${elements.length} elementos | 🎨 ${theme} | 📁 ${wsDir}`, {
        type: "info",
        duration: 6000,
      });
    });

    // ⑤ Dibuja un rectángulo de prueba en el canvas activo
    api.registerCommand("canvas-playground.draw-shape", async () => {
      const ok = await api.confirm({
        title: "Dibujar forma de prueba",
        description: "Se agregará un rectángulo azul al canvas activo.",
        confirmLabel: "Dibujar",
      });
      if (!ok) return;

      const existing = api.diagram.getElements();
      const offset = existing.length * 20;

      const rect = {
        type: "rectangle",
        id: `playground-${Date.now()}`,
        x: 80 + offset,
        y: 80 + offset,
        width: 180,
        height: 80,
        angle: 0,
        strokeColor: "#1971c2",
        backgroundColor: "#d0ebff",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: { type: 3 },
        seed: Math.floor(Math.random() * 999999),
        version: 1,
        versionNonce: Math.floor(Math.random() * 999999),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        index: null,
      } as unknown as ExcalidrawElement;

      api.diagram.addElements([rect]);
      api.notify("Forma dibujada en el canvas ✓", { type: "success" });
    });

    // Escucha cambios de pestaña y emite evento interno
    unsubTabChange = api.onTabChange((tab) => {
      if (tab) {
        api.emitEvent("canvas-playground.tabChanged", {
          tabId: tab.tabId,
          title: tab.title,
          instanceId: tab.instanceId,
        });
      }
    });

    // Acción en el footer del sidebar con submenú
    api.registerSidebarFooterAction({
      id: "canvas-playground.menu",
      label: "Canvas Playground",
      submenu: [
        {
          id: "canvas-playground.open",
          label: "Abrir Vista",
          onClick: () => api.executeCommand("canvas-playground.open"),
        },
        {
          id: "canvas-playground.notify",
          label: "Test Notificaciones",
          onClick: () => api.executeCommand("canvas-playground.notify"),
        },
        {
          id: "canvas-playground.confirm",
          label: "Test Confirmación",
          onClick: () => api.executeCommand("canvas-playground.confirm"),
        },
        {
          id: "canvas-playground.prompt",
          label: "Test Prompt",
          onClick: () => api.executeCommand("canvas-playground.prompt"),
        },
        {
          id: "canvas-playground.canvas-info",
          label: "Info del Canvas",
          onClick: () => api.executeCommand("canvas-playground.canvas-info"),
        },
        {
          id: "canvas-playground.draw-shape",
          label: "Dibujar Forma de Prueba",
          onClick: () => api.executeCommand("canvas-playground.draw-shape"),
        },
      ],
    });
  },

  deactivate() {
    unsubTabChange?.();
    unsubTabChange = null;
  },
});
