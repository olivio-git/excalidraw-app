// ── Branded primitive types ───────────────────────────────────────────────────

/**
 * A normalized key string in canonical form.
 * Example: "ctrl+shift+k", "enter", "arrowup"
 *
 * Branded to prevent raw strings from being passed where a NormalizedKey is
 * expected — callers must go through KeyNormalizer.
 */
export type NormalizedKey = string & { readonly __brand: "NormalizedKey" };

/**
 * A key chord: either a single key or a two-key sequence.
 * Example: ["ctrl+k"] or ["ctrl+k", "ctrl+b"]
 */
export type KeyChord = [NormalizedKey] | [NormalizedKey, NormalizedKey];

// ── When expressions ──────────────────────────────────────────────────────────

/**
 * A conditional expression evaluated against the current context state.
 * Examples: "editorFocus", "editorFocus && !readOnly", "mode == 'vim'"
 */
export type WhenExpression = string;

// ── Sources ───────────────────────────────────────────────────────────────────

export enum KeybindingSource {
  Builtin = "builtin",
  Plugin = "plugin",
  User = "user",
}

// ── Core data shapes ──────────────────────────────────────────────────────────

/**
 * A single keybinding entry that maps a key chord to a command.
 */
export interface KeybindingEntry {
  /** The command to execute when the chord is triggered. */
  commandId: string;

  /** The key sequence that triggers the command. */
  chord: KeyChord;

  /**
   * Optional when-clause expression.
   * If undefined or empty string, the binding is always active.
   */
  when?: WhenExpression;

  /** Where the binding was registered from. */
  source: KeybindingSource;

  /**
   * When true, the keybinding fires even when focus is inside an input,
   * textarea, or contenteditable element.
   * Use for workspace-level shortcuts that should always work (e.g. tab navigation).
   */
  allowInInput?: boolean;
}

/**
 * A keybinding context snapshot used during resolution.
 * The registry evaluates `when` expressions against the live context state,
 * so this type is informational — see ContextKeyService for the live store.
 */
export interface KeybindingContext {
  [key: string]: unknown;
}

/**
 * A declarative keybinding as expressed in a plugin manifest or config file.
 * Gets converted to a KeybindingEntry after normalization.
 */
export interface KeybindingDeclaration {
  commandId: string;
  /** Raw key string before normalization. E.g. "Ctrl+Shift+K" or "ctrl+k ctrl+b" */
  key: string;
  when?: WhenExpression;
}

/**
 * Represents a conflict between two entries registered for the same key+when.
 */
export interface KeybindingConflict {
  chord: KeyChord;
  when: WhenExpression | undefined;
  entries: [KeybindingEntry, KeybindingEntry];
}
