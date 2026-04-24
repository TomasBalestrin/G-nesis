import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";

import { useToast } from "@/hooks/useToast";
import { useConversationsStore } from "@/stores/conversationsStore";

/**
 * Landing redirect for `/`. If at least one conversation exists, jumps into
 * the most recently updated one; otherwise creates a brand-new thread and
 * navigates into it. Renders a blank placeholder while the async flow runs.
 */
export function ChatIndexRedirect() {
  const items = useConversationsStore((s) => s.items);
  const loaded = useConversationsStore((s) => s.loaded);
  const ensureLoaded = useConversationsStore((s) => s.ensureLoaded);
  const create = useConversationsStore((s) => s.create);
  const { toast } = useToast();
  const creatingRef = useRef(false);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  useEffect(() => {
    if (!loaded || items.length > 0 || creatingRef.current) return;
    creatingRef.current = true;
    create().then((c) => {
      if (!c) {
        toast({
          title: "Falha ao iniciar conversa",
          variant: "destructive",
        });
        creatingRef.current = false;
      }
    });
  }, [loaded, items.length, create, toast]);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-2)]">
        Carregando conversas...
      </div>
    );
  }

  if (items.length > 0) {
    return <Navigate to={`/chat/${items[0].id}`} replace />;
  }

  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--text-2)]">
      Criando conversa...
    </div>
  );
}
