import { describe, it, expect, beforeEach, vi } from "vitest";
import { KeyNormalizerClass } from "./key-normalizer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeKeyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    ...overrides,
  } as KeyboardEvent;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("KeyNormalizer", () => {
  let normalizer: KeyNormalizerClass;

  beforeEach(() => {
    normalizer = new KeyNormalizerClass();
    vi.restoreAllMocks();
  });

  // ── normalizeString — alias normalization ───────────────────────────────────

  describe("normalizeString — alias normalization", () => {
    it("KN-01: ctrl alias maps to ctrl", () => {
      expect(normalizer.normalizeString("ctrl+k")).toBe("ctrl+k");
    });

    it("KN-01: control alias maps to ctrl", () => {
      expect(normalizer.normalizeString("control+k")).toBe("ctrl+k");
    });

    it("KN-02: cmd alias maps to meta", () => {
      expect(normalizer.normalizeString("cmd+k")).toBe("meta+k");
    });

    it("KN-02: command alias maps to meta", () => {
      expect(normalizer.normalizeString("command+k")).toBe("meta+k");
    });

    it("KN-03: return alias maps to enter", () => {
      expect(normalizer.normalizeString("return")).toBe("enter");
    });

    it("KN-04: esc alias maps to escape", () => {
      expect(normalizer.normalizeString("esc")).toBe("escape");
    });

    it("KN-04: Escape maps to escape", () => {
      expect(normalizer.normalizeString("Escape")).toBe("escape");
    });
  });

  // ── normalizeString — case insensitivity ────────────────────────────────────

  describe("normalizeString — case insensitivity", () => {
    it("KN-05: uppercase CTRL+SHIFT+K lowercases correctly", () => {
      expect(normalizer.normalizeString("CTRL+SHIFT+K")).toBe("ctrl+shift+k");
    });

    it("KN-05: mixed case Ctrl+Alt+Delete lowercases correctly", () => {
      expect(normalizer.normalizeString("Ctrl+Alt+Delete")).toBe("ctrl+alt+delete");
    });
  });

  // ── normalizeString — single key ────────────────────────────────────────────

  describe("normalizeString — single key", () => {
    it("KN-06: single letter key passes through lowercase", () => {
      expect(normalizer.normalizeString("A")).toBe("a");
    });

    it("KN-06: single digit key passes through", () => {
      expect(normalizer.normalizeString("1")).toBe("1");
    });

    it("KN-06: enter key is normalized", () => {
      expect(normalizer.normalizeString("Enter")).toBe("enter");
    });
  });

  // ── normalizeChord — chord splitting ────────────────────────────────────────

  describe("normalizeChord — chord splitting", () => {
    it("KN-07: two-segment chord splits into two NormalizedKeys", () => {
      const chord = normalizer.normalizeChord("ctrl+k ctrl+b");
      expect(chord).toHaveLength(2);
      expect(chord[0]).toBe("ctrl+k");
      expect(chord[1]).toBe("ctrl+b");
    });

    it("KN-07: single segment chord produces one-element tuple", () => {
      const chord = normalizer.normalizeChord("ctrl+k");
      expect(chord).toHaveLength(1);
      expect(chord[0]).toBe("ctrl+k");
    });

    it("KN-07: two-segment chord with aliases is normalized", () => {
      const chord = normalizer.normalizeChord("control+k cmd+b");
      expect(chord).toHaveLength(2);
      expect(chord[0]).toBe("ctrl+k");
      expect(chord[1]).toBe("meta+b");
    });
  });

  // ── normalizeString — unknown keys passthrough ──────────────────────────────

  describe("normalizeString — unknown keys passthrough", () => {
    it("KN-08: unknown key passes through lowercased", () => {
      expect(normalizer.normalizeString("MyWeirdKey")).toBe("myweirdkey");
    });

    it("KN-08: unknown key with modifier passes through", () => {
      expect(normalizer.normalizeString("ctrl+Foo")).toBe("ctrl+foo");
    });
  });

  // ── normalize (KeyboardEvent) ────────────────────────────────────────────────

  describe("normalize — KeyboardEvent", () => {
    it("returns null for Unidentified key", () => {
      const event = makeKeyboardEvent({ key: "Unidentified" });
      expect(normalizer.normalize(event)).toBeNull();
    });

    it("returns null when isComposing is true (IME guard)", () => {
      const event = makeKeyboardEvent({ key: "a", isComposing: true });
      expect(normalizer.normalize(event)).toBeNull();
    });

    it("returns null for lone modifier key (Shift)", () => {
      const event = makeKeyboardEvent({ key: "Shift", shiftKey: true });
      expect(normalizer.normalize(event)).toBeNull();
    });

    it("returns null for lone modifier key (Control)", () => {
      const event = makeKeyboardEvent({ key: "Control", ctrlKey: true });
      expect(normalizer.normalize(event)).toBeNull();
    });

    it("returns null for lone modifier key (Meta)", () => {
      const event = makeKeyboardEvent({ key: "Meta", metaKey: true });
      expect(normalizer.normalize(event)).toBeNull();
    });

    it("normalizes ctrl+k from KeyboardEvent", () => {
      const event = makeKeyboardEvent({ key: "k", ctrlKey: true });
      expect(normalizer.normalize(event)).toBe("ctrl+k");
    });

    it("normalizes ctrl+shift+k from KeyboardEvent", () => {
      const event = makeKeyboardEvent({ key: "k", ctrlKey: true, shiftKey: true });
      expect(normalizer.normalize(event)).toBe("ctrl+shift+k");
    });

    it("normalizes plain Enter from KeyboardEvent", () => {
      const event = makeKeyboardEvent({ key: "Enter" });
      expect(normalizer.normalize(event)).toBe("enter");
    });

    it("normalizes Escape from KeyboardEvent", () => {
      const event = makeKeyboardEvent({ key: "Escape" });
      expect(normalizer.normalize(event)).toBe("escape");
    });

    it("normalizes space key from KeyboardEvent", () => {
      const event = makeKeyboardEvent({ key: " " });
      expect(normalizer.normalize(event)).toBe("space");
    });

    it("modifiers follow canonical order ctrl→alt→shift→meta", () => {
      const event = makeKeyboardEvent({
        key: "k",
        shiftKey: true,
        ctrlKey: true,
        altKey: true,
        metaKey: true,
      });
      expect(normalizer.normalize(event)).toBe("ctrl+alt+shift+meta+k");
    });
  });
});
