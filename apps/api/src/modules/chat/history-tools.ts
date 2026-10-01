import { z } from 'zod';
import type { ChatRepository } from './repository.js';
import type { ToolDefinition, ToolRegistry } from './tool-registry.js';

/** architecture.md 5: 검색 결과는 최대 5건, 상세는 별도 호출로 가져온다. */
const MAX_RESULTS = 5;
const RECENT_MESSAGES = 5;

/** Accepts a plain date (2026-10-01) or a timestamp, so the model can reason in either. */
const timestamp = z.string().trim().regex(
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/,
  '날짜는 2026-10-01 또는 2026-10-01T09:00 형식으로 적는다.'
);

export function registerHistoryTools(registry: ToolRegistry, repository: ChatRepository): void {
  for (const tool of createHistoryTools(repository)) registry.register(tool);
}

export function createHistoryTools(repository: ChatRepository): Array<ToolDefinition<never, unknown>> {
  const search: ToolDefinition<{ query?: string; from?: string; to?: string; limit?: number }, unknown> = {
    name: 'search_my_conversations',
    description: [
      '사용자 본인의 지난 대화를 찾는다. 보존 기간인 최근 30일 안의 대화만 대상이며 현재 대화는 제외된다.',
      '"지난번 A브랜드 얘기 이어서 해줘", "어제 뭐 물어봤지" 같은 질문에 쓴다.',
      'query 는 대화 제목과 구간 요약에서 찾는다. 기간만으로 찾으려면 query 를 생략하고 from/to 만 준다.',
      `최대 ${MAX_RESULTS}건까지 돌려주며, 제목과 마지막 활동 시각, 요약 미리보기만 온다.`,
      '대화 내용이 필요하면 get_conversation_context 를 따로 호출한다.'
    ].join(' '),
    capability: 'chat:history:read',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(200).optional().describe('대화 제목이나 구간 요약에서 찾을 문자열'),
      from: timestamp.optional().describe('이 시각 이후에 마지막으로 사용한 대화만 (어제를 찾으려면 어제 00:00)'),
      to: timestamp.optional().describe('이 시각 이전에 마지막으로 사용한 대화만 (어제를 찾으려면 오늘 00:00)'),
      limit: z.coerce.number().int().min(1).max(MAX_RESULTS).optional().describe(`돌려받을 대화 수 (기본 ${MAX_RESULTS})`)
    }),
    handler: async (input, context) => {
      const conversations = await repository.searchMyConversations(context.ownerUserId, {
        query: input.query,
        from: input.from,
        to: input.to,
        excludeThreadId: context.currentThreadId,
        limit: input.limit ?? MAX_RESULTS
      });
      return {
        found: conversations.length,
        note: conversations.length === 0
          ? '조건에 맞는 지난 대화가 없다. 검색은 대화 제목과 구간 요약만 보므로, 기간으로 다시 찾아보거나 없다고 answer 한다. 보존 기간은 30일이다.'
          : '내용이 필요하면 get_conversation_context 에 thread_id 를 넘긴다.',
        conversations
      };
    }
  };

  const context_: ToolDefinition<{ thread_id: string }, unknown> = {
    name: 'get_conversation_context',
    description: `search_my_conversations 로 찾은 지난 대화 하나의 문맥을 가져온다. 구간 요약과 참조 대상, 최근 메시지 ${RECENT_MESSAGES}개가 온다. 본인 대화만, 최근 30일 안에서만 읽을 수 있다.`,
    capability: 'chat:history:read',
    inputSchema: z.object({
      thread_id: z.string().uuid().describe('search_my_conversations 가 돌려준 thread_id')
    }),
    handler: async (input, context) => {
      if (input.thread_id === context.currentThreadId) {
        throw Object.assign(new Error('지금 진행 중인 대화입니다. 이미 문맥에 들어 있으므로 따로 읽을 필요가 없습니다.'), { code: 'HISTORY_CURRENT_THREAD' });
      }
      const conversation = await repository.getConversationContext(context.ownerUserId, input.thread_id, RECENT_MESSAGES);
      if (!conversation) {
        throw Object.assign(new Error('그 대화를 찾을 수 없습니다. 삭제되었거나 보존 기간 30일이 지났을 수 있습니다.'), { code: 'HISTORY_NOT_FOUND' });
      }
      return { thread_id: input.thread_id, ...conversation, message_count: conversation.recent_messages.length };
    }
  };

  return [search, context_] as unknown as Array<ToolDefinition<never, unknown>>;
}
