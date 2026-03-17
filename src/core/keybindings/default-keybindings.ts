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
    key: "ctrl+s",
    commandId: "diagram.action.save",
  },
  {
    key: "ctrl+n",
    commandId: "diagram.action.newDiagram",
  },
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
    allowInInput: true,
  },
  {
    key: "ctrl+pagedown",
    commandId: "workbench.action.nextTab",
    allowInInput: true,
  },
  {
    // Note: ctrl+shift+tab is consumed by GTK/WebKitGTK on Linux before
    // reaching JavaScript. Use ctrl+pageup as the cross-platform alternative.
    key: "ctrl+pageup",
    commandId: "workbench.action.previousTab",
    allowInInput: true,
  },
  {
    // Works on Windows/macOS. On Linux/GTK this is intercepted at OS level
    // and never reaches JavaScript — use ctrl+pageup as fallback.
    key: "ctrl+shift+tab",
    commandId: "workbench.action.previousTab",
    allowInInput: true,
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
      ...("allowInInput" in binding && { allowInInput: binding.allowInInput }),
    });
  }
}
