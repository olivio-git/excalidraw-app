import type { VsCodeExtensionManifest } from "./vsix";

/**
 * Normalized `contributes` of a VS Code extension, beyond themes. Manifests
 * allow a single object or an array for most points and omit many fields;
 * everything here is an array with the fields we use, so consumers don't
 * have to re-validate the raw JSON.
 */

export interface CommandContribution {
  command: string;
  title: string;
  category?: string;
  /** Codicon (`$(name)`) or path(s) to an icon; used by views and menus. */
  icon?: string | { light: string; dark: string };
}

export interface KeybindingContribution {
  command: string;
  key: string;
  mac?: string;
  linux?: string;
  win?: string;
  when?: string;
  args?: unknown;
}

export interface LanguageContribution {
  id: string;
  aliases?: string[];
  extensions?: string[];
  filenames?: string[];
  filenamePatterns?: string[];
  firstLine?: string;
  configuration?: string;
}

export interface GrammarContribution {
  language?: string;
  scopeName: string;
  path: string;
  embeddedLanguages?: Record<string, string>;
  injectTo?: string[];
}

export interface SnippetContribution {
  language?: string;
  path: string;
}

export interface ConfigurationProperty {
  type?: string | string[];
  default?: unknown;
  description?: string;
  markdownDescription?: string;
  enum?: unknown[];
  scope?: string;
}

export interface ViewContainerContribution {
  id: string;
  title: string;
  icon?: string;
}

export interface ViewContribution {
  id: string;
  name: string;
  type?: "tree" | "webview";
  when?: string;
  icon?: string;
  contextualTitle?: string;
  /** Id of the container (activity bar/panel container or a built-in one). */
  container: string;
}

export interface MenuItemContribution {
  command: string;
  when?: string;
  group?: string;
}

export interface ExtensionContributions {
  commands: CommandContribution[];
  keybindings: KeybindingContribution[];
  languages: LanguageContribution[];
  grammars: GrammarContribution[];
  snippets: SnippetContribution[];
  configuration: Record<string, ConfigurationProperty>;
  viewsContainers: { activitybar: ViewContainerContribution[]; panel: ViewContainerContribution[] };
  views: ViewContribution[];
  /** `view/title`, `view/item/context`, `commandPalette`, ... */
  menus: Record<string, MenuItemContribution[]>;
}

export function emptyContributions(): ExtensionContributions {
  return {
    commands: [],
    keybindings: [],
    languages: [],
    grammars: [],
    snippets: [],
    configuration: {},
    viewsContainers: { activitybar: [], panel: [] },
    views: [],
    menus: {},
  };
}

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

function asArray(value: unknown): Raw[] {
  if (Array.isArray(value)) return value.filter(isObject);
  return isObject(value) ? [value] : [];
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(isString);
  return strings.length > 0 ? strings : undefined;
}

function optionalString(value: unknown): string | undefined {
  return isString(value) && value.length > 0 ? value : undefined;
}

/** `%key%` placeholders resolved from `package.nls.json`. */
export function localize(value: string, nls: Record<string, unknown>): string {
  const match = /^%(.+)%$/.exec(value);
  if (!match) return value;
  const entry = nls[match[1]];
  if (isString(entry)) return entry;
  if (isObject(entry) && isString(entry.message)) return entry.message;
  return value;
}

function parseIcon(value: unknown): CommandContribution["icon"] {
  if (isString(value)) return value;
  if (isObject(value) && isString(value.light) && isString(value.dark)) {
    return { light: value.light, dark: value.dark };
  }
  return undefined;
}

function parseConfiguration(value: unknown): Record<string, ConfigurationProperty> {
  const properties: Record<string, ConfigurationProperty> = {};
  for (const section of asArray(value)) {
    if (!isObject(section.properties)) continue;
    for (const [key, raw] of Object.entries(section.properties)) {
      if (!isObject(raw)) continue;
      properties[key] = {
        type: isString(raw.type) ? raw.type : stringArray(raw.type),
        default: raw.default,
        description: optionalString(raw.description),
        markdownDescription: optionalString(raw.markdownDescription),
        enum: Array.isArray(raw.enum) ? raw.enum : undefined,
        scope: optionalString(raw.scope),
      };
    }
  }
  return properties;
}

function parseContainers(value: unknown): ViewContainerContribution[] {
  return asArray(value).flatMap((raw) =>
    isString(raw.id) && isString(raw.title)
      ? [{ id: raw.id, title: raw.title, icon: optionalString(raw.icon) }]
      : []
  );
}

/** Normalize `package.json#contributes`, resolving `%nls%` strings. */
export function parseContributions(
  manifest: Pick<VsCodeExtensionManifest, "contributes">,
  nls: Record<string, unknown> = {}
): ExtensionContributions {
  const contributes: Raw = isObject(manifest.contributes) ? manifest.contributes : {};
  const t = (value: string) => localize(value, nls);
  const result = emptyContributions();

  for (const raw of asArray(contributes.commands)) {
    if (!isString(raw.command) || !isString(raw.title)) continue;
    result.commands.push({
      command: raw.command,
      title: t(raw.title),
      category: isString(raw.category) ? t(raw.category) : undefined,
      icon: parseIcon(raw.icon),
    });
  }

  for (const raw of asArray(contributes.keybindings)) {
    if (!isString(raw.command) || !isString(raw.key)) continue;
    result.keybindings.push({
      command: raw.command,
      key: raw.key,
      mac: optionalString(raw.mac),
      linux: optionalString(raw.linux),
      win: optionalString(raw.win),
      when: optionalString(raw.when),
      args: raw.args,
    });
  }

  for (const raw of asArray(contributes.languages)) {
    if (!isString(raw.id)) continue;
    result.languages.push({
      id: raw.id,
      aliases: stringArray(raw.aliases),
      extensions: stringArray(raw.extensions),
      filenames: stringArray(raw.filenames),
      filenamePatterns: stringArray(raw.filenamePatterns),
      firstLine: optionalString(raw.firstLine),
      configuration: optionalString(raw.configuration),
    });
  }

  for (const raw of asArray(contributes.grammars)) {
    if (!isString(raw.scopeName) || !isString(raw.path)) continue;
    const embedded = isObject(raw.embeddedLanguages)
      ? Object.fromEntries(
          Object.entries(raw.embeddedLanguages).filter((entry): entry is [string, string] =>
            isString(entry[1])
          )
        )
      : undefined;
    result.grammars.push({
      language: optionalString(raw.language),
      scopeName: raw.scopeName,
      path: raw.path,
      embeddedLanguages: embedded,
      injectTo: stringArray(raw.injectTo),
    });
  }

  for (const raw of asArray(contributes.snippets)) {
    if (!isString(raw.path)) continue;
    result.snippets.push({ language: optionalString(raw.language), path: raw.path });
  }

  result.configuration = parseConfiguration(contributes.configuration);

  if (isObject(contributes.viewsContainers)) {
    result.viewsContainers = {
      activitybar: parseContainers(contributes.viewsContainers.activitybar).map((c) => ({
        ...c,
        title: t(c.title),
      })),
      panel: parseContainers(contributes.viewsContainers.panel).map((c) => ({
        ...c,
        title: t(c.title),
      })),
    };
  }

  if (isObject(contributes.views)) {
    for (const [container, views] of Object.entries(contributes.views)) {
      for (const raw of asArray(views)) {
        if (!isString(raw.id) || !isString(raw.name)) continue;
        result.views.push({
          id: raw.id,
          name: t(raw.name),
          type: raw.type === "webview" ? "webview" : "tree",
          when: optionalString(raw.when),
          icon: optionalString(raw.icon),
          contextualTitle: isString(raw.contextualTitle) ? t(raw.contextualTitle) : undefined,
          container,
        });
      }
    }
  }

  if (isObject(contributes.menus)) {
    for (const [menu, items] of Object.entries(contributes.menus)) {
      const parsed = asArray(items).flatMap((raw) =>
        isString(raw.command)
          ? [
              {
                command: raw.command,
                when: optionalString(raw.when),
                group: optionalString(raw.group),
              },
            ]
          : []
      );
      if (parsed.length > 0) result.menus[menu] = parsed;
    }
  }

  return result;
}

/** True if the extension brings anything the app can use besides themes. */
export function hasUsableContributions(contributions: ExtensionContributions): boolean {
  return (
    contributions.commands.length > 0 ||
    contributions.keybindings.length > 0 ||
    contributions.languages.length > 0 ||
    contributions.grammars.length > 0 ||
    contributions.snippets.length > 0 ||
    contributions.views.length > 0 ||
    Object.keys(contributions.configuration).length > 0
  );
}

export type Platform = "linux" | "win" | "mac";

export function currentPlatform(): Platform {
  if (typeof navigator === "undefined") return "linux";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "mac";
  if (platform.includes("win")) return "win";
  return "linux";
}

/** The key of a keybinding for a platform (`linux`/`win`/`mac` override `key`). */
export function keyForPlatform(binding: KeybindingContribution, platform: Platform): string {
  return binding[platform] ?? binding.key;
}

/**
 * Activation events of an extension, including the ones VS Code infers from
 * contributions since 1.74 (`onCommand:`, `onView:`, `onLanguage:`).
 */
export function effectiveActivationEvents(
  declared: string[],
  contributions: ExtensionContributions
): string[] {
  const events = new Set(declared);
  for (const command of contributions.commands) events.add(`onCommand:${command.command}`);
  for (const view of contributions.views) events.add(`onView:${view.id}`);
  for (const language of contributions.languages) events.add(`onLanguage:${language.id}`);
  return [...events];
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Short, human-readable list of what an extension brings (for the UI). */
export function summarizeContributions(extension: {
  contributions: ExtensionContributions;
  main?: string;
  iconThemes?: unknown[];
  colorThemes?: unknown[];
}): string[] {
  const c = extension.contributions;
  const parts: string[] = [];
  if (extension.colorThemes?.length)
    parts.push(plural(extension.colorThemes.length, "tema de color", "temas de color"));
  if (extension.iconThemes?.length)
    parts.push(plural(extension.iconThemes.length, "tema de iconos", "temas de iconos"));
  if (c.languages.length) parts.push(plural(c.languages.length, "lenguaje", "lenguajes"));
  if (c.grammars.length) parts.push(plural(c.grammars.length, "gramática", "gramáticas"));
  if (c.snippets.length) parts.push("snippets");
  if (c.commands.length) parts.push(plural(c.commands.length, "comando", "comandos"));
  if (c.keybindings.length) parts.push(plural(c.keybindings.length, "atajo", "atajos"));
  if (c.views.length) parts.push(plural(c.views.length, "vista", "vistas"));
  if (Object.keys(c.configuration).length) parts.push("configuración");
  if (extension.main) parts.push("código (Extension Host)");
  return parts;
}
