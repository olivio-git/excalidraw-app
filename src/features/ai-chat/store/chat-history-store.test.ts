import { describe, it, expect, beforeEach } from "vitest";
import { useChatHistoryStore, ConversationSummary } from "./chat-history-store";

const mockConv = (id: string, title = "Test"): ConversationSummary => ({
  id,
  title,
  contextKind: "diagram",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe("chat-history-store", () => {
  beforeEach(() => {
    useChatHistoryStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
  });

  describe("upsertConversation", () => {
    it("prepends new conversation to front of conversations", () => {
      const existing = mockConv("existing");
      useChatHistoryStore.setState({ conversations: [existing] });

      const newConv = mockConv("new");
      useChatHistoryStore.getState().upsertConversation(newConv);

      const { conversations } = useChatHistoryStore.getState();
      expect(conversations).toHaveLength(2);
      expect(conversations[0].id).toBe("new");
      expect(conversations[1].id).toBe("existing");
    });

    it("updates existing conversation in place without duplicating", () => {
      const conv = mockConv("conv-1", "Original Title");
      useChatHistoryStore.setState({ conversations: [conv] });

      const updated = { ...conv, title: "Updated Title" };
      useChatHistoryStore.getState().upsertConversation(updated);

      const { conversations } = useChatHistoryStore.getState();
      expect(conversations).toHaveLength(1);
      expect(conversations[0].id).toBe("conv-1");
      expect(conversations[0].title).toBe("Updated Title");
    });
  });

  describe("removeConversation", () => {
    it("removes the correct conversation by id", () => {
      const a = mockConv("a");
      const b = mockConv("b");
      const c = mockConv("c");
      useChatHistoryStore.setState({ conversations: [a, b, c] });

      useChatHistoryStore.getState().removeConversation("b");

      const { conversations } = useChatHistoryStore.getState();
      expect(conversations).toHaveLength(2);
      expect(conversations.map((c) => c.id)).toEqual(["a", "c"]);
    });

    it("resets activeConversationId to null when removed id matches", () => {
      const conv = mockConv("active-conv");
      useChatHistoryStore.setState({
        conversations: [conv],
        activeConversationId: "active-conv",
      });

      useChatHistoryStore.getState().removeConversation("active-conv");

      expect(useChatHistoryStore.getState().activeConversationId).toBeNull();
    });

    it("keeps activeConversationId unchanged when removed id does not match", () => {
      const a = mockConv("a");
      const b = mockConv("b");
      useChatHistoryStore.setState({
        conversations: [a, b],
        activeConversationId: "a",
      });

      useChatHistoryStore.getState().removeConversation("b");

      expect(useChatHistoryStore.getState().activeConversationId).toBe("a");
    });
  });
});
