import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChordBuffer } from "./chord-buffer";
import type { NormalizedKey, KeyChord } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function key(s: string): NormalizedKey {
  return s as NormalizedKey;
}

function chord(...keys: string[]): KeyChord {
  if (keys.length === 1) return [key(keys[0])] as KeyChord;
  return [key(keys[0]), key(keys[1])] as KeyChord;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("ChordBuffer", () => {
  let buffer: ChordBuffer;

  beforeEach(() => {
    vi.useFakeTimers();
    buffer = new ChordBuffer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── empty buffer ───────────────────────────────────────────────────────────

  describe("empty buffer", () => {
    it("matches nothing when no keys have been pushed", () => {
      expect(buffer.matches(chord("ctrl+k"))).toBe("none");
    });

    it("matches nothing against a two-key chord when empty", () => {
      expect(buffer.matches(chord("ctrl+k", "ctrl+b"))).toBe("none");
    });
  });

  // ── single-key full match ──────────────────────────────────────────────────

  describe("single-key full match", () => {
    it("returns full when the pushed key matches a single-segment chord", () => {
      buffer.push(key("ctrl+k"));
      expect(buffer.matches(chord("ctrl+k"))).toBe("full");
    });

    it("returns none when the pushed key does not match", () => {
      buffer.push(key("ctrl+j"));
      expect(buffer.matches(chord("ctrl+k"))).toBe("none");
    });
  });

  // ── two-key chord: partial then full ──────────────────────────────────────

  describe("two-key chord: partial then full", () => {
    it("returns partial after first key of a two-key chord", () => {
      buffer.push(key("ctrl+k"));
      expect(buffer.matches(chord("ctrl+k", "ctrl+b"))).toBe("partial");
    });

    it("returns full after both keys of a two-key chord", () => {
      buffer.push(key("ctrl+k"));
      buffer.push(key("ctrl+b"));
      expect(buffer.matches(chord("ctrl+k", "ctrl+b"))).toBe("full");
    });

    it("returns none when second key does not match", () => {
      buffer.push(key("ctrl+k"));
      buffer.push(key("ctrl+x"));
      expect(buffer.matches(chord("ctrl+k", "ctrl+b"))).toBe("none");
    });
  });

  // ── timeout auto-clear ─────────────────────────────────────────────────────

  describe("timeout auto-clear", () => {
    it("clears buffer after default 1500ms timeout", () => {
      buffer.push(key("ctrl+k"));
      expect(buffer.length).toBe(1);

      vi.advanceTimersByTime(1500);

      expect(buffer.length).toBe(0);
      expect(buffer.matches(chord("ctrl+k"))).toBe("none");
    });

    it("does not clear before 1500ms have elapsed", () => {
      buffer.push(key("ctrl+k"));
      vi.advanceTimersByTime(1499);
      expect(buffer.length).toBe(1);
    });

    it("resets timeout on each push", () => {
      buffer.push(key("ctrl+k"));
      vi.advanceTimersByTime(1000);
      buffer.push(key("ctrl+b")); // reset timer
      vi.advanceTimersByTime(1000); // only 1000ms since last push
      expect(buffer.length).toBe(2); // not cleared yet
      vi.advanceTimersByTime(500); // now 1500ms since last push
      expect(buffer.length).toBe(0);
    });

    it("respects custom timeout", () => {
      const custom = new ChordBuffer(500);
      custom.push(key("ctrl+k"));
      vi.advanceTimersByTime(499);
      expect(custom.length).toBe(1);
      vi.advanceTimersByTime(1);
      expect(custom.length).toBe(0);
    });
  });

  // ── clear() resets state ───────────────────────────────────────────────────

  describe("clear()", () => {
    it("resets pending state immediately", () => {
      buffer.push(key("ctrl+k"));
      buffer.push(key("ctrl+b"));
      buffer.clear();
      expect(buffer.length).toBe(0);
      expect(buffer.matches(chord("ctrl+k"))).toBe("none");
    });

    it("cancels the timer when clear() is called", () => {
      buffer.push(key("ctrl+k"));
      buffer.clear();
      // Timer is cancelled — advancing time should not throw or cause side effects
      vi.advanceTimersByTime(2000);
      expect(buffer.length).toBe(0);
    });
  });
});
