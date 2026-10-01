import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentOnInput } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, keymap, placeholder } from "@codemirror/view";
import { linkCompletions, slashCompletions } from "./completions";
import { embeds } from "./embeds";
import { insertLink, toggleInline } from "./formatting";
import { linkClickHandler, livePreview } from "./live-preview";
import { type NoteContext, noteContext } from "./note-context";
import { editorHighlight, editorTheme } from "./theme";
import { editorKeymapExtension } from "@/core/config/vim-mode";

export interface EditorCallbacks {
  onChange: (content: string) => void;
  onSave: () => void;
}

export function createEditorExtensions(
  context: NoteContext,
  callbacks: EditorCallbacks
): Extension[] {
  return [
    // Vim (or default) keys from config.toml; first so it wins over the keymaps below.
    editorKeymapExtension(callbacks.onSave),
    noteContext.of(context),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    closeBrackets(),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: "true", "aria-label": "Editor Markdown" }),
    // GFM (tables, tasks, strikethrough) plus highlighting for fenced code,
    // with language grammars loaded on demand.
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    editorHighlight,
    livePreview,
    embeds,
    linkClickHandler,
    autocompletion({ override: [slashCompletions, linkCompletions], icons: false }),
    search({ top: true }),
    highlightSelectionMatches(),
    placeholder("Escribe aquí… Pulsa / para insertar bloques o [[ para enlazar notas y diagramas."),
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          callbacks.onSave();
          return true;
        },
      },
      { key: "Mod-b", run: toggleInline("**") },
      { key: "Mod-i", run: toggleInline("*") },
      { key: "Mod-e", run: toggleInline("`") },
      { key: "Mod-Shift-x", run: toggleInline("~~") },
      { key: "Mod-k", run: insertLink },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) callbacks.onChange(update.state.doc.toString());
    }),
    editorTheme,
  ];
}
