import { create } from "zustand";

/**
 * Live chat surface state — currently scoped to the streaming-thinking
 * pipeline. Persistent message rows continue to live in component-local
 * useState within ChatPanel since they're keyed by route conversationId
 * and cheap to refetch on navigation. The store here owns only the
 * ephemeral, cross-cutting bits that react to backend events.
 */
interface ChatState {
  /** Conversation id whose turn is mid-thinking. Null when no stream is
   *  active. Used to filter incoming events from other tabs/threads. */
  thinkingConversationId: string | null;
  /** Accumulated thinking text streamed via `chat:thinking_delta`. */
  currentThinking: string;
  /** Optional summary set when `chat:thinking_complete` fires. UI uses
   *  it for the collapsed accordion header once the block is locked. */
  currentThinkingSummary: string | null;
  /** True between the first delta and the next clearThinking() call. */
  isThinking: boolean;

  /** Open the thinking buffer for a conversation. Discards stale state
   *  if the previous turn never closed cleanly. */
  startThinking: (conversationId: string | null) => void;
  /** Append a delta from `chat:thinking_delta`. */
  appendThinking: (delta: string) => void;
  /** Lock the summary from `chat:thinking_complete`. The block stays in
   *  the store until clearThinking() — it's still the active turn until
   *  the assistant message lands. */
  completeThinking: (summary: string) => void;
  /** Reset everything — called by ChatPanel after the AI roundtrip
   *  resolves and the persisted assistant message is in the list. */
  clearThinking: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  thinkingConversationId: null,
  currentThinking: "",
  currentThinkingSummary: null,
  isThinking: false,

  startThinking: (conversationId) =>
    set({
      thinkingConversationId: conversationId,
      currentThinking: "",
      currentThinkingSummary: null,
      isThinking: true,
    }),

  appendThinking: (delta) =>
    set((state) => ({
      currentThinking: state.currentThinking + delta,
      isThinking: true,
    })),

  completeThinking: (summary) =>
    set((state) => ({
      currentThinkingSummary: summary,
      // isThinking stays true — the thinking block is "done" but the
      // assistant turn isn't until clearThinking() runs.
      currentThinking: state.currentThinking,
    })),

  clearThinking: () =>
    set({
      thinkingConversationId: null,
      currentThinking: "",
      currentThinkingSummary: null,
      isThinking: false,
    }),
}));
