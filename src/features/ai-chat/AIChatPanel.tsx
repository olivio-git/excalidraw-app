import { useEffect, useLayoutEffect, useRef } from "react";
import { Trash2, ChevronDown, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { useAIChatStore } from "./store/ai-chat-store";
import { useAISettingsStore } from "@/features/settings/ai/ai-settings-store";
import { useChatHistoryStore } from "./store/chat-history-store";
import { useAIPermissionStore } from "./store/ai-permission-store";
import { listConversations, loadConversation, deleteConversation } from "./hooks/useChatHistory";
import { useAIChat } from "./hooks/useAIChat";
import { AIChatMessage } from "./AIChatMessage";
import { AIChatInput } from "./AIChatInput";
import { PluginManager } from "@/plugins/plugin-manager";

export function AIChatPanel() {
  const { t } = useTranslation("common");
  const scrollRef = useRef<HTMLDivElement>(null);

  const clearMessages = useAIChatStore((s) => s.clearMessages);
  const conversations = useChatHistoryStore((s) => s.conversations);
  const activeConversationId = useChatHistoryStore((s) => s.activeConversationId);
  const setConversations = useChatHistoryStore((s) => s.setConversations);

  const hasApiKey = useAISettingsStore((s) => !!s.providers[s.activeProvider].apiKey);

  const { messages, status, sendMessage, cancelStream, answerPendingQuestion } = useAIChat();
  const isWaiting = status === "waiting_for_user";

  const activeConversationTitle = conversations.find((c) => c.id === activeConversationId)?.title;

  // Load conversation list on mount
  useEffect(() => {
    listConversations()
      .then((result) => setConversations(result))
      .catch(console.error);
  }, []);

  // Auto-scroll: useLayoutEffect runs synchronously after DOM mutations, before paint
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleNewConversation = () => {
    useAIChatStore.getState().setMessages([]);
    useChatHistoryStore.getState().setActiveConversationId(null);
    useAIPermissionStore.getState().reset();
  };

  const handleSwitchConversation = async (id: string) => {
    if (["streaming", "waiting_for_user"].includes(useAIChatStore.getState().status)) {
      notify({ title: t("aiChat.switchBlocked"), variant: "warning" });
      return;
    }
    const { setLoading, setActiveConversationId } = useChatHistoryStore.getState();
    setLoading(true);
    try {
      const savedMessages = await loadConversation(id);
      const msgs = savedMessages.map((sm) => ({
        id: sm.id,
        role: sm.role as "user" | "assistant" | "tool",
        content: sm.content,
        toolCalls: sm.toolCallsJson ? JSON.parse(sm.toolCallsJson) : undefined,
        timestamp: sm.timestamp,
        isStreaming: false,
      }));
      useAIChatStore.getState().setMessages(msgs);
      setActiveConversationId(id);
      useAIPermissionStore.getState().reset();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    await deleteConversation(id).catch(console.error);
    const {
      removeConversation,
      conversations: currentConversations,
      activeConversationId: currentActiveId,
      setActiveConversationId,
    } = useChatHistoryStore.getState();
    removeConversation(id);
    if (id === currentActiveId) {
      const remaining = currentConversations.filter((c) => c.id !== id);
      if (remaining.length > 0) {
        handleSwitchConversation(remaining[0].id);
      } else {
        useAIChatStore.getState().setMessages([]);
        setActiveConversationId(null);
      }
    }
  };

  const handleClear = async () => {
    const ok = await confirm({
      title: t("aiChat.clearChat"),
      description: t("aiChat.clearConfirmDescription"),
      confirmLabel: t("aiChat.clearLabel"),
      variant: "destructive",
    });
    if (ok) clearMessages();
  };

  const goToSettings = () => {
    PluginManager.executeCommand("settings.action.openAITab");
  };

  return (
    <div className={cn("flex flex-col h-full overflow-hidden")}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 max-w-[160px] text-sm font-medium gap-1"
              disabled={status === "streaming" || isWaiting}
            >
              <span className="truncate">{activeConversationTitle ?? t("panels.aiChat")}</span>
              <ChevronDown className="size-3 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={handleNewConversation}>
              <Plus className="size-3.5 mr-2" />
              {t("aiChat.newConversation")}
            </DropdownMenuItem>
            {conversations.length > 0 && <DropdownMenuSeparator />}
            {conversations.map((conv) => (
              <DropdownMenuItem
                key={conv.id}
                onClick={() => handleSwitchConversation(conv.id)}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate flex-1">{conv.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteConversation(conv.id);
                  }}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="size-3" />
                </button>
              </DropdownMenuItem>
            ))}
            {conversations.length === 0 && (
              <DropdownMenuItem disabled>{t("aiChat.noConversations")}</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClear}
          title={t("aiChat.clearChat")}
          className="size-7 text-muted-foreground hover:text-foreground"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* No API key banner */}
      {!hasApiKey && (
        <div className="px-3 py-2.5 text-xs text-muted-foreground border-b border-border shrink-0">
          {t("aiChat.configureApiKey")}{" "}
          <button
            onClick={goToSettings}
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            {t("aiChat.settingsLink")}
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 py-2">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              {t("aiChat.emptyState")}
            </p>
          )}
          {messages.map((m) => (
            <AIChatMessage key={m.id} message={m} />
          ))}
        </div>
      </div>

      {/* Input */}
      {hasApiKey && (
        <div className="border-t border-border p-2 shrink-0">
          <AIChatInput
            onSend={sendMessage}
            onAnswer={answerPendingQuestion}
            onCancel={cancelStream}
            isStreaming={status === "streaming"}
            isWaitingForUser={isWaiting}
          />
        </div>
      )}
    </div>
  );
}
