import { useAIChatStore } from "../store/ai-chat-store";
import { useAISettingsStore } from "@/features/settings/ai/ai-settings-store";
import { DiagramController } from "@/core/diagram/DiagramController";
import { AIProviderFactory } from "../providers/factory";
import { StreamParser } from "../utils/stream-parser";
import { executeAITool } from "../utils/tool-executor";
import { buildExcalidrawSystemPrompt } from "../system-prompt";
import type { AIToolDefinition, AIMessage } from "../providers/types";

const TOOLS: AIToolDefinition[] = [
  {
    name: "draw_elements",
    description: "Draw or replace elements on the Excalidraw canvas",
    inputSchema: {
      type: "object",
      properties: {
        elements: { type: "array", description: "Array of Excalidraw element objects" },
      },
      required: ["elements"],
    },
  },
  {
    name: "get_elements",
    description: "Get all current elements from the canvas",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "clear_canvas",
    description: "Clear all elements from the canvas",
    inputSchema: {
      type: "object",
      properties: { confirm: { type: "boolean" } },
      required: ["confirm"],
    },
  },
  {
    name: "update_element",
    description: "Update a single element by ID",
    inputSchema: {
      type: "object",
      properties: {
        elementId: { type: "string" },
        updates: { type: "object" },
      },
      required: ["elementId", "updates"],
    },
  },
];

export function useAIChat() {
  const messages = useAIChatStore((s) => s.messages);
  const status = useAIChatStore((s) => s.status);
  const errorMessage = useAIChatStore((s) => s.errorMessage);

  const sendMessage = async (text: string) => {
    const currentStatus = useAIChatStore.getState().status;
    if (currentStatus === "streaming") return;

    const {
      addMessage,
      updateMessage,
      appendTextDelta,
      appendToolCallDelta,
      addToolCall,
      finalizeToolCall,
      setStatus,
      setAbortController,
    } = useAIChatStore.getState();

    addMessage({ role: "user", content: text });

    const { provider, config } = useAISettingsStore.getState().getActiveConfig();

    if (!config.apiKey) {
      setStatus("error", "No API key configured. Go to Settings → AI.");
      return;
    }

    const activeInstanceId = DiagramController.getActiveInstanceId();
    const snapshotElements = DiagramController.getElements(activeInstanceId);

    const controller = new AbortController();
    setAbortController(controller);
    setStatus("streaming");

    let assistantMsgId = addMessage({ role: "assistant", content: "", isStreaming: true });

    const parser = new StreamParser();
    const MAX_ITERATIONS = 10;

    try {
      const aiProvider = await AIProviderFactory.create(provider);

      // Agentic loop — keep calling the model while it returns tool calls
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        parser.reset();

        // Build messages excluding the current placeholder assistant message
        const storeMessages = useAIChatStore.getState().messages;
        const providerMessages: AIMessage[] = storeMessages.filter((m) => m.id !== assistantMsgId);

        const stream = aiProvider.stream(
          providerMessages,
          buildExcalidrawSystemPrompt(),
          TOOLS,
          { ...config, forceToolUse: iteration === 0 },
          controller.signal
        );

        let hadToolCalls = false;

        for await (const chunk of stream) {
          switch (chunk.type) {
            case "text_delta":
              appendTextDelta(assistantMsgId, chunk.delta);
              break;

            case "tool_use_start":
              hadToolCalls = true;
              addToolCall(assistantMsgId, {
                id: chunk.toolCallId,
                name: chunk.toolName,
                inputJson: "",
              });
              break;

            case "tool_use_delta":
              appendToolCallDelta(assistantMsgId, chunk.toolCallId, chunk.delta);
              parser.onToolDelta(chunk.toolCallId, chunk.delta);
              break;

            case "tool_use_stop": {
              parser.onToolStop(chunk.toolCallId);
              finalizeToolCall(assistantMsgId, chunk.toolCallId);

              const updatedMessages = useAIChatStore.getState().messages;
              const assistantMsg = updatedMessages.find((m) => m.id === assistantMsgId);
              const completedTool = assistantMsg?.toolCalls?.find(
                (tc) => tc.id === chunk.toolCallId
              );

              if (completedTool) {
                let parsedInput: unknown = {};
                try {
                  parsedInput = JSON.parse(completedTool.inputJson);
                } catch {
                  parsedInput = {};
                }

                const result = await executeAITool(
                  completedTool.name,
                  parsedInput,
                  activeInstanceId
                );

                addMessage({
                  role: "tool",
                  content: result.result,
                  toolResults: [
                    {
                      toolCallId: chunk.toolCallId,
                      result: result.result,
                      isError: result.isError,
                    },
                  ],
                });
              }
              break;
            }

            case "error":
              setStatus("error", chunk.message);
              DiagramController.setElements(
                activeInstanceId,
                snapshotElements as Parameters<typeof DiagramController.setElements>[1]
              );
              break;

            case "done":
              break;
          }

          if (chunk.type === "error" || chunk.type === "done") break;
        }

        // If no tool calls in this iteration, the model is done
        if (!hadToolCalls) break;

        // Finalize current assistant message and start a fresh one for next iteration
        updateMessage(assistantMsgId, { isStreaming: false });
        assistantMsgId = addMessage({ role: "assistant", content: "", isStreaming: true });
      }

      updateMessage(assistantMsgId, { isStreaming: false });
      setStatus("idle");
      setAbortController(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        DiagramController.setElements(
          activeInstanceId,
          snapshotElements as Parameters<typeof DiagramController.setElements>[1]
        );
        updateMessage(assistantMsgId, { isStreaming: false });
        setStatus("idle");
        setAbortController(null);
      } else {
        updateMessage(assistantMsgId, { isStreaming: false });
        setStatus("error", err instanceof Error ? err.message : String(err));
        setAbortController(null);
      }
    }
  };

  const cancelStream = () => {
    useAIChatStore.getState().abortController?.abort();
  };

  return { messages, status, errorMessage, sendMessage, cancelStream };
}
