import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * Editor styling built only from the app's CSS variables, so it follows the
 * light/dark mode and any VS Code color theme automatically.
 */
const color = (variable: string, alpha?: number) =>
  alpha === undefined ? `hsl(var(${variable}))` : `hsl(var(${variable}) / ${alpha})`;

export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: color("--foreground"),
    // The theme token (not the raw HSL) so window translucency shows through.
    backgroundColor: "var(--color-background)",
    // config.toml [editor] can change the font, size and spacing.
    fontSize: "var(--qori-editor-size, 15px)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--qori-editor-font, var(--font-family-active, var(--font-sans)))",
    lineHeight: "var(--qori-editor-line-height, 1.7)",
  },
  ".cm-content": {
    // Full width by default; config.toml `content_width = "readable"` sets a column.
    maxWidth: "var(--qori-content-width, none)",
    margin: "0 auto",
    padding: "1.5rem 2rem 40vh",
    caretColor: color("--primary"),
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: color("--primary"), borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: `${color("--primary", 0.25)} !important`,
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-gutters": { display: "none" },

  // Headings
  ".cm-md-heading": { fontWeight: "700", lineHeight: "1.3", color: color("--foreground") },
  ".cm-md-h1": { fontSize: "1.9em", paddingTop: "0.6em" },
  ".cm-md-h2": { fontSize: "1.5em", paddingTop: "0.5em" },
  ".cm-md-h3": { fontSize: "1.25em", paddingTop: "0.4em" },
  ".cm-md-h4, .cm-md-h5, .cm-md-h6": { fontSize: "1.05em" },

  // Inline
  ".cm-md-strong": { fontWeight: "700" },
  ".cm-md-em": { fontStyle: "italic" },
  ".cm-md-strike": { textDecoration: "line-through", color: color("--muted-foreground") },
  ".cm-md-inline-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.88em",
    padding: "0.1em 0.3em",
    borderRadius: "4px",
    backgroundColor: color("--muted"),
  },
  ".cm-md-link": {
    color: color("--primary"),
    textDecoration: "underline",
    textDecorationColor: color("--primary", 0.4),
    textUnderlineOffset: "3px",
  },
  ".cm-md-math": { padding: "0 0.1em" },

  // Blocks
  ".cm-md-quote": {
    borderLeft: `3px solid ${color("--primary", 0.6)}`,
    paddingLeft: "1em !important",
    color: color("--muted-foreground"),
  },
  ".cm-md-codeblock": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.88em",
    backgroundColor: color("--muted"),
    paddingLeft: "1em !important",
  },
  ".cm-md-codeblock-fence": { color: color("--muted-foreground") },
  ".cm-md-codeblock-first": { borderTopLeftRadius: "8px", borderTopRightRadius: "8px" },
  ".cm-md-codeblock-last": { borderBottomLeftRadius: "8px", borderBottomRightRadius: "8px" },
  ".cm-md-code-lang": {
    fontSize: "0.75em",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: color("--muted-foreground"),
  },
  ".cm-md-callout": {
    borderLeft: `3px solid var(--callout-color)`,
    backgroundColor: "color-mix(in srgb, var(--callout-color) 10%, transparent)",
    paddingLeft: "1em !important",
  },
  ".cm-md-callout-note, .cm-md-callout-important": { "--callout-color": color("--primary") },
  ".cm-md-callout-tip": { "--callout-color": color("--sidebar-primary") },
  ".cm-md-callout-warning, .cm-md-callout-caution": { "--callout-color": color("--destructive") },
  ".cm-md-callout-label": { fontWeight: "700", color: "var(--callout-color)" },
  ".cm-md-bullet": { color: color("--primary"), fontWeight: "700", padding: "0 0.25em" },
  ".cm-md-task": {
    accentColor: color("--primary"),
    width: "1em",
    height: "1em",
    margin: "0 0.35em 0 0",
    verticalAlign: "-0.15em",
    cursor: "pointer",
  },
  ".cm-md-task-done": { color: color("--muted-foreground"), textDecoration: "line-through" },
  ".cm-md-hr": {
    display: "inline-block",
    width: "100%",
    border: "none",
    borderTop: `1px solid ${color("--border")}`,
    verticalAlign: "middle",
    margin: "0",
  },
  ".cm-md-math-block": {
    padding: "0.75em 0",
    textAlign: "center",
    cursor: "text",
    overflowX: "auto",
  },

  // Embeds (diagrams, images)
  ".cm-md-embed": {
    margin: "0.75em 0",
    border: `1px solid ${color("--border")}`,
    borderRadius: "10px",
    overflow: "hidden",
    backgroundColor: color("--card"),
  },
  ".cm-md-embed-frame": {
    display: "flex",
    justifyContent: "center",
    padding: "0.75em",
    minHeight: "4em",
    color: color("--muted-foreground"),
    fontSize: "0.85em",
  },
  ".cm-md-embed-frame img": { maxWidth: "100%", maxHeight: "480px", objectFit: "contain" },
  ".cm-md-embed-error": { color: color("--destructive") },
  ".cm-md-embed figcaption": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5em",
    padding: "0.35em 0.75em",
    borderTop: `1px solid ${color("--border")}`,
    fontSize: "0.8em",
    color: color("--muted-foreground"),
  },
  ".cm-md-embed-actions": { display: "flex", gap: "0.25em" },
  ".cm-md-embed-actions button": {
    padding: "0.1em 0.5em",
    borderRadius: "4px",
    color: color("--foreground"),
    background: "transparent",
    cursor: "pointer",
  },
  ".cm-md-embed-actions button:hover": { backgroundColor: color("--accent") },

  // Autocomplete and search panels
  ".cm-tooltip": {
    border: `1px solid ${color("--border")}`,
    backgroundColor: color("--popover"),
    color: color("--popover-foreground"),
    borderRadius: "8px",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul > li": { padding: "0.3em 0.75em !important" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: color("--accent"),
    color: color("--accent-foreground"),
  },
  ".cm-completionDetail": { color: color("--muted-foreground"), marginLeft: "0.75em" },
  ".cm-completionMatchedText": { textDecoration: "none", color: color("--primary") },
  ".cm-panels": { backgroundColor: color("--card"), color: color("--card-foreground") },
  ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${color("--border")}` },
  ".cm-searchMatch": { backgroundColor: color("--primary", 0.2) },
  ".cm-searchMatch-selected": { backgroundColor: color("--primary", 0.45) },
  ".cm-textfield": {
    backgroundColor: color("--background"),
    color: color("--foreground"),
    border: `1px solid ${color("--input")}`,
    borderRadius: "4px",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: color("--secondary"),
    color: color("--secondary-foreground"),
    border: `1px solid ${color("--border")}`,
    borderRadius: "4px",
  },
});

/** Syntax colors (Markdown and fenced code) from the theme's variables. */
export const editorHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.processingInstruction, color: color("--muted-foreground") },
    { tag: tags.url, color: color("--muted-foreground") },
    { tag: tags.monospace, fontFamily: "var(--font-mono)" },
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: color("--primary") },
    {
      tag: [tags.string, tags.special(tags.string), tags.regexp],
      color: color("--sidebar-primary"),
    },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: color("--destructive") },
    { tag: [tags.comment, tags.meta], color: color("--muted-foreground"), fontStyle: "italic" },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      color: color("--ring"),
    },
    { tag: [tags.typeName, tags.className, tags.namespace], color: color("--sidebar-primary") },
    { tag: tags.invalid, color: color("--destructive") },
  ])
);
