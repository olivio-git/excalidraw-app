import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { confirm } from "@/shared/lib/confirm";
import { useAIChatStore } from "./store/ai-chat-store";
import { useAISettingsStore } from "@/features/settings/ai/ai-settings-store";
import { useAIChat } from "./hooks/useAIChat";
import { AIChatMessage } from "./AIChatMessage";
import { AIChatInput } from "./AIChatInput";
import { PluginManager } from "@/plugins/plugin-manager";

export function AIChatPanel() {
  const { t } = useTranslation("common");
  const bottomRef = useRef<HTMLDivElement>(null);

  const clearMessages = useAIChatStore((s) => s.clearMessages);

  const hasApiKey = useAISettingsStore((s) => !!s.providers[s.activeProvider].apiKey);

  const { messages, status, sendMessage, cancelStream } = useAIChat();

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
        <span className="text-sm font-medium">{t("panels.aiChat")}</span>
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
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 py-2">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              {t("aiChat.emptyState")}
            </p>
          )}
          {messages.map((m) => (
            <AIChatMessage key={m.id} message={m} />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      {hasApiKey && (
        <div className="border-t border-border p-2 shrink-0">
          <AIChatInput
            onSend={sendMessage}
            onCancel={cancelStream}
            isStreaming={status === "streaming"}
          />
        </div>
      )}
    </div>
  );
}
