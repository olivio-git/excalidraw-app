import type { IRawTheme } from "vscode-textmate";
import type { TokenColorRule } from "@/plugins/vscode/color-theme";

export type { TokenColorRule };

/**
 * Token colors for TextMate highlighting: the active VS Code theme's
 * `tokenColors` when it has them, otherwise a compact version of VS Code's
 * Dark+ / Light+ defaults.
 */

const DARK_PLUS: TokenColorRule[] = [
  { settings: { foreground: "#D4D4D4", background: "#1E1E1E" } },
  { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#6A9955" } },
  {
    scope: ["string", "string.quoted", "meta.embedded.assembly"],
    settings: { foreground: "#CE9178" },
  },
  { scope: ["constant.numeric", "keyword.other.unit"], settings: { foreground: "#B5CEA8" } },
  { scope: ["constant.language", "constant.character"], settings: { foreground: "#569CD6" } },
  { scope: ["constant.regexp", "string.regexp"], settings: { foreground: "#D16969" } },
  { scope: ["constant.character.escape"], settings: { foreground: "#D7BA7D" } },
  { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#569CD6" } },
  {
    scope: ["keyword.control", "keyword.operator.new", "keyword.other.using"],
    settings: { foreground: "#C586C0" },
  },
  { scope: ["keyword.operator"], settings: { foreground: "#D4D4D4" } },
  {
    scope: ["entity.name.function", "support.function", "meta.function-call"],
    settings: { foreground: "#DCDCAA" },
  },
  {
    scope: [
      "entity.name.type",
      "entity.name.class",
      "support.class",
      "support.type",
      "entity.other.inherited-class",
    ],
    settings: { foreground: "#4EC9B0" },
  },
  {
    scope: [
      "variable",
      "meta.definition.variable.name",
      "support.variable",
      "entity.name.variable",
    ],
    settings: { foreground: "#9CDCFE" },
  },
  {
    scope: ["variable.other.constant", "variable.other.enummember"],
    settings: { foreground: "#4FC1FF" },
  },
  { scope: ["variable.language"], settings: { foreground: "#569CD6" } },
  { scope: ["entity.name.tag"], settings: { foreground: "#569CD6" } },
  { scope: ["entity.other.attribute-name"], settings: { foreground: "#9CDCFE" } },
  { scope: ["support.type.property-name"], settings: { foreground: "#9CDCFE" } },
  { scope: ["punctuation.definition.tag"], settings: { foreground: "#808080" } },
  { scope: ["markup.heading"], settings: { foreground: "#569CD6", fontStyle: "bold" } },
  { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
  { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
  { scope: ["markup.inline.raw"], settings: { foreground: "#CE9178" } },
  { scope: ["invalid"], settings: { foreground: "#F44747" } },
];

const LIGHT_PLUS: TokenColorRule[] = [
  { settings: { foreground: "#000000", background: "#FFFFFF" } },
  { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#008000" } },
  {
    scope: ["string", "string.quoted", "meta.embedded.assembly"],
    settings: { foreground: "#A31515" },
  },
  { scope: ["constant.numeric", "keyword.other.unit"], settings: { foreground: "#098658" } },
  { scope: ["constant.language", "constant.character"], settings: { foreground: "#0000FF" } },
  { scope: ["constant.regexp", "string.regexp"], settings: { foreground: "#811F3F" } },
  { scope: ["constant.character.escape"], settings: { foreground: "#EE0000" } },
  { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#0000FF" } },
  {
    scope: ["keyword.control", "keyword.operator.new", "keyword.other.using"],
    settings: { foreground: "#AF00DB" },
  },
  { scope: ["keyword.operator"], settings: { foreground: "#000000" } },
  {
    scope: ["entity.name.function", "support.function", "meta.function-call"],
    settings: { foreground: "#795E26" },
  },
  {
    scope: [
      "entity.name.type",
      "entity.name.class",
      "support.class",
      "support.type",
      "entity.other.inherited-class",
    ],
    settings: { foreground: "#267F99" },
  },
  {
    scope: [
      "variable",
      "meta.definition.variable.name",
      "support.variable",
      "entity.name.variable",
    ],
    settings: { foreground: "#001080" },
  },
  {
    scope: ["variable.other.constant", "variable.other.enummember"],
    settings: { foreground: "#0070C1" },
  },
  { scope: ["variable.language"], settings: { foreground: "#0000FF" } },
  { scope: ["entity.name.tag"], settings: { foreground: "#800000" } },
  { scope: ["entity.other.attribute-name"], settings: { foreground: "#E50000" } },
  { scope: ["support.type.property-name"], settings: { foreground: "#0451A5" } },
  { scope: ["punctuation.definition.tag"], settings: { foreground: "#800000" } },
  { scope: ["markup.heading"], settings: { foreground: "#800000", fontStyle: "bold" } },
  { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
  { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
  { scope: ["markup.inline.raw"], settings: { foreground: "#800000" } },
  { scope: ["invalid"], settings: { foreground: "#CD3131" } },
];

export function defaultTokenRules(isDark: boolean): TokenColorRule[] {
  return isDark ? DARK_PLUS : LIGHT_PLUS;
}

/**
 * TextMate theme from a VS Code theme's `tokenColors` plus its editor colors
 * (the scope-less first rule sets the default foreground/background).
 */
export function buildTextMateTheme(
  isDark: boolean,
  tokenColors: TokenColorRule[] | null,
  editorColors: Record<string, string>
): IRawTheme {
  const rules = tokenColors && tokenColors.length > 0 ? tokenColors : defaultTokenRules(isDark);
  const defaults = defaultTokenRules(isDark)[0].settings;
  const base: TokenColorRule = {
    settings: {
      foreground: editorColors["editor.foreground"] ?? defaults.foreground,
      background: editorColors["editor.background"] ?? defaults.background,
    },
  };
  return {
    name: "qori",
    settings: [base, ...rules.filter((rule) => rule.scope !== undefined)] as IRawTheme["settings"],
  };
}
