import type { NormalizedKey, KeyChord } from "./types";
import { keyNormalizer } from "./key-normalizer";
import { ChordBuffer } from "./chord-buffer";
import { keybindingRegistry } from "./keybinding-registry";
import { contextKeyService } from "./context-key-service";
import { PluginManager } from "../../plugins/plugin-manager";

// ── Target element guard ───────────────────────────────────────────────────────

/**
 * Returns true when the event target is an element that should absorb keystrokes
 * by default: INPUT, TEXTAREA, or any element with contenteditable="true".
 */
function isInputTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;

  const tag = target.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.getAttribute("contenteditable") === "true") return true;

  return false;
}

// ── KeybindingService ─────────────────────────────────────────────────────────

/**
 * Top-level keyboard dispatch coordinator.
 *
 * Responsibilities:
 * 1. Normalize raw KeyboardEvents → NormalizedKey via KeyNormalizerClass.
 * 2. Maintain a ChordBuffer for two-key chord sequences.
 * 3. Resolve the active binding from KeybindingRegistry.
 * 4. Guard against IME composition, input/textarea/contenteditable targets.
 * 5. Call PluginManager.executeCommand() for matched commands.
 *
 * handleKeyEvent is the ONLY public entry point — called by useKeybindingBridge.
 */
export class KeybindingServiceClass {
  /** ChordBuffer tracks auto-clear timeout; we also maintain our own sequence. */
  private readonly buffer: ChordBuffer = new ChordBuffer();

  /** Parallel key sequence mirror — lets us build KeyChord without exposing buffer internals. */
  private sequence: NormalizedKey[] = [];

  /** Reference to the bound keydown event listener for cleanup in dispose(). */
  private boundHandler: ((event: KeyboardEvent) => void) | null = null;

  /**
   * Reference to the keyup fallback listener for cleanup in dispose().
   *
   * On Linux/GTK, WebKitGTK intercepts certain keydown events (e.g. Ctrl+Shift+Tab
   * for backwards focus traversal) before they reach JavaScript. The keyup event
   * still fires, so we use it as a fallback dispatch path.
   * The lastDispatchedChord guard prevents double-dispatch on other platforms.
   */
  private keyupFallbackHandler: ((event: KeyboardEvent) => void) | null = null;

  /**
   * The NormalizedKey of the last chord dispatched via keydown.
   * Set by _tryExecute; cleared by the keyup fallback handler.
   * Guards against double-dispatch when keydown already handled the chord.
   */
  private lastDispatchedChord: NormalizedKey | null = null;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Attach global 'keydown' and 'keyup' listeners at the document level (capture phase).
   * Call once at application boot.
   */
  initialize(): void {
    this.boundHandler = (event: KeyboardEvent) => {
      this.handleKeyEvent(event);
    };
    document.addEventListener("keydown", this.boundHandler, true);

    // keyup fallback: handles chords whose keydown was consumed by GTK before
    // reaching JavaScript (e.g. Ctrl+Shift+Tab on Linux/WebKitGTK).
    // Only single-key chords are attempted here — two-key chords can't be
    // reliably reconstructed from keyup alone.
    this.keyupFallbackHandler = (event: KeyboardEvent) => {
      if (event.isComposing) return;

      const normalizedKey = keyNormalizer.normalize(event);

      // Always consume the guard on any non-modifier keyup to prevent stale state
      // (e.g. user releases Ctrl before Tab — the Tab keyup won't have ctrlKey set).
      const prevDispatched = this.lastDispatchedChord;
      this.lastDispatchedChord = null;

      if (!normalizedKey) return;

      // keydown already handled this chord — skip to avoid double-dispatch
      if (prevDispatched === normalizedKey) return;

      // keydown was not dispatched for this chord (likely GTK-intercepted) — try now
      const chord: KeyChord = [normalizedKey];
      const entry = keybindingRegistry.resolve(chord);
      if (!entry) return;
      if (isInputTarget(event) && !entry.allowInInput) return;

      event.preventDefault();
      void PluginManager.executeCommand(entry.commandId);
    };
    document.addEventListener("keyup", this.keyupFallbackHandler, true);
  }

  /**
   * Remove the global listeners and reset state.
   * Call on application unmount / teardown.
   */
  dispose(): void {
    if (this.boundHandler) {
      document.removeEventListener("keydown", this.boundHandler, true);
      this.boundHandler = null;
    }
    if (this.keyupFallbackHandler) {
      document.removeEventListener("keyup", this.keyupFallbackHandler, true);
      this.keyupFallbackHandler = null;
    }
    this.lastDispatchedChord = null;
    this._reset();
  }

  // ── Dispatch ────────────────────────────────────────────────────────────────

  /**
   * Process a KeyboardEvent and dispatch the matching command if found.
   *
   * Returns `true` when a command was dispatched, `false` otherwise.
   *
   * Guards (returns false without consuming the event):
   * - event.isComposing === true (IME input in progress)
   * - keyNormalizer returns null (lone modifier, Unidentified, etc.)
   *
   * Target-input guard (returns false and resets buffer):
   * - event target is INPUT, TEXTAREA, or contenteditable, unless the resolved
   *   binding has `allowInInput: true`.
   *
   * Chord handling:
   * - Partial match (first key of a two-key chord): preventDefault(), wait.
   * - Full match: preventDefault(), execute command, clear buffer.
   * - No match: clear buffer, return false.
   */
  handleKeyEvent(event: KeyboardEvent): boolean {
    // Guard: IME composition
    if (event.isComposing) return false;

    // Normalize the raw event into a canonical key string
    const normalizedKey = keyNormalizer.normalize(event);
    if (normalizedKey === null) return false;

    // Append to our sequence and the auto-clear buffer
    this.sequence.push(normalizedKey);
    this.buffer.push(normalizedKey);

    return this._process(event);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Core dispatch logic. Called after sequence has been updated with the new key.
   */
  private _process(event: KeyboardEvent): boolean {
    const seq = this.sequence;

    // Should never happen, but guard regardless
    if (seq.length === 0) return false;

    const allEntries = keybindingRegistry.getAll();

    if (seq.length === 1) {
      const firstKey = seq[0];

      // Check if any two-key chord has this as a valid first key (context-aware)
      const hasPartialCandidate = allEntries.some(
        (entry) =>
          entry.chord.length === 2 &&
          entry.chord[0] === firstKey &&
          contextKeyService.evaluate(entry.when)
      );

      if (hasPartialCandidate) {
        // Consume the event and wait for the second key
        event.preventDefault();
        return false;
      }

      // No two-key chord matches — attempt single-key resolution
      const singleChord: KeyChord = [firstKey];
      return this._tryExecute(event, singleChord);
    }

    // seq.length >= 2 — attempt full two-key chord resolution
    const twoKeyChord: KeyChord = [seq[0], seq[1]];
    const matched = this._tryExecute(event, twoKeyChord);

    if (!matched) {
      // Second key did not complete a chord — silent cancel
      this._reset();
    }

    return matched;
  }

  /**
   * Attempt to resolve and execute a command for the given chord.
   * Returns true if command was dispatched.
   */
  private _tryExecute(event: KeyboardEvent, chord: KeyChord): boolean {
    const entry = keybindingRegistry.resolve(chord);

    if (!entry) {
      this._reset();
      return false;
    }

    // Target input guard — skip unless binding opts in via allowInInput
    if (isInputTarget(event) && !entry.allowInInput) {
      this._reset();
      return false;
    }

    // Consume the event and execute
    event.preventDefault();
    this._reset();

    // Track single-key dispatches so the keyup fallback can skip double-dispatch
    if (chord.length === 1) {
      this.lastDispatchedChord = chord[0];
    }

    void PluginManager.executeCommand(entry.commandId);
    return true;
  }

  /**
   * Clear the sequence and the auto-clear buffer.
   */
  private _reset(): void {
    this.sequence = [];
    this.buffer.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const keybindingService = new KeybindingServiceClass();
