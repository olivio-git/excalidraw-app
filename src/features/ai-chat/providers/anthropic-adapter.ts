import type {
  AIProvider,
  AIProviderName,
  AIProviderConfig,
  AIMessage,
  AIToolDefinition,
  StreamChunk,
} from "./types";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

type AnthropicMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | AnthropicContentBlock[] }
  | {
      role: "user";
      content: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
        is_error: boolean;
      }>;
    };

function formatMessages(messages: AIMessage[]): AnthropicMessage[] {
  return messages.map((msg): AnthropicMessage => {
    if (msg.role === "tool") {
      return {
        role: "user",
        content: (msg.toolResults ?? []).map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.toolCallId,
          content: r.result,
          is_error: r.isError,
        })),
      };
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      const contentBlocks: AnthropicContentBlock[] = [];
      if (msg.content) {
        contentBlocks.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        let parsedInput: unknown;
        try {
          parsedInput = JSON.parse(tc.inputJson || "{}");
        } catch {
          parsedInput = {};
        }
        contentBlocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: parsedInput,
        });
      }
      return { role: "assistant", content: contentBlocks };
    }

    return { role: msg.role as "user" | "assistant", content: msg.content };
  });
}

function formatTools(tools: AIToolDefinition[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncIterable<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentToolCallId: string | null = null;

  try {
    while (true) {
      if (signal?.aborted) {
        yield { type: "done" };
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }

        const eventType = event.type as string;

        if (eventType === "content_block_start") {
          const block = event.content_block as Record<string, unknown>;
          if (block?.type === "tool_use") {
            currentToolCallId = block.id as string;
            yield {
              type: "tool_use_start",
              toolCallId: block.id as string,
              toolName: block.name as string,
            };
          }
        } else if (eventType === "content_block_delta") {
          const delta = event.delta as Record<string, unknown>;
          if (delta?.type === "text_delta") {
            yield { type: "text_delta", delta: delta.text as string };
          } else if (delta?.type === "input_json_delta" && currentToolCallId) {
            yield {
              type: "tool_use_delta",
              toolCallId: currentToolCallId,
              delta: delta.partial_json as string,
            };
          }
        } else if (eventType === "content_block_stop") {
          if (currentToolCallId) {
            yield { type: "tool_use_stop", toolCallId: currentToolCallId };
            currentToolCallId = null;
          }
        } else if (eventType === "message_stop") {
          yield { type: "done" };
          return;
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      yield { type: "done" };
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    yield { type: "error", message };
  } finally {
    reader.releaseLock();
  }
}

export class AnthropicAdapter implements AIProvider {
  readonly name: AIProviderName = "anthropic";

  async *stream(
    messages: AIMessage[],
    systemPrompt: string,
    tools: AIToolDefinition[],
    config: AIProviderConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    let response: Response;

    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: config.maxTokens ?? 4096,
          system: systemPrompt,
          messages: formatMessages(messages),
          tools: formatTools(tools),
          ...(config.forceToolUse ? { tool_choice: { type: "any" } } : {}),
          stream: true,
        }),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) {
        yield { type: "done" };
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      yield { type: "error", message };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      yield { type: "error", message: `HTTP ${response.status}: ${text}` };
      return;
    }

    if (!response.body) {
      yield { type: "error", message: "Response body is null." };
      return;
    }

    yield* parseSseStream(response.body, signal);
  }
}
