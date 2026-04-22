import { useEffect, useRef } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useChatStore } from "@/stores/chatStore";
import type { ChatMessage } from "@/types/chat";

import { CommandInput } from "./CommandInput";
import { MessageBubble } from "./MessageBubble";

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const addMessage = useChatStore((s) => s.addMessage);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  function handleSubmit(content: string) {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      execution_id: null,
      role: "user",
      content,
      created_at: new Date().toISOString(),
    };
    addMessage(userMsg);

    // TODO(C2): replace with OpenAI orchestrator call
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      execution_id: null,
      role: "assistant",
      content: `Echo: ${content}`,
      created_at: new Date().toISOString(),
    };
    addMessage(reply);
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-background p-4">
        <div className="mx-auto max-w-3xl">
          <CommandInput onSubmit={handleSubmit} />
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
