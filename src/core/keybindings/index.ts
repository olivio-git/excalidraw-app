// ── Public API for the keybinding system ─────────────────────────────────────
//
// This is the single import point for all consumers outside the
// src/core/keybindings directory. Internal modules should import from their
// sibling files directly; only external consumers should use this barrel.

// ── Singletons ────────────────────────────────────────────────────────────────

export { keybindingService } from "./keybinding-service";
export { keybindingRegistry } from "./keybinding-registry";
export { contextKeyService } from "./context-key-service";
export { keyNormalizer } from "./key-normalizer";

// ── Classes (for extension / testing) ────────────────────────────────────────

export { KeybindingServiceClass } from "./keybinding-service";
export { KeybindingRegistryClass } from "./keybinding-registry";
export { ContextKeyServiceClass } from "./context-key-service";
export { KeyNormalizerClass } from "./key-normalizer";
export { ChordBuffer } from "./chord-buffer";

// ── Types ─────────────────────────────────────────────────────────────────────

export type {
  NormalizedKey,
  KeyChord,
  WhenExpression,
  KeybindingEntry,
  KeybindingContext,
  KeybindingDeclaration,
  KeybindingConflict,
} from "./types";

export { KeybindingSource } from "./types";

// ── Store ─────────────────────────────────────────────────────────────────────

export { useKeybindingStore } from "./store/keybinding-store";

// ── Hooks ─────────────────────────────────────────────────────────────────────

export { useKeybindingBridge } from "./hooks/useKeybindingBridge";

// ── Default bindings initializer ──────────────────────────────────────────────

export { registerDefaultKeybindings } from "./default-keybindings";
