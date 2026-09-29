import { lazy } from "react";
import { Boxes } from "lucide-react";
import { join } from "@tauri-apps/api/path";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { Plugin, PluginAPI } from "@/plugins/types";
import { openFileInWorkbench } from "@/core/shell/services/file-navigation";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { notify } from "@/shared/lib/notify";
import { sampleFlow, serializeFlow } from "./model";
import { convertExcalidrawToFlowFile } from "./excalidraw-bridge";
import { flow3dRegistry } from "./flow3d-registry";

// Three.js loads only when a flow is opened.
const Flow3DEditorContainer = lazy(() => import("./Flow3DEditorContainer"));

export const FLOW3D_ROUTE_ID = "flow3d";

const baseName = (path: string) => (path.split(/[\\/]/).pop() ?? path).replace(/\.flow3d$/i, "");

function activeFlow() {
  const state = useTabStore.getState();
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  const path = tab?.routeId === FLOW3D_ROUTE_ID ? (tab.instanceId ?? "") : "";
  return flow3dRegistry.get(path);
}

function activate(api: PluginAPI): void {
  api.registerRoutes([
    {
      id: FLOW3D_ROUTE_ID,
      path: `/${FLOW3D_ROUTE_ID}`,
      name: "Flow 3D",
      type: "protected",
      component: Flow3DEditorContainer,
      security: { requiresAuth: false },
      // Kept mounted so camera and playback survive tab switches; hidden tabs don't render.
      tabConfig: { singleton: false, closable: true, keepMounted: true },
      showSidebar: false,
      showInCommandPalette: false,
    },
  ]);

  api.registerFileHandler("flow3d", {
    routeId: FLOW3D_ROUTE_ID,
    defaultExtension: "flow3d",
    create: async (dir: string, name: string) => {
      const fileName = /\.flow3d$/i.test(name) ? name : `${name}.flow3d`;
      const filePath = await join(dir, fileName);
      await writeTextFile(filePath, serializeFlow(sampleFlow(baseName(fileName))));
      return filePath;
    },
    displayName: baseName,
  });
  api.registerFileIcon("flow3d", Boxes);

  api.registerCommand("flow3d.new", async () => {
    try {
      const workspaceDir = api.getWorkspaceDir();
      const chosen = await saveDialog({
        defaultPath: workspaceDir
          ? await join(workspaceDir, "Nuevo flujo.flow3d")
          : "Nuevo flujo.flow3d",
        filters: [{ name: "Flow 3D", extensions: ["flow3d"] }],
      });
      if (!chosen) return;
      const path = /\.flow3d$/i.test(chosen) ? chosen : `${chosen}.flow3d`;
      await writeTextFile(path, serializeFlow(sampleFlow(baseName(path))));
      api.openFile(path);
    } catch (error) {
      notify("No se pudo crear el flujo", { type: "error", description: String(error) });
    }
  });

  // From the diagram being edited (or one picked), next to it, opened beside.
  api.registerCommand("flow3d.fromExcalidraw", async () => {
    try {
      const tab = api.getActiveTab();
      let source = tab?.instanceId && /\.excalidraw$/i.test(tab.instanceId) ? tab.instanceId : null;
      if (!source) {
        const picked = await openDialog({
          multiple: false,
          defaultPath: api.getWorkspaceDir() ?? undefined,
          filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
        });
        if (typeof picked !== "string") return;
        source = picked;
      }
      const target = await convertExcalidrawToFlowFile(source);
      openFileInWorkbench(target, { beside: true });
    } catch (error) {
      notify("No se pudo convertir el diagrama a 3D", {
        type: "error",
        description: String(error),
      });
    }
  });

  api.registerCommand("flow3d.togglePlay", () => activeFlow()?.store.getState().togglePlay());
  api.registerCommand("flow3d.stop", () => activeFlow()?.store.getState().stop());
  api.registerCommand("flow3d.fit", () => activeFlow()?.store.getState().requestFit());
  api.registerCommand("flow3d.layout", () => activeFlow()?.store.getState().layout());
  api.registerCommand("flow3d.execute", () => activeFlow()?.execute?.());
  api.registerCommand("flow3d.exportExcalidraw", () => activeFlow()?.exportExcalidraw?.());

  // Automations: loaded apart so the app starts without the flow engine.
  const automation = () => import("./automation-service");
  void automation().then(({ startFlowAutomation }) => startFlowAutomation());
  api.registerCommand("flow3d.toggleAutomations", async () => {
    const { flowAutomation } = await automation();
    flowAutomation.paused = !flowAutomation.paused;
    notify(flowAutomation.paused ? "Automatizaciones en pausa" : "Automatizaciones reanudadas", {
      type: "info",
    });
  });
  api.registerCommand("flow3d.listAutomations", async () => {
    const [{ flowAutomation }, { describePlan }] = await Promise.all([
      automation(),
      import("./automation"),
    ]);
    const active = flowAutomation.list();
    notify(
      active.length === 0
        ? "Ningún flujo se ejecuta solo"
        : `${active.length} flujo(s) automáticos${flowAutomation.paused ? " (en pausa)" : ""}`,
      {
        type: "info",
        description: active
          .map((flow) => `${flow.name}: ${flow.plans.map(describePlan).join(", ")}`)
          .join("\n"),
      }
    );
  });
}

export const flow3dPlugin: Plugin = {
  manifest: {
    id: "flow3d",
    name: "Flow 3D",
    version: "0.1.0",
    description: "Diseñador de flujos en 3D con reproducción, vinculado a notas y diagramas",
    author: "excalidraw-app",
    commands: [
      { id: "flow3d.new", name: "Flow 3D: Nuevo flujo" },
      { id: "flow3d.fromExcalidraw", name: "Flow 3D: Ver diagrama de Excalidraw en 3D" },
      { id: "flow3d.togglePlay", name: "Flow 3D: Reproducir / pausar" },
      { id: "flow3d.stop", name: "Flow 3D: Detener" },
      { id: "flow3d.fit", name: "Flow 3D: Encuadrar" },
      { id: "flow3d.layout", name: "Flow 3D: Organizar automáticamente" },
      { id: "flow3d.execute", name: "Flow 3D: Ejecutar flujo" },
      { id: "flow3d.exportExcalidraw", name: "Flow 3D: Exportar a Excalidraw" },
      { id: "flow3d.listAutomations", name: "Flow 3D: Ver automatizaciones activas" },
      { id: "flow3d.toggleAutomations", name: "Flow 3D: Pausar / reanudar automatizaciones" },
    ],
  },
  activate,
};
