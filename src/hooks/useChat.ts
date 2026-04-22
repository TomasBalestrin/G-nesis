import { useCallback, useState } from "react";

import { sendChatMessage } from "@/lib/tauri-bridge";
import { useChatStore } from "@/stores/chatStore";
import type { ChatMessage } from "@/types/chat";

import { useToast } from "./useToast";

interface UseChatResult {
  sending: boolean;
  send: (content: string) => Promise<void>;
}

/**
 * Sends a message through the Rust bridge, optimistically appending the user
 * message to the chat store and the assistant reply on resolution. Errors
 * surface as destructive toasts; the user message stays in the list so the
 * user can retry without retyping.
 *
 * The Rust `send_chat_message` persists both messages to SQLite — the
 * optimistic entry is only for UI immediacy and will be replaced the next
 * time history loads from the backend.
 */
export function useChat(): UseChatResult {
  const addMessage = useChatStore((s) => s.addMessage);
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

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
      try {
        const reply = await sendChatMessage({ content });
        addMessage(reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast({
          title: "Falha ao enviar mensagem",
          description: message,
          variant: "destructive",
        });
      } finally {
        setSending(false);
      }
    },
    [addMessage, toast],
  );

  return { sending, send };
}
