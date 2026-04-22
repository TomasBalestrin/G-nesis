import { useEffect, useRef } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useChat } from "@/hooks/useChat";
import { useChatStore } from "@/stores/chatStore";

import { CommandInput } from "./CommandInput";
import { MessageBubble } from "./MessageBubble";

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const { send, sending } = useChat();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending]);

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
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
        <div className="mx-auto max-w-3xl">
          <CommandInput onSubmit={send} disabled={sending} />
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
    <div className="flex w-full justify-start" aria-live="polite" aria-label="Assistente digitando">
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
