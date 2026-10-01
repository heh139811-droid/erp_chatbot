import { buildModelMessages } from './context.js';
import { ChatRepository } from './repository.js';
import type { ChatModelProvider, ProviderResult, StreamEvent } from './types.js';

export class ChatService {
  constructor(
    private readonly repository: ChatRepository,
    private readonly provider: ChatModelProvider,
    private readonly contextMaxTokens: number
  ) {}

  async *sendMessage(input: {
    ownerUserId: string;
    threadId: string;
    question: string;
    signal: AbortSignal;
  }): AsyncGenerator<StreamEvent> {
    const thread = await this.repository.getThread(input.ownerUserId, input.threadId);
    if (!thread) throw notFound();
    const segment = await this.repository.getOrCreateSegment(thread.id);
    const history = await this.repository.getRecentContext(thread.id, segment.id, this.contextMaxTokens);
    const runId = await this.repository.reserveRun(thread.id, segment.id, this.provider.name, this.provider.model);
    yield { type: 'run_started', run_id: runId };

    let answer = '';
    let firstToken = true;
    try {
      const iterator = this.provider.stream(buildModelMessages(history, input.question), input.signal);
      let usage: ProviderResult | undefined;
      while (true) {
        const next = await iterator.next();
        if (next.done) {
          usage = next.value;
          break;
        }
        if (firstToken) {
          firstToken = false;
          await this.repository.markFirstToken(runId);
        }
        answer += next.value;
        yield { type: 'text_delta', run_id: runId, delta: next.value };
      }
      if (!answer.trim()) throw new Error('Provider returned an empty response');
      const messageId = await this.repository.completeRun({
        ownerUserId: input.ownerUserId,
        threadId: thread.id,
        segmentId: segment.id,
        runId,
        question: input.question,
        answer,
        inputTokens: usage?.usage?.inputTokens,
        outputTokens: usage?.usage?.outputTokens
      });
      yield { type: 'completed', run_id: runId, message_id: messageId };
    } catch (error) {
      if (input.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        await this.repository.cancelRun(runId, thread.id);
        return;
      }
      await this.repository.failRun(runId, 'PROVIDER_ERROR');
      yield { type: 'error', run_id: runId, code: 'PROVIDER_ERROR', message: '현재 답변을 생성할 수 없습니다.' };
    }
  }
}

function notFound(): Error {
  return Object.assign(new Error('Thread not found'), { statusCode: 404, code: 'THREAD_NOT_FOUND' });
}
