import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";
import {
  DEFAULT_CONFIG,
  OPTION_DOCS,
  RULES,
  SECTION_DOCS,
  validateConfig,
  type AppConfig,
  type ConfigIssue,
} from "./schema";
import { parseToml, validateKeymap } from "./loader";
import { parseVimrc } from "./vim-mode";

/**
 * Editor help for the config files, like VS Code with a JSON schema:
 * suggestions for sections, options and their values (with what each one
 * does), the problems the app found shown on their line, and the docs of an
 * option on hover. Works on config.toml, the project's .qori/config.toml,
 * keymap.toml (suggests the app's commands) and vimrc.
 */

export type ConfigFileKind = "config" | "keymap" | "vimrc";

type Rule =
  | { type: "string"; oneOf?: readonly string[] }
  | { type: "number"; min: number; max: number }
  | { type: "boolean" }
  | { type: "string[]" };

const SECTIONS = Object.keys(RULES) as Array<keyof AppConfig>;

const ruleOf = (section: string, key: string): Rule | undefined =>
  (RULES as Record<string, Record<string, Rule>>)[section]?.[key];

const defaultOf = (section: string, key: string): unknown =>
  (DEFAULT_CONFIG as unknown as Record<string, Record<string, unknown>>)[section]?.[key];

/** A TOML literal for a value (strings quoted). */
const literal = (value: unknown) =>
  typeof value === "string"
    ? `"${value}"`
    : Array.isArray(value)
      ? JSON.stringify(value)
      : String(value);

function ruleSummary(rule: Rule | undefined): string {
  if (!rule) return "";
  if (rule.type === "string") return rule.oneOf ? rule.oneOf.join(" | ") : "texto";
  if (rule.type === "number") return `número ${rule.min}–${rule.max}`;
  if (rule.type === "boolean") return "true | false";
  return "lista de textos";
}

/** Markdown-ish docs of an option: description, accepted values, default. */
export function optionDoc(section: string, key: string): string | null {
  const rule = ruleOf(section, key);
  if (!rule) return null;
  const description = OPTION_DOCS[`${section}.${key}`] ?? "";
  return `${description}\nValores: ${ruleSummary(rule)} · por defecto: ${literal(defaultOf(section, key))}`;
}

/** The `[section]` a line belongs to (the last header above it). */
export function sectionAt(text: string, pos: number): string | null {
  const before = text.slice(0, pos).split("\n");
  for (let i = before.length - 1; i >= 0; i--) {
    const match = before[i].match(/^\s*\[\s*([\w.-]+)\s*\]/);
    if (match) return match[1];
  }
  return null;
}

// ── Suggestions ───────────────────────────────────────────────────────────────

const infoNode = (text: string) => () => {
  const dom = document.createElement("div");
  dom.className = "qori-config-info";
  dom.textContent = text;
  return dom;
};

/** Suggestions in config.toml at `pos` (pure: `lineBefore` is the line up to the cursor). */
export function configCompletions(
  text: string,
  pos: number,
  lineBefore: string
): { from: number; options: Completion[] } | null {
  // [sec|
  const header = lineBefore.match(/^\s*\[\s*([\w-]*)$/);
  if (header) {
    return {
      from: pos - header[1].length,
      options: SECTIONS.map((section) => ({
        label: section,
        type: "namespace",
        detail: "sección",
        info: infoNode(SECTION_DOCS[section]),
        apply:
          lineBefore.endsWith("[") || !text.slice(pos).startsWith("]") ? `${section}]` : section,
      })),
    };
  }
  const section = sectionAt(text, pos);
  // key = val|
  const value = lineBefore.match(/^\s*([\w-]+)\s*=\s*("?)([^"]*)$/);
  if (value && section) {
    const [, key, quote, typed] = value;
    const rule = ruleOf(section, key);
    if (!rule) return null;
    let options: Completion[] = [];
    if (rule.type === "string" && rule.oneOf)
      options = rule.oneOf.map((choice) => ({
        label: `"${choice}"`,
        type: "enum",
        apply: quote ? `${choice}"` : `"${choice}"`,
        boost: choice === defaultOf(section, key) ? 1 : 0,
        detail: choice === defaultOf(section, key) ? "por defecto" : undefined,
      }));
    else if (rule.type === "boolean")
      options = ["true", "false"].map((choice) => ({ label: choice, type: "keyword" }));
    else if (rule.type === "number")
      options = [
        { label: literal(defaultOf(section, key)), type: "constant", detail: ruleSummary(rule) },
      ];
    if (options.length === 0) return null;
    return { from: pos - typed.length - quote.length, options };
  }
  // ke|   (start of a line inside a section)
  const keyMatch = lineBefore.match(/^\s*([\w-]*)$/);
  if (keyMatch && section && section in RULES) {
    const present = new Set([...text.matchAll(/^\s*([\w-]+)\s*=/gm)].map((m) => m[1]));
    const rules = (RULES as Record<string, Record<string, Rule>>)[section];
    return {
      from: pos - keyMatch[1].length,
      options: Object.keys(rules).map((key) => ({
        label: key,
        type: "property",
        detail: ruleSummary(rules[key]),
        info: infoNode(OPTION_DOCS[`${section}.${key}`] ?? ""),
        apply: `${key} = ${literal(defaultOf(section, key))}`,
        boost: present.has(key) ? -1 : 0,
      })),
    };
  }
  return null;
}

/** Commands of the app, for keymap.toml and `:qori` in vimrc. */
export type CommandList = () => Array<{ id: string; name: string }>;

const commandOptions = (commands: CommandList, apply?: (id: string) => string): Completion[] =>
  commands().map((command) => ({
    label: command.id,
    detail: command.name,
    type: "function",
    apply: apply ? apply(command.id) : command.id,
  }));

export function keymapCompletions(
  pos: number,
  lineBefore: string,
  commands: CommandList
): { from: number; options: Completion[] } | null {
  if (/^\s*\[\[?\w*$/.test(lineBefore)) {
    const typed = lineBefore.trimStart();
    return {
      from: pos - typed.length,
      options: [{ label: "[[bind]]", type: "namespace", detail: "un atajo", apply: "[[bind]]" }],
    };
  }
  const command = lineBefore.match(/^\s*command\s*=\s*"([^"]*)$/);
  if (command)
    return { from: pos - command[1].length, options: commandOptions(commands, (id) => `${id}"`) };
  const keyMatch = lineBefore.match(/^\s*(\w*)$/);
  if (keyMatch)
    return {
      from: pos - keyMatch[1].length,
      options: [
        { label: "key", type: "property", detail: "tecla, p. ej. ctrl+alt+n", apply: 'key = ""' },
        { label: "command", type: "property", detail: "ID del comando", apply: 'command = ""' },
        { label: "when", type: "property", detail: "contexto (opcional)", apply: 'when = ""' },
      ],
    };
  return null;
}

const VIM_COMMANDS = [
  ["let mapleader", 'let mapleader = " "', "Tecla líder para <leader>"],
  ["nnoremap", "nnoremap ", "Mapeo en modo normal (sin recursión)"],
  ["inoremap", "inoremap ", "Mapeo en modo insertar (sin recursión)"],
  ["vnoremap", "vnoremap ", "Mapeo en modo visual (sin recursión)"],
  ["noremap", "noremap ", "Mapeo en normal, visual y operador"],
  ["nmap", "nmap ", "Mapeo en modo normal"],
  ["imap", "imap ", "Mapeo en modo insertar"],
  ["vmap", "vmap ", "Mapeo en modo visual"],
  ["map", "map ", "Mapeo en normal, visual y operador"],
] as const;

export function vimrcCompletions(
  pos: number,
  lineBefore: string,
  commands: CommandList
): { from: number; options: Completion[] } | null {
  const qori = lineBefore.match(/:qori\s+([\w.-]*)$/);
  if (qori) return { from: pos - qori[1].length, options: commandOptions(commands) };
  const start = lineBefore.match(/^\s*([\w ]*)$/);
  if (start && !start[1].includes("  "))
    return {
      from: pos - start[1].length,
      options: VIM_COMMANDS.map(([label, apply, detail]) => ({
        label,
        apply,
        detail,
        type: "keyword",
      })),
    };
  return null;
}

// ── Problems on their line ────────────────────────────────────────────────────

/** 1-based line of an issue: its own, its option's line inside its section, or its section header. */
function issueLine(text: string, issue: ConfigIssue): number {
  if (issue.line) return issue.line;
  const lines = text.split("\n");
  const [section, key] = issue.path.split(".");
  let current: string | null = null;
  let headerLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^\s*\[\s*([\w.-]+)\s*\]/);
    if (header) {
      current = header[1];
      if (current === section && !key) return i + 1;
      if (current === section) headerLine = i + 1;
      continue;
    }
    if (key && current === section && new RegExp(`^\\s*${key}\\s*=`).test(lines[i])) return i + 1;
  }
  return headerLine || 1;
}

export interface LineProblem {
  line: number;
  message: string;
  severity: "error" | "warning";
}

export function configProblems(text: string): LineProblem[] {
  const parsed = parseToml(text, "config.toml");
  if (parsed.data === null)
    return parsed.issues.map((issue) => ({
      line: issue.line ?? 1,
      message: issue.message,
      severity: "error",
    }));
  return validateConfig(parsed.data, "config.toml").issues.map((issue) => ({
    line: issueLine(text, issue),
    message: issue.message,
    severity: /se usa/.test(issue.message) ? "warning" : "error",
  }));
}

export function keymapProblems(text: string, commands: CommandList): LineProblem[] {
  const parsed = parseToml(text, "keymap.toml");
  if (parsed.data === null)
    return parsed.issues.map((issue) => ({
      line: issue.line ?? 1,
      message: issue.message,
      severity: "error",
    }));
  const lines = text.split("\n");
  const problems: LineProblem[] = validateKeymap(parsed.data, "keymap.toml").issues.map((issue) => {
    const index = Number(issue.path.match(/bind\[(\d+)\]/)?.[1] ?? 0);
    let seen = 0;
    const line = lines.findIndex((l) => /^\s*\[\[\s*bind\s*\]\]/.test(l) && ++seen === index);
    return { line: line >= 0 ? line + 1 : 1, message: issue.message, severity: "error" as const };
  });
  const known = new Set(commands().map((c) => c.id));
  if (known.size > 0)
    lines.forEach((line, i) => {
      const id = line.match(/^\s*command\s*=\s*"([^"]+)"/)?.[1];
      if (id && !known.has(id))
        problems.push({
          line: i + 1,
          message: `No existe el comando «${id}»`,
          severity: "warning",
        });
    });
  return problems;
}

export function vimrcProblems(text: string): LineProblem[] {
  return parseVimrc(text).problems.map((problem) => ({ ...problem, severity: "warning" }));
}

// ── CodeMirror glue ───────────────────────────────────────────────────────────

function toDiagnostics(text: string, problems: LineProblem[]): Diagnostic[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return problems.map((problem) => {
    const from = starts[Math.min(problem.line, starts.length) - 1] ?? 0;
    const end = text.indexOf("\n", from);
    return {
      from,
      to: end < 0 ? text.length : end,
      severity: problem.severity,
      message: problem.message,
      source: "QoriApp",
    };
  });
}

function completionSource(kind: ConfigFileKind, commands: CommandList) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const lineBefore = line.text.slice(0, context.pos - line.from);
    if (/^\s*[#"]/.test(lineBefore)) return null;
    const text = context.state.doc.toString();
    const result =
      kind === "config"
        ? configCompletions(text, context.pos, lineBefore)
        : kind === "keymap"
          ? keymapCompletions(context.pos, lineBefore, commands)
          : vimrcCompletions(context.pos, lineBefore, commands);
    if (!result) return null;
    // Don't pop up on an empty line unless asked (Ctrl+Space) or typing a header.
    if (!context.explicit && result.from === context.pos && !/[[=":]\s*"?$/.test(lineBefore))
      return null;
    return { ...result, validFor: /^[\w."-]*$/ };
  };
}

const hover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const match = line.text.match(/^\s*([\w-]+)\s*=/);
  const header = line.text.match(/^\s*\[\s*([\w-]+)\s*\]/);
  const text = view.state.doc.toString();
  let doc: string | null = null;
  let start = line.from;
  let end = line.to;
  if (header && header[1] in SECTION_DOCS) {
    doc = SECTION_DOCS[header[1] as keyof AppConfig];
  } else if (match) {
    const keyStart = line.from + line.text.indexOf(match[1]);
    if (pos < keyStart || pos > keyStart + match[1].length) return null;
    const section = sectionAt(text, line.from);
    doc = section ? optionDoc(section, match[1]) : null;
    if (doc) doc = `${section}.${match[1]}\n${doc}`;
    start = keyStart;
    end = keyStart + match[1].length;
  }
  if (!doc) return null;
  const content = doc;
  return {
    pos: start,
    end,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "qori-config-info";
      dom.textContent = content;
      return { dom };
    },
  };
});

/** Editor extensions for a config file: problems on their line, gutter marks and hover docs. */
export function configEditorExtensions(kind: ConfigFileKind, commands: CommandList): Extension[] {
  const problems = (text: string) =>
    kind === "config"
      ? configProblems(text)
      : kind === "keymap"
        ? keymapProblems(text, commands)
        : vimrcProblems(text);
  return [
    linter(
      (view) => toDiagnostics(view.state.doc.toString(), problems(view.state.doc.toString())),
      {
        delay: 300,
      }
    ),
    lintGutter(),
    ...(kind === "config" ? [hover] : []),
  ];
}

export function configCompletionSource(kind: ConfigFileKind, commands: CommandList) {
  return completionSource(kind, commands);
}
