import type {
  Plugin,
  PluginCommand,
  PluginManifest,
  CommandHandler,
  PluginEventHandler,
  SidebarSection,
  SidebarFooterAction,
} from "./types";
import { createPluginAPI } from "./plugin-api";
import { logger } from "@/core/logger";
import { RouteRegistry } from "@/core/routing/route-registry";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import type { NormalizedKey } from "@/core/keybindings/types";

interface PluginEntry {
  plugin: Plugin;
  isActive: boolean;
  registeredSectionIds: string[];
  registeredCommandIds: string[];
  registeredRouteIds: string[];
  registeredFooterActionIds: string[];
  registeredKeybindingKeys: Array<{ firstKey: NormalizedKey; commandId: string }>;
  registeredTabChangeUnsubscribers: Array<() => void>;
}

type PluginManagerEventType = "plugin-activated" | "plugin-deactivated" | "plugins-changed";

interface PluginManagerEvent {
  type: PluginManagerEventType;
  pluginId: string;
  manifest: PluginManifest;
}

interface PluginEventListener {
  pluginId: string;
  handler: PluginEventHandler;
}

export class PluginManagerClass {
  private plugins: Map<string, PluginEntry> = new Map();
  private commandHandlers: Map<string, CommandHandler> = new Map();
  private sidebarSections: SidebarSection[] = [];
  private footerActions: SidebarFooterAction[] = [];

  // Internal event bus for host components (React hooks, shell, etc.)
  private managerListeners: Set<(event: PluginManagerEvent) => void> = new Set();

  // Plugin-level event bus (pub/sub topics between plugins and host).
  private pluginEventListeners: Map<string, PluginEventListener[]> = new Map();

  getSidebarSections(): SidebarSection[] {
    return this.sidebarSections;
  }

  getFooterActions(): SidebarFooterAction[] {
    return this.footerActions;
  }

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.manifest.id)) {
      logger.warn("PluginManager", `Plugin "${plugin.manifest.id}" is already registered.`);
      return;
    }

    // Check dependencies
    if (plugin.manifest.dependencies) {
      for (const dep of plugin.manifest.dependencies) {
        if (!this.plugins.has(dep)) {
          logger.warn(
            "PluginManager",
            `Plugin "${plugin.manifest.id}" requires "${dep}" which is not registered.`
          );
          return;
        }
      }
    }

    this.plugins.set(plugin.manifest.id, {
      plugin,
      isActive: false,
      registeredSectionIds: [],
      registeredCommandIds: [],
      registeredRouteIds: [],
      registeredFooterActionIds: [],
      registeredKeybindingKeys: [],
      registeredTabChangeUnsubscribers: [],
    });
  }

  registerCommandHandler(commandId: string, handler: CommandHandler): void {
    if (this.commandHandlers.has(commandId)) {
      logger.warn("PluginManager", `Command "${commandId}" is already registered.`);
      return;
    }
    this.commandHandlers.set(commandId, handler);
  }

  unregisterCommandHandler(commandId: string): void {
    this.commandHandlers.delete(commandId);
  }

  async activate(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) {
      logger.warn("PluginManager", `Plugin "${pluginId}" is not registered.`);
      return;
    }
    if (entry.isActive) return;

    // Create a scoped API that tracks what this plugin registers
    const api = createPluginAPI(
      (section: SidebarSection) => {
        if (!this.sidebarSections.some((s) => s.id === section.id)) {
          this.sidebarSections.push(section);
          this.sidebarSections.sort((a, b) => a.order - b.order);
          entry.registeredSectionIds.push(section.id);
        }
      },
      (commandId: string, handler: CommandHandler) => {
        if (this.commandHandlers.has(commandId)) {
          logger.warn("PluginManager", `Command "${commandId}" is already registered.`);
          return;
        }
        this.commandHandlers.set(commandId, handler);
        entry.registeredCommandIds.push(commandId);
      },
      (routeId: string) => {
        // Register route and track it for cleanup
        entry.registeredRouteIds.push(routeId);
      },
      (action: SidebarFooterAction) => {
        if (!this.footerActions.some((a) => a.id === action.id)) {
          this.footerActions.push(action);
          entry.registeredFooterActionIds.push(action.id);
        }
      },
      (topic: string, handler: PluginEventHandler) => {
        const listeners = this.pluginEventListeners.get(topic) ?? [];
        listeners.push({ pluginId, handler });
        this.pluginEventListeners.set(topic, listeners);
        return () => {
          const current = this.pluginEventListeners.get(topic);
          if (!current) return;
          const remaining = current.filter((l) => l.handler !== handler);
          if (remaining.length === 0) {
            this.pluginEventListeners.delete(topic);
          } else {
            this.pluginEventListeners.set(topic, remaining);
          }
        };
      },
      (topic: string, payload?: unknown) => {
        const listeners = this.pluginEventListeners.get(topic);
        if (!listeners || listeners.length === 0) return;
        for (const listener of listeners) {
          try {
            listener.handler(payload);
          } catch (error) {
            logger.error(
              "PluginManager",
              `Error in plugin event handler for topic "${topic}" from plugin "${listener.pluginId}"`,
              error
            );
          }
        }
      },
      pluginId,
      (firstKey: NormalizedKey, commandId: string) => {
        entry.registeredKeybindingKeys.push({ firstKey, commandId });
      },
      (commandId: string) => this.executeCommand(commandId),
      (unsub: () => void) => {
        entry.registeredTabChangeUnsubscribers.push(unsub);
      }
    );

    try {
      await entry.plugin.activate(api);
      entry.isActive = true;

      // Validate: warn if any manifest command has no registered handler
      const declaredCommands = entry.plugin.manifest.commands ?? [];
      for (const cmd of declaredCommands) {
        if (!this.commandHandlers.has(cmd.id)) {
          logger.warn(
            "PluginManager",
            `[Plugin "${pluginId}"] Command "${cmd.id}" is declared in manifest but has no registered handler. ` +
              `Call api.registerCommand("${cmd.id}", handler) inside activate().`
          );
        }
      }

      this.emitManagerEvent({
        type: "plugin-activated",
        pluginId,
        manifest: entry.plugin.manifest,
      });
      this.emitManagerEvent({
        type: "plugins-changed",
        pluginId,
        manifest: entry.plugin.manifest,
      });
    } catch (error) {
      logger.error("PluginManager", `Failed to activate plugin "${pluginId}":`, error);
    }
  }

  async deactivate(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry || !entry.isActive) return;

    try {
      await entry.plugin.deactivate?.();

      // Clean up command handlers
      for (const commandId of entry.registeredCommandIds) {
        this.commandHandlers.delete(commandId);
      }
      entry.registeredCommandIds = [];

      // Clean up sidebar sections
      for (const sectionId of entry.registeredSectionIds) {
        const idx = this.sidebarSections.findIndex((s) => s.id === sectionId);
        if (idx !== -1) this.sidebarSections.splice(idx, 1);
      }
      entry.registeredSectionIds = [];

      // Clean up routes
      for (const routeId of entry.registeredRouteIds) {
        // Unregister route from RouteRegistry
        RouteRegistry.unregister(routeId);
      }
      entry.registeredRouteIds = [];

      for (const actionId of entry.registeredFooterActionIds) {
        // Unregister sidebar footer actions
        const idx = this.footerActions.findIndex((a) => a.id === actionId);
        if (idx !== -1) this.footerActions.splice(idx, 1);
      }
      entry.registeredFooterActionIds = [];

      // Clean up keybindings registered by this plugin
      for (const { firstKey, commandId } of entry.registeredKeybindingKeys) {
        keybindingRegistry.unregister(firstKey, commandId);
      }
      entry.registeredKeybindingKeys = [];

      // Clean up tab change subscriptions
      for (const unsub of entry.registeredTabChangeUnsubscribers) {
        unsub();
      }
      entry.registeredTabChangeUnsubscribers = [];

      // Remove all event listeners registered by this plugin
      for (const [topic, listeners] of this.pluginEventListeners) {
        const remaining = listeners.filter((listener) => listener.pluginId !== pluginId);
        if (remaining.length === 0) {
          this.pluginEventListeners.delete(topic);
        } else {
          this.pluginEventListeners.set(topic, remaining);
        }
      }

      entry.isActive = false;

      this.emitManagerEvent({
        type: "plugin-deactivated",
        pluginId,
        manifest: entry.plugin.manifest,
      });
      this.emitManagerEvent({
        type: "plugins-changed",
        pluginId,
        manifest: entry.plugin.manifest,
      });
    } catch (error) {
      logger.error("PluginManager", `Failed to deactivate plugin "${pluginId}":`, error);
    }
  }

  async activateAll(): Promise<void> {
    for (const [id] of this.plugins) {
      await this.activate(id);
    }
  }

  getManifests(): PluginManifest[] {
    return Array.from(this.plugins.values()).map((e) => e.plugin.manifest);
  }

  isActive(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.isActive ?? false;
  }

  getCommands(): PluginCommand[] {
    const commands: PluginCommand[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.isActive && entry.plugin.manifest.commands) {
        commands.push(...entry.plugin.manifest.commands);
      }
    }
    return commands;
  }

  async executeCommand(commandId: string): Promise<void> {
    const handler = this.commandHandlers.get(commandId);
    if (!handler) {
      logger.warn("PluginManager", `Command "${commandId}" is not registered.`);
      return;
    }
    try {
      await handler();
    } catch (error) {
      logger.error("PluginManager", `Failed to execute command "${commandId}":`, error);
    }
  }

  async loadExternalPlugins(): Promise<void> {
    if (!(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return;

    const { invoke } = await import("@tauri-apps/api/core");

    let rawPlugins: Array<{ manifest_json: string; script_content: string }>;
    try {
      rawPlugins = await invoke("get_external_plugins");
    } catch (error) {
      logger.error("PluginManager", "Error al leer plugins externos:", error);
      return;
    }

    for (const info of rawPlugins) {
      let manifest: PluginManifest;
      try {
        manifest = JSON.parse(info.manifest_json);
      } catch {
        logger.error("PluginManager", "Invalid manifest.json, skipping plugin.");
        continue;
      }

      // Skip already-registered plugins (e.g. StrictMode double-effect, refresh)
      if (this.plugins.has(manifest.id)) continue;

      try {
        const blob = new Blob([info.script_content], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        const module = await import(/* @vite-ignore */ url);
        URL.revokeObjectURL(url);

        if (!module.default) {
          logger.warn("PluginManager", `El plugin "${manifest.id}" no tiene export default.`);
          continue;
        }

        module.default.manifest = manifest;
        this.register(module.default);
      } catch (error) {
        logger.error("PluginManager", `Error cargando plugin "${manifest.id}":`, error);
      }
    }
  }

  loadInternalPlugins(): void {
    const modules = import.meta.glob<{ default: Plugin }>("/src/plugins/internal/*/index.ts", {
      eager: true,
    });
    for (const module of Object.values(modules)) {
      this.register(module.default);
    }
  }

  /**
   * Subscribe to high-level manager events (activation, deactivation, changes).
   * This is intended for host components (for example React hooks), not for plugins.
   */
  subscribe(listener: (event: PluginManagerEvent) => void): () => void {
    this.managerListeners.add(listener);
    return () => {
      this.managerListeners.delete(listener);
    };
  }

  private emitManagerEvent(event: PluginManagerEvent): void {
    for (const listener of this.managerListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error("PluginManager", "Error in PluginManager event listener", error);
      }
    }
  }
}

export const PluginManager = new PluginManagerClass();
