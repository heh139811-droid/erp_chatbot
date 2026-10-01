import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { ChatMessage, ChatThread, ConversationSearchResult } from '../types';

export function useChat() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const [searchResults, setSearchResults] = useState<ConversationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const loadThreads = useCallback(async (reset = false) => {
    if (loadingThreads || (!reset && !hasMore)) return;
    setLoadingThreads(true);
    try {
      const page = await api.listThreads({ cursor: reset ? undefined : nextCursor ?? undefined });
      setThreads((current) => reset ? page.items : mergeThreads(current, page.items));
      setNextCursor(page.next_cursor);
      setHasMore(page.has_more);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoadingThreads(false);
    }
  }, [hasMore, loadingThreads, nextCursor]);

  useEffect(() => { void loadThreads(true); }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const selectThread = useCallback(async (threadId: string) => {
    setSelectedThreadId(threadId);
    setError(undefined);
    try {
      const page = await api.listMessages(threadId);
      setMessages(page.items);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  /**
   * Starts a new conversation locally only. The thread row is written on the first
   * message (see `send`), so an abandoned "새 대화" never reaches the database.
   */
  const startNewThread = useCallback(() => {
    abortRef.current?.abort();
    setSelectedThreadId(undefined);
    setMessages([]);
    setError(undefined);
  }, []);

  const deleteThread = useCallback(async (threadId: string) => {
    try {
      if (selectedThreadId === threadId) abortRef.current?.abort();
      await api.deleteThread(threadId);
      setThreads((current) => current.filter((thread) => thread.id !== threadId));
      setSearchResults((current) => current.filter((thread) => thread.id !== threadId));
      if (selectedThreadId === threadId) {
        setSelectedThreadId(undefined);
        setMessages([]);
      }
    } catch (cause) {
      setError(messageOf(cause));
      throw cause;
    }
  }, [selectedThreadId]);

  const searchThreads = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      setSearchResults(await api.searchThreads(query));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSearching(false);
    }
  }, []);

  const loadMoreThreads = useCallback(() => loadThreads(false), [loadThreads]);

  const send = useCallback(async (content: string) => {
    if (streaming) return;
    const temporaryThreadId = selectedThreadId ?? `pending-thread-${crypto.randomUUID()}`;
    const optimisticUserId = `pending-user-${crypto.randomUUID()}`;
    const optimisticAssistantId = `pending-assistant-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    setMessages((current) => [
      ...current,
      { id: optimisticUserId, thread_id: temporaryThreadId, role: 'user', content, created_at: now, pending: true },
      { id: optimisticAssistantId, thread_id: temporaryThreadId, role: 'assistant', content: '', created_at: now, pending: true }
    ]);
    setStreaming(true);
    setError(undefined);
    const controller = new AbortController();
    abortRef.current = controller;
    let createdThreadId: string | undefined;
    try {
      let threadId = selectedThreadId;
      if (!threadId) {
        const thread = await api.createThread();
        createdThreadId = thread.id;
        threadId = thread.id;
        setSelectedThreadId(thread.id);
        setThreads((current) => [thread, ...current]);
      }
      for await (const event of api.sendMessage(threadId, content, controller.signal)) {
        if (event.type === 'text_delta') {
          setMessages((current) => current.map((message) => message.id === optimisticAssistantId
            ? { ...message, content: message.content + event.delta }
            : message));
        }
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'completed') {
          const page = await api.listMessages(threadId);
          setMessages(page.items);
          await loadThreads(true);
        }
      }
    } catch (cause) {
      setMessages((current) => current.filter((message) => message.id !== optimisticUserId && message.id !== optimisticAssistantId));
      // The server drops a thread whose first answer never landed; mirror that here.
      if (createdThreadId) {
        const abandonedId = createdThreadId;
        setThreads((current) => current.filter((thread) => thread.id !== abandonedId));
        setSelectedThreadId((current) => current === abandonedId ? undefined : current);
      }
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(messageOf(cause));
    } finally {
      setStreaming(false);
      abortRef.current = undefined;
    }
  }, [loadThreads, selectedThreadId, streaming]);

  return {
    threads,
    selectedThreadId,
    messages,
    hasMore,
    loadingThreads,
    streaming,
    error,
    searchResults,
    searching,
    loadMoreThreads,
    selectThread,
    startNewThread,
    deleteThread,
    searchThreads,
    send
  };
}

function mergeThreads(current: ChatThread[], incoming: ChatThread[]): ChatThread[] {
  const seen = new Set(current.map((thread) => thread.id));
  return [...current, ...incoming.filter((thread) => !seen.has(thread.id))];
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : '알 수 없는 오류가 발생했습니다.';
}
