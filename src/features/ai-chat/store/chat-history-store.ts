import { create } from "zustand";

export interface ConversationSummary {
  id: string;
  title: string;
  contextKind: string;
  createdAt: number;
  updatedAt: number;
}

export interface SavedMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  toolCallsJson: string | null;
  timestamp: number;
}

interface ChatHistoryState {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  isLoading: boolean;

  setConversations: (convs: ConversationSummary[]) => void;
  setActiveConversationId: (id: string | null) => void;
  upsertConversation: (conv: ConversationSummary) => void;
  removeConversation: (id: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useChatHistoryStore = create<ChatHistoryState>()((set) => ({
  conversations: [],
  activeConversationId: null,
  isLoading: false,

  setConversations: (conversations) => set({ conversations }),
  setActiveConversationId: (id) => set({ activeConversationId: id }),
  upsertConversation: (conv) =>
    set((state) => {
      const idx = state.conversations.findIndex((c) => c.id === conv.id);
      if (idx >= 0) {
        const updated = [...state.conversations];
        updated[idx] = conv;
        return { conversations: updated };
      }
      return { conversations: [conv, ...state.conversations] };
    }),
  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
    })),
  setLoading: (isLoading) => set({ isLoading }),
}));
