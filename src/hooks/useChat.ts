import { useCallback, useState } from "react";

import { safeInvoke, sendChatMessage } from "@/lib/tauri-bridge";
import { useChatStore } from "@/stores/chatStore";
import type { ChatMessage } from "@/types/chat";

interface UseChatResult {
  sending: boolean;
  send: (content: string) => Promise<void>;
}

/**
 * Sends a message through the Rust bridge, optimistically appending the user
 * message to the chat store and the assistant reply on resolution. Errors
 * surface as destructive toasts (auto-persisting via the destructive variant
 * default) so the user never misses a failed send.
 */
export function useChat(): UseChatResult {
  const addMessage = useChatStore((s) => s.addMessage);
  const [sending, setSending] = useState(false);

  const send = useCallback(
    async (content: string) => {
      const optimistic: ChatMessage = {
        id: crypto.randomUUID(),
        execution_id: null,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      addMessage(optimistic);

      setSending(true);
      const reply = await safeInvoke(() => sendChatMessage({ content }), {
        errorTitle: "Falha ao enviar mensagem",
      });
      if (reply) addMessage(reply);
      setSending(false);
    },
    [addMessage],
  );

  return { sending, send };
}
