import { create } from "zustand";
import type { AIMessage, AIToolCall } from "../providers/types";
import { useAIPermissionStore } from "./ai-permission-store";

export interface PendingQuestion {
  toolCallId: string;
  question: string;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
}

interface AIChatState {
  messages: AIMessage[];
  status: "idle" | "streaming" | "error" | "waiting_for_user";
  errorMessage: string | null;
  abortController: AbortController | null;
  pendingQuestion: PendingQuestion | null;

  addMessage: (msg: Omit<AIMessage, "id" | "timestamp">) => string;
  updateMessage: (id: string, patch: Partial<AIMessage>) => void;
  appendTextDelta: (id: string, delta: string) => void;
  appendToolCallDelta: (id: string, toolCallId: string, delta: string) => void;
  addToolCall: (id: string, toolCall: Omit<AIToolCall, "isComplete">) => void;
  finalizeToolCall: (id: string, toolCallId: string) => void;
  setStatus: (
    status: "idle" | "streaming" | "error" | "waiting_for_user",
    errorMessage?: string
  ) => void;
  setAbortController: (controller: AbortController | null) => void;
  setPendingQuestion: (pq: PendingQuestion) => void;
  clearPendingQuestion: () => void;
  clearMessages: () => void;
  setMessages: (messages: AIMessage[]) => void;
}

export const useAIChatStore = create<AIChatState>()((set, _get) => ({
  messages: [],
  status: "idle",
  errorMessage: null,
  abortController: null,
  pendingQuestion: null,

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

  setStatus: (
    status: "idle" | "streaming" | "error" | "waiting_for_user",
    errorMessage?: string
  ) => {
    set({ status, errorMessage: errorMessage ?? null });
  },

  setAbortController: (controller: AbortController | null) => {
    set({ abortController: controller });
  },

  setPendingQuestion: (pq: PendingQuestion) => {
    set({ pendingQuestion: pq });
  },

  clearPendingQuestion: () => {
    set({ pendingQuestion: null });
  },

  clearMessages: () => {
    const pq = _get().pendingQuestion;
    if (pq) {
      pq.reject(new Error("Chat cleared"));
    }
    set({ messages: [], status: "idle", errorMessage: null, pendingQuestion: null });
    useAIPermissionStore.getState()._cancel();
    useAIPermissionStore.getState().reset();
  },

  setMessages: (messages) => set({ messages, status: "idle", errorMessage: null }),
}));
