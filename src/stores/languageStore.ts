import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriLanguageStorage } from "@/core/storage/tauri-storage";

const LANGUAGE = {
  EN: "en",
  ES: "es",
} as const;

type Language = (typeof LANGUAGE)[keyof typeof LANGUAGE];

interface LanguageStore {
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set) => ({
      language: LANGUAGE.EN,

      setLanguage: (language: Language) => {
        set({ language });
      },
    }),
    {
      name: "language-storage",
      storage: createJSONStorage(() => tauriLanguageStorage),
    }
  )
);
