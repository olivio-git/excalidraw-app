import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  toggleComment,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { getLanguageRegistry } from "./language-registry";
import { getLanguageConfiguration, type LanguageConfiguration } from "./extension-languages";
import { textMateService } from "./textmate/textmate-service";
import { textMateHighlighting } from "./textmate/highlighter";
import { codeEditorTheme, codeHighlightStyle } from "./theme";
import type { ContentChange, EditorSelection, TextPosition } from "./editor-contributions";
import type { ChangeSet, Text } from "@codemirror/state";

export interface CodeEditorCallbacks {
  onChange: (content: string, changes: ContentChange[]) => void;
  onSelectionChange?: (selections: EditorSelection[]) => void;
  onSave: () => void;
  onFocusChange: (focused: boolean) => void;
}

export interface CodeEditorCompartments {
  language: Compartment;
  highlight: Compartment;
  contributions: Compartment;
  completion: Compartment;
}

export function createCompartments(): CodeEditorCompartments {
  return {
    language: new Compartment(),
    highlight: new Compartment(),
    contributions: new Compartment(),
    completion: new Compartment(),
  };
}

export function toTextPosition(doc: Text, offset: number): TextPosition {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

export function toOffset(doc: Text, position: TextPosition): number {
  const lineNumber = Math.min(Math.max(position.line + 1, 1), doc.lines);
  const line = doc.line(lineNumber);
  return Math.min(line.from + Math.max(position.character, 0), line.to);
}

/**
 * CodeMirror changes → VS Code content changes. Changes are listed from the
 * end of the document backwards, so each range is still valid in the text
 * produced by the changes before it.
 */
export function toContentChanges(startDoc: Text, changes: ChangeSet): ContentChange[] {
  const result: ContentChange[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    result.push({
      range: { start: toTextPosition(startDoc, fromA), end: toTextPosition(startDoc, toA) },
      text: inserted.toString(),
    });
  });
  return result.reverse();
}

/** Completion with every source (snippets, language servers) in one list. */
export function completionExtension(sources: CompletionSource[]): Extension {
  return autocompletion({ override: sources.length > 0 ? sources : undefined, icons: true });
}

/** Comment tokens and brackets from an extension's language-configuration.json. */
function languageDataFrom(config: LanguageConfiguration | null): Extension {
  if (!config) return [];
  const data: Record<string, unknown> = {};
  const line = config.comments?.lineComment;
  const block = config.comments?.blockComment;
  if (line || block) {
    data.commentTokens = {
      ...(line ? { line } : {}),
      ...(block ? { block: { open: block[0], close: block[1] } } : {}),
    };
  }
  const pairs = config.autoClosingPairs
    ?.map((pair) => (Array.isArray(pair) ? pair[0] : pair.open))
    .filter((open) => open.length === 1);
  if (pairs && pairs.length > 0) data.closeBrackets = { brackets: pairs };
  return Object.keys(data).length > 0 ? EditorState.languageData.of(() => [data]) : [];
}

/**
 * Highlighting and language data for a language: the extension's TextMate
 * grammar when one is installed (same colors as VS Code), otherwise
 * CodeMirror's built-in parser, otherwise plain text.
 */
export async function loadLanguageSupport(languageId: string | null): Promise<{
  extension: Extension;
  usesTextMate: boolean;
}> {
  if (!languageId) return { extension: [], usesTextMate: false };
  const config = await getLanguageConfiguration(languageId).catch(() => null);
  const data = languageDataFrom(config);

  if (textMateService.hasGrammarFor(languageId)) {
    const grammar = await textMateService.loadGrammar(languageId);
    if (grammar) {
      return {
        extension: [textMateHighlighting(grammar, () => textMateService.getThemeVersion()), data],
        usesTextMate: true,
      };
    }
  }

  const description = getLanguageRegistry().get(languageId)?.codemirror;
  if (description) {
    try {
      const support = await description.load();
      return { extension: [support, data], usesTextMate: false };
    } catch (error) {
      console.warn(`[code-editor] Could not load ${languageId}`, error);
    }
  }
  return { extension: data, usesTextMate: false };
}

export function createCodeEditorExtensions(
  compartments: CodeEditorCompartments,
  callbacks: CodeEditorCallbacks,
  isDark: boolean,
  completionSources: CompletionSource[]
): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    indentUnit.of("    "),
    EditorState.tabSize.of(4),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    compartments.language.of([]),
    compartments.highlight.of(codeHighlightStyle(isDark)),
    compartments.completion.of(completionExtension(completionSources)),
    compartments.contributions.of([]),
    EditorView.contentAttributes.of({ "aria-label": "Editor de código", spellcheck: "false" }),
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          callbacks.onSave();
          return true;
        },
      },
      { key: "Mod-/", run: toggleComment },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        callbacks.onChange(
          update.state.doc.toString(),
          toContentChanges(update.startState.doc, update.changes)
        );
      }
      if ((update.selectionSet || update.docChanged) && callbacks.onSelectionChange) {
        callbacks.onSelectionChange(
          update.state.selection.ranges.map((range) => ({
            anchor: toTextPosition(update.state.doc, range.anchor),
            active: toTextPosition(update.state.doc, range.head),
          }))
        );
      }
      if (update.focusChanged) callbacks.onFocusChange(update.view.hasFocus);
    }),
    codeEditorTheme,
  ];
}
