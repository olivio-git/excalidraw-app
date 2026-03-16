import { RouteRegistry } from "@/core/routing/route-registry";
import { useAuthStore } from "@/core/auth/store/auth-store";
import { fileIconRegistry } from "@/core/shell/panels/file-icon-registry";
import { fileHandlerRegistry } from "@/core/shell/panels/file-handler-registry";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { notify } from "@/shared/lib/notify";
import { confirm } from "@/shared/lib/confirm";
import { prompt } from "@/shared/lib/prompt";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useThemeStore } from "@/stores/themeStore";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { contextKeyService } from "@/core/keybindings/context-key-service";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { KeybindingSource } from "@/core/keybindings/types";
import type {
  ActiveTabInfo,
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
 * Callbacks wired by PluginManager:
 * - onRegisterEvent / emitEvent: plugin-level pub/sub event bus
 * - onRegisterKeybinding: tracks (firstKey, commandId) for cleanup on deactivation
 * - onExecuteCommand: delegates to PluginManager.executeCommand
 * - onRegisterTabChange: tracks the Zustand unsubscriber for cleanup on deactivation
 */
export function createPluginAPI(
  onRegisterSection: (section: SidebarSection) => void,
  onRegisterCommand: (commandId: string, handler: CommandHandler) => void,
  onRegisterRoute: (routeId: string) => void,
  onRegisterFooterAction: (action: SidebarFooterAction) => void,
  onRegisterEvent: (topic: string, handler: PluginEventHandler) => () => void,
  emitEvent: (topic: string, payload?: unknown) => void,
  pluginId: string,
  onRegisterKeybinding: (firstKey: NormalizedKey, commandId: string) => void,
  onExecuteCommand: (commandId: string) => Promise<void>,
  onRegisterTabChange: (unsub: () => void) => void
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

    notify: (message, options) => {
      notify(message, options);
    },

    confirm: (options) => confirm(options),

    prompt: (options) => prompt(options),

    getAuthState: () => {
      const state = useAuthStore.getState();
      return {
        isAuthenticated: state.isAuthenticated,
        user: state.user,
      };
    },

    getActiveTab: () => {
      const { tabs, activeTabId } = useTabStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return null;
      return {
        tabId: tab.id,
        routeId: tab.routeId,
        title: tab.title,
        path: tab.path,
        instanceId: tab.instanceId,
        metadata: tab.metadata as Record<string, unknown> | undefined,
      };
    },

    getWorkspaceDir: () => {
      return useWorkspaceStore.getState().workspaceDir;
    },

    registerFileIcon: (extension, icon) => {
      fileIconRegistry.register(extension, icon);
    },

    registerFileHandler: (extension, handler) => {
      fileHandlerRegistry.register(extension, handler);
    },

    registerSettingsAction: (action: SidebarFooterAction) => {
      onRegisterFooterAction(action);
    },

    registerSidebarFooterAction: (action: SidebarFooterAction) => {
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

    openFile: (filePath: string) => {
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      const handler = fileHandlerRegistry.resolveOrDefault(name);
      const title = handler.displayName ? handler.displayName(name) : name;
      useTabStore.getState().addTab({
        routeId: handler.routeId,
        path: `/${handler.routeId}`,
        title,
        instanceId: filePath,
        metadata: { filePath },
      });
    },

    executeCommand: (commandId: string) => {
      return onExecuteCommand(commandId);
    },

    onTabChange: (handler: (tab: ActiveTabInfo | null) => void) => {
      const toInfo = (state: ReturnType<typeof useTabStore.getState>): ActiveTabInfo | null => {
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (!tab) return null;
        return {
          tabId: tab.id,
          routeId: tab.routeId,
          title: tab.title,
          path: tab.path,
          instanceId: tab.instanceId,
          metadata: tab.metadata as Record<string, unknown> | undefined,
        };
      };

      // Call immediately with current state
      handler(toInfo(useTabStore.getState()));

      // Subscribe to future changes — only fire when activeTabId actually changes
      let prevActiveTabId = useTabStore.getState().activeTabId;
      const unsub = useTabStore.subscribe((state) => {
        if (state.activeTabId !== prevActiveTabId) {
          prevActiveTabId = state.activeTabId;
          handler(toInfo(state));
        }
      });

      onRegisterTabChange(unsub);
      return unsub;
    },

    getTheme: () => {
      return useThemeStore.getState().resolvedTheme;
    },
  };
}
