import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import type { AIMessage } from "./providers/types";

interface AIChatMessageProps {
  message: AIMessage;
}

// ---------------------------------------------------------------------------
// Thinking block parser
// ---------------------------------------------------------------------------

interface ParsedContent {
  thinking: string | null;
  isThinkingOpen: boolean; // true = <think> started but </think> not received yet
  response: string;
}

function parseContent(content: string): ParsedContent {
  const closeIdx = content.indexOf("</think>");
  const openIdx = content.indexOf("<think>");

  if (openIdx === -1) {
    return { thinking: null, isThinkingOpen: false, response: content };
  }

  const thinkStart = openIdx + "<think>".length;

  if (closeIdx === -1) {
    // Still inside <think> block
    return { thinking: content.slice(thinkStart), isThinkingOpen: true, response: "" };
  }

  return {
    thinking: content.slice(thinkStart, closeIdx).trim(),
    isThinkingOpen: false,
    response: content.slice(closeIdx + "</think>".length).trimStart(),
  };
}

// ---------------------------------------------------------------------------
// ThinkingBlock
// ---------------------------------------------------------------------------

function ThinkingBlock({ thinking, isOpen }: { thinking: string; isOpen: boolean }) {
  const [expanded, setExpanded] = useState(isOpen);

  return (
    <div className="mb-2 rounded-md border border-border/50 bg-muted/20 text-[10px] text-muted-foreground">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1 px-2 py-1 hover:bg-muted/30 rounded-md transition-colors"
      >
        {expanded ? (
          <ChevronDown className="size-2.5 shrink-0" />
        ) : (
          <ChevronRight className="size-2.5 shrink-0" />
        )}
        <span className="font-medium">Thinking</span>
        {isOpen && <Loader2 className="size-2.5 animate-spin ml-auto" />}
      </button>
      {expanded && (
        <div className="px-2 pb-2 whitespace-pre-wrap leading-relaxed opacity-70 border-t border-border/40 pt-1.5 mt-0.5">
          {thinking}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown components — sized for the chat sidebar (text-xs base)
// ---------------------------------------------------------------------------

const markdownComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="text-sm font-bold mt-3 mb-1 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xs font-bold mt-2.5 mb-1 first:mt-0">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="text-xs font-semibold mt-2 mb-0.5 first:mt-0">{children}</h3>
  ),
  ul: ({ children }) => <ul className="mb-1.5 ml-3 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1.5 ml-3 list-decimal space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <code className="block bg-muted/60 border border-border rounded px-2 py-1.5 font-mono text-[10px] leading-relaxed overflow-x-auto whitespace-pre">
          {children}
        </code>
      );
    }
    return (
      <code className="bg-muted/60 border border-border rounded px-1 py-0.5 font-mono text-[10px]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="mb-1.5 overflow-x-auto">{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-2 text-muted-foreground mb-1.5">
      {children}
    </blockquote>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  hr: () => <hr className="my-2 border-border" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-foreground transition-colors"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mb-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-[10px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
};

// ---------------------------------------------------------------------------
// AIChatMessage
// ---------------------------------------------------------------------------

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
    const parsed = parseContent(message.content);

    return (
      <div className="flex justify-start mb-2">
        <div className="max-w-[90%] text-xs text-foreground">
          {showStreamingIndicator ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              <span>{t("aiChat.thinking")}</span>
            </span>
          ) : message.isStreaming ? (
            <div style={{ transform: "translateZ(0)" }}>
              {parsed.thinking !== null && (
                <ThinkingBlock thinking={parsed.thinking} isOpen={parsed.isThinkingOpen} />
              )}
              {parsed.response && (
                <div className="whitespace-pre-wrap leading-relaxed">
                  {parsed.response}
                  <span className="inline-block w-1.5 h-3 bg-foreground/60 animate-pulse ml-0.5 align-middle" />
                </div>
              )}
              {!parsed.response && !parsed.isThinkingOpen && (
                <span className="inline-block w-1.5 h-3 bg-foreground/60 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          ) : (
            <div className="prose-chat">
              {parsed.thinking !== null && (
                <ThinkingBlock thinking={parsed.thinking} isOpen={false} />
              )}
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {parsed.thinking !== null ? parsed.response : message.content}
              </ReactMarkdown>
            </div>
          )}

          {/* Tool actions */}
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

  // Tool result messages — show only errors
  if (message.role === "tool") {
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
