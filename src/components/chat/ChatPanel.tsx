import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useExecution } from "@/hooks/useExecution";
import { useThinking } from "@/hooks/useThinking";
import { useToast } from "@/hooks/useToast";
import {
  listMessagesByConversation,
  safeInvoke,
  sendChatMessage,
} from "@/lib/tauri-bridge";
import { useChatStore } from "@/stores/chatStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useExecutionStore } from "@/stores/executionStore";
import type { ChatMessage } from "@/types/chat";

import { CommandInput } from "./CommandInput";
import { ExecutionMessage } from "./ExecutionMessage";
import { MessageBubble } from "./MessageBubble";
import { ThinkingBlock } from "./ThinkingBlock";

/**
 * Chat surface for a single conversation. Reads `conversationId` from the
 * route (`/chat/:conversationId`) and keeps its own message buffer since
 * messages are per-thread and loading history is cheap.
 *
 * When a skill is running, an inline `<ExecutionMessage>` renders right in
 * the message stream as a virtual chat item with `type: "execution"` —
 * steps, logs, and controls all live inside the chat (no modal, no side
 * panel).
 */
export function ChatPanel() {
  const { conversationId = "" } = useParams<{ conversationId: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const activeExecution = useExecutionStore((s) => s.activeExecution);
  const hasActiveExecution = activeExecution !== null;
  const refreshConversations = useConversationsStore((s) => s.refresh);
  const startThinking = useChatStore((s) => s.startThinking);
  const clearThinking = useChatStore((s) => s.clearThinking);
  const isThinking = useChatStore((s) => s.isThinking);
  const currentThinking = useChatStore((s) => s.currentThinking);
  const currentThinkingSummary = useChatStore((s) => s.currentThinkingSummary);
  const endRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useExecution();
  // Bridge backend `chat:thinking_*` events into the chat store. Filters by
  // route conversationId so concurrent threads don't cross-contaminate.
  useThinking(conversationId || null);

  // Hydrate from SQLite whenever the route conversation changes.
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    listMessagesByConversation({ conversationId })
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            title: "Falha ao carregar mensagens",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, toast]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending, hasActiveExecution]);

  async function handleSend(content: string) {
    if (!conversationId) return;
    const now = new Date().toISOString();
    const optimistic: ChatMessage = {
      id: crypto.randomUUID(),
      execution_id: null,
      conversation_id: conversationId,
      role: "user",
      content,
      created_at: now,
    };
    setMessages((prev) => [...prev, optimistic]);

    // Reset the thinking buffer for the new turn — stale text from a
    // previous failed completion would otherwise leak into the new bubble.
    startThinking(conversationId);
    setSending(true);
    try {
      const reply = await safeInvoke(
        () => sendChatMessage({ content, conversationId }),
        { errorTitle: "Falha ao enviar mensagem" },
      );
      if (reply) {
        setMessages((prev) => [...prev, reply]);
        refreshConversations();
      }
    } finally {
      setSending(false);
      // The persisted assistant message already carries its own thinking
      // (rendered by MessageBubble's collapsed ThinkingBlock); the live
      // store buffer can be released regardless of success/failure.
      clearThinking();
    }
  }

  // Stitches the persisted text messages with an in-memory virtual entry
  // for the active execution. Keeping the union here lets the renderer
  // dispatch on `message.type` without scattering execution-store reads
  // across MessageBubble.
  const displayMessages = useMemo<ChatMessage[]>(() => {
    if (!activeExecution) return messages;
    const virtual: ChatMessage = {
      id: `execution-${activeExecution.id}`,
      execution_id: activeExecution.id,
      conversation_id: conversationId || null,
      role: "assistant",
      content: "",
      created_at: activeExecution.started_at ?? new Date().toISOString(),
      type: "execution",
    };
    return [...messages, virtual];
  }, [messages, activeExecution, conversationId]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
          {displayMessages.length === 0 && !sending ? (
            <EmptyState />
          ) : (
            displayMessages.map((m) =>
              m.type === "execution" ? (
                <ExecutionMessage key={m.id} />
              ) : (
                <MessageBubble key={m.id} message={m} onAutoSend={handleSend} />
              ),
            )
          )}
          {sending && isThinking ? (
            <div className="flex w-full justify-start">
              <article className="max-w-[80%] px-1 py-1">
                <ThinkingBlock
                  thinking={currentThinking}
                  summary={currentThinkingSummary ?? undefined}
                  streaming
                />
              </article>
            </div>
          ) : sending ? (
            <TypingIndicator />
          ) : null}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-background p-4">
        <div className="mx-auto max-w-3xl">
          <CommandInput
            onSubmit={handleSend}
            disabled={sending || !conversationId}
          />
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-20 text-center text-sm text-[var(--text-2)]">
      Digite um comando ou converse com o assistente.
    </div>
  );
}

function TypingIndicator() {
  return (
    <div
      className="flex w-full justify-start"
      aria-live="polite"
      aria-label="Assistente digitando"
    >
      <article className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-1">
          <Dot />
          <Dot delay={150} />
          <Dot delay={300} />
        </div>
      </article>
    </div>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="h-2 w-2 animate-bounce rounded-full bg-[var(--text-3)]"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}
