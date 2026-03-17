import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriAISettingsStorage } from "@/core/storage/tauri-storage";
import type { AIProviderName, AIProviderConfig } from "@/features/ai-chat/providers/types";

interface ProviderSettings {
  apiKey: string;
  model: string;
}

interface AISettingsState {
  activeProvider: AIProviderName;
  providers: Record<AIProviderName, ProviderSettings>;

  setActiveProvider: (provider: AIProviderName) => void;
  setProviderKey: (provider: AIProviderName, key: string) => void;
  setProviderModel: (provider: AIProviderName, model: string) => void;
  getActiveConfig: () => { provider: AIProviderName; config: AIProviderConfig };
}

export const useAISettingsStore = create<AISettingsState>()(
  persist(
    (set, get) => ({
      activeProvider: "anthropic",
      providers: {
        anthropic: { apiKey: "", model: "claude-sonnet-4-5" },
        groq: { apiKey: "", model: "llama-3.3-70b-versatile" },
        openai: { apiKey: "", model: "gpt-4o" },
        gemini: { apiKey: "", model: "gemini-2.5-pro" },
      },

      setActiveProvider: (provider: AIProviderName) => {
        set({ activeProvider: provider });
      },

      setProviderKey: (provider: AIProviderName, key: string) => {
        set((state) => ({
          providers: {
            ...state.providers,
            [provider]: { ...state.providers[provider], apiKey: key },
          },
        }));
      },

      setProviderModel: (provider: AIProviderName, model: string) => {
        set((state) => ({
          providers: {
            ...state.providers,
            [provider]: { ...state.providers[provider], model },
          },
        }));
      },

      getActiveConfig: () => {
        const { activeProvider, providers } = get();
        const { apiKey, model } = providers[activeProvider];
        return {
          provider: activeProvider,
          config: { apiKey, model },
        };
      },
    }),
    {
      name: "ai-settings-storage",
      storage: createJSONStorage(() => tauriAISettingsStorage),
      partialize: (state) => ({
        activeProvider: state.activeProvider,
        providers: state.providers,
      }),
      // Deep-merge so new providers added in future updates get their defaults
      // even when an older persisted state doesn't have them.
      merge: (persisted, current) => {
        const p = persisted as Partial<AISettingsState>;
        return {
          ...current,
          ...p,
          providers: { ...current.providers, ...p.providers },
        };
      },
    }
  )
);
