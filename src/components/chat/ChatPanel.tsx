import { useEffect, useRef } from "react";

import { ProgressDashboard } from "@/components/progress/ProgressDashboard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChat } from "@/hooks/useChat";
import { useExecution } from "@/hooks/useExecution";
import { useChatStore } from "@/stores/chatStore";
import { useExecutionStore } from "@/stores/executionStore";

import { CommandInput } from "./CommandInput";
import { ExecutionControls } from "./ExecutionControls";
import { MessageBubble } from "./MessageBubble";

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const hasActiveExecution = useExecutionStore(
    (s) => s.activeExecution !== null,
  );
  const { send, sending } = useChat();
  const endRef = useRef<HTMLDivElement>(null);

  // Subscribe to executor events so ExecutionControls + the embedded
  // ProgressDashboard wake up the moment the first step_started fires.
  useExecution();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending]);

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
            <CommandInput onSubmit={send} disabled={sending} />
          </div>
        </div>
      </div>

      {/*
        Side-by-side: only on ≥ 1200px AND when there's a live execution.
        Below 1200px the user navigates to /progress instead.
      */}
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
