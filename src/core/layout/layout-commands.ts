import { PluginManager } from "@/plugins/plugin-manager";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { KeybindingSource } from "@/core/keybindings/types";
import { LOCATION_LABELS, VIEW_LOCATIONS, viewRegistry, viewTitle } from "./view-registry";
import { locationOf, useLayoutStore } from "./layout-store";

const CATEGORY = "View";

async function pick(labels: Array<{ label: string; description?: string }>, placeHolder: string) {
  const { showQuickPick } = await import("@/plugins/vscode/host/quick-input");
  const index = await showQuickPick(labels, { placeHolder });
  return typeof index === "number" ? index : undefined;
}

/** Quick pick of every view, with where it is now. */
async function pickView(placeHolder: string) {
  const state = useLayoutStore.getState();
  const views = viewRegistry.getAll();
  const index = await pick(
    views.map((view) => ({
      label: viewTitle(view),
      description: LOCATION_LABELS[locationOf(view.id, state)],
    })),
    placeHolder
  );
  return index === undefined ? undefined : views[index];
}

const COMMANDS: Array<{ id: string; name: string; run: () => unknown; key?: string }> = [
  {
    id: "workbench.action.toggleAuxiliaryBar",
    name: "Ver: Mostrar/ocultar barra lateral secundaria",
    run: () => useLayoutStore.getState().togglePart("secondary"),
    key: "ctrl+alt+b",
  },
  {
    id: "workbench.action.toggleSidebarPosition",
    name: "Ver: Cambiar de lado la barra lateral principal",
    run: () => {
      const layout = useLayoutStore.getState();
      layout.setSidebarSide(layout.sidebarSide === "left" ? "right" : "left");
    },
  },
  {
    id: "workbench.action.togglePanelPosition",
    name: "Ver: Mover el panel abajo / a la derecha",
    run: () => {
      const layout = useLayoutStore.getState();
      layout.setPanelPosition(layout.panelPosition === "bottom" ? "right" : "bottom");
      layout.setPartOpen("panel", true);
    },
  },
  {
    id: "workbench.action.openView",
    name: "Ver: Abrir vista…",
    run: async () => {
      const view = await pickView("Vista que quieres abrir");
      if (view) useLayoutStore.getState().showView(view.id);
    },
  },
  {
    id: "workbench.action.moveView",
    name: "Ver: Mover vista…",
    run: async () => {
      const view = await pickView("Vista que quieres mover");
      if (!view) return;
      const current = locationOf(view.id, useLayoutStore.getState());
      const targets = VIEW_LOCATIONS.filter((location) => location !== current);
      const index = await pick(
        targets.map((location) => ({ label: LOCATION_LABELS[location] })),
        `Mover «${viewTitle(view)}» a…`
      );
      if (index !== undefined) useLayoutStore.getState().moveView(view.id, targets[index]);
    },
  },
  {
    id: "workbench.action.resetViewLocations",
    name: "Ver: Restablecer diseño de las vistas",
    run: () => useLayoutStore.getState().resetLayout(),
  },
];

let initialized = false;

/** Layout commands (command palette) and their default keybindings. Call once. */
export function initLayoutCommands(): void {
  if (initialized) return;
  initialized = true;
  for (const command of COMMANDS) {
    PluginManager.registerDynamicCommand(
      { id: command.id, name: command.name, category: CATEGORY },
      async () => {
        await command.run();
      }
    );
    if (command.key) {
      keybindingRegistry.registerDefault({
        commandId: command.id,
        chord: keyNormalizer.normalizeChord(command.key),
        source: KeybindingSource.Builtin,
      });
    }
  }
}
