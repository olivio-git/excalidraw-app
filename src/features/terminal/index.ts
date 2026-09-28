import { lazy } from "react";
import { PluginManager } from "@/plugins/plugin-manager";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { commandsAllowedInTerminal } from "@/core/keybindings/keybinding-service";
import { KeybindingSource } from "@/core/keybindings/types";
import { panelRegistry } from "@/core/panel/panel-registry";
import { usePanelStore } from "@/core/panel/panel-store";
import { isPtyAvailable } from "./pty";
import {
  TERMINAL_VIEW_ID,
  createShellTerminal,
  getAvailableShells,
  killActiveTerminal,
  toggleTerminal,
  useTerminalStore,
} from "./terminal-service";

const TerminalPanel = lazy(() =>
  import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel }))
);
const TerminalPanelActions = lazy(() =>
  import("./TerminalPanel").then((m) => ({ default: m.TerminalPanelActions }))
);

const CATEGORY = "Terminal";

/** Commands that keep working while the terminal has focus (see keybinding-service). */
export const TERMINAL_PASSTHROUGH_COMMANDS = new Set([
  "workbench.action.terminal.toggleTerminal",
  "workbench.action.terminal.new",
  "workbench.action.togglePanel",
  "workbench.action.showCommands",
  "workbench.action.openQuickOpen",
  "workbench.action.nextTab",
  "workbench.action.previousTab",
]);

const COMMANDS = [
  {
    id: "workbench.action.terminal.toggleTerminal",
    name: "Terminal: Mostrar/ocultar terminal",
    handler: () => toggleTerminal(),
    key: "ctrl+`",
  },
  {
    id: "workbench.action.terminal.new",
    name: "Terminal: Nueva terminal",
    handler: () => createShellTerminal().then(() => undefined),
    key: "ctrl+shift+`",
  },
  {
    id: "workbench.action.terminal.kill",
    name: "Terminal: Cerrar la terminal activa",
    handler: () => killActiveTerminal(),
  },
  {
    id: "workbench.action.togglePanel",
    name: "Ver: Mostrar/ocultar panel inferior",
    handler: () => {
      const panel = usePanelStore.getState();
      if (!panel.open && !panel.activeViewId) panel.showView(TERMINAL_VIEW_ID);
      else panel.toggle();
    },
    key: "ctrl+j",
  },
] as const;

let initialized = false;

/** Register the Terminal panel view, its commands and keybindings. Call once. */
export function initTerminal(): void {
  if (initialized) return;
  initialized = true;

  for (const id of TERMINAL_PASSTHROUGH_COMMANDS) commandsAllowedInTerminal.add(id);

  panelRegistry.register({
    id: TERMINAL_VIEW_ID,
    title: "Terminal",
    order: 10,
    component: TerminalPanel,
    actions: TerminalPanelActions,
  });

  for (const command of COMMANDS) {
    PluginManager.registerDynamicCommand(
      { id: command.id, name: command.name, category: CATEGORY },
      command.handler
    );
    if ("key" in command) {
      keybindingRegistry.registerDefault({
        commandId: command.id,
        chord: keyNormalizer.normalizeChord(command.key),
        source: KeybindingSource.Builtin,
        allowInInput: true,
      });
    }
  }

  // One "new terminal with <shell>" command per detected shell.
  if (isPtyAvailable()) {
    void getAvailableShells().then((shells) => {
      for (const shell of shells) {
        PluginManager.registerDynamicCommand(
          {
            id: `workbench.action.terminal.newWithProfile:${shell.name}`,
            name: `Terminal: Nueva terminal (${shell.name})`,
            category: CATEGORY,
          },
          () =>
            createShellTerminal({ shell: shell.path, args: shell.args, name: shell.name }).then(
              () => undefined
            )
        );
      }
    });
  }
}

export { useTerminalStore };
