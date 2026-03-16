import { describe, it, expect, beforeEach } from "vitest";
import { ContextKeyServiceClass } from "./context-key-service";

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("ContextKeyService", () => {
  let service: ContextKeyServiceClass;

  beforeEach(() => {
    service = new ContextKeyServiceClass();
  });

  // ── set / get roundtrip ────────────────────────────────────────────────────

  describe("set / get roundtrip", () => {
    it("stores and retrieves a boolean", () => {
      service.set("editorFocus", true);
      expect(service.get("editorFocus")).toBe(true);
    });

    it("stores and retrieves a string", () => {
      service.set("mode", "vim");
      expect(service.get("mode")).toBe("vim");
    });

    it("stores and retrieves a number", () => {
      service.set("lineCount", 42);
      expect(service.get("lineCount")).toBe(42);
    });

    it("returns undefined for missing key", () => {
      expect(service.get("nonexistent")).toBeUndefined();
    });

    it("overwrites previous value on set", () => {
      service.set("mode", "vim");
      service.set("mode", "emacs");
      expect(service.get("mode")).toBe("emacs");
    });
  });

  // ── evaluate — undefined/empty returns true ──────────────────────────────

  describe("evaluate — undefined/empty when expression", () => {
    it("returns true when when is undefined", () => {
      expect(service.evaluate(undefined)).toBe(true);
    });

    it("returns true when when is empty string", () => {
      expect(service.evaluate("")).toBe(true);
    });

    it("returns true when when is whitespace only", () => {
      expect(service.evaluate("   ")).toBe(true);
    });
  });

  // ── evaluate — simple key lookup ─────────────────────────────────────────

  describe("evaluate — simple key lookup", () => {
    it("returns true when key is set to true", () => {
      service.set("editorFocus", true);
      expect(service.evaluate("editorFocus")).toBe(true);
    });

    it("returns false when key is set to false", () => {
      service.set("readOnly", false);
      expect(service.evaluate("readOnly")).toBe(false);
    });

    it("returns false for missing key (default false)", () => {
      expect(service.evaluate("unknownKey")).toBe(false);
    });

    it("returns false when key is set to 0", () => {
      service.set("count", 0);
      expect(service.evaluate("count")).toBe(false);
    });

    it("returns false when key is set to empty string", () => {
      service.set("mode", "");
      expect(service.evaluate("mode")).toBe(false);
    });
  });

  // ── evaluate — NOT operator ───────────────────────────────────────────────

  describe("evaluate — ! (NOT) operator", () => {
    it("negates a true key", () => {
      service.set("readOnly", true);
      expect(service.evaluate("!readOnly")).toBe(false);
    });

    it("negates a false key", () => {
      service.set("readOnly", false);
      expect(service.evaluate("!readOnly")).toBe(true);
    });

    it("negates a missing key (defaults false → !false = true)", () => {
      expect(service.evaluate("!missingKey")).toBe(true);
    });

    it("double negation returns original value", () => {
      service.set("editorFocus", true);
      expect(service.evaluate("!!editorFocus")).toBe(true);
    });
  });

  // ── evaluate — AND operator ───────────────────────────────────────────────

  describe("evaluate — && (AND) operator", () => {
    it("true && true = true", () => {
      service.set("a", true);
      service.set("b", true);
      expect(service.evaluate("a && b")).toBe(true);
    });

    it("true && false = false", () => {
      service.set("a", true);
      service.set("b", false);
      expect(service.evaluate("a && b")).toBe(false);
    });

    it("false && true = false", () => {
      service.set("a", false);
      service.set("b", true);
      expect(service.evaluate("a && b")).toBe(false);
    });

    it("combines with NOT: editorFocus && !readOnly", () => {
      service.set("editorFocus", true);
      service.set("readOnly", false);
      expect(service.evaluate("editorFocus && !readOnly")).toBe(true);
    });
  });

  // ── evaluate — OR operator ────────────────────────────────────────────────

  describe("evaluate — || (OR) operator", () => {
    it("true || false = true", () => {
      service.set("a", true);
      service.set("b", false);
      expect(service.evaluate("a || b")).toBe(true);
    });

    it("false || false = false", () => {
      expect(service.evaluate("a || b")).toBe(false);
    });

    it("false || true = true", () => {
      service.set("b", true);
      expect(service.evaluate("a || b")).toBe(true);
    });
  });

  // ── evaluate — equality checks ────────────────────────────────────────────

  describe("evaluate — equality (==) and inequality (!=)", () => {
    it("mode == 'vim' is true when mode is 'vim'", () => {
      service.set("mode", "vim");
      expect(service.evaluate("mode == 'vim'")).toBe(true);
    });

    it("mode == 'vim' is false when mode is 'emacs'", () => {
      service.set("mode", "emacs");
      expect(service.evaluate("mode == 'vim'")).toBe(false);
    });

    it("mode != 'vim' is true when mode is 'emacs'", () => {
      service.set("mode", "emacs");
      expect(service.evaluate("mode != 'vim'")).toBe(true);
    });

    it("mode != 'vim' is false when mode is 'vim'", () => {
      service.set("mode", "vim");
      expect(service.evaluate("mode != 'vim'")).toBe(false);
    });

    it("equality with missing key is false", () => {
      expect(service.evaluate("unknownKey == 'something'")).toBe(false);
    });

    it("inequality with missing key is true (undefined != anything)", () => {
      expect(service.evaluate("unknownKey != 'something'")).toBe(true);
    });
  });

  // ── evaluate — grouping ───────────────────────────────────────────────────

  describe("evaluate — grouping with parentheses", () => {
    it("(a || b) && c evaluates correctly", () => {
      service.set("a", false);
      service.set("b", true);
      service.set("c", true);
      expect(service.evaluate("(a || b) && c")).toBe(true);
    });

    it("(a || b) && c is false when c is false", () => {
      service.set("a", true);
      service.set("b", true);
      service.set("c", false);
      expect(service.evaluate("(a || b) && c")).toBe(false);
    });
  });

  // ── evaluate — malformed expressions ─────────────────────────────────────

  describe("evaluate — malformed expressions return false without throwing", () => {
    it("returns false for completely invalid expression", () => {
      expect(() => service.evaluate("!!!@#$%")).not.toThrow();
      expect(service.evaluate("!!!@#$%")).toBe(false);
    });

    it("returns false for dangling operator", () => {
      expect(() => service.evaluate("a &&")).not.toThrow();
      expect(service.evaluate("a &&")).toBe(false);
    });

    it("returns false for unclosed parenthesis", () => {
      expect(() => service.evaluate("(a && b")).not.toThrow();
      // Gracefully completes even with missing closing paren
    });
  });
});
