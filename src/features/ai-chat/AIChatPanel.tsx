import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Trash2, ChevronDown, Plus, Bug, Copy, X } from "lucide-react";
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
import { resolveAIChatContext } from "./utils/context-resolver";
import { useTabStore } from "@/core/tabs/store/tab-store";
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
  const inspectorSnapshot = useAIChatStore((s) => s.lastInspectorSnapshot);
  const [showInspector, setShowInspector] = useState(false);

  const hasApiKey = useAISettingsStore(
    (s) => s.activeProvider === "openai-codex" || !!s.providers[s.activeProvider].apiKey
  );

  const { messages, status, sendMessage, cancelStream, answerPendingQuestion } = useAIChat();
  const isWaiting = status === "waiting_for_user";

  // Prompts handed over by other features (openAgent): sent, or left in the input.
  const queuedPrompt = useAIChatStore((s) => s.queuedPrompt);
  const [draft, setDraft] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    if (!queuedPrompt || !hasApiKey) return;
    useAIChatStore.getState().queuePrompt(null);
    if (queuedPrompt.send) void sendMessage(queuedPrompt.text);
    else setDraft({ text: queuedPrompt.text, id: Date.now() });
    // sendMessage is recreated every render; the queue is what triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedPrompt, hasApiKey]);

  // Re-render with the active tab: the empty state says what the agent can do here.
  useTabStore((s) => s.activeTabId);
  const contextKind = resolveAIChatContext().kind;
  const emptyState = {
    diagram: t("aiChat.emptyState"),
    document: t("aiChat.emptyStateDocument"),
    flow: t("aiChat.emptyStateFlow"),
    none: t("aiChat.emptyStateNone"),
  }[contextKind];

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

  const copyInspectorSnapshot = async () => {
    if (!inspectorSnapshot) return;
    await navigator.clipboard.writeText(JSON.stringify(inspectorSnapshot, null, 2));
    notify({ title: "Agent context copied", variant: "success" });
  };

  return (
    <div data-ai-chat className={cn("flex flex-col h-full overflow-hidden")}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 max-w-[160px] text-sm font-medium gap-1"
                disabled={status === "streaming" || isWaiting}
              >
                <span className="truncate">{activeConversationTitle ?? t("panels.aiChat")}</span>
                <ChevronDown className="size-3 shrink-0 opacity-50" />
              </Button>
            }
          />
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
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowInspector((value) => !value)}
            title="Agent context inspector"
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <Bug className="size-3.5" />
          </Button>
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
      </div>

      {showInspector && (
        <div className="max-h-80 shrink-0 overflow-hidden border-b border-border bg-muted/20">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
            <div className="min-w-0">
              <div className="font-medium">Agent context inspector</div>
              <div className="truncate text-muted-foreground">
                {inspectorSnapshot
                  ? `${inspectorSnapshot.provider}/${inspectorSnapshot.model} · ${inspectorSnapshot.context.kind} · ${inspectorSnapshot.stats.toolCount} tools · ~${Math.ceil(inspectorSnapshot.stats.approximateChars / 4).toLocaleString()} tokens`
                  : "Send a message to capture the next provider payload."}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={!inspectorSnapshot}
                onClick={copyInspectorSnapshot}
                title="Copy snapshot JSON"
              >
                <Copy className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setShowInspector(false)}
                title="Close"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words p-3 text-[10px] text-muted-foreground">
            {inspectorSnapshot
              ? JSON.stringify(
                  {
                    createdAt: new Date(inspectorSnapshot.createdAt).toISOString(),
                    iteration: inspectorSnapshot.iteration,
                    provider: inspectorSnapshot.provider,
                    model: inspectorSnapshot.model,
                    context: inspectorSnapshot.context,
                    contextInfo: inspectorSnapshot.contextInfo,
                    stats: inspectorSnapshot.stats,
                    tools: inspectorSnapshot.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      inputSchema: tool.inputSchema,
                    })),
                    systemPrompt: inspectorSnapshot.systemPrompt,
                    messages: inspectorSnapshot.messages,
                  },
                  null,
                  2
                )
              : "No snapshot captured yet."}
          </pre>
        </div>
      )}

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
            <p className="text-xs text-muted-foreground text-center py-6">{emptyState}</p>
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
            draft={draft}
            isStreaming={status === "streaming"}
            isWaitingForUser={isWaiting}
          />
        </div>
      )}
    </div>
  );
}
