import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginManagerClass } from "./plugin-manager";
import type { Plugin, PluginManifest, PluginAPI } from "./types";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlugin(id: string, overrides?: Partial<PluginManifest>): Plugin {
  return {
    manifest: { id, name: id, version: "1.0.0", ...overrides },
    activate: vi.fn(),
    deactivate: vi.fn(),
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("PluginManager", () => {
  let manager: PluginManagerClass;

  beforeEach(() => {
    manager = new PluginManagerClass();
    vi.clearAllMocks();
  });

  // ── register ───────────────────────────────────────────────────────────────

  describe("register", () => {
    it("1. registers a plugin successfully", () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      const manifests = manager.getManifests();
      expect(manifests).toHaveLength(1);
      expect(manifests[0].id).toBe("foo");
    });

    it("2. warns and skips if plugin with same id is already registered", async () => {
      const { logger } = await import("@/core/logger");
      const plugin = makePlugin("foo");
      manager.register(plugin);
      manager.register(plugin);
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(manager.getManifests()).toHaveLength(1);
    });

    it("3. warns and skips if a dependency is not registered", async () => {
      const { logger } = await import("@/core/logger");
      const plugin = makePlugin("bar", { dependencies: ["missing-dep"] });
      manager.register(plugin);
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(manager.getManifests()).toHaveLength(0);
    });

    it("4. registers successfully when dependency is registered first", () => {
      const dep = makePlugin("dep-a");
      const plugin = makePlugin("bar", { dependencies: ["dep-a"] });
      manager.register(dep);
      manager.register(plugin);
      const manifests = manager.getManifests();
      expect(manifests).toHaveLength(2);
      expect(manifests.map((m) => m.id)).toContain("bar");
    });

    it("5. getManifests() returns manifests of all registered plugins", () => {
      manager.register(makePlugin("p1"));
      manager.register(makePlugin("p2"));
      manager.register(makePlugin("p3"));
      const manifests = manager.getManifests();
      expect(manifests).toHaveLength(3);
      expect(manifests.map((m) => m.id)).toEqual(expect.arrayContaining(["p1", "p2", "p3"]));
    });
  });

  // ── activate ───────────────────────────────────────────────────────────────

  describe("activate", () => {
    it("6. calls plugin.activate(api) when activating", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      await manager.activate("foo");
      expect(plugin.activate).toHaveBeenCalledOnce();
      // The argument should be a PluginAPI object with the expected shape
      const api = (plugin.activate as ReturnType<typeof vi.fn>).mock.calls[0][0] as PluginAPI;
      expect(typeof api.registerCommand).toBe("function");
      expect(typeof api.onEvent).toBe("function");
      expect(typeof api.emitEvent).toBe("function");
    });

    it("7. sets isActive=true after activation", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      expect(manager.isActive("foo")).toBe(false);
      await manager.activate("foo");
      expect(manager.isActive("foo")).toBe(true);
    });

    it("8. warns and does nothing if plugin not registered", async () => {
      const { logger } = await import("@/core/logger");
      await manager.activate("ghost");
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it("9. does nothing if plugin already active (activate not called twice)", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      await manager.activate("foo");
      await manager.activate("foo");
      expect(plugin.activate).toHaveBeenCalledOnce();
    });

    it("10. emits plugin-activated event to manager subscribers", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      const listener = vi.fn();
      manager.subscribe(listener);
      await manager.activate("foo");
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "plugin-activated", pluginId: "foo" })
      );
    });

    it("11. emits plugins-changed event to manager subscribers", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      const listener = vi.fn();
      manager.subscribe(listener);
      await manager.activate("foo");
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "plugins-changed", pluginId: "foo" })
      );
    });

    it("12. warns if manifest declares a command but no handler is registered in activate()", async () => {
      const { logger } = await import("@/core/logger");
      // Plugin declares a command but its activate() does NOT call api.registerCommand
      const plugin = makePlugin("foo", {
        commands: [{ id: "foo.doSomething", name: "Do Something" }],
      });
      // activate is a no-op — does not register any command
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
      manager.register(plugin);
      await manager.activate("foo");
      expect(logger.warn).toHaveBeenCalledWith(
        "PluginManager",
        expect.stringContaining("foo.doSomething")
        // no data arg — warn is called with (category, message)
      );
    });
  });

  // ── deactivate ─────────────────────────────────────────────────────────────

  describe("deactivate", () => {
    it("13. calls plugin.deactivate() when deactivating", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      await manager.activate("foo");
      await manager.deactivate("foo");
      expect(plugin.deactivate).toHaveBeenCalledOnce();
    });

    it("14. sets isActive=false after deactivation", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      await manager.activate("foo");
      expect(manager.isActive("foo")).toBe(true);
      await manager.deactivate("foo");
      expect(manager.isActive("foo")).toBe(false);
    });

    it("15. does nothing if plugin not active", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      // Never activated — deactivate should be a no-op
      await manager.deactivate("foo");
      expect(plugin.deactivate).not.toHaveBeenCalled();
    });

    it("16. emits plugin-deactivated event", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      await manager.activate("foo");
      const listener = vi.fn();
      manager.subscribe(listener);
      await manager.deactivate("foo");
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "plugin-deactivated", pluginId: "foo" })
      );
    });

    it("17. emits plugins-changed event on deactivation", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      await manager.activate("foo");
      const listener = vi.fn();
      manager.subscribe(listener);
      await manager.deactivate("foo");
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "plugins-changed", pluginId: "foo" })
      );
    });
  });

  // ── command bus ────────────────────────────────────────────────────────────

  describe("command bus", () => {
    it("18. registerCommandHandler registers a handler", async () => {
      const handler = vi.fn();
      manager.registerCommandHandler("cmd.test", handler);
      await manager.executeCommand("cmd.test");
      expect(handler).toHaveBeenCalledOnce();
    });

    it("19. warns if same command id registered twice", async () => {
      const { logger } = await import("@/core/logger");
      manager.registerCommandHandler("cmd.dup", vi.fn());
      manager.registerCommandHandler("cmd.dup", vi.fn());
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it("20. executeCommand calls the handler", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      manager.registerCommandHandler("cmd.run", handler);
      await manager.executeCommand("cmd.run");
      expect(handler).toHaveBeenCalledOnce();
    });

    it("21. executeCommand warns if handler not found", async () => {
      const { logger } = await import("@/core/logger");
      await manager.executeCommand("cmd.nonexistent");
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it("22. deactivation removes command handlers registered by the plugin", async () => {
      const handler = vi.fn();
      const plugin = makePlugin("foo");
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.registerCommand("foo.cmd", handler);
      });
      manager.register(plugin);
      await manager.activate("foo");

      // Command is reachable
      await manager.executeCommand("foo.cmd");
      expect(handler).toHaveBeenCalledOnce();

      await manager.deactivate("foo");

      // Handler has been removed — executeCommand should warn
      vi.clearAllMocks();
      const { logger } = await import("@/core/logger");
      await manager.executeCommand("foo.cmd");
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it("23. getCommands() returns commands of active plugins only", async () => {
      const commands = [{ id: "foo.cmd", name: "Foo Command" }];
      const plugin = makePlugin("foo", { commands });
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.registerCommand("foo.cmd", vi.fn());
      });
      manager.register(plugin);

      // Before activation: no commands
      expect(manager.getCommands()).toHaveLength(0);

      await manager.activate("foo");
      expect(manager.getCommands()).toHaveLength(1);
      expect(manager.getCommands()[0].id).toBe("foo.cmd");

      await manager.deactivate("foo");
      expect(manager.getCommands()).toHaveLength(0);
    });
  });

  // ── manager event subscription ─────────────────────────────────────────────

  describe("manager event subscription", () => {
    it("24. subscribe receives events", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      const received: string[] = [];
      manager.subscribe((event) => received.push(event.type));
      await manager.activate("foo");
      expect(received).toContain("plugin-activated");
      expect(received).toContain("plugins-changed");
    });

    it("25. unsubscribe (returned cleanup fn) stops receiving events", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      const listener = vi.fn();
      const unsubscribe = manager.subscribe(listener);
      unsubscribe();
      await manager.activate("foo");
      expect(listener).not.toHaveBeenCalled();
    });

    it("26. errors in subscriber do not crash the manager", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);
      manager.subscribe(() => {
        throw new Error("subscriber exploded");
      });
      // Should not throw
      await expect(manager.activate("foo")).resolves.toBeUndefined();
      expect(manager.isActive("foo")).toBe(true);
    });
  });

  // ── plugin event bus (pub/sub) ─────────────────────────────────────────────

  describe("plugin event bus (pub/sub)", () => {
    it("27. api.onEvent(topic, handler) registers listener", async () => {
      const handler = vi.fn();
      const plugin = makePlugin("foo");
      (plugin.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.onEvent("myTopic", handler);
      });
      manager.register(plugin);
      await manager.activate("foo");

      // Emit from another plugin that shares the same manager
      const emitter = makePlugin("emitter");
      (emitter.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.emitEvent("myTopic", { data: 42 });
      });
      manager.register(emitter);
      await manager.activate("emitter");

      expect(handler).toHaveBeenCalledWith({ data: 42 });
    });

    it("28. api.emitEvent(topic, payload) calls registered listeners with payload", async () => {
      const handler = vi.fn();
      const listener = makePlugin("listener");
      (listener.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.onEvent("evt.ping", handler);
      });
      const emitter = makePlugin("emitter");
      (emitter.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.emitEvent("evt.ping", "hello");
      });

      manager.register(listener);
      await manager.activate("listener");

      manager.register(emitter);
      await manager.activate("emitter");

      expect(handler).toHaveBeenCalledWith("hello");
    });

    it("29. emit to topic with no listeners does nothing (no error)", async () => {
      const emitter = makePlugin("emitter");
      (emitter.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        // No one subscribed to this topic
        api.emitEvent("silent.topic", { value: 1 });
      });
      manager.register(emitter);
      await expect(manager.activate("emitter")).resolves.toBeUndefined();
    });

    it("30. deactivation removes all event listeners registered by the plugin", async () => {
      const handler = vi.fn();
      const listener = makePlugin("listener");
      (listener.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.onEvent("data.update", handler);
      });
      const emitter = makePlugin("emitter");
      (emitter.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.emitEvent("data.update", "payload");
      });

      manager.register(listener);
      await manager.activate("listener");
      manager.register(emitter);
      await manager.activate("emitter");

      expect(handler).toHaveBeenCalledOnce();

      // Deactivate the listener plugin — its handlers must be removed
      await manager.deactivate("listener");

      // Re-activate emitter to trigger another emit
      await manager.deactivate("emitter");
      handler.mockClear();
      await manager.activate("emitter");

      expect(handler).not.toHaveBeenCalled();
    });

    it("31. multiple plugins can listen to same topic; all receive the event", async () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      const pluginA = makePlugin("a");
      (pluginA.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.onEvent("shared.topic", handlerA);
      });

      const pluginB = makePlugin("b");
      (pluginB.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.onEvent("shared.topic", handlerB);
      });

      const emitter = makePlugin("emitter");
      (emitter.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.emitEvent("shared.topic", "broadcast");
      });

      manager.register(pluginA);
      manager.register(pluginB);
      manager.register(emitter);

      await manager.activate("a");
      await manager.activate("b");
      await manager.activate("emitter");

      expect(handlerA).toHaveBeenCalledWith("broadcast");
      expect(handlerB).toHaveBeenCalledWith("broadcast");
    });

    it("32. error in plugin event handler is caught and does not crash others", async () => {
      const { logger } = await import("@/core/logger");
      const brokenHandler = vi.fn().mockImplementation(() => {
        throw new Error("handler exploded");
      });
      const safeHandler = vi.fn();

      const broken = makePlugin("broken");
      (broken.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.onEvent("crash.topic", brokenHandler);
      });

      const safe = makePlugin("safe");
      (safe.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.onEvent("crash.topic", safeHandler);
      });

      const emitter = makePlugin("emitter");
      (emitter.activate as ReturnType<typeof vi.fn>).mockImplementation((api: PluginAPI) => {
        api.emitEvent("crash.topic", "data");
      });

      manager.register(broken);
      manager.register(safe);
      manager.register(emitter);

      await manager.activate("broken");
      await manager.activate("safe");
      await manager.activate("emitter");

      // brokenHandler threw but safeHandler still ran
      expect(brokenHandler).toHaveBeenCalled();
      expect(safeHandler).toHaveBeenCalledWith("data");
      // The error should have been logged
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ── activateAll ────────────────────────────────────────────────────────────

  describe("activateAll", () => {
    it("33. activates all registered plugins", async () => {
      const p1 = makePlugin("p1");
      const p2 = makePlugin("p2");
      const p3 = makePlugin("p3");
      manager.register(p1);
      manager.register(p2);
      manager.register(p3);
      await manager.activateAll();
      expect(manager.isActive("p1")).toBe(true);
      expect(manager.isActive("p2")).toBe(true);
      expect(manager.isActive("p3")).toBe(true);
    });
  });

  // ── isActive ───────────────────────────────────────────────────────────────

  describe("isActive", () => {
    it("34. returns correct active state", async () => {
      const plugin = makePlugin("foo");
      manager.register(plugin);

      expect(manager.isActive("foo")).toBe(false);
      expect(manager.isActive("nonexistent")).toBe(false);

      await manager.activate("foo");
      expect(manager.isActive("foo")).toBe(true);

      await manager.deactivate("foo");
      expect(manager.isActive("foo")).toBe(false);
    });
  });
});
