import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightCode, tagHighlighter, tags } from "@lezer/highlight";

/**
 * Syntax highlighting for code blocks in the Markdown preview, with the same
 * parsers as the editor (CodeMirror language data) and the same palette
 * (`tok-*` classes styled in markdown-preview.css, mirroring the code editor).
 */
const highlighter = tagHighlighter([
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: "tok-comment" },
  { tag: [tags.string, tags.special(tags.string)], class: "tok-string" },
  { tag: [tags.number, tags.integer, tags.float], class: "tok-number" },
  { tag: [tags.bool, tags.null, tags.atom], class: "tok-atom" },
  { tag: [tags.keyword, tags.modifier, tags.definitionKeyword], class: "tok-keyword" },
  { tag: [tags.controlKeyword, tags.moduleKeyword], class: "tok-control" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: "tok-function",
  },
  { tag: [tags.typeName, tags.className, tags.namespace], class: "tok-type" },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], class: "tok-variable" },
  { tag: tags.tagName, class: "tok-tag" },
  { tag: [tags.regexp, tags.escape], class: "tok-regexp" },
  { tag: tags.heading, class: "tok-heading" },
  { tag: tags.strong, class: "tok-strong" },
  { tag: tags.emphasis, class: "tok-emphasis" },
  { tag: tags.link, class: "tok-link" },
  { tag: tags.invalid, class: "tok-invalid" },
]);

export interface Token {
  text: string;
  /** Space-separated `tok-*` classes, empty for plain text. */
  classes: string;
}

/** One array of tokens per line. */
export type HighlightedLines = Token[][];

const parsers = new Map<string, Promise<LanguageDescription | null>>();

function findLanguage(name: string): Promise<LanguageDescription | null> {
  const key = name.toLowerCase();
  let found = parsers.get(key);
  if (!found) {
    const description =
      LanguageDescription.matchLanguageName(languages, key, true) ??
      LanguageDescription.matchFilename(languages, `file.${key}`);
    found = description
      ? description.load().then(
          () => description,
          () => null
        )
      : Promise.resolve(null);
    parsers.set(key, found);
  }
  return found;
}

/** Tokens of `code` in `language`, or null when the language is unknown. */
export async function highlight(code: string, language: string): Promise<HighlightedLines | null> {
  const description = await findLanguage(language);
  const support = description?.support;
  if (!support) return null;
  const tree = support.language.parser.parse(code);
  const lines: HighlightedLines = [[]];
  highlightCode(
    code,
    tree,
    highlighter,
    (text, classes) => lines[lines.length - 1].push({ text, classes }),
    () => lines.push([])
  );
  return lines;
}
