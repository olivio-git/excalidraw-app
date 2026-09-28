import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/**
 * Code editor look: chrome from the app's CSS variables (so it follows any
 * VS Code color theme) and Dark+/Light+ colors for CodeMirror's own parsers.
 * TextMate-highlighted languages use the theme's tokenColors instead.
 */
const color = (variable: string, alpha?: number) =>
  alpha === undefined ? `hsl(var(${variable}))` : `hsl(var(${variable}) / ${alpha})`;

export const codeEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: color("--foreground"),
    backgroundColor: color("--background"),
    fontSize: "13px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-tooltip, .cm-panels": { fontFamily: "var(--font-family-active)" },
  ".cm-content": { caretColor: color("--primary"), paddingBottom: "40vh" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: color("--primary"), borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: `${color("--primary", 0.25)} !important`,
  },
  ".cm-activeLine": { backgroundColor: color("--muted", 0.35) },
  ".cm-gutters": {
    backgroundColor: color("--background"),
    color: color("--muted-foreground", 0.7),
    border: "none",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: color("--foreground") },
  ".cm-foldPlaceholder": {
    backgroundColor: color("--muted"),
    border: "none",
    color: color("--muted-foreground"),
  },
  ".cm-tooltip": {
    backgroundColor: color("--popover"),
    color: color("--popover-foreground"),
    border: `1px solid ${color("--border")}`,
    borderRadius: "6px",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: color("--accent"),
    color: color("--accent-foreground"),
  },
  ".cm-panels": { backgroundColor: color("--card"), color: color("--foreground") },
  ".cm-searchMatch": { backgroundColor: "rgba(234, 179, 8, 0.3)" },
  ".cm-selectionMatch": { backgroundColor: color("--primary", 0.12) },
  ".cm-matchingBracket": { outline: `1px solid ${color("--muted-foreground", 0.6)}` },
});

const dark = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#6A9955" },
  { tag: [tags.string, tags.special(tags.string)], color: "#CE9178" },
  { tag: [tags.number, tags.integer, tags.float], color: "#B5CEA8" },
  { tag: [tags.bool, tags.null, tags.atom], color: "#569CD6" },
  { tag: [tags.keyword, tags.modifier, tags.definitionKeyword], color: "#569CD6" },
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: "#C586C0" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#DCDCAA" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#4EC9B0" },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: "#9CDCFE" },
  { tag: [tags.tagName], color: "#569CD6" },
  { tag: [tags.regexp, tags.escape], color: "#D16969" },
  { tag: tags.heading, color: "#569CD6", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "#3794FF", textDecoration: "underline" },
  { tag: tags.invalid, color: "#F44747" },
]);

const light = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#008000" },
  { tag: [tags.string, tags.special(tags.string)], color: "#A31515" },
  { tag: [tags.number, tags.integer, tags.float], color: "#098658" },
  { tag: [tags.bool, tags.null, tags.atom], color: "#0000FF" },
  { tag: [tags.keyword, tags.modifier, tags.definitionKeyword], color: "#0000FF" },
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: "#AF00DB" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#795E26" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#267F99" },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: "#001080" },
  { tag: [tags.tagName], color: "#800000" },
  { tag: [tags.regexp, tags.escape], color: "#811F3F" },
  { tag: tags.heading, color: "#800000", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "#006AB1", textDecoration: "underline" },
  { tag: tags.invalid, color: "#CD3131" },
]);

export function codeHighlightStyle(isDark: boolean): Extension {
  return syntaxHighlighting(isDark ? dark : light);
}
