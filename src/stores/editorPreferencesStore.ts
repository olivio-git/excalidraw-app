import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createTauriStorage } from "@/core/storage/tauri-storage";

/** Which editor opens `.md` files. `.note` files always use the rich editor. */
export type MarkdownEditorChoice = "classic" | "markdown";

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
export function markdownRouteId(): "document-editor" | "markdown-editor" {
  return useEditorPreferencesStore.getState().markdownEditor === "markdown"
    ? "markdown-editor"
    : "document-editor";
}
