import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";

/**
 * VS Code snippets (`contributes.snippets` / `.code-snippets`) for the code
 * editor. VS Code's TextMate-style snippet syntax is converted to
 * CodeMirror's template syntax.
 */

export interface Snippet {
  name: string;
  prefixes: string[];
  body: string;
  description?: string;
  /** Language ids the snippet applies to; empty = the file's language. */
  scopes: string[];
}

export interface SnippetVariables {
  filePath?: string;
  workspaceName?: string;
  lineComment?: string;
  blockComment?: [string, string];
  now?: Date;
}

type Raw = Record<string, unknown>;

/** Parse a snippet file (already JSON-parsed). Invalid entries are skipped. */
export function parseSnippetFile(json: unknown): Snippet[] {
  if (typeof json !== "object" || json === null) return [];
  const snippets: Snippet[] = [];
  for (const [name, value] of Object.entries(json as Raw)) {
    if (typeof value !== "object" || value === null) continue;
    const raw = value as Raw;
    const prefixes = (Array.isArray(raw.prefix) ? raw.prefix : [raw.prefix]).filter(
      (p): p is string => typeof p === "string" && p.length > 0
    );
    const bodyLines = Array.isArray(raw.body) ? raw.body : [raw.body];
    if (prefixes.length === 0 || !bodyLines.every((line) => typeof line === "string")) continue;
    snippets.push({
      name,
      prefixes,
      body: (bodyLines as string[]).join("\n"),
      description: typeof raw.description === "string" ? raw.description : undefined,
      scopes:
        typeof raw.scope === "string"
          ? raw.scope
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
    });
  }
  return snippets;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function resolveVariable(name: string, vars: SnippetVariables): string | undefined {
  const now = vars.now ?? new Date();
  const path = vars.filePath ?? "";
  const file = path.split(/[\\/]/).pop() ?? "";
  switch (name) {
    case "TM_FILENAME":
      return file;
    case "TM_FILENAME_BASE":
      return file.replace(/\.[^.]*$/, "");
    case "TM_FILEPATH":
      return path;
    case "TM_DIRECTORY":
      return path.slice(0, Math.max(0, path.length - file.length - 1));
    case "TM_SELECTED_TEXT":
    case "TM_CURRENT_LINE":
    case "TM_CURRENT_WORD":
    case "CLIPBOARD":
      return "";
    case "TM_LINE_NUMBER":
      return "1";
    case "WORKSPACE_NAME":
      return vars.workspaceName ?? "";
    case "CURRENT_YEAR":
      return String(now.getFullYear());
    case "CURRENT_YEAR_SHORT":
      return String(now.getFullYear()).slice(-2);
    case "CURRENT_MONTH":
      return pad(now.getMonth() + 1);
    case "CURRENT_DATE":
      return pad(now.getDate());
    case "CURRENT_HOUR":
      return pad(now.getHours());
    case "CURRENT_MINUTE":
      return pad(now.getMinutes());
    case "CURRENT_SECOND":
      return pad(now.getSeconds());
    case "CURRENT_SECONDS_UNIX":
      return String(Math.floor(now.getTime() / 1000));
    case "UUID":
      return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "";
    case "LINE_COMMENT":
      return vars.lineComment ?? "//";
    case "BLOCK_COMMENT_START":
      return vars.blockComment?.[0] ?? "/*";
    case "BLOCK_COMMENT_END":
      return vars.blockComment?.[1] ?? "*/";
    default:
      return undefined;
  }
}

/** Escape literal text for a CodeMirror template. */
function escapeLiteral(text: string): string {
  return text.replace(/[{}]/g, (brace) => `\\${brace}`);
}

/**
 * Convert VS Code snippet syntax to a CodeMirror snippet template:
 * `$1`, `${1:default}`, `${1|a,b|}`, `$0`, variables (`$TM_FILENAME`,
 * `${CURRENT_YEAR}`, `${VAR:default}`) and transforms (kept as plain tab
 * stops). Nested placeholders are flattened into their parent's text.
 */
export function toCodeMirrorTemplate(body: string, vars: SnippetVariables = {}): string {
  let pos = 0;

  // Parses until `stop` (a closing brace) at the current nesting level and
  // returns the plain text, used for placeholder defaults.
  const parseText = (stopAtBrace: boolean): { template: string; plain: string } => {
    let template = "";
    let plain = "";
    while (pos < body.length) {
      const ch = body[pos];
      if (ch === "\\" && pos + 1 < body.length && "$}\\,|".includes(body[pos + 1])) {
        template += escapeLiteral(body[pos + 1]);
        plain += body[pos + 1];
        pos += 2;
        continue;
      }
      if (stopAtBrace && ch === "}") break;
      if (ch === "$") {
        const parsed = parseDollar();
        if (parsed) {
          template += parsed.template;
          plain += parsed.plain;
          continue;
        }
      }
      template += escapeLiteral(ch);
      plain += ch;
      pos++;
    }
    return { template, plain };
  };

  const field = (index: number, text: string) => {
    const clean = text.replace(/[{}\n]/g, "");
    return index === 0 ? "${0}" : clean ? `\${${index}:${clean}}` : `\${${index}}`;
  };

  const parseDollar = (): { template: string; plain: string } | null => {
    const rest = body.slice(pos + 1);
    const simpleTab = /^(\d+)/.exec(rest);
    if (simpleTab) {
      pos += 1 + simpleTab[1].length;
      return { template: field(Number(simpleTab[1]), ""), plain: "" };
    }
    const simpleVar = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
    if (simpleVar) {
      pos += 1 + simpleVar[1].length;
      const value = resolveVariable(simpleVar[1], vars);
      const text = value ?? simpleVar[1];
      return { template: escapeLiteral(text), plain: text };
    }
    if (rest[0] !== "{") return null;

    const inner = body.slice(pos + 2);
    const tab = /^(\d+)/.exec(inner);
    const variable = tab ? null : /^([A-Za-z_][A-Za-z0-9_]*)/.exec(inner);
    if (!tab && !variable) return null;
    const head = (tab ?? variable)![1];
    const start = pos;
    pos += 2 + head.length;
    const next = body[pos];

    const closeOrFail = (): boolean => {
      if (body[pos] === "}") {
        pos++;
        return true;
      }
      pos = start;
      return false;
    };

    if (next === "}") {
      pos++;
      if (tab) return { template: field(Number(head), ""), plain: "" };
      const text = resolveVariable(head, vars) ?? head;
      return { template: escapeLiteral(text), plain: text };
    }
    if (next === ":") {
      pos++;
      const inside = parseText(true);
      if (!closeOrFail()) return null;
      if (tab) return { template: field(Number(head), inside.plain), plain: inside.plain };
      const value = resolveVariable(head, vars);
      return value !== undefined
        ? { template: escapeLiteral(value), plain: value }
        : { template: inside.template, plain: inside.plain };
    }
    if (next === "|" && tab) {
      const end = body.indexOf("|}", pos + 1);
      if (end < 0) {
        pos = start;
        return null;
      }
      const choices = body.slice(pos + 1, end).split(",");
      pos = end + 2;
      return { template: field(Number(head), choices[0] ?? ""), plain: choices[0] ?? "" };
    }
    if (next === "/") {
      // `${1/regex/format/flags}`: transforms are not supported, keep the stop.
      let slashes = 0;
      let depth = 0;
      while (pos < body.length) {
        const current = body[pos];
        if (current === "\\") pos++;
        else if (current === "/") slashes++;
        else if (current === "{") depth++;
        else if (current === "}") {
          if (depth === 0 && slashes >= 3) break;
          depth = Math.max(0, depth - 1);
        }
        pos++;
      }
      if (!closeOrFail()) return null;
      if (tab) return { template: field(Number(head), ""), plain: "" };
      const text = resolveVariable(head, vars) ?? "";
      return { template: escapeLiteral(text), plain: text };
    }
    pos = start;
    return null;
  };

  return parseText(false).template;
}

/** Snippets that apply to `languageId`. */
export function snippetsForLanguage(
  snippets: Array<Snippet & { language?: string }>,
  languageId: string
): Snippet[] {
  return snippets.filter((snippet) => {
    if (snippet.scopes.length > 0) return snippet.scopes.includes(languageId);
    return !snippet.language || snippet.language === languageId;
  });
}

/** Completion source offering the given snippets by prefix. */
export function snippetCompletionSource(
  getSnippets: () => Snippet[],
  vars: () => SnippetVariables
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w\-.:@#!$]+$/);
    if (!word && !context.explicit) return null;
    const snippets = getSnippets();
    if (snippets.length === 0) return null;
    const options: Completion[] = [];
    for (const snippet of snippets) {
      for (const prefix of snippet.prefixes) {
        options.push(
          snippetCompletion(toCodeMirrorTemplate(snippet.body, vars()), {
            label: prefix,
            detail: snippet.description ?? snippet.name,
            type: "snippet",
            boost: -1,
          })
        );
      }
    }
    return { from: word?.from ?? context.pos, options, validFor: /^[\w\-.:@#!$]*$/ };
  };
}
