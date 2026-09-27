import { gatewayClient } from "@/features/ai-chat/gateway/gatewayClient";
import type {
  AIProvider,
  AIProviderName,
  AIProviderConfig,
  AIMessage,
  AIToolDefinition,
  StreamChunk,
} from "./types";

type PiContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

type PiMessage =
  | { role: "user"; content: string | PiContentBlock[]; timestamp: number }
  | {
      role: "assistant";
      content: PiContentBlock[];
      api: string;
      provider: string;
      model: string;
      usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        totalTokens: number;
        cost: {
          input: number;
          output: number;
          cacheRead: number;
          cacheWrite: number;
          total: number;
        };
      };
      stopReason: "stop" | "toolUse" | "error" | "aborted" | "length" | "pending";
      timestamp: number;
    }
  | {
      role: "toolResult";
      toolCallId: string;
      toolName: string;
      content: { type: "text"; text: string }[];
      isError: boolean;
      timestamp: number;
    };

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function parseToolArgs(inputJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(inputJson || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatMessages(messages: AIMessage[], model: string): PiMessage[] {
  const toolNames = new Map<string, string>();
  for (const msg of messages) {
    for (const tc of msg.toolCalls ?? []) toolNames.set(tc.id, tc.name);
  }

  return messages.flatMap((msg): PiMessage[] => {
    if (msg.role === "user") {
      const content: PiContentBlock[] = [{ type: "text", text: msg.content }];
      for (const image of msg.images ?? []) {
        content.push({ type: "image", data: image.data, mimeType: image.mediaType });
      }
      return [
        {
          role: "user",
          content: msg.images?.length ? content : msg.content,
          timestamp: msg.timestamp,
        },
      ];
    }

    if (msg.role === "assistant") {
      const content: PiContentBlock[] = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      for (const tc of msg.toolCalls ?? []) {
        content.push({
          type: "toolCall",
          id: tc.id,
          name: tc.name,
          arguments: parseToolArgs(tc.inputJson),
        });
      }
      return [
        {
          role: "assistant",
          content,
          api: "openai-codex-responses",
          provider: "openai-codex",
          model,
          usage: emptyUsage(),
          stopReason: msg.toolCalls?.length ? "toolUse" : "stop",
          timestamp: msg.timestamp,
        },
      ];
    }

    return (msg.toolResults ?? []).map((result) => ({
      role: "toolResult" as const,
      toolCallId: result.toolCallId,
      toolName: toolNames.get(result.toolCallId) ?? result.toolCallId,
      content: [{ type: "text" as const, text: result.result }],
      isError: result.isError,
      timestamp: msg.timestamp,
    }));
  });
}

function formatTools(tools: AIToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

export class OpenAICodexAdapter implements AIProvider {
  readonly name: AIProviderName = "openai-codex";

  async *stream(
    messages: AIMessage[],
    systemPrompt: string,
    tools: AIToolDefinition[],
    config: AIProviderConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const requestId = crypto.randomUUID();
    const modelId = config.model || "gpt-5.6-luna";
    const queue: StreamChunk[] = [];
    let wake: (() => void) | null = null;
    let finished = false;

    const push = (chunk: StreamChunk) => {
      queue.push(chunk);
      wake?.();
      wake = null;
    };
    const startedToolCalls = new Set<string>();
    const toolCallsWithDelta = new Set<string>();

    const off = gatewayClient.onEvent((event) => {
      if (!("requestId" in event) || event.requestId !== requestId) return;
      if (event.type === "stream.event") {
        const ev = event.event as Record<string, unknown>;
        switch (ev.type) {
          case "text_delta":
            push({ type: "text_delta", delta: String(ev.delta ?? "") });
            break;
          case "toolcall_start": {
            const partial = ev.partial as { content?: unknown[] } | undefined;
            const idx = Number(ev.contentIndex ?? -1);
            const block = partial?.content?.[idx] as { id?: string; name?: string } | undefined;
            if (block?.id && block?.name && !startedToolCalls.has(block.id)) {
              startedToolCalls.add(block.id);
              push({ type: "tool_use_start", toolCallId: block.id, toolName: block.name });
            }
            break;
          }
          case "toolcall_delta": {
            const partial = ev.partial as { content?: unknown[] } | undefined;
            const idx = Number(ev.contentIndex ?? -1);
            const block = partial?.content?.[idx] as { id?: string } | undefined;
            if (block?.id) {
              if (!startedToolCalls.has(block.id)) {
                const named = block as { id?: string; name?: string };
                if (named.name) {
                  startedToolCalls.add(block.id);
                  push({ type: "tool_use_start", toolCallId: block.id, toolName: named.name });
                }
              }
              toolCallsWithDelta.add(block.id);
              push({ type: "tool_use_delta", toolCallId: block.id, delta: String(ev.delta ?? "") });
            }
            break;
          }
          case "toolcall_end": {
            const tc = ev.toolCall as
              | { id?: string; name?: string; arguments?: unknown }
              | undefined;
            if (tc?.id) {
              if (!startedToolCalls.has(tc.id) && tc.name) {
                push({ type: "tool_use_start", toolCallId: tc.id, toolName: tc.name });
              }
              if (!toolCallsWithDelta.has(tc.id)) {
                push({
                  type: "tool_use_delta",
                  toolCallId: tc.id,
                  delta: JSON.stringify(tc.arguments ?? {}),
                });
              }
              push({ type: "tool_use_stop", toolCallId: tc.id });
            }
            break;
          }
          case "done":
            push({ type: "done" });
            finished = true;
            wake?.();
            break;
          case "error": {
            const err = ev.error as { errorMessage?: string } | undefined;
            push({ type: "error", message: err?.errorMessage ?? "Codex stream error" });
            finished = true;
            wake?.();
            break;
          }
        }
      } else if (event.type === "stream.error") {
        push({ type: "error", message: event.error.message });
        finished = true;
        wake?.();
      } else if (event.type === "stream.done") {
        if (!finished) push({ type: "done" });
        finished = true;
        wake?.();
      }
    });

    const abort = () => {
      void gatewayClient.send("stream.abort", { requestId }).catch(() => undefined);
      finished = true;
      wake?.();
    };
    signal?.addEventListener("abort", abort, { once: true });

    try {
      await gatewayClient.request("stream.start", {
        requestId,
        modelId,
        context: {
          systemPrompt,
          messages: formatMessages(messages, modelId),
          tools: formatTools(tools),
        },
        options: {
          reasoning: "medium",
        },
      });

      while (!finished || queue.length > 0) {
        while (queue.length > 0) yield queue.shift()!;
        if (!finished) await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      off();
      signal?.removeEventListener("abort", abort);
    }
  }
}
