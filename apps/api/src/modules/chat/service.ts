import {
  SUMMARY_SYSTEM_PROMPT,
  buildModelMessages,
  buildSummaryRequest,
  buildSystemPrompt,
  mayBecomeToolCall,
  parseToolCall,
  renderToolError,
  renderToolResult
} from './context.js';
import { ChatRepository } from './repository.js';
import { ToolRegistry, type ToolContext } from './tool-registry.js';
import type { ChatMessage, ChatModelProvider, ModelMessage, NewAnswerBasis, ProviderResult, StreamEvent } from './types.js';

/** How many tool hops one question may take before the model must answer with what it has. */
const MAX_TOOL_ITERATIONS = 6;

export class ChatService {
  constructor(
    private readonly repository: ChatRepository,
    private readonly provider: ChatModelProvider,
    private readonly contextMaxTokens: number,
    private readonly tools: ToolRegistry = new ToolRegistry()
  ) {}

  async *sendMessage(input: {
    ownerUserId: string;
    threadId: string;
    question: string;
    signal: AbortSignal;
  }): AsyncGenerator<StreamEvent> {
    const thread = await this.repository.getThread(input.ownerUserId, input.threadId);
    if (!thread) throw notFound();
    const segment = await this.repository.getOrCreateSegment(thread.id, (messages) => this.summarizeSegment(messages, input.signal));
    const history = await this.repository.getRecentContext(thread.id, segment.id, this.contextMaxTokens);
    const runId = await this.repository.reserveRun(thread.id, segment.id, this.provider.name, this.provider.model);
    yield { type: 'run_started', run_id: runId };

    const systemPrompt = buildSystemPrompt(this.tools.specs(), new Date(), segment.handoff_summary);
    const conversation = buildModelMessages(history, input.question);
    const answerBasis: NewAnswerBasis[] = [];

    let answer = '';
    let firstToken = true;
    try {
      let usage: ProviderResult | undefined;

      for (let iteration = 0; ; iteration += 1) {
        const lastHop = iteration >= MAX_TOOL_ITERATIONS;
        const turn = this.runTurn(conversation, input.signal, lastHop ? withFinalAnswerNudge(systemPrompt) : systemPrompt);

        let buffered = '';
        let streaming = false;
        while (true) {
          const next = await turn.next();
          if (next.done) {
            usage = next.value;
            break;
          }
          buffered += next.value;
          // Hold the output back only while it could still turn out to be a tool call.
          if (!streaming && !mayBecomeToolCall(buffered)) {
            streaming = true;
            if (firstToken) {
              firstToken = false;
              await this.repository.markFirstToken(runId);
            }
            answer += buffered;
            yield { type: 'text_delta', run_id: runId, delta: buffered };
            continue;
          }
          if (streaming) {
            answer += next.value;
            yield { type: 'text_delta', run_id: runId, delta: next.value };
          }
        }

        if (streaming) break;

        const call = parseToolCall(buffered);
        if (!call) {
          // A short turn that never left the buffer: emit it as the answer.
          if (firstToken) {
            firstToken = false;
            await this.repository.markFirstToken(runId);
          }
          answer += buffered;
          if (buffered) yield { type: 'text_delta', run_id: runId, delta: buffered };
          break;
        }

        conversation.push({ role: 'assistant', content: buffered.trim() });
        const outcome = await this.invokeTool(runId, call.name, call.input, { ownerUserId: input.ownerUserId, currentThreadId: thread.id });
        conversation.push({ role: 'user', content: outcome.rendered });
        if (outcome.basis) answerBasis.push(outcome.basis);
      }

      if (!answer.trim()) throw new Error('Provider returned an empty response');
      const messageId = await this.repository.completeRun({
        ownerUserId: input.ownerUserId,
        threadId: thread.id,
        segmentId: segment.id,
        runId,
        question: input.question,
        answer,
        answerBasis,
        inputTokens: usage?.usage?.inputTokens,
        outputTokens: usage?.usage?.outputTokens
      });
      yield { type: 'completed', run_id: runId, message_id: messageId };
    } catch (error) {
      if (input.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        await this.repository.cancelRun(runId, thread.id);
        await this.repository.deleteThreadIfEmpty(input.ownerUserId, thread.id);
        return;
      }
      // The client only sees a generic message, so the real cause (auth, model, CLI) must reach the server log.
      console.error(JSON.stringify({
        event: 'chat_provider_failed',
        run_id: runId,
        thread_id: thread.id,
        provider: this.provider.name,
        model: this.provider.model,
        message: error instanceof Error ? error.message : String(error)
      }));
      await this.repository.failRun(runId, 'PROVIDER_ERROR');
      await this.repository.deleteThreadIfEmpty(input.ownerUserId, thread.id);
      yield { type: 'error', run_id: runId, code: 'PROVIDER_ERROR', message: '현재 답변을 생성할 수 없습니다.' };
    }
  }

  /**
   * Condenses a segment that hit the 50 question limit so the next one can keep going.
   * Never blocks the user's question: a failure here just means no handoff text.
   */
  private async summarizeSegment(messages: ChatMessage[], signal: AbortSignal): Promise<string | null> {
    if (messages.length === 0) return null;
    try {
      const stream = this.provider.stream(buildSummaryRequest(messages), signal, SUMMARY_SYSTEM_PROMPT);
      let summary = '';
      while (true) {
        const next = await stream.next();
        if (next.done) break;
        summary += next.value;
      }
      return summary.trim() || null;
    } catch (error) {
      if (signal.aborted) return null;
      console.error(JSON.stringify({
        event: 'chat_handoff_summary_failed',
        provider: this.provider.name,
        model: this.provider.model,
        message: error instanceof Error ? error.message : String(error)
      }));
      return null;
    }
  }

  private runTurn(conversation: ModelMessage[], signal: AbortSignal, systemPrompt: string) {
    return this.provider.stream([...conversation], signal, systemPrompt);
  }

  /** Runs one tool and turns both success and failure into something the model can read. */
  private async invokeTool(runId: string, name: string, input: unknown, context: ToolContext): Promise<{ rendered: string; basis?: NewAnswerBasis }> {
    const startedAt = Date.now();
    if (!this.tools.has(name)) {
      await this.repository.recordToolCall({
        runId, toolName: name, status: 'rejected', durationMs: Date.now() - startedAt, errorCode: 'TOOL_NOT_ALLOWED'
      });
      return { rendered: renderToolError(name, `허용되지 않은 도구입니다: ${name}`) };
    }
    try {
      const result = await this.tools.execute(name, input, context);
      const rowCount = readRowCount(result);
      await this.repository.recordToolCall({
        runId, toolName: name, status: 'succeeded', resultCount: rowCount, durationMs: Date.now() - startedAt
      });
      return { rendered: renderToolResult(name, result), basis: toAnswerBasis(name, input, result, rowCount) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.recordToolCall({
        runId,
        toolName: name,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        errorCode: String((error as { code?: string }).code ?? 'TOOL_FAILED')
      });
      return { rendered: renderToolError(name, message) };
    }
  }
}

function withFinalAnswerNudge(systemPrompt: string): string {
  return `${systemPrompt}\n\n[중요] 도구 호출 한도에 도달했다. 이번에는 도구를 호출하지 말고 지금까지 확인한 내용만으로 최종 답변을 작성한다.`;
}

function readRowCount(result: unknown): number | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const record = result as Record<string, unknown>;
  for (const key of ['row_count', 'table_count', 'found', 'message_count']) {
    if (typeof record[key] === 'number') return record[key] as number;
  }
  return Array.isArray(record.columns) ? record.columns.length : undefined;
}

/** Only data reads become user-visible answer basis; schema browsing does not. */
function toAnswerBasis(name: string, input: unknown, result: unknown, rowCount?: number): NewAnswerBasis | undefined {
  if (name !== 'crm_query') return undefined;
  const request = (typeof input === 'object' && input !== null ? input : {}) as { purpose?: unknown; sql?: unknown };
  const executed = (typeof result === 'object' && result !== null ? result : {}) as { executed_sql?: unknown };
  const sql = typeof executed.executed_sql === 'string' ? executed.executed_sql : typeof request.sql === 'string' ? request.sql : '';
  return {
    source_system: 'CRM',
    source_label: 'CRM 데이터베이스',
    explanation: typeof request.purpose === 'string' && request.purpose ? request.purpose : 'CRM 데이터 조회',
    period_label: null,
    conditions: sql ? [sql] : [],
    calculation: null,
    record_count: rowCount ?? null
  };
}

function notFound(): Error {
  return Object.assign(new Error('Thread not found'), { statusCode: 404, code: 'THREAD_NOT_FOUND' });
}
