/**
 * Shared implementation for OpenAI-compatible streaming adapters (Groq, OpenAI).
 * Both providers use the same request/response format.
 */
import type {
  AIProvider,
  AIProviderName,
  AIProviderConfig,
  AIMessage,
  AIToolDefinition,
  StreamChunk,
} from "./types";

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAIMessage =
  | { role: "user" | "system"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

function formatMessages(messages: AIMessage[]): OpenAIMessage[] {
  return messages.map((msg): OpenAIMessage => {
    if (msg.role === "tool") {
      // Flatten tool results into individual tool messages
      // Return the first tool result; caller should ensure one message per result
      const result = msg.toolResults?.[0];
      if (result) {
        return {
          role: "tool",
          tool_call_id: result.toolCallId,
          content: result.result,
        };
      }
      return { role: "tool", tool_call_id: "", content: "" };
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: tc.inputJson || "{}",
          },
        })),
      };
    }

    return { role: msg.role as "user" | "assistant", content: msg.content };
  });
}

function formatTools(tools: AIToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

// Track per-index state for streaming tool calls (OpenAI sends tool calls by index)
interface ToolCallAccumulator {
  id: string;
  name: string;
  argumentsBuffer: string;
  started: boolean;
}

async function* parseOpenAISseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncIterable<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Map index → accumulator
  const toolCallsByIndex = new Map<number, ToolCallAccumulator>();

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
        if (data === "[DONE]") {
          // Finalize any open tool calls
          for (const [, acc] of toolCallsByIndex) {
            if (acc.started) {
              yield { type: "tool_use_stop", toolCallId: acc.id };
            }
          }
          yield { type: "done" };
          return;
        }

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }

        const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
        if (!choices || choices.length === 0) continue;

        const choice = choices[0];
        const delta = choice.delta as Record<string, unknown> | undefined;
        const finishReason = choice.finish_reason as string | null;

        if (!delta) continue;

        // Text content
        if (typeof delta.content === "string" && delta.content) {
          yield { type: "text_delta", delta: delta.content };
        }

        // Tool calls
        const deltaToolCalls = delta.tool_calls as
          | Array<{
              index: number;
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: string };
            }>
          | undefined;

        if (deltaToolCalls) {
          for (const tc of deltaToolCalls) {
            const idx = tc.index;
            let acc = toolCallsByIndex.get(idx);

            if (!acc) {
              acc = { id: tc.id ?? "", name: "", argumentsBuffer: "", started: false };
              toolCallsByIndex.set(idx, acc);
            }

            if (tc.id && !acc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) {
              // Emit start on first argument delta
              if (!acc.started && acc.id && acc.name) {
                acc.started = true;
                yield {
                  type: "tool_use_start",
                  toolCallId: acc.id,
                  toolName: acc.name,
                };
              }
              acc.argumentsBuffer += tc.function.arguments;
              if (acc.started) {
                yield {
                  type: "tool_use_delta",
                  toolCallId: acc.id,
                  delta: tc.function.arguments,
                };
              }
            }
          }
        }

        // Finalize tool calls on finish_reason
        if (finishReason === "tool_calls") {
          for (const [, acc] of toolCallsByIndex) {
            if (acc.started) {
              yield { type: "tool_use_stop", toolCallId: acc.id };
            }
          }
          toolCallsByIndex.clear();
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

export class OpenAICompatAdapter implements AIProvider {
  readonly name: AIProviderName;
  private readonly baseUrl: string;

  constructor(name: AIProviderName, baseUrl: string) {
    this.name = name;
    this.baseUrl = baseUrl;
  }

  async *stream(
    messages: AIMessage[],
    systemPrompt: string,
    tools: AIToolDefinition[],
    config: AIProviderConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const allMessages: OpenAIMessage[] = [
      { role: "system", content: systemPrompt },
      ...formatMessages(messages),
    ];

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: allMessages,
          tools: formatTools(tools),
          ...(config.forceToolUse ? { tool_choice: "required" } : {}),
          stream: true,
          max_tokens: config.maxTokens ?? 4096,
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

    yield* parseOpenAISseStream(response.body, signal);
  }
}
