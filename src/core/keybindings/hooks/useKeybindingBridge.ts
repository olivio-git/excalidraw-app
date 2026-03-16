import { useEffect } from "react";
import { keybindingService } from "../keybinding-service";
import { useKeybindingStore } from "../store/keybinding-store";

// ── Idempotency guard ─────────────────────────────────────────────────────────

/**
 * Module-level flag that prevents double-initialization in React Strict Mode
 * (or any scenario where the hook mounts twice without an unmount in between).
 *
 * A single global bridge is sufficient — the keybinding system is a singleton.
 */
let _mounted = false;

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useKeybindingBridge
 *
 * Connects the React lifecycle to the keybinding system:
 * 1. Calls `keybindingService.initialize()` once on mount — this attaches the
 *    global 'keydown' listener at the document level (capture phase).
 * 2. Calls `hydrateRegistry()` on mount — replays any user overrides that were
 *    persisted to disk into the live registry.
 * 3. Calls `keybindingService.dispose()` on unmount — removes the listener and
 *    resets internal state.
 *
 * Idempotent: if the hook mounts a second time while already initialized (e.g.,
 * React Strict Mode double-invoke), it is a no-op. Only one listener is ever
 * registered at a time.
 *
 * Usage: call once at the top of the Shell component (or equivalent app root).
 */
export function useKeybindingBridge(): void {
  useEffect(() => {
    if (_mounted) return;

    _mounted = true;

    keybindingService.initialize();
    useKeybindingStore.getState().hydrateRegistry();

    return () => {
      _mounted = false;
      keybindingService.dispose();
    };
  }, []);
}
