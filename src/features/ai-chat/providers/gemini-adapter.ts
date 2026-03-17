import type {
  AIProvider,
  AIProviderName,
  AIProviderConfig,
  AIMessage,
  AIToolDefinition,
  StreamChunk,
} from "./types";

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { content: string } } };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

/** Build a reverse map toolCallId → toolName from assistant messages. */
function buildToolCallNameMap(messages: AIMessage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        map.set(tc.id, tc.name);
      }
    }
  }
  return map;
}

function formatMessages(messages: AIMessage[]): GeminiContent[] {
  const toolCallNameMap = buildToolCallNameMap(messages);
  const result: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === "tool") {
      const parts: GeminiPart[] = (msg.toolResults ?? []).map((r) => ({
        functionResponse: {
          name: toolCallNameMap.get(r.toolCallId) ?? r.toolCallId,
          response: { content: r.result },
        },
      }));
      if (parts.length > 0) {
        result.push({ role: "user", parts });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      for (const tc of msg.toolCalls ?? []) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.inputJson || "{}") as Record<string, unknown>;
        } catch {
          // ignore malformed json
        }
        parts.push({ functionCall: { name: tc.name, args } });
      }
      if (parts.length > 0) {
        result.push({ role: "model", parts });
      }
      continue;
    }

    result.push({ role: "user", parts: [{ text: msg.content }] });
  }

  return result;
}

function formatTools(tools: AIToolDefinition[]) {
  if (tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    },
  ];
}

let toolCallCounter = 0;

async function* parseGeminiSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncIterable<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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

        if (event.error) {
          const err = event.error as { message?: string };
          yield { type: "error", message: err.message ?? "Gemini API error" };
          return;
        }

        const candidates = event.candidates as
          | Array<{
              content?: { parts?: Array<Record<string, unknown>> };
              finishReason?: string;
            }>
          | undefined;

        if (!candidates || candidates.length === 0) continue;

        const candidate = candidates[0];
        const parts = candidate.content?.parts ?? [];
        const finishReason = candidate.finishReason;

        for (const part of parts) {
          if (typeof part.text === "string" && part.text) {
            yield { type: "text_delta", delta: part.text };
          }

          if (part.functionCall) {
            const fc = part.functionCall as { name: string; args: Record<string, unknown> };
            // Gemini doesn't provide tool call IDs — generate a stable synthetic one
            const toolCallId = `gemini-tc-${++toolCallCounter}`;
            yield { type: "tool_use_start", toolCallId, toolName: fc.name };
            yield { type: "tool_use_delta", toolCallId, delta: JSON.stringify(fc.args) };
            yield { type: "tool_use_stop", toolCallId };
          }
        }

        if (finishReason === "STOP" || finishReason === "MAX_TOKENS") {
          yield { type: "done" };
          return;
        }
      }
    }

    yield { type: "done" };
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

export class GeminiAdapter implements AIProvider {
  readonly name: AIProviderName = "gemini";

  async *stream(
    messages: AIMessage[],
    systemPrompt: string,
    tools: AIToolDefinition[],
    config: AIProviderConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:streamGenerateContent?alt=sse&key=${config.apiKey}`;

    const formattedTools = formatTools(tools);

    const requestBody: Record<string, unknown> = {
      contents: formatMessages(messages),
      generationConfig: {
        maxOutputTokens: config.maxTokens ?? 4096,
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      },
    };

    if (systemPrompt) {
      requestBody.system_instruction = { parts: [{ text: systemPrompt }] };
    }

    if (formattedTools) {
      requestBody.tools = formattedTools;
      requestBody.toolConfig = {
        functionCallingConfig: { mode: config.forceToolUse ? "ANY" : "AUTO" },
      };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
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

    yield* parseGeminiSseStream(response.body, signal);
  }
}
