import { useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { useAISettingsStore } from "@/features/settings/ai/ai-settings-store";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { resolveAIChatContext } from "./utils/context-resolver";

interface AIChatInputProps {
  onSend: (text: string) => void;
  onAnswer?: (text: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
  isWaitingForUser?: boolean;
  disabled?: boolean;
}

export function AIChatInput({
  onSend,
  onAnswer,
  onCancel,
  isStreaming,
  isWaitingForUser,
  disabled,
}: AIChatInputProps) {
  const { t } = useTranslation("common");
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeProvider = useAISettingsStore((s) => s.activeProvider);
  const providerModel = useAISettingsStore((s) => s.providers[s.activeProvider].model);

  const activeTabId = useTabStore((s) => s.activeTabId);
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === activeTabId));
  const context = resolveAIChatContext();
  const contextLabel = context.kind !== "none" ? (activeTab?.title ?? null) : null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed || isStreaming || disabled) return;
      if (isWaitingForUser && onAnswer) {
        onAnswer(trimmed);
      } else {
        onSend(trimmed);
      }
      setValue("");
    }
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming || disabled) return;
    if (isWaitingForUser && onAnswer) {
      onAnswer(trimmed);
    } else {
      onSend(trimmed);
    }
    setValue("");
    textareaRef.current?.focus();
  };

  const placeholder = isWaitingForUser
    ? t("aiChat.waitingForAnswer")
    : t("aiChat.inputPlaceholder");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative flex items-end gap-1.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={3}
          disabled={isStreaming || disabled}
          className={cn(
            "flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-xs",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            isWaitingForUser && "border-primary/50"
          )}
        />

        <div className="flex flex-col gap-1 shrink-0">
          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={onCancel}
              title={t("aiChat.stopGeneration")}
              className="size-7"
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon"
              onClick={handleSend}
              disabled={!value.trim() || disabled}
              title={t("aiChat.sendMessage")}
              className="size-7"
            >
              <Send className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] text-muted-foreground truncate">
          {activeProvider} · {providerModel}
        </span>
        {contextLabel ? (
          <span
            className="text-[10px] text-muted-foreground/60 truncate max-w-[120px]"
            title={contextLabel}
          >
            {t("aiChat.context")}: {contextLabel}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/40">
            {t("aiChat.noDiagramActive")}
          </span>
        )}
      </div>
    </div>
  );
}
