import { isViewVisible, useLayoutStore } from "@/core/layout/layout-store";
import { useAIChatStore } from "./store/ai-chat-store";

export const AI_CHAT_VIEW = "ai-chat";

/**
 * Bring up the agent chat from anywhere in the app (a button in an editor, a
 * command). With `prompt`, it lands in the input — or is sent at once with
 * `send: true` — so features ask the agent instead of a one-shot text box.
 */
export function openAgent(options: { prompt?: string; send?: boolean } = {}): void {
  useLayoutStore.getState().showView(AI_CHAT_VIEW);
  if (options.prompt !== undefined)
    useAIChatStore.getState().queuePrompt({ text: options.prompt, send: !!options.send });
  // The panel may be mounting: focus once it has rendered.
  requestAnimationFrame(() =>
    document.querySelector<HTMLTextAreaElement>("[data-ai-chat-input]")?.focus()
  );
}

/** Open and focus the chat; hide it when you are already typing in it. */
export function toggleAgent(): void {
  const inChat = document.activeElement?.closest("[data-ai-chat]");
  if (inChat && isViewVisible(AI_CHAT_VIEW)) useLayoutStore.getState().hideView(AI_CHAT_VIEW);
  else openAgent();
}
