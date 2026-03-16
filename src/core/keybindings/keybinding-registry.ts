import type {
  NormalizedKey,
  KeyChord,
  KeybindingEntry,
  KeybindingConflict,
  WhenExpression,
} from "./types";
import { KeybindingSource } from "./types";
import { contextKeyService } from "./context-key-service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function chordFirstKey(chord: KeyChord): NormalizedKey {
  return chord[0];
}

function chordsEqual(a: KeyChord, b: KeyChord): boolean {
  if (a.length !== b.length) return false;
  return a[0] === b[0] && (a.length === 1 || a[1] === b[1]);
}

function whenEqual(a: WhenExpression | undefined, b: WhenExpression | undefined): boolean {
  const normalize = (w: WhenExpression | undefined) => (w ?? "").trim();
  return normalize(a) === normalize(b);
}

// ── KeybindingRegistry ────────────────────────────────────────────────────────

/**
 * Two-layer keybinding store.
 *
 * - **Default layer** (`builtin` | `plugin`): registered by core and plugins.
 * - **User layer**: registered via `registerOverride` — shadows default bindings
 *   for the same `commandId + chord` combination.
 *
 * Lookup table: `Map<NormalizedKey, KeybindingEntry[]>` keyed by the
 * normalized first-chord key for O(1) dispatch.
 *
 * Conflict detection: two different `commandId`s registered for the exact same
 * `chord + when` combination within the same source layer trigger a console.warn.
 */
export class KeybindingRegistryClass {
  /** Default bindings from core + plugins. */
  private defaults: Map<NormalizedKey, KeybindingEntry[]> = new Map();
  /** User overrides — shadow defaults for the same commandId + chord. */
  private overrides: Map<NormalizedKey, KeybindingEntry[]> = new Map();

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a default binding (builtin or plugin).
   * Last-registered-wins within the same `commandId + chord` combination.
   */
  registerDefault(entry: KeybindingEntry): void {
    this._insert(this.defaults, entry);
  }

  /**
   * Register a user override binding.
   * User overrides take precedence over all default bindings for the same
   * `commandId + chord` combination.
   */
  registerOverride(entry: KeybindingEntry): void {
    const override = { ...entry, source: KeybindingSource.User };
    this._insert(this.overrides, override);
  }

  /**
   * Remove a binding for a given commandId and chord first-key.
   * Removes from both default and user-override layers.
   */
  unregister(firstKey: NormalizedKey, commandId: string): void {
    this._removeFrom(this.defaults, firstKey, commandId);
    this._removeFrom(this.overrides, firstKey, commandId);
  }

  // ── Resolution ────────────────────────────────────────────────────────────

  /**
   * Resolve the best matching binding for the given chord and current context.
   *
   * Resolution order:
   * 1. User overrides (source: user)
   * 2. Default bindings (source: builtin | plugin)
   *
   * Within each layer, the entry whose `when` expression evaluates to `true`
   * against the live ContextKeyService is returned. If multiple entries match,
   * the last-registered one wins (last in the array).
   */
  resolve(chord: KeyChord, _context?: Record<string, unknown>): KeybindingEntry | null {
    const firstKey = chordFirstKey(chord);

    // Try user overrides first
    const overrideMatch = this._findMatch(this.overrides, chord, firstKey);
    if (overrideMatch) return overrideMatch;

    // Fall back to defaults
    return this._findMatch(this.defaults, chord, firstKey);
  }

  /**
   * Return all registered entries across both layers (overrides first).
   */
  getAll(): KeybindingEntry[] {
    const all: KeybindingEntry[] = [];
    for (const entries of this.overrides.values()) all.push(...entries);
    for (const entries of this.defaults.values()) all.push(...entries);
    return all;
  }

  /**
   * Detect conflicts: two different `commandId`s sharing the same `chord + when`.
   * Returns one conflict descriptor per conflicting pair within each layer.
   */
  getConflicts(): KeybindingConflict[] {
    const conflicts: KeybindingConflict[] = [];
    this._detectConflicts(this.defaults, conflicts);
    this._detectConflicts(this.overrides, conflicts);
    return conflicts;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _insert(store: Map<NormalizedKey, KeybindingEntry[]>, entry: KeybindingEntry): void {
    const firstKey = chordFirstKey(entry.chord);
    const existing = store.get(firstKey) ?? [];

    // Last-registered-wins: replace entry with same commandId + chord
    const idx = existing.findIndex(
      (e) => e.commandId === entry.commandId && chordsEqual(e.chord, entry.chord)
    );

    if (idx !== -1) {
      existing[idx] = entry;
    } else {
      // Conflict detection before pushing new entry
      const conflict = existing.find(
        (e) =>
          e.commandId !== entry.commandId &&
          chordsEqual(e.chord, entry.chord) &&
          whenEqual(e.when, entry.when)
      );
      if (conflict) {
        console.warn(
          `[KeybindingRegistry] Conflict detected: both "${conflict.commandId}" and "${entry.commandId}" ` +
            `are bound to the same chord "${entry.chord.join(" ")}" with when="${entry.when ?? ""}"`
        );
      }
      existing.push(entry);
    }

    store.set(firstKey, existing);
  }

  private _removeFrom(
    store: Map<NormalizedKey, KeybindingEntry[]>,
    firstKey: NormalizedKey,
    commandId: string
  ): void {
    const existing = store.get(firstKey);
    if (!existing) return;
    const filtered = existing.filter((e) => e.commandId !== commandId);
    if (filtered.length === 0) {
      store.delete(firstKey);
    } else {
      store.set(firstKey, filtered);
    }
  }

  private _findMatch(
    store: Map<NormalizedKey, KeybindingEntry[]>,
    chord: KeyChord,
    firstKey: NormalizedKey
  ): KeybindingEntry | null {
    const entries = store.get(firstKey);
    if (!entries || entries.length === 0) return null;

    // Iterate in reverse for last-registered-wins semantics
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!chordsEqual(entry.chord, chord)) continue;
      if (contextKeyService.evaluate(entry.when)) return entry;
    }
    return null;
  }

  private _detectConflicts(
    store: Map<NormalizedKey, KeybindingEntry[]>,
    out: KeybindingConflict[]
  ): void {
    for (const entries of store.values()) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i];
          const b = entries[j];
          if (
            a.commandId !== b.commandId &&
            chordsEqual(a.chord, b.chord) &&
            whenEqual(a.when, b.when)
          ) {
            out.push({ chord: a.chord, when: a.when, entries: [a, b] });
          }
        }
      }
    }
  }
}

export const keybindingRegistry = new KeybindingRegistryClass();
