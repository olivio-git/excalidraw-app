import { CheckCircle2, ChevronDown, ChevronRight, Circle, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { formatToolText } from "../lib/tool-text";
import type { AIToolCall, AIToolResult } from "../providers/types";

// ---------------------------------------------------------------------------
// ToolCallChips — one chip per tool call of an assistant message. A chip spins
// while the call runs, turns red when it failed, and opens to show what the
// agent sent and what it got back.
// ---------------------------------------------------------------------------

type CallState = "running" | "done" | "error" | "unknown";

function callState(call: AIToolCall, result: AIToolResult | undefined, busy: boolean): CallState {
  if (result) return result.isError ? "error" : "done";
  // Restored conversations keep the calls but not their results.
  return !call.isComplete || busy ? "running" : "unknown";
}

const ICONS: Record<CallState, React.ReactNode> = {
  running: <Loader2 className="size-2.5 animate-spin" />,
  done: <CheckCircle2 className="size-2.5 text-green-500" />,
  error: <XCircle className="size-2.5" />,
  unknown: <Circle className="size-2.5 opacity-50" />,
};

const firstLine = (text: string) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
};

interface ToolCallChipsProps {
  calls: AIToolCall[];
  results: ReadonlyMap<string, AIToolResult>;
  /** The chat is still working: calls without a result are running. */
  busy: boolean;
}

export function ToolCallChips({ calls, results, busy }: ToolCallChipsProps) {
  const { t } = useTranslation("common");
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));
  const open = calls.find((call) => call.id === openId);
  const openResult = open ? results.get(open.id) : undefined;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1">
        {calls.map((call) => {
          const state = callState(call, results.get(call.id), busy);
          const label = t(`aiChat.tools.${call.name}` as Parameters<typeof t>[0], {
            defaultValue: call.name,
          });
          return (
            <button
              key={call.id}
              type="button"
              title={call.name}
              aria-expanded={openId === call.id}
              onClick={() => toggle(call.id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                state === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
                openId === call.id && state !== "error" && "bg-muted/60 text-foreground"
              )}
            >
              {ICONS[state]}
              {label}
              {openId === call.id ? (
                <ChevronDown className="size-2.5 opacity-60" />
              ) : (
                <ChevronRight className="size-2.5 opacity-60" />
              )}
            </button>
          );
        })}
      </div>

      {/* Failures stay readable without opening the chip. */}
      {calls.map((call) => {
        const result = results.get(call.id);
        if (!result?.isError || call.id === openId) return null;
        return (
          <button
            key={call.id}
            type="button"
            onClick={() => toggle(call.id)}
            className="mt-1 block w-full text-left text-[10px] text-destructive break-words hover:underline"
          >
            {firstLine(result.result) || t("aiChat.toolError")}
          </button>
        );
      })}

      {open && (
        <div className="mt-1 rounded-md border border-border/60 bg-muted/20 text-[10px]">
          <ToolText title={t("aiChat.toolInput")} text={formatToolText(open.inputJson || "{}")} />
          <ToolText
            title={t("aiChat.toolResult")}
            text={
              openResult
                ? formatToolText(openResult.result)
                : busy
                  ? t("aiChat.toolRunning")
                  : t("aiChat.toolNoResult")
            }
            error={openResult?.isError}
          />
        </div>
      )}
    </div>
  );
}

function ToolText({ title, text, error }: { title: string; text: string; error?: boolean }) {
  return (
    <div className="border-b border-border/40 px-2 py-1.5 last:border-b-0">
      <div className="mb-0.5 font-medium text-muted-foreground">{title}</div>
      <pre
        className={cn(
          "max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed",
          error && "text-destructive"
        )}
      >
        {text}
      </pre>
    </div>
  );
}
