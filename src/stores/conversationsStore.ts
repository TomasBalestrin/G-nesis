import { create } from "zustand";

import {
  createConversation as bridgeCreate,
  deleteConversation as bridgeDelete,
  listConversations as bridgeList,
  renameConversation as bridgeRename,
} from "@/lib/tauri-bridge";
import type { Conversation } from "@/types/chat";

interface ConversationsState {
  items: Conversation[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Refresh the full list from the backend. */
  refresh: () => Promise<void>;
  /** Ensure the list has been loaded at least once — cheap on subsequent calls. */
  ensureLoaded: () => Promise<void>;
  /** Create a new conversation, prepend it to the list, and return it. */
  create: (title?: string | null) => Promise<Conversation | null>;
  /** Delete the conversation and remove from the list (cascade wipes messages). */
  remove: (id: string) => Promise<void>;
  /** Rename a conversation in-place and re-sort. */
  rename: (id: string, title: string) => Promise<void>;
  /** Patch a single row locally (e.g. after an auto-title turns around). */
  upsert: (conversation: Conversation) => void;
}

function sortByUpdatedDesc(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export const useConversationsStore = create<ConversationsState>((set, get) => ({
  items: [],
  loading: false,
  loaded: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const items = await bridgeList();
      set({ items: sortByUpdatedDesc(items), loading: false, loaded: true });
    } catch (err) {
      set({
        loading: false,
        loaded: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async ensureLoaded() {
    if (get().loaded || get().loading) return;
    await get().refresh();
  },

  async create(title) {
    try {
      const conversation = await bridgeCreate({ title: title ?? null });
      set((state) => ({
        items: sortByUpdatedDesc([conversation, ...state.items]),
      }));
      return conversation;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  async remove(id) {
    await bridgeDelete({ id });
    set((state) => ({ items: state.items.filter((c) => c.id !== id) }));
  },

  async rename(id, title) {
    const updated = await bridgeRename({ id, title });
    set((state) => ({
      items: sortByUpdatedDesc(
        state.items.map((c) => (c.id === id ? updated : c)),
      ),
    }));
  },

  upsert(conversation) {
    set((state) => {
      const exists = state.items.some((c) => c.id === conversation.id);
      const items = exists
        ? state.items.map((c) => (c.id === conversation.id ? conversation : c))
        : [conversation, ...state.items];
      return { items: sortByUpdatedDesc(items) };
    });
  },
}));
