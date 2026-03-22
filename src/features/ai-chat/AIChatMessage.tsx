import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import type { AIMessage } from "./providers/types";

interface AIChatMessageProps {
  message: AIMessage;
}

export function AIChatMessage({ message }: AIChatMessageProps) {
  const { t } = useTranslation("common");

  if (message.role === "user") {
    return (
      <div className="flex justify-end mb-2">
        <div
          className={cn(
            "max-w-[80%] rounded-2xl px-3 py-2 text-xs",
            "bg-primary text-primary-foreground"
          )}
        >
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "assistant") {
    const showStreamingIndicator = message.isStreaming && !message.content;

    return (
      <div className="flex justify-start mb-2">
        <div className="max-w-[90%] text-xs text-foreground">
          {showStreamingIndicator ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              <span>{t("aiChat.thinking")}</span>
            </span>
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}

          {/* Tool actions — shown as minimal status badges, no JSON */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {message.toolCalls.map((tc) => {
                const toolKey = `aiChat.tools.${tc.name}` as const;
                const label = t(toolKey as Parameters<typeof t>[0], { defaultValue: tc.name });
                return (
                  <span
                    key={tc.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {!tc.isComplete ? (
                      <Loader2 className="size-2.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-2.5 text-green-500" />
                    )}
                    {label}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Tool result messages are internal — not shown in chat.
  // Errors go back to the model for self-correction; canvas changes are visible directly.
  if (message.role === "tool") {
    // Show only if there's an error, as a subtle hint to the user
    const hasError = message.toolResults?.some((tr) => tr.isError);
    if (!hasError) return null;

    return (
      <div className="flex justify-start mb-1">
        <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
          <XCircle className="size-2.5 shrink-0" />
          {message.toolResults?.find((tr) => tr.isError)?.result ?? t("aiChat.toolError")}
        </span>
      </div>
    );
  }

  return null;
}
