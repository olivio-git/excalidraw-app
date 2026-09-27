import { describe, it, expect, beforeEach } from "vitest";
import { StreamParser } from "./stream-parser";

describe("StreamParser", () => {
  let parser: StreamParser;

  beforeEach(() => {
    parser = new StreamParser();
  });

  // ── tryFlushPartial / onToolDelta ─────────────────────────────────────────

  describe("tryFlushPartial (via onToolDelta + incremental JSON)", () => {
    it("returns null for an empty buffer (no deltas received)", () => {
      expect(parser.tryFlushPartial("call-1")).toBeNull();
    });

    it("returns null for incomplete / invalid JSON", () => {
      parser.onToolDelta("call-1", '{"elements": [');
      expect(parser.tryFlushPartial("call-1")).toBeNull();
    });

    it("returns null for valid JSON that has no elements array", () => {
      parser.onToolDelta("call-1", '{"confirm": true}');
      expect(parser.tryFlushPartial("call-1")).toBeNull();
    });

    it("returns elements array on complete valid JSON", () => {
      const elements = [{ id: "el-1", type: "rectangle" }];
      parser.onToolDelta("call-1", JSON.stringify({ elements }));
      const result = parser.tryFlushPartial("call-1");
      expect(result).toEqual(elements);
    });

    it("accumulates deltas before the JSON is complete", () => {
      const fullJson = JSON.stringify({ elements: [{ id: "a" }] });
      // Split into 3 chunks
      const chunk1 = fullJson.slice(0, 10);
      const chunk2 = fullJson.slice(10, 20);
      const chunk3 = fullJson.slice(20);

      parser.onToolDelta("call-1", chunk1);
      expect(parser.tryFlushPartial("call-1")).toBeNull();

      parser.onToolDelta("call-1", chunk2);
      // Still incomplete unless chunk3 completes it
      parser.onToolDelta("call-1", chunk3);

      const result = parser.tryFlushPartial("call-1");
      expect(result).toEqual([{ id: "a" }]);
    });
  });

  // ── onToolStop ────────────────────────────────────────────────────────────

  describe("onToolStop", () => {
    it("returns elements when the buffer contains valid JSON with elements", () => {
      parser.onToolDelta("call-1", JSON.stringify({ elements: [{ id: "el-2" }] }));
      const result = parser.onToolStop("call-1");
      expect(result).toEqual([{ id: "el-2" }]);
    });

    it("returns null when buffer contains JSON without elements field", () => {
      parser.onToolDelta("call-1", JSON.stringify({ confirm: true }));
      const result = parser.onToolStop("call-1");
      expect(result).toBeNull();
    });

    it("clears the buffer after onToolStop", () => {
      parser.onToolDelta("call-1", JSON.stringify({ elements: [{ id: "el-3" }] }));
      parser.onToolStop("call-1");
      // Buffer should be gone — tryFlushPartial returns null now
      expect(parser.tryFlushPartial("call-1")).toBeNull();
    });

    it("onToolStop on unknown toolCallId returns null without error", () => {
      expect(parser.onToolStop("non-existent")).toBeNull();
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("clears all buffers", () => {
      parser.onToolDelta("call-a", '{"elements": [{"id": "a"}]}');
      parser.onToolDelta("call-b", '{"elements": [{"id": "b"}]}');

      parser.reset();

      expect(parser.tryFlushPartial("call-a")).toBeNull();
      expect(parser.tryFlushPartial("call-b")).toBeNull();
    });

    it("can receive new deltas after reset", () => {
      parser.onToolDelta("call-1", JSON.stringify({ elements: [{ id: "old" }] }));
      parser.reset();

      parser.onToolDelta("call-1", JSON.stringify({ elements: [{ id: "new" }] }));
      expect(parser.tryFlushPartial("call-1")).toEqual([{ id: "new" }]);
    });
  });

  // ── concurrent toolCallIds ────────────────────────────────────────────────

  describe("multiple concurrent toolCallIds", () => {
    it("buffers for different toolCallIds do not interfere", () => {
      parser.onToolDelta("call-a", JSON.stringify({ elements: [{ id: "a" }] }));
      parser.onToolDelta("call-b", JSON.stringify({ elements: [{ id: "b" }] }));

      expect(parser.tryFlushPartial("call-a")).toEqual([{ id: "a" }]);
      expect(parser.tryFlushPartial("call-b")).toEqual([{ id: "b" }]);
    });

    it("onToolStop for one id does not affect another", () => {
      parser.onToolDelta("call-a", JSON.stringify({ elements: [{ id: "a" }] }));
      parser.onToolDelta("call-b", JSON.stringify({ elements: [{ id: "b" }] }));

      parser.onToolStop("call-a");

      // call-b buffer should still be intact
      expect(parser.tryFlushPartial("call-b")).toEqual([{ id: "b" }]);
    });
  });
});
