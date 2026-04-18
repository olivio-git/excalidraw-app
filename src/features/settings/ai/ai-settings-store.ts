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
  customInstructions: string;

  setActiveProvider: (provider: AIProviderName) => void;
  setProviderKey: (provider: AIProviderName, key: string) => void;
  setProviderModel: (provider: AIProviderName, model: string) => void;
  setCustomInstructions: (instructions: string) => void;
  getActiveConfig: () => { provider: AIProviderName; config: AIProviderConfig };
}

export const useAISettingsStore = create<AISettingsState>()(
  persist(
    (set, get) => ({
      activeProvider: "anthropic",
      customInstructions: "",
      providers: {
        anthropic: { apiKey: "", model: "claude-sonnet-4-5-20250514" },
        groq: { apiKey: "", model: "openai/gpt-oss-120b" },
        openai: { apiKey: "", model: "gpt-4o" },
        gemini: { apiKey: "", model: "gemini-2.5-pro" },
        openrouter: { apiKey: "", model: "deepseek/deepseek-r1-0528" },
      },

      setActiveProvider: (provider: AIProviderName) => {
        set({ activeProvider: provider });
      },

      setCustomInstructions: (instructions: string) => {
        set({ customInstructions: instructions });
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
        customInstructions: state.customInstructions,
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
