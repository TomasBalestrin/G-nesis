import { useTauriEvent } from "./useTauriEvent";
import { useChatStore } from "@/stores/chatStore";

/**
 * Bridge backend `chat:thinking_*` events into the chat store. Mount once
 * inside ChatPanel — the store's `currentThinking` / `isThinking` selectors
 * drive the live `<ThinkingBlock streaming>` in the chat surface.
 *
 * Events we listen to (emitted by commands/chat.rs::AppHandleSink):
 *   - `chat:thinking_delta`     : append a chunk to the buffer
 *   - `chat:thinking_complete`  : lock the summary; buffer stays until the
 *                                  assistant message lands and ChatPanel
 *                                  calls clearThinking()
 *
 * Events for other conversations are ignored — keeps multi-tab usage
 * consistent (only the active route's chat sees the stream).
 */
export function useThinking(activeConversationId: string | null): void {
  const appendThinking = useChatStore((s) => s.appendThinking);
  const completeThinking = useChatStore((s) => s.completeThinking);

  useTauriEvent("chat:thinking_delta", (event) => {
    if (event.conversation_id && event.conversation_id !== activeConversationId) {
      return;
    }
    appendThinking(event.delta);
  });

  useTauriEvent("chat:thinking_complete", (event) => {
    if (event.conversation_id && event.conversation_id !== activeConversationId) {
      return;
    }
    completeThinking(event.summary);
  });
}
