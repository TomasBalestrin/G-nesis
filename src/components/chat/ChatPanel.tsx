import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, Loader2 } from "lucide-react";
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
import { useIntegrationsStore } from "@/stores/integrationsStore";
import type { ChatMessage } from "@/types/chat";
import type { ChatMessageInsertedEvent } from "@/types/events";

import { CommandInput } from "./CommandInput";
import { EmptyHomeScreen } from "./EmptyHomeScreen";
import { ExecutionControlBar } from "./ExecutionControlBar";
import { MessageBubble } from "./MessageBubble";
import { ThinkingBlock } from "./ThinkingBlock";

const USER_NAME_KEY = "user_name";

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
  // analyses) without a full re-fetch. Same stability pattern as
  // useExecution: ref body + useCallback wrapper with empty deps.
  // Without this, the inline closure was a fresh function reference
  // every render, which caused useTauriEvent's `[callback]` effect to
  // re-run on every parent re-render — bare-minimum risk of cascading
  // updates if anything in render path also touched setMessages.
  // Filters by conversation_id (latest from closure via ref) so events
  // routed to other threads don't leak. Dedupes by id — the
  // optimistic insert in handleSend may have already added this row.
  const onMessageInserted = useRef<(e: ChatMessageInsertedEvent) => void>(
    () => {},
  );
  onMessageInserted.current = (event) => {
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
  };
  const messageInsertedHandler = useCallback(
    (e: ChatMessageInsertedEvent) => onMessageInserted.current(e),
    [],
  );
  useTauriEvent("chat:message_inserted", messageInsertedHandler);

  // ── integration loading indicator ─────────────────────────────────────────
  // Backend (commands/chat.rs::post_process_integration_call) emits
  // "integration:loading" before firing the HTTP request and
  // "integration:loaded" after, with `success: bool`. Both carry the
  // conversation_id so we can filter to the current thread.
  const integrations = useIntegrationsStore((s) => s.items);
  const ensureIntegrations = useIntegrationsStore((s) => s.ensureLoaded);
  const [integrationCall, setIntegrationCall] = useState<{
    name: string;
    endpoint: string;
  } | null>(null);

  // Lazy-hydrate the catalog once so the indicator can resolve
  // display_name from `integration_name` (the @-mention handle). Without
  // this, a fresh load that lands directly in a chat with active
  // integration would only show the slug.
  useEffect(() => {
    void ensureIntegrations();
  }, [ensureIntegrations]);

  const loadingHandler = useRef<
    (e: {
      conversation_id: string | null;
      integration_name: string;
      endpoint: string;
    }) => void
  >(() => {});
  loadingHandler.current = (event) => {
    if (event.conversation_id !== conversationId) return;
    setIntegrationCall({
      name: event.integration_name,
      endpoint: event.endpoint,
    });
  };
  const loadingCb = useCallback(
    (e: {
      conversation_id: string | null;
      integration_name: string;
      endpoint: string;
    }) => loadingHandler.current(e),
    [],
  );
  useTauriEvent("integration:loading", loadingCb);

  const loadedHandler = useRef<
    (e: {
      conversation_id: string | null;
      integration_name: string;
      endpoint: string;
      success: boolean;
    }) => void
  >(() => {});
  loadedHandler.current = (event) => {
    if (event.conversation_id !== conversationId) return;
    setIntegrationCall(null);
    if (!event.success) {
      const display = displayNameFor(event.integration_name);
      toast({
        title: `Falha ao consultar ${display}`,
        description: `Endpoint: ${event.endpoint}`,
        variant: "destructive",
      });
    }
  };
  const loadedCb = useCallback(
    (e: {
      conversation_id: string | null;
      integration_name: string;
      endpoint: string;
      success: boolean;
    }) => loadedHandler.current(e),
    [],
  );
  useTauriEvent("integration:loaded", loadedCb);

  // ── web search indicator ──────────────────────────────────────────────────
  // Backend dispara "chat:searching" antes de cada chamada à Brave
  // Search; "chat:search-done" depois (sucesso ou falha). Indicador
  // separado do integration:loading porque os dois fluxos podem
  // coexistir num turno (ex: pesquisa → chamada à integração).
  const [searchingQuery, setSearchingQuery] = useState<string | null>(null);

  const searchingHandler = useRef<
    (e: { conversation_id: string | null; query: string; round: number }) => void
  >(() => {});
  searchingHandler.current = (event) => {
    if (event.conversation_id !== conversationId) return;
    setSearchingQuery(event.query);
  };
  const searchingCb = useCallback(
    (e: { conversation_id: string | null; query: string; round: number }) =>
      searchingHandler.current(e),
    [],
  );
  useTauriEvent("chat:searching", searchingCb);

  const searchDoneHandler = useRef<
    (e: {
      conversation_id: string | null;
      query: string;
      round: number;
      success: boolean;
    }) => void
  >(() => {});
  searchDoneHandler.current = (event) => {
    if (event.conversation_id !== conversationId) return;
    setSearchingQuery(null);
    if (!event.success) {
      toast({
        title: "Pesquisa falhou",
        description: `Query: ${event.query}`,
        variant: "destructive",
      });
    }
  };
  const searchDoneCb = useCallback(
    (e: {
      conversation_id: string | null;
      query: string;
      round: number;
      success: boolean;
    }) => searchDoneHandler.current(e),
    [],
  );
  useTauriEvent("chat:search-done", searchDoneCb);

  function displayNameFor(name: string): string {
    return integrations.find((i) => i.name === name)?.display_name ?? name;
  }

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
      <EmptyHomeScreen
        onSubmit={handleSend}
        disabled={!conversationId}
        userName={userName}
      />
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
          {renderable.map((m) => (
            <MessageBubble key={m.id} message={m} onAutoSend={handleSend} />
          ))}
          {sending && searchingQuery ? (
            <SearchingIndicator query={searchingQuery} />
          ) : sending && integrationCall ? (
            <IntegrationLoadingIndicator
              displayName={displayNameFor(integrationCall.name)}
            />
          ) : sending && isThinking ? (
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
  // animate-pulse usa ease-in-out (cubic-bezier 0.4,0,0.6,1) — sem
  // spring conforme Elite Premium (DESIGN.md §motion). Tailwind's
  // content scanner é greedy e gera classe pra qualquer token que
  // bate o pattern, incluindo em comments — daí evitar repetir aqui
  // o nome da animation antiga.
  return (
    <span
      className="h-2 w-2 animate-pulse rounded-full bg-[var(--text-3)]"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}

/**
 * Inline indicator while an integration HTTP roundtrip is in flight.
 * Replaces the TypingIndicator while `integration:loading` is active —
 * gives the user a clear signal that the chat is waiting on an
 * external API rather than the model.
 */
function IntegrationLoadingIndicator({ displayName }: { displayName: string }) {
  return (
    <div
      className="flex w-full justify-start"
      aria-live="polite"
      aria-label={`Consultando ${displayName}`}
    >
      <article className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-[var(--text-2)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
          <span>
            Consultando <span className="font-medium">{displayName}</span>...
          </span>
        </div>
      </article>
    </div>
  );
}

function SearchingIndicator({ query }: { query: string }) {
  return (
    <div
      className="flex w-full justify-start"
      aria-live="polite"
      aria-label={`Pesquisando na web: ${query}`}
    >
      <article className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-[var(--text-2)]">
          <Globe className="h-4 w-4 animate-spin text-[var(--accent)]" />
          <span>
            Pesquisando na web: <span className="font-mono text-xs">{query}</span>
          </span>
        </div>
      </article>
    </div>
  );
}
