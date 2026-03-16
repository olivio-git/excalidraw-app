import { useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { useAISettingsStore } from "@/features/settings/ai/ai-settings-store";
import { DiagramController } from "@/core/diagram/DiagramController";
import { useTabStore } from "@/core/tabs/store/tab-store";

interface AIChatInputProps {
  onSend: (text: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export function AIChatInput({ onSend, onCancel, isStreaming, disabled }: AIChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeProvider = useAISettingsStore((s) => s.activeProvider);
  const providerModel = useAISettingsStore((s) => s.providers[s.activeProvider].model);

  const activeInstanceId = DiagramController.getActiveInstanceId();
  const tabs = useTabStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.instanceId === activeInstanceId);
  const contextLabel = activeTab?.title ?? (activeInstanceId ? activeInstanceId : null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed || isStreaming || disabled) return;
      onSend(trimmed);
      setValue("");
    }
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming || disabled) return;
    onSend(trimmed);
    setValue("");
    textareaRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative flex items-end gap-1.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask AI to draw or modify your diagram…"
          rows={3}
          disabled={isStreaming || disabled}
          className={cn(
            "flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-xs",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        />

        <div className="flex flex-col gap-1 shrink-0">
          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={onCancel}
              title="Stop generation"
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
              title="Send (Enter)"
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
            Context: {contextLabel}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/40">No diagram active</span>
        )}
      </div>
    </div>
  );
}
