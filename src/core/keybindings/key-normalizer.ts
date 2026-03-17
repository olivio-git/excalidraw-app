import type { NormalizedKey, KeyChord } from "./types";

// ── Alias maps ────────────────────────────────────────────────────────────────

/**
 * Modifier aliases: maps user-supplied modifier names to canonical form.
 * The canonical order for modifiers is: ctrl → alt → shift → meta.
 * Includes direct canonical names so they resolve even without going through
 * the MODIFIER_ORDER check.
 */
const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  ctrl: "ctrl",
  control: "ctrl",
  shift: "shift",
  alt: "alt",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  win: "meta",
  windows: "meta",
  opt: "alt",
  option: "alt",
};

/**
 * Key name aliases: maps raw key names to canonical lowercase forms.
 */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  return: "enter",
  esc: "escape",
  " ": "space",
  arrowup: "arrowup",
  arrowdown: "arrowdown",
  arrowleft: "arrowleft",
  arrowright: "arrowright",
  del: "delete",
  ins: "insert",
  pgup: "pageup",
  pgdn: "pagedown",
};

/** Canonical modifier order used when re-joining. */
const MODIFIER_ORDER = ["ctrl", "alt", "shift", "meta"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

// ── Platform detection ────────────────────────────────────────────────────────

function isMac(): boolean {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
}

// ── KeyNormalizer class ───────────────────────────────────────────────────────

export class KeyNormalizerClass {
  /**
   * Normalize a KeyboardEvent into a NormalizedKey.
   *
   * Returns null when:
   * - event.isComposing is true (IME input guard)
   * - event.key is "Unidentified"
   * - the key is a lone modifier key (Shift, Control, Alt, Meta)
   */
  normalize(event: KeyboardEvent): NormalizedKey | null {
    if (event.isComposing) return null;

    let raw = event.key;

    // WebKitGTK reports event.key as "Unidentified" for some key combinations
    // (e.g. Ctrl+Shift+Tab on Linux). Fall back to event.code which always
    // carries the physical key identity regardless of modifier state.
    if (!raw || raw === "Unidentified") {
      raw = this._codeToKeyName(event.code);
    }

    if (!raw) return null;

    // Lone modifier keys are not standalone bindings
    if (["Shift", "Control", "Alt", "Meta"].includes(raw)) return null;

    const mods: Set<Modifier> = new Set();

    // On Mac, metaKey maps to Cmd. On non-Mac, ctrlKey typically maps to Ctrl.
    // We always normalize to the platform-agnostic canonical names here.
    if (event.ctrlKey) mods.add("ctrl");
    if (event.altKey) mods.add("alt");
    if (event.shiftKey) mods.add("shift");
    if (event.metaKey) mods.add("meta");

    const keyPart = this._normalizeKeyName(raw);
    return this._build(mods, keyPart);
  }

  /**
   * Normalize a user-supplied string key description.
   *
   * Handles:
   * - Single keys: "Enter", "esc", "a"
   * - Key combos: "ctrl+k", "Ctrl+Shift+K"
   * - Two-segment chords are NOT handled here — use normalizeChord() for that.
   *
   * This method never returns null; unknown keys pass through lowercased.
   */
  normalizeString(raw: string): NormalizedKey {
    const parts = raw.split("+").map((p) => p.trim().toLowerCase());
    const mods: Set<Modifier> = new Set();
    let keyPart = "";

    for (const part of parts) {
      if (part in MODIFIER_ALIASES) {
        const canonical = MODIFIER_ALIASES[part];
        if (this._isMod(canonical)) mods.add(canonical);
      } else {
        // Last non-modifier part is the key
        keyPart = this._normalizeKeyName(part);
      }
    }

    if (!keyPart) {
      // Edge case: only modifiers supplied — return as-is (caller's problem)
      keyPart = parts[parts.length - 1] ?? "";
    }

    return this._build(mods, keyPart);
  }

  /**
   * Parse a chord string that may contain two space-separated segments.
   * "ctrl+k ctrl+b" → [NormalizedKey("ctrl+k"), NormalizedKey("ctrl+b")]
   * "ctrl+k" → [NormalizedKey("ctrl+k")]
   */
  normalizeChord(raw: string): KeyChord {
    const segments = raw.trim().split(/\s+/);
    if (segments.length >= 2) {
      return [this.normalizeString(segments[0]), this.normalizeString(segments[1])] as KeyChord;
    }
    return [this.normalizeString(segments[0])] as KeyChord;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _normalizeKeyName(raw: string): string {
    const lower = raw.toLowerCase();
    return KEY_ALIASES[lower] ?? lower;
  }

  private _isMod(value: string): value is Modifier {
    return (MODIFIER_ORDER as readonly string[]).includes(value);
  }

  /**
   * Convert a KeyboardEvent.code value to a canonical key name.
   * Used as fallback when event.key is "Unidentified" (WebKitGTK bug with
   * certain modifier+key combinations on Linux).
   *
   * Examples: "Tab" → "tab", "KeyA" → "a", "Digit1" → "1", "PageUp" → "pageup"
   */
  private _codeToKeyName(code: string): string {
    if (!code) return "";
    // "KeyA"–"KeyZ" → "a"–"z"
    if (/^Key[A-Z]$/.test(code)) return code[3].toLowerCase();
    // "Digit0"–"Digit9" → "0"–"9"
    if (/^Digit\d$/.test(code)) return code[5];
    // Everything else: lowercase as-is ("Tab"→"tab", "PageUp"→"pageup", etc.)
    return code.toLowerCase();
  }

  private _build(mods: Set<Modifier>, key: string): NormalizedKey {
    const orderedMods = MODIFIER_ORDER.filter((m) => mods.has(m));

    // Platform modifier swap: on Mac, swap ctrl ↔ meta when both absent to keep
    // bindings consistent across platforms (e.g. Cmd+C on Mac = Ctrl+C on Win).
    // Only swap if explicitly running on Mac and metaKey is in the set without ctrl.
    if (isMac() && mods.has("meta") && !mods.has("ctrl")) {
      // Already fine — meta means Cmd on Mac
    }

    const parts = [...orderedMods, key].filter(Boolean);
    return parts.join("+") as NormalizedKey;
  }
}

export const keyNormalizer = new KeyNormalizerClass();
