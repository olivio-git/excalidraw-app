export type AIProviderName = "anthropic" | "groq" | "openai" | "gemini";

export type AIMessageRole = "user" | "assistant" | "tool";

export interface AIToolCall {
  id: string;
  name: string;
  inputJson: string; // raw accumulating JSON string
  isComplete: boolean;
}

export interface AIToolResult {
  toolCallId: string;
  result: string;
  isError: boolean;
}

export interface AIMessage {
  id: string;
  role: AIMessageRole;
  content: string;
  toolCalls?: AIToolCall[];
  toolResults?: AIToolResult[];
  timestamp: number;
  isStreaming?: boolean;
}

export type StreamChunkType =
  | "text_delta"
  | "tool_use_start"
  | "tool_use_delta"
  | "tool_use_stop"
  | "error"
  | "done";

export type StreamChunk =
  | { type: "text_delta"; delta: string }
  | { type: "tool_use_start"; toolCallId: string; toolName: string }
  | { type: "tool_use_delta"; toolCallId: string; delta: string }
  | { type: "tool_use_stop"; toolCallId: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface AIProviderConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  forceToolUse?: boolean; // forces tool_choice: required on first turn
}

export interface AIToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema object
}

export interface AIProvider {
  readonly name: AIProviderName;
  stream(
    messages: AIMessage[],
    systemPrompt: string,
    tools: AIToolDefinition[],
    config: AIProviderConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk>;
}
