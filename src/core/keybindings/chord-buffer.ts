import type { NormalizedKey, KeyChord } from "./types";

// ── ChordBuffer ───────────────────────────────────────────────────────────────

/**
 * Maintains a pending sequence of keypresses for multi-key chord matching.
 *
 * After `timeoutMs` milliseconds of inactivity the buffer auto-clears,
 * preventing a stale first-chord from permanently blocking new bindings.
 *
 * No external dependencies — pure class.
 */
export class ChordBuffer {
  private pending: NormalizedKey[] = [];
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private readonly timeoutMs: number;

  constructor(timeoutMs = 1500) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Append a key to the pending sequence and reset the inactivity timer.
   */
  push(key: NormalizedKey): void {
    this.pending.push(key);
    this._resetTimer();
  }

  /**
   * Test the current pending sequence against a chord.
   *
   * - 'none'    — the pending sequence does not match any prefix of chord
   * - 'partial' — the pending sequence is a valid prefix but not complete yet
   * - 'full'    — the pending sequence exactly matches the chord
   */
  matches(chord: KeyChord): "none" | "partial" | "full" {
    if (this.pending.length === 0) return "none";

    const len = this.pending.length;

    // Check that every pending key matches the corresponding chord segment.
    for (let i = 0; i < len; i++) {
      if (i >= chord.length) return "none"; // pending is longer than chord
      if (this.pending[i] !== chord[i]) return "none";
    }

    if (len === chord.length) return "full";
    return "partial"; // pending is a valid prefix but chord needs more keys
  }

  /**
   * Reset pending state and cancel any running timer.
   */
  clear(): void {
    this.pending = [];
    this._cancelTimer();
  }

  /** Expose pending length (useful for testing / debugging). */
  get length(): number {
    return this.pending.length;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _resetTimer(): void {
    this._cancelTimer();
    this.timerId = setTimeout(() => {
      this.clear();
    }, this.timeoutMs);
  }

  private _cancelTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
