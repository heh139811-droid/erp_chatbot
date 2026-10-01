import { z } from 'zod';
import type { ChatRepository } from './repository.js';
import type { ToolDefinition, ToolRegistry } from './tool-registry.js';

const MAX_THREADS = 10;
const DEFAULT_THREADS = 5;
const MAX_MESSAGES = 60;
const DEFAULT_MESSAGES = 30;

/** Accepts a plain date (2026-10-01) or a full timestamp, so the model can reason in either. */
const timestamp = z.string().trim().regex(
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/,
  '날짜는 2026-10-01 또는 2026-10-01T09:00 형식으로 적는다.'
);

export function registerHistoryTools(registry: ToolRegistry, repository: ChatRepository): void {
  for (const tool of createHistoryTools(repository)) registry.register(tool);
}

export function createHistoryTools(repository: ChatRepository): Array<ToolDefinition<never, unknown>> {
  const search: ToolDefinition<{ query?: string; from?: string; to?: string; limit?: number }, unknown> = {
    name: 'chat_search_history',
    description: [
      '사용자 본인의 지난 대화를 찾는다. 보존 기간인 최근 30일 안의 대화만 대상이며 현재 대화는 제외된다.',
      '"어제 뭐 물어봤지", "저번에 계약 관련해서 뭐라고 했더라" 같은 질문에 쓴다.',
      'query 로 내용을 검색하거나, from/to 로 기간을 좁히거나, 둘을 함께 쓸 수 있다.',
      '둘 다 생략하면 최근 대화부터 돌려준다. 각 대화마다 앞부분 메시지 일부가 함께 온다.'
    ].join(' '),
    capability: 'chat:history:read',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(200).optional().describe('대화 제목이나 메시지 내용에서 찾을 문자열'),
      from: timestamp.optional().describe('이 시각 이후에 마지막으로 사용한 대화만 (예: 어제를 찾으려면 어제 00:00)'),
      to: timestamp.optional().describe('이 시각 이전에 마지막으로 사용한 대화만 (예: 어제를 찾으려면 오늘 00:00)'),
      limit: z.coerce.number().int().min(1).max(MAX_THREADS).optional().describe(`돌려받을 대화 수 (기본 ${DEFAULT_THREADS})`)
    }),
    handler: async (input, context) => {
      const threads = await repository.searchHistory(context.ownerUserId, {
        query: input.query,
        from: input.from,
        to: input.to,
        excludeThreadId: context.currentThreadId,
        limit: input.limit ?? DEFAULT_THREADS
      });
      return {
        found: threads.length,
        note: threads.length === 0
          ? '조건에 맞는 지난 대화가 없다. 보존 기간은 30일이며 그 이전 대화는 삭제된다.'
          : '전체 내용이 필요하면 chat_read_conversation 에 thread_id 를 넘겨 읽는다.',
        conversations: threads
      };
    }
  };

  const read: ToolDefinition<{ thread_id: string; limit?: number }, unknown> = {
    name: 'chat_read_conversation',
    description: 'chat_search_history 로 찾은 지난 대화 하나의 내용을 읽는다. 본인 대화만, 최근 30일 안에서만 읽을 수 있다.',
    capability: 'chat:history:read',
    inputSchema: z.object({
      thread_id: z.string().uuid().describe('chat_search_history 가 돌려준 thread_id'),
      limit: z.coerce.number().int().min(1).max(MAX_MESSAGES).optional().describe(`읽을 최근 메시지 수 (기본 ${DEFAULT_MESSAGES})`)
    }),
    handler: async (input, context) => {
      if (input.thread_id === context.currentThreadId) {
        throw Object.assign(new Error('지금 진행 중인 대화입니다. 이미 문맥에 들어 있으므로 따로 읽을 필요가 없습니다.'), { code: 'HISTORY_CURRENT_THREAD' });
      }
      const conversation = await repository.readConversation(context.ownerUserId, input.thread_id, input.limit ?? DEFAULT_MESSAGES);
      if (!conversation) {
        throw Object.assign(new Error('그 대화를 찾을 수 없습니다. 삭제되었거나 보존 기간 30일이 지났을 수 있습니다.'), { code: 'HISTORY_NOT_FOUND' });
      }
      return { thread_id: input.thread_id, ...conversation, message_count: conversation.messages.length };
    }
  };

  return [search, read] as unknown as Array<ToolDefinition<never, unknown>>;
}
