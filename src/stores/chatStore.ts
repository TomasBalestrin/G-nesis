import { create } from "zustand";

import type { ChatMessage } from "@/types/chat";

interface ChatState {
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),
  clear: () => set({ messages: [] }),
}));
