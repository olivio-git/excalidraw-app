import { useAIChatStore } from "../store/ai-chat-store";
import { useAISettingsStore } from "@/features/settings/ai/ai-settings-store";
import { DiagramController } from "@/core/diagram/DiagramController";
import { AIProviderFactory } from "../providers/factory";
import { StreamParser } from "../utils/stream-parser";
import { resolveAIChatContext } from "../utils/context-resolver";
import type { AIChatContext } from "../utils/context-resolver";
import { getToolsForContext } from "../tools";
import { executeAITool } from "../utils/tool-executor";
import { buildSystemPrompt } from "../system-prompt";
import type { DiagramContextInfo, DocumentContextInfo } from "../system-prompt";
import { useDocumentStore } from "@/stores/documentStore";
import { getDocumentController } from "@/features/document-editor/documentController.singleton";
import { useThemeStore } from "@/stores/themeStore";
import type { AIMessage } from "../providers/types";
import { useChatHistoryStore } from "../store/chat-history-store";
import { createConversation, saveMessage } from "./useChatHistory";
import { prompt } from "@/shared/lib/prompt";
import { confirm } from "@/shared/lib/confirm";

// ---------------------------------------------------------------------------
// Tool permission gate
// ---------------------------------------------------------------------------

const TOOLS_REQUIRING_PERMISSION = new Set([
  "document_append",
  "document_replace_section",
  "document_insert_after_section",
  "document_set_block_color",
  "clear_canvas",
]);

function describeToolAction(name: string, input: unknown): string {
  const i = input as Record<string, unknown>;
  switch (name) {
    case "document_append": {
      const preview = String(i.content ?? "").slice(0, 100);
      return `Append to document:\n"${preview}${preview.length >= 100 ? "…" : ""}"`;
    }
    case "document_replace_section":
      return `Replace section "${i.heading}"`;
    case "document_insert_after_section":
      return `Insert content after "${i.heading}"`;
    case "document_set_block_color":
      return `Set color of "${i.heading}" to ${i.color}`;
    case "clear_canvas":
      return "Clear the entire canvas";
    default:
      return name;
  }
}

// ---------------------------------------------------------------------------

export function useAIChat() {
  const messages = useAIChatStore((s) => s.messages);
  const status = useAIChatStore((s) => s.status);
  const errorMessage = useAIChatStore((s) => s.errorMessage);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  const answerPendingQuestion = (answer: string) => {
    const { pendingQuestion, clearPendingQuestion } = useAIChatStore.getState();
    if (!pendingQuestion) return;
    clearPendingQuestion();
    pendingQuestion.resolve(answer);
  };

  const cancelStream = () => {
    const { abortController, pendingQuestion, clearPendingQuestion } = useAIChatStore.getState();
    if (pendingQuestion) {
      clearPendingQuestion();
      pendingQuestion.reject(new DOMException("Aborted", "AbortError"));
    }
    abortController?.abort();
  };

  const sendMessage = async (text: string) => {
    const currentStatus = useAIChatStore.getState().status;
    if (currentStatus === "streaming" || currentStatus === "waiting_for_user") return;

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

    // Resolve or create conversation for history persistence
    let convId: string | null = useChatHistoryStore.getState().activeConversationId;

    const { provider, config } = useAISettingsStore.getState().getActiveConfig();

    if (!config.apiKey) {
      setStatus("error", "No API key configured. Go to Settings → AI.");
      return;
    }

    let context: AIChatContext = resolveAIChatContext();

    // Persist conversation and user message to history
    const userMsg = useAIChatStore.getState().messages.at(-1)!;
    if (convId === null) {
      const newConvId = crypto.randomUUID();
      const title = text.slice(0, 60) || "New conversation";
      createConversation(newConvId, title, context.kind).catch(console.error);
      useChatHistoryStore.getState().upsertConversation({
        id: newConvId,
        title,
        contextKind: context.kind,
        createdAt: userMsg.timestamp,
        updatedAt: userMsg.timestamp,
      });
      useChatHistoryStore.getState().setActiveConversationId(newConvId);
      convId = newConvId;
    }
    saveMessage({
      id: userMsg.id,
      conversationId: convId,
      role: "user",
      content: text,
      toolCallsJson: null,
      timestamp: userMsg.timestamp,
    }).catch(console.error);

    // Snapshot for rollback
    const snapshotElements =
      context.kind === "diagram" ? DiagramController.getElements(context.instanceId) : null;
    const snapshotContent =
      context.kind === "document"
        ? (useDocumentStore.getState().documents[context.filePath]?.content ?? null)
        : null;

    // Build dynamic context info for system prompt
    const customInstructions = useAISettingsStore.getState().customInstructions;

    let diagramContext: DiagramContextInfo | undefined;
    if (context.kind === "diagram") {
      const elements = DiagramController.getElements(context.instanceId) ?? [];
      const elementTypes: Record<string, number> = {};
      for (const el of elements) {
        const t = (el as { type: string }).type;
        elementTypes[t] = (elementTypes[t] ?? 0) + 1;
      }
      diagramContext = { elementCount: elements.length, elementTypes };
    }

    let documentContext: DocumentContextInfo | undefined;
    if (context.kind === "document") {
      const doc = useDocumentStore.getState().documents[context.filePath];
      if (doc) {
        const sectionCount = getDocumentController().getSections(context.filePath).length;
        documentContext = {
          title: doc.title,
          sectionCount,
          charCount: doc.content.length,
        };
      }
    }

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
          buildSystemPrompt(context, {
            theme: resolvedTheme,
            customInstructions,
            diagramContext,
            documentContext,
          }),
          getToolsForContext(context),
          config,
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

                // ── ask_user: pause loop, show prompt modal ──
                if (completedTool.name === "ask_user") {
                  const input = parsedInput as { question?: string };
                  const question = input.question ?? "";

                  setStatus("waiting_for_user");
                  const result = await prompt({
                    title: question || "The AI has a question",
                    fields: [{ id: "answer", label: "Your answer", required: false }],
                    confirmLabel: "Send",
                    cancelLabel: "Cancel",
                  });
                  const answer = result?.answer ?? "";

                  const toolMsgId = addMessage({
                    role: "tool",
                    content: answer,
                    toolResults: [
                      {
                        toolCallId: chunk.toolCallId,
                        result: answer,
                        isError: false,
                      },
                    ],
                  });

                  const currentConvId = useChatHistoryStore.getState().activeConversationId;
                  if (currentConvId) {
                    const toolMsg = useAIChatStore
                      .getState()
                      .messages.find((m) => m.id === toolMsgId);
                    if (toolMsg) {
                      saveMessage({
                        id: toolMsg.id,
                        conversationId: currentConvId,
                        role: "tool",
                        content: answer,
                        toolCallsJson: null,
                        timestamp: toolMsg.timestamp,
                      }).catch(console.error);
                    }
                  }

                  setStatus("streaming");
                  break;
                }

                // ── Permission gate for write tools ──
                if (TOOLS_REQUIRING_PERMISSION.has(completedTool.name)) {
                  const allowed = await confirm({
                    title: "AI wants to make changes",
                    description: describeToolAction(completedTool.name, parsedInput),
                    confirmLabel: "Allow",
                    cancelLabel: "Deny",
                  });
                  if (!allowed) {
                    addMessage({
                      role: "tool",
                      content: "Action denied by user.",
                      toolResults: [
                        {
                          toolCallId: chunk.toolCallId,
                          result: "Action denied by user.",
                          isError: true,
                        },
                      ],
                    });
                    break;
                  }
                }

                // ── Normal tool execution ──
                const result = await executeAITool(completedTool.name, parsedInput, context);

                // Re-resolve context after workspace tools that open/create a file
                if (
                  !result.isError &&
                  (completedTool.name === "workspace_create_document" ||
                    completedTool.name === "workspace_create_diagram" ||
                    completedTool.name === "workspace_open_file")
                ) {
                  context = resolveAIChatContext();
                  if (context.kind === "document") {
                    const doc = useDocumentStore.getState().documents[context.filePath];
                    if (doc) {
                      documentContext = {
                        title: doc.title,
                        sectionCount: getDocumentController().getSections(context.filePath).length,
                        charCount: doc.content.length,
                      };
                    }
                  } else if (context.kind === "diagram") {
                    const elements = DiagramController.getElements(context.instanceId) ?? [];
                    const elTypes: Record<string, number> = {};
                    for (const el of elements) {
                      const t = (el as { type: string }).type;
                      elTypes[t] = (elTypes[t] ?? 0) + 1;
                    }
                    diagramContext = { elementCount: elements.length, elementTypes: elTypes };
                  }
                }

                const toolMsgId = addMessage({
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
                const currentConvId = useChatHistoryStore.getState().activeConversationId;
                if (currentConvId) {
                  const toolMsg = useAIChatStore
                    .getState()
                    .messages.find((m) => m.id === toolMsgId);
                  if (toolMsg) {
                    saveMessage({
                      id: toolMsg.id,
                      conversationId: currentConvId,
                      role: "tool",
                      content: result.result,
                      toolCallsJson: null,
                      timestamp: toolMsg.timestamp,
                    }).catch(console.error);
                  }
                }
              }
              break;
            }

            case "error":
              setStatus("error", chunk.message);
              if (context.kind === "diagram" && snapshotElements) {
                DiagramController.setElements(
                  context.instanceId,
                  snapshotElements as Parameters<typeof DiagramController.setElements>[1]
                );
              } else if (context.kind === "document" && snapshotContent !== null) {
                getDocumentController().setContent(context.filePath, snapshotContent);
              }
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
        {
          const savedConvId = useChatHistoryStore.getState().activeConversationId;
          if (savedConvId) {
            const assistantMsg = useAIChatStore
              .getState()
              .messages.find((m) => m.id === assistantMsgId);
            if (assistantMsg) {
              saveMessage({
                id: assistantMsg.id,
                conversationId: savedConvId,
                role: "assistant",
                content: assistantMsg.content,
                toolCallsJson: assistantMsg.toolCalls
                  ? JSON.stringify(assistantMsg.toolCalls)
                  : null,
                timestamp: assistantMsg.timestamp,
              }).catch(console.error);
            }
          }
        }
        assistantMsgId = addMessage({ role: "assistant", content: "", isStreaming: true });
      }

      updateMessage(assistantMsgId, { isStreaming: false });
      {
        const savedConvId = useChatHistoryStore.getState().activeConversationId;
        if (savedConvId) {
          const assistantMsg = useAIChatStore
            .getState()
            .messages.find((m) => m.id === assistantMsgId);
          if (assistantMsg) {
            saveMessage({
              id: assistantMsg.id,
              conversationId: savedConvId,
              role: "assistant",
              content: assistantMsg.content,
              toolCallsJson: assistantMsg.toolCalls ? JSON.stringify(assistantMsg.toolCalls) : null,
              timestamp: assistantMsg.timestamp,
            }).catch(console.error);
          }
        }
      }
      setStatus("idle");
      setAbortController(null);
    } catch (err) {
      // Reject pending question for non-abort errors
      const { pendingQuestion } = useAIChatStore.getState();
      if (pendingQuestion && !(err instanceof Error && err.name === "AbortError")) {
        useAIChatStore.getState().clearPendingQuestion();
        pendingQuestion.reject(err instanceof Error ? err : new Error(String(err)));
      }

      if (err instanceof Error && err.name === "AbortError") {
        if (context.kind === "diagram" && snapshotElements) {
          DiagramController.setElements(
            context.instanceId,
            snapshotElements as Parameters<typeof DiagramController.setElements>[1]
          );
        } else if (context.kind === "document" && snapshotContent !== null) {
          getDocumentController().setContent(context.filePath, snapshotContent);
        }
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

  return { messages, status, errorMessage, sendMessage, cancelStream, answerPendingQuestion };
}
