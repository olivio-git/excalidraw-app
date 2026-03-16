import { RouteRegistry } from "@/core/routing/route-registry";
import { useAuthStore } from "@/core/auth/store/auth-store";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { contextKeyService } from "@/core/keybindings/context-key-service";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { KeybindingSource } from "@/core/keybindings/types";
import type {
  CommandHandler,
  PluginAPI,
  PluginEventHandler,
  SidebarSection,
  SidebarFooterAction,
} from "./types";
import type { KeybindingDeclaration, NormalizedKey } from "@/core/keybindings/types";
import type { RouteConfig } from "@/core/routing/types";

/**
 * Factory for the public PluginAPI.
 *
 * The last two callbacks wire the plugin-level event bus:
 * - onRegisterEvent: host stores the handler for the given topic.
 * - emitEvent: host dispatches an event on the given topic.
 *
 * onRegisterKeybinding: host tracks the (firstKey, commandId) pair for cleanup on deactivation.
 */
export function createPluginAPI(
  onRegisterSection: (section: SidebarSection) => void,
  onRegisterCommand: (commandId: string, handler: CommandHandler) => void,
  onRegisterRoute: (routeId: string) => void,
  onRegisterFooterAction: (action: SidebarFooterAction) => void,
  onRegisterEvent: (topic: string, handler: PluginEventHandler) => () => void,
  emitEvent: (topic: string, payload?: unknown) => void,
  pluginId: string,
  onRegisterKeybinding: (firstKey: NormalizedKey, commandId: string) => void
): PluginAPI {
  return {
    registerRoutes: (routes: RouteConfig[]) => {
      RouteRegistry.register(routes);
      for (const route of routes) {
        onRegisterRoute(route.id);
      }
    },

    registerSidebarSection: (section: SidebarSection) => {
      onRegisterSection(section);
    },

    registerCommand: (commandId: string, handler: CommandHandler) => {
      onRegisterCommand(commandId, handler);
    },

    getAuthState: () => {
      const state = useAuthStore.getState();
      return {
        isAuthenticated: state.isAuthenticated,
        user: state.user,
      };
    },

    registerSettingsAction: (action: SidebarFooterAction) => {
      onRegisterFooterAction(action);
    },

    onEvent: (topic: string, handler: PluginEventHandler) => {
      return onRegisterEvent(topic, handler);
    },

    emitEvent: (topic: string, payload?: unknown) => {
      emitEvent(topic, payload);
    },

    registerKeybinding: (declaration: KeybindingDeclaration) => {
      const chord = keyNormalizer.normalizeChord(declaration.key);
      const firstKey = chord[0];
      keybindingRegistry.registerDefault({
        commandId: declaration.commandId,
        chord,
        when: declaration.when,
        source: KeybindingSource.Plugin,
      });
      onRegisterKeybinding(firstKey, declaration.commandId);
    },

    registerContext: (key: string, value: boolean | string | number) => {
      contextKeyService.set(key, value);
    },
  };
}
