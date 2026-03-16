import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginManagerClass } from "./plugin-manager";
import type { Plugin, PluginAPI } from "./types";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/core/routing/route-registry", () => ({
  RouteRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
    getRoute: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("@/core/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/core/auth/store/auth-store", () => ({
  useAuthStore: {
    getState: vi.fn().mockReturnValue({
      isAuthenticated: false,
      user: null,
    }),
  },
}));

vi.mock("@/core/keybindings/keybinding-registry", () => ({
  keybindingRegistry: {
    registerDefault: vi.fn(),
    unregister: vi.fn(),
    resolve: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    getConflicts: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("@/core/keybindings/context-key-service", () => ({
  contextKeyService: {
    set: vi.fn(),
    get: vi.fn(),
    evaluate: vi.fn().mockReturnValue(true),
  },
}));

vi.mock("@/core/keybindings/key-normalizer", () => ({
  keyNormalizer: {
    normalizeChord: vi.fn((raw: string) => {
      // Simple mock: return the raw string lowercased as a single-segment chord
      const key = raw.toLowerCase() as import("@/core/keybindings/types").NormalizedKey;
      return [key] as import("@/core/keybindings/types").KeyChord;
    }),
    normalizeString: vi.fn((raw: string) => raw.toLowerCase()),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlugin(id: string): Plugin {
  return {
    manifest: { id, name: id, version: "1.0.0" },
    activate: vi.fn(),
    deactivate: vi.fn(),
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Plugin API — keybinding extensions", () => {
  let manager: PluginManagerClass;

  beforeEach(async () => {
    manager = new PluginManagerClass();
    vi.clearAllMocks();
  });

  describe("registerKeybinding", () => {
    it("1. calls keybindingRegistry.registerDefault with source plugin", async () => {
      const { keybindingRegistry } = await import("@/core/keybindings/keybinding-registry");
      const { KeybindingSource } = await import("@/core/keybindings/types");

      const plugin = makePlugin("my-plugin");
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.registerKeybinding({ key: "ctrl+k", commandId: "my-plugin.doThing" });
      });

      manager.register(plugin);
      await manager.activate("my-plugin");

      expect(keybindingRegistry.registerDefault).toHaveBeenCalledOnce();
      expect(keybindingRegistry.registerDefault).toHaveBeenCalledWith(
        expect.objectContaining({
          commandId: "my-plugin.doThing",
          source: KeybindingSource.Plugin,
        })
      );
    });

    it("2. normalizes the key string via keyNormalizer.normalizeChord", async () => {
      const { keyNormalizer } = await import("@/core/keybindings/key-normalizer");

      const plugin = makePlugin("norm-plugin");
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.registerKeybinding({ key: "Ctrl+Shift+K", commandId: "norm-plugin.cmd" });
      });

      manager.register(plugin);
      await manager.activate("norm-plugin");

      expect(keyNormalizer.normalizeChord).toHaveBeenCalledWith("Ctrl+Shift+K");
    });

    it("3. passes the when clause to the registry entry", async () => {
      const { keybindingRegistry } = await import("@/core/keybindings/keybinding-registry");

      const plugin = makePlugin("when-plugin");
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.registerKeybinding({
          key: "ctrl+e",
          commandId: "when-plugin.action",
          when: "editorFocus",
        });
      });

      manager.register(plugin);
      await manager.activate("when-plugin");

      expect(keybindingRegistry.registerDefault).toHaveBeenCalledWith(
        expect.objectContaining({ when: "editorFocus" })
      );
    });

    it("4. plugin deactivation unregisters all keybindings registered by the plugin", async () => {
      const { keybindingRegistry } = await import("@/core/keybindings/keybinding-registry");
      const { keyNormalizer } = await import("@/core/keybindings/key-normalizer");

      // Make normalizeChord return a predictable first key
      const mockFirstKey = "ctrl+k" as import("@/core/keybindings/types").NormalizedKey;
      (keyNormalizer.normalizeChord as ReturnType<typeof vi.fn>).mockReturnValue([mockFirstKey]);

      const plugin = makePlugin("cleanup-plugin");
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.registerKeybinding({ key: "ctrl+k", commandId: "cleanup-plugin.cmd" });
      });

      manager.register(plugin);
      await manager.activate("cleanup-plugin");
      await manager.deactivate("cleanup-plugin");

      expect(keybindingRegistry.unregister).toHaveBeenCalledWith(
        mockFirstKey,
        "cleanup-plugin.cmd"
      );
    });

    it("5. multiple keybindings from the same plugin are all unregistered on deactivate", async () => {
      const { keybindingRegistry } = await import("@/core/keybindings/keybinding-registry");
      const { keyNormalizer } = await import("@/core/keybindings/key-normalizer");

      const firstKeyA = "ctrl+a" as import("@/core/keybindings/types").NormalizedKey;
      const firstKeyB = "ctrl+b" as import("@/core/keybindings/types").NormalizedKey;

      (keyNormalizer.normalizeChord as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([firstKeyA])
        .mockReturnValueOnce([firstKeyB]);

      const plugin = makePlugin("multi-binding");
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.registerKeybinding({ key: "ctrl+a", commandId: "multi-binding.cmdA" });
        api.registerKeybinding({ key: "ctrl+b", commandId: "multi-binding.cmdB" });
      });

      manager.register(plugin);
      await manager.activate("multi-binding");
      await manager.deactivate("multi-binding");

      expect(keybindingRegistry.unregister).toHaveBeenCalledTimes(2);
      expect(keybindingRegistry.unregister).toHaveBeenCalledWith(firstKeyA, "multi-binding.cmdA");
      expect(keybindingRegistry.unregister).toHaveBeenCalledWith(firstKeyB, "multi-binding.cmdB");
    });
  });

  describe("registerContext", () => {
    it("6. calls contextKeyService.set with the given key and value", async () => {
      const { contextKeyService } = await import("@/core/keybindings/context-key-service");

      const plugin = makePlugin("ctx-plugin");
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.registerContext("myPlugin.featureEnabled", true);
      });

      manager.register(plugin);
      await manager.activate("ctx-plugin");

      expect(contextKeyService.set).toHaveBeenCalledWith("myPlugin.featureEnabled", true);
    });

    it("7. supports string values for context keys", async () => {
      const { contextKeyService } = await import("@/core/keybindings/context-key-service");

      const plugin = makePlugin("str-ctx-plugin");
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.registerContext("myPlugin.mode", "vim");
      });

      manager.register(plugin);
      await manager.activate("str-ctx-plugin");

      expect(contextKeyService.set).toHaveBeenCalledWith("myPlugin.mode", "vim");
    });

    it("8. supports numeric values for context keys", async () => {
      const { contextKeyService } = await import("@/core/keybindings/context-key-service");

      const plugin = makePlugin("num-ctx-plugin");
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.registerContext("myPlugin.level", 42);
      });

      manager.register(plugin);
      await manager.activate("num-ctx-plugin");

      expect(contextKeyService.set).toHaveBeenCalledWith("myPlugin.level", 42);
    });
  });
});
