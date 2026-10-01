import type { ChatMessage, ChatThread, ConversationSearchResult, CursorPage, StreamEvent, ThreadStatus } from './types';
import { parseNdjson } from './utils/ndjson';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers }
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: '요청에 실패했습니다.' })) as { message?: string };
    throw new Error(error.message ?? '요청에 실패했습니다.');
  }
  return response.json() as Promise<T>;
}

export function createThread(): Promise<ChatThread> {
  return requestJson('/api/chat/threads', { method: 'POST' });
}

export function listThreads(input: { cursor?: string; status?: ThreadStatus; limit?: number } = {}): Promise<CursorPage<ChatThread>> {
  const params = new URLSearchParams({ status: input.status ?? 'active', limit: String(input.limit ?? 30) });
  if (input.cursor) params.set('cursor', input.cursor);
  return requestJson(`/api/chat/threads?${params}`);
}

export function listMessages(threadId: string, cursor?: string): Promise<CursorPage<ChatMessage>> {
  const params = new URLSearchParams({ limit: '50' });
  if (cursor) params.set('cursor', cursor);
  return requestJson(`/api/chat/threads/${threadId}/messages?${params}`);
}

export async function searchThreads(query: string): Promise<ConversationSearchResult[]> {
  if (!query.trim()) return [];
  const result = await requestJson<{ items: ConversationSearchResult[] }>(`/api/chat/threads/search?q=${encodeURIComponent(query.trim())}&limit=5`);
  return result.items;
}

export function archiveThread(threadId: string): Promise<ChatThread> {
  return requestJson(`/api/chat/threads/${threadId}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
}

export async function* sendMessage(threadId: string, content: string, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const response = await fetch(`/api/chat/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({ content }),
    signal
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: '답변 요청에 실패했습니다.' })) as { message?: string };
    throw new Error(error.message ?? '답변 요청에 실패했습니다.');
  }
  for await (const value of parseNdjson(response)) {
    if (isStreamEvent(value)) yield value;
  }
}

function isStreamEvent(value: unknown): value is StreamEvent {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}
