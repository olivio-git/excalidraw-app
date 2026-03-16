import { keybindingRegistry } from "./keybinding-registry";
import { keyNormalizer } from "./key-normalizer";
import { KeybindingSource } from "./types";

// ── Built-in default keybindings ──────────────────────────────────────────────
//
// These are registered before plugins load so that plugins can override them
// via registerDefault() with last-registered-wins semantics, or users can
// shadow them via registerOverride().
//
// Keybinding IDs mirror VS Code's workbench action naming convention for
// familiarity and forward-compatibility.

const BUILTIN_KEYBINDINGS = [
  {
    key: "ctrl+shift+p",
    commandId: "workbench.action.showCommands",
  },
  {
    key: "ctrl+,",
    commandId: "workbench.action.openSettings",
  },
  {
    key: "ctrl+w",
    commandId: "workbench.action.closeActiveTab",
  },
  {
    key: "ctrl+tab",
    commandId: "workbench.action.nextTab",
  },
  {
    key: "ctrl+shift+tab",
    commandId: "workbench.action.previousTab",
  },
] as const;

/**
 * Register all built-in default keybindings into the keybinding registry.
 *
 * MUST be called before plugins load so that plugins can override these
 * bindings using last-registered-wins semantics.
 *
 * App.tsx init order:
 *   registerDefaultKeybindings() → loadInternalPlugins() → loadExternalPlugins() → activateAll()
 */
export function registerDefaultKeybindings(): void {
  for (const binding of BUILTIN_KEYBINDINGS) {
    keybindingRegistry.registerDefault({
      commandId: binding.commandId,
      chord: keyNormalizer.normalizeChord(binding.key),
      source: KeybindingSource.Builtin,
    });
  }
}
