import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { KeybindingRegistryClass } from "./keybinding-registry";
import { KeybindingSource } from "./types";
import type { KeybindingEntry, NormalizedKey, KeyChord } from "./types";

// ── Mock contextKeyService ────────────────────────────────────────────────────
// We control context evaluation in tests by mocking the singleton.

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

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("KeybindingRegistry", () => {
  let registry: KeybindingRegistryClass;

  beforeEach(async () => {
    registry = new KeybindingRegistryClass();
    vi.clearAllMocks();
    // Default: contextKeyService.evaluate returns true (context always matches)
    const { contextKeyService } = await import("./context-key-service");
    vi.mocked(contextKeyService.evaluate).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── registerDefault ───────────────────────────────────────────────────────

  describe("registerDefault", () => {
    it("registers a default binding and returns it via getAll()", () => {
      const entry = makeEntry("editor.save", "ctrl+s");
      registry.registerDefault(entry);
      expect(registry.getAll()).toContainEqual(entry);
    });

    it("registers multiple distinct commands", () => {
      registry.registerDefault(makeEntry("editor.save", "ctrl+s"));
      registry.registerDefault(makeEntry("editor.undo", "ctrl+z"));
      const all = registry.getAll();
      expect(all).toHaveLength(2);
    });

    it("last-registered-wins for same commandId + chord", () => {
      const first = makeEntry("editor.save", "ctrl+s", { when: "editorFocus" });
      const second = makeEntry("editor.save", "ctrl+s", { when: "previewFocus" });
      registry.registerDefault(first);
      registry.registerDefault(second);
      // Should only have one entry for that commandId+chord combination
      const all = registry.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].when).toBe("previewFocus");
    });
  });

  // ── user override takes precedence ────────────────────────────────────────

  describe("user override takes precedence", () => {
    it("resolve() returns override over default for same chord", async () => {
      const { contextKeyService } = await import("./context-key-service");
      vi.mocked(contextKeyService.evaluate).mockReturnValue(true);

      registry.registerDefault(makeEntry("cmd.default", "ctrl+k"));
      registry.registerOverride(makeEntry("cmd.override", "ctrl+k"));

      const result = registry.resolve(chord("ctrl+k"));
      expect(result?.commandId).toBe("cmd.override");
      expect(result?.source).toBe(KeybindingSource.User);
    });

    it("registerOverride forces source to User regardless of entry source", () => {
      const entry = makeEntry("cmd.foo", "ctrl+f", { source: KeybindingSource.Builtin });
      registry.registerOverride(entry);
      const result = registry.resolve(chord("ctrl+f"));
      expect(result?.source).toBe(KeybindingSource.User);
    });
  });

  // ── unregister ────────────────────────────────────────────────────────────

  describe("unregister", () => {
    it("removes a default binding", () => {
      registry.registerDefault(makeEntry("editor.save", "ctrl+s"));
      registry.unregister(key("ctrl+s"), "editor.save");
      expect(registry.getAll()).toHaveLength(0);
    });

    it("removes an override binding", () => {
      registry.registerOverride(makeEntry("editor.save", "ctrl+s"));
      registry.unregister(key("ctrl+s"), "editor.save");
      expect(registry.getAll()).toHaveLength(0);
    });

    it("does not remove bindings for different commandIds", () => {
      registry.registerDefault(makeEntry("editor.save", "ctrl+s"));
      registry.registerDefault(makeEntry("editor.undo", "ctrl+z"));
      registry.unregister(key("ctrl+s"), "editor.save");
      expect(registry.getAll()).toHaveLength(1);
      expect(registry.getAll()[0].commandId).toBe("editor.undo");
    });

    it("unregister of non-existent key is a no-op", () => {
      expect(() => registry.unregister(key("ctrl+x"), "ghost.command")).not.toThrow();
    });
  });

  // ── resolve ───────────────────────────────────────────────────────────────

  describe("resolve", () => {
    it("returns the matching entry when context matches", async () => {
      const { contextKeyService } = await import("./context-key-service");
      vi.mocked(contextKeyService.evaluate).mockReturnValue(true);

      const entry = makeEntry("editor.save", "ctrl+s");
      registry.registerDefault(entry);
      expect(registry.resolve(chord("ctrl+s"))).toEqual(entry);
    });

    it("returns null when no entry is registered for the chord", () => {
      expect(registry.resolve(chord("ctrl+x"))).toBeNull();
    });

    it("returns null when context does not match the when expression", async () => {
      const { contextKeyService } = await import("./context-key-service");
      vi.mocked(contextKeyService.evaluate).mockReturnValue(false);

      registry.registerDefault(makeEntry("editor.save", "ctrl+s", { when: "editorFocus" }));
      expect(registry.resolve(chord("ctrl+s"))).toBeNull();
    });

    it("returns entry with undefined when (always active) when context mock returns true", async () => {
      const { contextKeyService } = await import("./context-key-service");
      vi.mocked(contextKeyService.evaluate).mockReturnValue(true);

      const entry = makeEntry("cmd.always", "ctrl+a");
      registry.registerDefault(entry);
      expect(registry.resolve(chord("ctrl+a"))).toEqual(entry);
    });

    it("resolves two-key chord correctly", async () => {
      const { contextKeyService } = await import("./context-key-service");
      vi.mocked(contextKeyService.evaluate).mockReturnValue(true);

      const entry = makeEntry("editor.format", ["ctrl+k", "ctrl+f"]);
      registry.registerDefault(entry);
      expect(registry.resolve(chord("ctrl+k", "ctrl+f"))).toEqual(entry);
    });

    it("does not match two-key chord when only first key is given", () => {
      const entry = makeEntry("editor.format", ["ctrl+k", "ctrl+f"]);
      registry.registerDefault(entry);
      expect(registry.resolve(chord("ctrl+k"))).toBeNull();
    });
  });

  // ── conflict detection ────────────────────────────────────────────────────

  describe("getConflicts", () => {
    it("returns empty array when no conflicts exist", () => {
      registry.registerDefault(makeEntry("cmd.a", "ctrl+a"));
      registry.registerDefault(makeEntry("cmd.b", "ctrl+b"));
      expect(registry.getConflicts()).toHaveLength(0);
    });

    it("detects conflict when two different commandIds share the same chord+when", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      registry.registerDefault(makeEntry("cmd.a", "ctrl+k"));
      registry.registerDefault(makeEntry("cmd.b", "ctrl+k"));

      const conflicts = registry.getConflicts();
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].entries[0].commandId).toBe("cmd.a");
      expect(conflicts[0].entries[1].commandId).toBe("cmd.b");

      warnSpy.mockRestore();
    });

    it("emits console.warn on conflict registration", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      registry.registerDefault(makeEntry("cmd.a", "ctrl+k"));
      registry.registerDefault(makeEntry("cmd.b", "ctrl+k"));

      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toContain("cmd.a");

      warnSpy.mockRestore();
    });

    it("does NOT conflict when same chord has different when expressions", () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);

      registry.registerDefault(makeEntry("cmd.a", "ctrl+k", { when: "editorFocus" }));
      registry.registerDefault(makeEntry("cmd.b", "ctrl+k", { when: "previewFocus" }));

      expect(registry.getConflicts()).toHaveLength(0);
    });

    it("does NOT conflict when same commandId is re-registered (last-wins update)", () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);

      registry.registerDefault(makeEntry("cmd.a", "ctrl+k"));
      registry.registerDefault(makeEntry("cmd.a", "ctrl+k", { when: "editorFocus" }));

      expect(registry.getConflicts()).toHaveLength(0);
    });
  });
});
