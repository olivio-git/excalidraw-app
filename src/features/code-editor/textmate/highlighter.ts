import { RangeSetBuilder, type Extension, type Text } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { INITIAL, type IGrammar, type StateStack } from "vscode-textmate";

/**
 * CodeMirror highlighting driven by a TextMate grammar. The tokenizer state
 * at the end of every line is cached, so edits only re-tokenize from the
 * first changed line and scrolling only tokenizes what becomes visible.
 * Token colors come from the TextMate theme's color map, exposed as CSS
 * classes (`tm-f<N>`) by {@link textMateThemeCss}.
 */

// vscode-textmate MetadataConsts.
const FONT_STYLE_MASK = 0b0000_0000_0000_0000_0111_1000_0000_0000;
const FONT_STYLE_OFFSET = 11;
const FOREGROUND_MASK = 0b0000_0000_1111_1111_1000_0000_0000_0000;
const FOREGROUND_OFFSET = 15;
/** Default foreground: no class needed. */
const DEFAULT_FOREGROUND = 1;
/** Lines longer than this are left plain (minified files). */
const MAX_LINE_LENGTH = 20_000;
const TIME_LIMIT_MS = 500;

export function foregroundOf(metadata: number): number {
  return (metadata & FOREGROUND_MASK) >>> FOREGROUND_OFFSET;
}

export function fontStyleOf(metadata: number): number {
  return (metadata & FONT_STYLE_MASK) >>> FONT_STYLE_OFFSET;
}

export function tokenClass(metadata: number): string | null {
  const fg = foregroundOf(metadata);
  const style = fontStyleOf(metadata);
  const classes: string[] = [];
  if (fg !== DEFAULT_FOREGROUND && fg !== 0) classes.push(`tm-f${fg}`);
  if (style & 1) classes.push("tm-i");
  if (style & 2) classes.push("tm-b");
  if (style & 4) classes.push("tm-u");
  if (style & 8) classes.push("tm-s");
  return classes.length > 0 ? classes.join(" ") : null;
}

/** CSS for the theme's color map. */
export function textMateThemeCss(colorMap: string[]): string {
  const rules = colorMap
    .map((color, index) =>
      index > DEFAULT_FOREGROUND && color ? `.tm-f${index}{color:${color}}` : ""
    )
    .join("");
  return `${rules}.tm-i{font-style:italic}.tm-b{font-weight:bold}.tm-u{text-decoration:underline}.tm-s{text-decoration:line-through}`;
}

const markCache = new Map<string, Decoration>();
function mark(className: string): Decoration {
  let decoration = markCache.get(className);
  if (!decoration) {
    decoration = Decoration.mark({ class: className });
    markCache.set(className, decoration);
  }
  return decoration;
}

/** Tokenizer state cache: `after[n]` is the state at the end of line n (1-based). */
export class LineStateCache {
  private after: (StateStack | undefined)[] = [];
  private readonly grammar: IGrammar;

  constructor(grammar: IGrammar) {
    this.grammar = grammar;
  }

  invalidateFrom(line: number): void {
    if (this.after.length > line) this.after.length = line;
  }

  clear(): void {
    this.after = [];
  }

  stateBefore(doc: Text, line: number): StateStack {
    let known = Math.max(0, Math.min(line - 1, this.after.length - 1));
    while (known > 0 && !this.after[known]) known--;
    let state = known > 0 ? this.after[known]! : INITIAL;
    for (let n = known + 1; n < line; n++) state = this.tokenize(doc, n, state).ruleStack;
    return state;
  }

  tokenize(doc: Text, line: number, state: StateStack) {
    const text = doc.line(line).text;
    const result =
      text.length > MAX_LINE_LENGTH
        ? { tokens: new Uint32Array([0, 0]), ruleStack: state }
        : this.grammar.tokenizeLine2(text, state, TIME_LIMIT_MS);
    this.after[line] = result.ruleStack;
    return result;
  }
}

export function textMateHighlighting(grammar: IGrammar, getThemeVersion: () => number): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      cache = new LineStateCache(grammar);
      themeVersion = getThemeVersion();

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        let dirty = update.viewportChanged;
        if (update.docChanged) {
          let first = Infinity;
          update.changes.iterChangedRanges((fromA) => {
            first = Math.min(first, update.startState.doc.lineAt(fromA).number);
          });
          if (first !== Infinity) this.cache.invalidateFrom(first);
          dirty = true;
        }
        const version = getThemeVersion();
        if (version !== this.themeVersion) {
          this.themeVersion = version;
          this.cache.clear();
          dirty = true;
        }
        if (dirty) this.decorations = this.build(update.view);
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;
        let lastLine = 0;
        for (const { from, to } of view.visibleRanges) {
          const startLine = Math.max(doc.lineAt(from).number, lastLine + 1);
          const endLine = doc.lineAt(to).number;
          if (startLine > endLine) continue;
          let state = this.cache.stateBefore(doc, startLine);
          for (let n = startLine; n <= endLine; n++) {
            const line = doc.line(n);
            const { tokens, ruleStack } = this.cache.tokenize(doc, n, state);
            state = ruleStack;
            const count = tokens.length / 2;
            for (let i = 0; i < count; i++) {
              const start = tokens[2 * i];
              const end = i + 1 < count ? tokens[2 * i + 2] : line.length;
              if (end <= start) continue;
              const className = tokenClass(tokens[2 * i + 1]);
              if (className) builder.add(line.from + start, line.from + end, mark(className));
            }
          }
          lastLine = endLine;
        }
        return builder.finish();
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
}

/** Keeps a single <style> element in sync with the TextMate color map. */
export function applyTextMateThemeCss(colorMap: string[]): void {
  if (typeof document === "undefined") return;
  let style = document.getElementById("qori-textmate-theme") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "qori-textmate-theme";
    document.head.appendChild(style);
  }
  style.textContent = textMateThemeCss(colorMap);
}
