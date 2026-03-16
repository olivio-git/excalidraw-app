import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { KeybindingServiceClass } from "./keybinding-service";
import { KeybindingRegistryClass } from "./keybinding-registry";
import { KeybindingSource } from "./types";
import type { KeybindingEntry, NormalizedKey, KeyChord } from "./types";

// ── Mock PluginManager ────────────────────────────────────────────────────────

vi.mock("../../plugins/plugin-manager", () => ({
  PluginManager: {
    executeCommand: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock contextKeyService ─────────────────────────────────────────────────────

vi.mock("./context-key-service", () => ({
  contextKeyService: {
    evaluate: vi.fn().mockReturnValue(true),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function key(s: string): NormalizedKey {
  return s as NormalizedKey;
}

function chord(...keys: string[]): KeyChord {
  if (keys.length === 1) return [key(keys[0])] as KeyChord;
  return [key(keys[0]), key(keys[1])] as KeyChord;
}

function makeEntry(
  commandId: string,
  chordKeys: string | string[],
  overrides?: Partial<KeybindingEntry>
): KeybindingEntry {
  const c = Array.isArray(chordKeys) ? chord(...chordKeys) : chord(chordKeys);
  return {
    commandId,
    chord: c,
    source: KeybindingSource.Builtin,
    ...overrides,
  };
}

/**
 * Build a minimal KeyboardEvent-like object.
 * key-normalizer.normalize() reads: isComposing, key, ctrlKey, altKey, shiftKey, metaKey.
 * We also need a target for input guard checks and preventDefault spy.
 */
function makeEvent(overrides: Partial<KeyboardEvent> & { targetEl?: Element }): KeyboardEvent {
  const target = overrides.targetEl ?? document.body;
  const event = {
    key: "a",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    target,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
  return event;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("KeybindingService", () => {
  let service: KeybindingServiceClass;
  let registry: KeybindingRegistryClass;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-import mocked modules to configure them per-test
    const { contextKeyService } = await import("./context-key-service");
    vi.mocked(contextKeyService.evaluate).mockReturnValue(true);

    const { PluginManager } = await import("../../plugins/plugin-manager");
    vi.mocked(PluginManager.executeCommand).mockResolvedValue(undefined);

    // Create a fresh registry and inject it via the module mock
    registry = new KeybindingRegistryClass();

    // We test KeybindingServiceClass directly — it imports keybindingRegistry singleton.
    // We need to control the registry used by the service.
    // Since we cannot swap the singleton, we spy on keybindingRegistry methods.
    service = new KeybindingServiceClass();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── registered command executes on matching key ───────────────────────────

  describe("registered command executes on matching key", () => {
    it("calls executeCommand when a matching single-key binding is found", async () => {
      const { PluginManager } = await import("../../plugins/plugin-manager");

      // Spy on keybindingRegistry to return a matching entry
      const { keybindingRegistry } = await import("./keybinding-registry");
      const entry = makeEntry("editor.save", "ctrl+s");
      vi.spyOn(keybindingRegistry, "resolve").mockReturnValue(entry);
      vi.spyOn(keybindingRegistry, "getAll").mockReturnValue([entry]);

      const event = makeEvent({ key: "s", ctrlKey: true });
      const result = service.handleKeyEvent(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(PluginManager.executeCommand).toHaveBeenCalledWith("editor.save");
    });
  });

  // ── returns false when no binding found ──────────────────────────────────

  describe("returns false when no binding found", () => {
    it("returns false and does not call executeCommand when no entry matches", async () => {
      const { PluginManager } = await import("../../plugins/plugin-manager");
      const { keybindingRegistry } = await import("./keybinding-registry");

      vi.spyOn(keybindingRegistry, "resolve").mockReturnValue(null);
      vi.spyOn(keybindingRegistry, "getAll").mockReturnValue([]);

      const event = makeEvent({ key: "x", ctrlKey: true });
      const result = service.handleKeyEvent(event);

      expect(result).toBe(false);
      expect(PluginManager.executeCommand).not.toHaveBeenCalled();
    });
  });

  // ── skips isComposing events ──────────────────────────────────────────────

  describe("skips isComposing events", () => {
    it("returns false and does not normalize/dispatch when event.isComposing is true", async () => {
      const { PluginManager } = await import("../../plugins/plugin-manager");
      const { keybindingRegistry } = await import("./keybinding-registry");

      const resolveSpy = vi.spyOn(keybindingRegistry, "resolve");

      const event = makeEvent({ key: "a", isComposing: true });
      const result = service.handleKeyEvent(event);

      expect(result).toBe(false);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(PluginManager.executeCommand).not.toHaveBeenCalled();
    });
  });

  // ── skips input element targets ───────────────────────────────────────────

  describe("skips input element targets", () => {
    it("returns false when target is an INPUT element", async () => {
      const { PluginManager } = await import("../../plugins/plugin-manager");
      const { keybindingRegistry } = await import("./keybinding-registry");

      const entry = makeEntry("editor.save", "ctrl+s");
      vi.spyOn(keybindingRegistry, "resolve").mockReturnValue(entry);
      vi.spyOn(keybindingRegistry, "getAll").mockReturnValue([entry]);

      const input = document.createElement("input");
      const event = makeEvent({ key: "s", ctrlKey: true, targetEl: input });
      const result = service.handleKeyEvent(event);

      expect(result).toBe(false);
      expect(PluginManager.executeCommand).not.toHaveBeenCalled();
    });

    it("returns false when target is a TEXTAREA element", async () => {
      const { PluginManager } = await import("../../plugins/plugin-manager");
      const { keybindingRegistry } = await import("./keybinding-registry");

      const entry = makeEntry("editor.save", "ctrl+s");
      vi.spyOn(keybindingRegistry, "resolve").mockReturnValue(entry);
      vi.spyOn(keybindingRegistry, "getAll").mockReturnValue([entry]);

      const textarea = document.createElement("textarea");
      const event = makeEvent({ key: "s", ctrlKey: true, targetEl: textarea });
      const result = service.handleKeyEvent(event);

      expect(result).toBe(false);
      expect(PluginManager.executeCommand).not.toHaveBeenCalled();
    });

    it('returns false when target has contenteditable="true"', async () => {
      const { PluginManager } = await import("../../plugins/plugin-manager");
      const { keybindingRegistry } = await import("./keybinding-registry");

      const entry = makeEntry("editor.save", "ctrl+s");
      vi.spyOn(keybindingRegistry, "resolve").mockReturnValue(entry);
      vi.spyOn(keybindingRegistry, "getAll").mockReturnValue([entry]);

      const div = document.createElement("div");
      div.setAttribute("contenteditable", "true");
      const event = makeEvent({ key: "s", ctrlKey: true, targetEl: div });
      const result = service.handleKeyEvent(event);

      expect(result).toBe(false);
      expect(PluginManager.executeCommand).not.toHaveBeenCalled();
    });
  });

  // ── chord sequence resolves correctly ────────────────────────────────────

  describe("chord sequence resolves correctly", () => {
    it("returns false on first key of a two-key chord (partial match)", async () => {
      const { PluginManager } = await import("../../plugins/plugin-manager");
      const { keybindingRegistry } = await import("./keybinding-registry");
      const { contextKeyService } = await import("./context-key-service");

      const twoKeyEntry = makeEntry("editor.format", ["ctrl+k", "ctrl+f"]);
      // getAll returns the two-key entry — service will detect partial
      vi.spyOn(keybindingRegistry, "getAll").mockReturnValue([twoKeyEntry]);
      vi.mocked(contextKeyService.evaluate).mockReturnValue(true);

      const event1 = makeEvent({ key: "k", ctrlKey: true });
      const result1 = service.handleKeyEvent(event1);

      expect(result1).toBe(false);
      // preventDefault is called to consume the partial chord key
      expect(event1.preventDefault).toHaveBeenCalled();
      expect(PluginManager.executeCommand).not.toHaveBeenCalled();
    });

    it("dispatches command after both keys of a two-key chord are pressed", async () => {
      const { PluginManager } = await import("../../plugins/plugin-manager");
      const { keybindingRegistry } = await import("./keybinding-registry");
      const { contextKeyService } = await import("./context-key-service");

      const twoKeyEntry = makeEntry("editor.format", ["ctrl+k", "ctrl+f"]);
      vi.spyOn(keybindingRegistry, "getAll").mockReturnValue([twoKeyEntry]);
      vi.spyOn(keybindingRegistry, "resolve").mockReturnValue(twoKeyEntry);
      vi.mocked(contextKeyService.evaluate).mockReturnValue(true);

      const event1 = makeEvent({ key: "k", ctrlKey: true });
      service.handleKeyEvent(event1);

      const event2 = makeEvent({ key: "f", ctrlKey: true });
      const result2 = service.handleKeyEvent(event2);

      expect(result2).toBe(true);
      expect(event2.preventDefault).toHaveBeenCalled();
      expect(PluginManager.executeCommand).toHaveBeenCalledWith("editor.format");
    });

    it("cancels chord silently when second key does not complete any binding", async () => {
      const { PluginManager } = await import("../../plugins/plugin-manager");
      const { keybindingRegistry } = await import("./keybinding-registry");
      const { contextKeyService } = await import("./context-key-service");

      const twoKeyEntry = makeEntry("editor.format", ["ctrl+k", "ctrl+f"]);
      vi.spyOn(keybindingRegistry, "getAll").mockReturnValue([twoKeyEntry]);
      // Second key resolves to nothing
      vi.spyOn(keybindingRegistry, "resolve").mockReturnValue(null);
      vi.mocked(contextKeyService.evaluate).mockReturnValue(true);

      const event1 = makeEvent({ key: "k", ctrlKey: true });
      service.handleKeyEvent(event1);

      const event2 = makeEvent({ key: "x", ctrlKey: true });
      const result2 = service.handleKeyEvent(event2);

      expect(result2).toBe(false);
      expect(PluginManager.executeCommand).not.toHaveBeenCalled();
    });
  });

  // ── when clause filters correctly ─────────────────────────────────────────

  describe("when clause filters correctly", () => {
    it("does not dispatch when contextKeyService.evaluate returns false for entry.when", async () => {
      const { PluginManager } = await import("../../plugins/plugin-manager");
      const { keybindingRegistry } = await import("./keybinding-registry");
      const { contextKeyService } = await import("./context-key-service");

      const entry = makeEntry("editor.save", "ctrl+s", { when: "editorFocus" });
      vi.spyOn(keybindingRegistry, "getAll").mockReturnValue([entry]);
      // resolve returns null because context doesn't match (registry already filters)
      vi.spyOn(keybindingRegistry, "resolve").mockReturnValue(null);
      vi.mocked(contextKeyService.evaluate).mockReturnValue(false);

      const event = makeEvent({ key: "s", ctrlKey: true });
      const result = service.handleKeyEvent(event);

      expect(result).toBe(false);
      expect(PluginManager.executeCommand).not.toHaveBeenCalled();
    });

    it("dispatches when contextKeyService.evaluate returns true", async () => {
      const { PluginManager } = await import("../../plugins/plugin-manager");
      const { keybindingRegistry } = await import("./keybinding-registry");
      const { contextKeyService } = await import("./context-key-service");

      const entry = makeEntry("editor.save", "ctrl+s", { when: "editorFocus" });
      vi.spyOn(keybindingRegistry, "getAll").mockReturnValue([entry]);
      vi.spyOn(keybindingRegistry, "resolve").mockReturnValue(entry);
      vi.mocked(contextKeyService.evaluate).mockReturnValue(true);

      const event = makeEvent({ key: "s", ctrlKey: true });
      const result = service.handleKeyEvent(event);

      expect(result).toBe(true);
      expect(PluginManager.executeCommand).toHaveBeenCalledWith("editor.save");
    });
  });

  // ── initialize / dispose lifecycle ────────────────────────────────────────

  describe("lifecycle: initialize / dispose", () => {
    it("initialize attaches a keydown listener and dispose removes it", () => {
      const addSpy = vi.spyOn(document, "addEventListener");
      const removeSpy = vi.spyOn(document, "removeEventListener");

      const svc = new KeybindingServiceClass();
      svc.initialize();
      expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function), true);

      svc.dispose();
      expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    });
  });
});
