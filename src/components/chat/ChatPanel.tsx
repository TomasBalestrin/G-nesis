import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { ProgressDashboard } from "@/components/progress/ProgressDashboard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useExecution } from "@/hooks/useExecution";
import { useToast } from "@/hooks/useToast";
import {
  listMessagesByConversation,
  safeInvoke,
  sendChatMessage,
} from "@/lib/tauri-bridge";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useExecutionStore } from "@/stores/executionStore";
import type { ChatMessage } from "@/types/chat";

import { CommandInput } from "./CommandInput";
import { ExecutionControls } from "./ExecutionControls";
import { MessageBubble } from "./MessageBubble";

/**
 * Chat surface for a single conversation. Reads `conversationId` from the
 * route (`/chat/:conversationId`) and keeps its own message buffer since
 * messages are per-thread and loading history is cheap.
 *
 * Side-by-side ProgressDashboard at ≥1200px when an execution is running —
 * otherwise the user navigates back through the sidebar.
 */
export function ChatPanel() {
  const { conversationId = "" } = useParams<{ conversationId: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const hasActiveExecution = useExecutionStore(
    (s) => s.activeExecution !== null,
  );
  const refreshConversations = useConversationsStore((s) => s.refresh);
  const endRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useExecution();

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
  }, [messages.length, sending]);

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

    setSending(true);
    const reply = await safeInvoke(
      () => sendChatMessage({ content, conversationId }),
      { errorTitle: "Falha ao enviar mensagem" },
    );
    setSending(false);
    if (reply) {
      setMessages((prev) => [...prev, reply]);
      // Pick up bumped `updated_at` + possibly the auto-generated title.
      refreshConversations();
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
            {messages.length === 0 && !sending ? (
              <EmptyState />
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
            {sending ? <TypingIndicator /> : null}
            <div ref={endRef} />
          </div>
        </ScrollArea>

        <div className="border-t border-border bg-background p-4">
          <div className="mx-auto max-w-3xl space-y-3">
            <ExecutionControls />
            <CommandInput
              onSubmit={handleSend}
              disabled={sending || !conversationId}
            />
          </div>
        </div>
      </div>

      {hasActiveExecution ? (
        <aside
          aria-label="Painel de progresso"
          className="hidden min-w-0 flex-1 border-l border-border min-[1200px]:flex"
        >
          <ProgressDashboard />
        </aside>
      ) : null}
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
