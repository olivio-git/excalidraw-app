import { invoke } from "@tauri-apps/api/core";
import type { ConversationSummary, SavedMessage } from "../store/chat-history-store";
import { useChatHistoryStore } from "../store/chat-history-store";

export async function createConversation(
  id: string,
  title: string,
  contextKind: string
): Promise<void> {
  await invoke("chat_create_conversation", { id, title, contextKind });
}

export async function saveMessage(msg: SavedMessage): Promise<void> {
  await invoke("chat_save_message", { msg });
}

export async function listConversations(): Promise<ConversationSummary[]> {
  return invoke<ConversationSummary[]>("chat_list_conversations");
}

export async function loadConversation(id: string): Promise<SavedMessage[]> {
  return invoke<SavedMessage[]>("chat_load_conversation", { id });
}

export async function deleteConversation(id: string): Promise<void> {
  await invoke("chat_delete_conversation", { id });
}

export function useChatHistory() {
  const conversations = useChatHistoryStore((s) => s.conversations);
  const activeConversationId = useChatHistoryStore((s) => s.activeConversationId);
  const isLoading = useChatHistoryStore((s) => s.isLoading);
  return { conversations, activeConversationId, isLoading };
}
