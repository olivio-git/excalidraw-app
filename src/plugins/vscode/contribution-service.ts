import { PluginManager } from "@/plugins/plugin-manager";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { KeybindingSource, type KeyChord } from "@/core/keybindings/types";
import type { InstalledExtension } from "./extension-storage";
import { loadInstalledExtensions, onInstalledExtensionsChanged } from "./extension-registry";
import { executeExtensionCommand } from "./extension-commands";
import {
  currentPlatform,
  keyForPlatform,
  type ConfigurationProperty,
  type KeybindingContribution,
} from "./contributions";

/**
 * Applies the declarative contributions of installed extensions to the
 * workbench: commands appear in the command palette and keybindings in the
 * keybinding registry. Both are re-synced on every install/uninstall.
 */

const registeredCommands: string[] = [];
const registeredKeybindings: Array<{ chord: KeyChord; commandId: string }> = [];
let initialized = false;

/** Palette label, VS Code style: "Category: Title". */
export function commandLabel(title: string, category?: string): string {
  return category ? `${category}: ${title}` : title;
}

/**
 * VS Code key syntax (`ctrl+shift+alt+k`, `cmd+k cmd+s`) → our chord. Returns
 * null for keys our keyboard layer cannot express.
 */
export function toChord(key: string): KeyChord | null {
  const trimmed = key.trim().toLowerCase();
  if (!trimmed) return null;
  const segments = trimmed.split(/\s+/);
  if (segments.length > 2) return null;
  return keyNormalizer.normalizeChord(trimmed);
}

function isChordTaken(chord: KeyChord): boolean {
  const existing = keybindingRegistry.resolve(chord);
  return existing !== null && existing.source !== KeybindingSource.Plugin;
}

function syncCommands(extensions: InstalledExtension[]): void {
  for (const id of registeredCommands.splice(0)) PluginManager.unregisterDynamicCommand(id);
  for (const extension of extensions) {
    const hidden = new Set(
      (extension.contributions.menus.commandPalette ?? [])
        .filter((item) => item.when === "false")
        .map((item) => item.command)
    );
    for (const command of extension.contributions.commands) {
      if (hidden.has(command.command) || PluginManager.hasCommand(command.command)) continue;
      PluginManager.registerDynamicCommand(
        {
          id: command.command,
          name: commandLabel(command.title, command.category),
          category: command.category ?? extension.displayName,
        },
        () => executeExtensionCommand(command.command).then(() => undefined)
      );
      registeredCommands.push(command.command);
    }
  }
}

function syncKeybindings(extensions: InstalledExtension[]): void {
  for (const { chord, commandId } of registeredKeybindings.splice(0)) {
    keybindingRegistry.unregister(chord[0], commandId);
  }
  const platform = currentPlatform();
  const commandIds = new Set(
    extensions.flatMap((ext) => ext.contributions.commands.map((c) => c.command))
  );
  for (const extension of extensions) {
    for (const binding of extension.contributions.keybindings) {
      const chord = toChord(keyForPlatform(binding, platform));
      // Never let an extension take over one of the app's own shortcuts.
      if (!chord || isChordTaken(chord)) continue;
      registerExtensionKeybinding(binding, chord, commandIds);
    }
  }
}

function registerExtensionKeybinding(
  binding: KeybindingContribution,
  chord: KeyChord,
  contributedCommands: Set<string>
): void {
  // Commands that are not contributed (e.g. built-in VS Code editor actions)
  // are still routed to the extension host, which knows its own commands.
  if (!contributedCommands.has(binding.command) && !PluginManager.hasCommand(binding.command)) {
    PluginManager.registerDynamicCommand(
      { id: binding.command, name: binding.command, category: "Extensiones" },
      () => executeExtensionCommand(binding.command, binding.args).then(() => undefined)
    );
    registeredCommands.push(binding.command);
  }
  keybindingRegistry.registerDefault({
    commandId: binding.command,
    chord,
    when: binding.when,
    source: KeybindingSource.Plugin,
  });
  registeredKeybindings.push({ chord, commandId: binding.command });
}

let configurationDefaults: Record<string, unknown> = {};
let configurationSchema: Record<string, ConfigurationProperty & { extension: string }> = {};

function syncConfiguration(extensions: InstalledExtension[]): void {
  configurationDefaults = {};
  configurationSchema = {};
  for (const extension of extensions) {
    for (const [key, property] of Object.entries(extension.contributions.configuration)) {
      configurationSchema[key] = { ...property, extension: extension.id };
      if (property.default !== undefined) configurationDefaults[key] = property.default;
    }
  }
}

/** Default values of every setting contributed by installed extensions. */
export function getConfigurationDefaults(): Record<string, unknown> {
  return configurationDefaults;
}

export function getConfigurationSchema(): Record<
  string,
  ConfigurationProperty & { extension: string }
> {
  return configurationSchema;
}

export function syncContributions(extensions: InstalledExtension[]): void {
  syncCommands(extensions);
  syncKeybindings(extensions);
  syncConfiguration(extensions);
}

/** Apply contributions of installed extensions and keep them updated. Call once. */
export async function initExtensionContributions(): Promise<void> {
  if (initialized) return;
  initialized = true;
  onInstalledExtensionsChanged(syncContributions);
  syncContributions(await loadInstalledExtensions());
}
