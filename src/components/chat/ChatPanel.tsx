import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useParams } from "react-router-dom";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useExecution } from "@/hooks/useExecution";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { useThinking } from "@/hooks/useThinking";
import { useToast } from "@/hooks/useToast";
import {
  getAppStateValue,
  listMessagesByConversation,
  safeInvoke,
  sendChatMessage,
} from "@/lib/tauri-bridge";
import { useChatStore } from "@/stores/chatStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import type { ChatMessage } from "@/types/chat";

import { CommandInput } from "./CommandInput";
import { ExecutionControlBar } from "./ExecutionControlBar";
import { MessageBubble } from "./MessageBubble";
import { ThinkingBlock } from "./ThinkingBlock";

const USER_NAME_KEY = "user_name";

const EMPTY_STATE_PLACEHOLDER = "Como posso ajudar você hoje?";

/**
 * Chat surface for a single conversation. Reads `conversationId` from the
 * route (`/chat/:conversationId`) and keeps its own message buffer since
 * messages are per-thread and loading history is cheap.
 *
 * Skill execution surfaces inline now: each `execution:step_*` event
 * gets persisted as a `kind: "execution-status"` chat message by
 * useExecution + the backend (F1-F3), and the live ChatPanel listens
 * to `chat:message_inserted` to append without a re-fetch. Pause/abort
 * controls live in the thin `<ExecutionControlBar>` between the scroll
 * area and the input — only visible while an execution is running or
 * paused.
 */
export function ChatPanel() {
  const { conversationId = "" } = useParams<{ conversationId: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  // user_name lives in app_state (set in onboarding step 3, editable in
  // KnowledgeSection). Fetched once on mount — invariant across
  // conversations within a session.
  const [userName, setUserName] = useState<string | null>(null);
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

  // Append messages persisted by `insert_execution_status_message` /
  // `analyze_step_failure` (inline ⏳/✅/❌ entries + GPT failure
  // analyses) without a full re-fetch. Filters by conversation_id so
  // messages routed to other threads don't leak in. Dedupes by id —
  // the optimistic insert in handleSend may have already added this
  // row. Defensive try-catch + payload validation: a malformed event
  // shouldn't kill the React tree.
  useTauriEvent("chat:message_inserted", (event) => {
    try {
      if (!event?.message?.id || !event.message.role) {
        console.warn("[ChatPanel] message_inserted payload inválido:", event);
        return;
      }
      if (event.message.conversation_id !== conversationId) return;
      setMessages((prev) =>
        prev.some((m) => m.id === event.message.id)
          ? prev
          : [...prev, event.message],
      );
    } catch (err) {
      console.error("[ChatPanel] message_inserted crash:", err);
    }
  });

  // Read user_name once for the empty-state greeting. Failures are
  // silent — the UI degrades to a generic "Olá!" if the value is missing
  // or the call errors out.
  useEffect(() => {
    let cancelled = false;
    getAppStateValue({ key: USER_NAME_KEY })
      .then((v) => {
        if (!cancelled) setUserName(v ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserName(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Defensive filter: drop rows with missing essentials before render.
  // A corrupted DB row (legacy migration, partial write during crash,
  // truncated event payload) would otherwise reach MessageBubble and
  // crash the tree on the markdown layer. Filtering here is cheap and
  // keeps the empty-state condition below honest — `messages.length`
  // post-filter decides whether to show the greeting or the chat.
  const renderable = messages.filter(
    (m) => m?.id && m.content != null && m.role,
  );

  // Empty-state branch: shown only on a brand-new conversation with
  // nothing in flight. CommandInput is rendered ONCE — here, centered
  // under the greeting. Once the user sends, `renderable.length` flips
  // to 1 (optimistic add) and the next render switches to the normal
  // layout below; CommandInput unmounts here and remounts at the
  // bottom. State loss is a non-issue since `submitRaw` clears the
  // textarea before the parent re-renders.
  if (renderable.length === 0 && !sending) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center px-4">
        <EmptyStateGreeting userName={userName} />
        <div className="mt-8 w-full max-w-2xl animate-fade-in">
          <CommandInput
            onSubmit={handleSend}
            disabled={!conversationId}
            placeholder={EMPTY_STATE_PLACEHOLDER}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
          {renderable.map((m) => (
            <MessageBubble key={m.id} message={m} onAutoSend={handleSend} />
          ))}
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

      <ExecutionControlBar />

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

/**
 * Centered greeting shown above the input on a brand-new conversation.
 * Sparkles in the brand color sits above the heading so the page reads
 * as "Genesis, ready to help" without dropping a heavy logo. Heading
 * text uses the user's name from app_state when available; otherwise
 * the generic "Olá!" so the layout stays meaningful while user_name
 * loads (or for users who skipped onboarding step 3).
 */
function EmptyStateGreeting({ userName }: { userName: string | null }) {
  const greeting = userName ? `Olá, ${userName}` : "Olá!";
  return (
    <div className="flex flex-col items-center gap-4 text-center animate-fade-in">
      <Sparkles className="h-7 w-7 text-[var(--primary)]" aria-hidden="true" />
      <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-4xl">
        {greeting}
      </h1>
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
