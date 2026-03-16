import { create } from "zustand";
import type { AIMessage, AIToolCall } from "../providers/types";

interface AIChatState {
  messages: AIMessage[];
  status: "idle" | "streaming" | "error";
  errorMessage: string | null;
  abortController: AbortController | null;

  addMessage: (msg: Omit<AIMessage, "id" | "timestamp">) => string;
  updateMessage: (id: string, patch: Partial<AIMessage>) => void;
  appendTextDelta: (id: string, delta: string) => void;
  appendToolCallDelta: (id: string, toolCallId: string, delta: string) => void;
  addToolCall: (id: string, toolCall: Omit<AIToolCall, "isComplete">) => void;
  finalizeToolCall: (id: string, toolCallId: string) => void;
  setStatus: (status: "idle" | "streaming" | "error", errorMessage?: string) => void;
  setAbortController: (controller: AbortController | null) => void;
  clearMessages: () => void;
}

export const useAIChatStore = create<AIChatState>()((set, _get) => ({
  messages: [],
  status: "idle",
  errorMessage: null,
  abortController: null,

  addMessage: (msg: Omit<AIMessage, "id" | "timestamp">) => {
    const id = crypto.randomUUID();
    const newMessage: AIMessage = {
      ...msg,
      id,
      timestamp: Date.now(),
    };
    set((state) => ({ messages: [...state.messages, newMessage] }));
    return id;
  },

  updateMessage: (id: string, patch: Partial<AIMessage>) => {
    set((state) => ({
      messages: state.messages.map((msg) => (msg.id === id ? { ...msg, ...patch } : msg)),
    }));
  },

  appendTextDelta: (id: string, delta: string) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, content: msg.content + delta } : msg
      ),
    }));
  },

  appendToolCallDelta: (id: string, toolCallId: string, delta: string) => {
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== id) return msg;
        const toolCalls = (msg.toolCalls ?? []).map((tc) =>
          tc.id === toolCallId ? { ...tc, inputJson: tc.inputJson + delta } : tc
        );
        return { ...msg, toolCalls };
      }),
    }));
  },

  addToolCall: (id: string, toolCall: Omit<AIToolCall, "isComplete">) => {
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== id) return msg;
        const newToolCall: AIToolCall = { ...toolCall, isComplete: false };
        return {
          ...msg,
          toolCalls: [...(msg.toolCalls ?? []), newToolCall],
        };
      }),
    }));
  },

  finalizeToolCall: (id: string, toolCallId: string) => {
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== id) return msg;
        const toolCalls = (msg.toolCalls ?? []).map((tc) =>
          tc.id === toolCallId ? { ...tc, isComplete: true } : tc
        );
        return { ...msg, toolCalls };
      }),
    }));
  },

  setStatus: (status: "idle" | "streaming" | "error", errorMessage?: string) => {
    set({ status, errorMessage: errorMessage ?? null });
  },

  setAbortController: (controller: AbortController | null) => {
    set({ abortController: controller });
  },

  clearMessages: () => {
    set({ messages: [], status: "idle", errorMessage: null });
  },
}));
