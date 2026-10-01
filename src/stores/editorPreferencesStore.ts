import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createTauriStorage } from "@/core/storage/tauri-storage";

/**
 * Which editor opens `.md` files: blocks, Markdown with live preview, or the
 * plain code editor (like config.toml). `.note` files always use the rich editor.
 */
export type MarkdownEditorChoice = "classic" | "markdown" | "code";

interface EditorPreferencesState {
  markdownEditor: MarkdownEditorChoice;
  setMarkdownEditor: (choice: MarkdownEditorChoice) => void;
}

export const useEditorPreferencesStore = create<EditorPreferencesState>()(
  persist(
    (set) => ({
      markdownEditor: "classic",
      setMarkdownEditor: (markdownEditor) => set({ markdownEditor }),
    }),
    {
      name: "editor-preferences",
      storage: createJSONStorage(() => createTauriStorage("editor-preferences.json")),
      partialize: (state) => ({ markdownEditor: state.markdownEditor }),
    }
  )
);

/** Route that opens `.md` files, per the user's preference. */
export function markdownRouteId(): "document-editor" | "markdown-editor" | "code-editor" {
  const choice = useEditorPreferencesStore.getState().markdownEditor;
  return choice === "markdown"
    ? "markdown-editor"
    : choice === "code"
      ? "code-editor"
      : "document-editor";
}
