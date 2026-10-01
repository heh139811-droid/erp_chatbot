import { randomUUID } from 'node:crypto';
import type { Database, Queryable } from '../../core/types.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import type { ChatMessage, ChatThread, ContextSegment, CursorPage, NewAnswerBasis, ThreadStatus } from './types.js';

/** 한 대화 구간이 유지되는 총 시간. 무활동 시간이 아니라 시작부터의 경과 시간이다. */
const SESSION_WINDOW_MS = 6 * 60 * 60 * 1000;

export class ChatRepository {
  constructor(private readonly db: Database) {}

  async createThread(ownerUserId: string): Promise<ChatThread> {
    const id = randomUUID();
    const result = await this.db.query<ChatThread>(
      `INSERT INTO chat_threads(id, owner_user_id) VALUES($1, $2) RETURNING *`,
      [id, ownerUserId]
    );
    return result.rows[0];
  }

  async getThread(ownerUserId: string, threadId: string): Promise<ChatThread | undefined> {
    return (await this.db.query<ChatThread>(
      `SELECT * FROM chat_threads WHERE id=$1 AND owner_user_id=$2`,
      [threadId, ownerUserId]
    )).rows[0];
  }

  async listThreads(ownerUserId: string, status: ThreadStatus, limit: number, cursorValue?: string): Promise<CursorPage<ChatThread>> {
    const cursor = decodeCursor(cursorValue);
    const params: unknown[] = [ownerUserId, status, limit + 1];
    const cursorSql = cursor ? `AND (last_activity_at, id) < ($4::timestamptz, $5::uuid)` : '';
    if (cursor) params.push(cursor.timestamp, cursor.id);
    const rows = (await this.db.query<ChatThread>(
      `SELECT * FROM chat_threads
       WHERE owner_user_id=$1 AND status=$2
         AND created_at >= now() - interval '30 days'
         ${cursorSql}
       ORDER BY last_activity_at DESC, id DESC
       LIMIT $3`,
      params
    )).rows;
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor({ timestamp: last.last_activity_at, id: last.id }) : null
    };
  }

  async updateThreadStatus(ownerUserId: string, threadId: string, status: ThreadStatus): Promise<ChatThread | undefined> {
    return (await this.db.query<ChatThread>(
      `UPDATE chat_threads SET status=$3, updated_at=now() WHERE id=$1 AND owner_user_id=$2 RETURNING *`,
      [threadId, ownerUserId, status]
    )).rows[0];
  }

  async deleteThread(ownerUserId: string, threadId: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM chat_threads WHERE id=$1 AND owner_user_id=$2`,
      [threadId, ownerUserId]
    );
    return result.rowCount > 0;
  }

  /** Drops a thread that never produced a message, so an abandoned "새 대화" leaves nothing behind. */
  async deleteThreadIfEmpty(ownerUserId: string, threadId: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM chat_threads
       WHERE id=$1 AND owner_user_id=$2
         AND NOT EXISTS (SELECT 1 FROM chat_messages WHERE thread_id=$1)`,
      [threadId, ownerUserId]
    );
    return result.rowCount > 0;
  }

  async listMessages(ownerUserId: string, threadId: string, limit: number, cursorValue?: string): Promise<CursorPage<ChatMessage>> {
    const cursor = decodeCursor(cursorValue);
    const params: unknown[] = [threadId, ownerUserId, limit + 1];
    const cursorSql = cursor ? `AND (m.created_at, m.id) < ($4::timestamptz, $5::uuid)` : '';
    if (cursor) params.push(cursor.timestamp, cursor.id);
    const rows = (await this.db.query<ChatMessage>(
      `SELECT m.*,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', b.id,
                  'source_system', b.source_system,
                  'source_label', b.source_label,
                  'explanation', b.explanation,
                  'period_label', b.period_label,
                  'conditions', b.conditions,
                  'calculation', b.calculation,
                  'record_count', b.record_count,
                  'queried_at', b.queried_at
                ) ORDER BY b.created_at)
                FROM chat_answer_basis b
                WHERE b.message_id=m.id
              ), '[]'::json) AS answer_basis
       FROM chat_messages m
       JOIN chat_threads t ON t.id=m.thread_id
       WHERE m.thread_id=$1 AND t.owner_user_id=$2 ${cursorSql}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $3`,
      params
    )).rows;
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.reverse(),
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor({ timestamp: last.created_at, id: last.id }) : null
    };
  }

  async searchThreads(ownerUserId: string, query: string, limit: number): Promise<Array<Pick<ChatThread, 'id' | 'title' | 'last_activity_at'> & { summary_preview: string }>> {
    const pattern = `%${query}%`;
    return (await this.db.query<Pick<ChatThread, 'id' | 'title' | 'last_activity_at'> & { summary_preview: string }>(
      `SELECT t.id, t.title, t.last_activity_at,
              COALESCE(s.handoff_summary, '') AS summary_preview
       FROM chat_threads t
       LEFT JOIN LATERAL (
         SELECT handoff_summary FROM chat_context_segments
         WHERE thread_id=t.id AND handoff_summary IS NOT NULL
         ORDER BY segment_number DESC LIMIT 1
       ) s ON true
       WHERE t.owner_user_id=$1
         AND t.created_at >= now() - interval '30 days'
         AND (t.title ILIKE $2 OR COALESCE(s.handoff_summary, '') ILIKE $2)
       ORDER BY t.last_activity_at DESC
       LIMIT $3`,
      [ownerUserId, pattern, limit]
    )).rows;
  }

  async getOrCreateSegment(threadId: string): Promise<ContextSegment> {
    const latest = (await this.db.query<ContextSegment>(
      `SELECT * FROM chat_context_segments WHERE thread_id=$1 ORDER BY segment_number DESC LIMIT 1`,
      [threadId]
    )).rows[0];
    if (!latest) return this.createSegment(threadId, 1);

    // 한 세션은 구간이 시작된 시점부터 총 6시간이다. 중간에 쉬었는지는 따지지 않는다.
    const sessionExpired = Date.now() - new Date(latest.started_at).getTime() >= SESSION_WINDOW_MS;
    const questionLimitReached = latest.user_question_count >= 50;
    if (!sessionExpired && !questionLimitReached) return latest;

    const reason = sessionExpired ? 'session_6h' : 'question_limit';
    await this.db.query(
      `UPDATE chat_context_segments SET ended_at=now(), end_reason=$2 WHERE id=$1`,
      [latest.id, reason]
    );
    return this.createSegment(threadId, latest.segment_number + 1, questionLimitReached ? latest.handoff_summary : null);
  }

  private async createSegment(threadId: string, segmentNumber: number, summary: string | null = null): Promise<ContextSegment> {
    const id = randomUUID();
    return (await this.db.query<ContextSegment>(
      `INSERT INTO chat_context_segments(id, thread_id, segment_number, handoff_summary)
       VALUES($1, $2, $3, $4) RETURNING *`,
      [id, threadId, segmentNumber, summary]
    )).rows[0];
  }

  async getRecentContext(threadId: string, segmentId: string, maxTokens: number): Promise<ChatMessage[]> {
    const rows = (await this.db.query<ChatMessage>(
      `SELECT * FROM chat_messages
       WHERE thread_id=$1 AND segment_id=$2 AND created_at >= now() - interval '7 days'
       ORDER BY created_at DESC, id DESC LIMIT 200`,
      [threadId, segmentId]
    )).rows;
    const budgetCharacters = Math.floor(maxTokens * 0.8 * 3);
    let used = 0;
    const selected: ChatMessage[] = [];
    for (const message of rows) {
      if (used + message.content.length > budgetCharacters) break;
      selected.push(message);
      used += message.content.length;
    }
    return selected.reverse();
  }

  async reserveRun(threadId: string, segmentId: string, provider: string, model: string): Promise<string> {
    const id = randomUUID();
    try {
      await this.db.query(
        `INSERT INTO chat_runs(id, thread_id, segment_id, provider, model, status)
         VALUES($1, $2, $3, $4, $5, 'running')`,
        [id, threadId, segmentId, provider, model]
      );
      return id;
    } catch (error) {
      if (String(error).includes('chat_runs_one_active_per_thread_idx')) {
        throw Object.assign(new Error('Run already active'), { statusCode: 409, code: 'RUN_ALREADY_ACTIVE' });
      }
      throw error;
    }
  }

  /** Records one tool invocation for the answer-basis panel and for auditing. */
  async recordToolCall(input: {
    runId: string;
    toolName: string;
    targetRefs?: unknown[];
    resultCount?: number;
    status: 'succeeded' | 'failed' | 'rejected';
    durationMs: number;
    errorCode?: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO chat_tool_calls(id, run_id, tool_name, target_refs, result_count, status, duration_ms, error_code)
       VALUES($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
      [
        randomUUID(),
        input.runId,
        input.toolName,
        JSON.stringify(input.targetRefs ?? []),
        input.resultCount ?? null,
        input.status,
        input.durationMs,
        input.errorCode ?? null
      ]
    );
  }

  async markFirstToken(runId: string): Promise<void> {
    await this.db.query(`UPDATE chat_runs SET first_token_at=COALESCE(first_token_at, now()) WHERE id=$1`, [runId]);
  }

  async completeRun(input: {
    ownerUserId: string;
    threadId: string;
    segmentId: string;
    runId: string;
    question: string;
    answer: string;
    inputTokens?: number;
    outputTokens?: number;
    answerBasis?: NewAnswerBasis[];
  }): Promise<string> {
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO chat_messages(id, thread_id, segment_id, run_id, role, content, created_at)
         VALUES
           ($1, $3, $4, $5, 'user', $6, now()),
           ($2, $3, $4, $5, 'assistant', $7, now() + interval '1 microsecond')`,
        [userMessageId, assistantMessageId, input.threadId, input.segmentId, input.runId, input.question, input.answer]
      );
      await tx.query(
        `UPDATE chat_runs SET status='completed', completed_at=now(), input_tokens=$2, output_tokens=$3 WHERE id=$1`,
        [input.runId, input.inputTokens ?? null, input.outputTokens ?? null]
      );
      for (const basis of input.answerBasis ?? []) {
        await tx.query(
          `INSERT INTO chat_answer_basis(
             id, message_id, source_system, source_label, explanation,
             period_label, conditions, calculation, record_count, queried_at
           ) VALUES($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, COALESCE($10::timestamptz, now()))`,
          [
            randomUUID(), assistantMessageId, basis.source_system, basis.source_label, basis.explanation,
            basis.period_label, JSON.stringify(basis.conditions), basis.calculation, basis.record_count,
            basis.queried_at ?? null
          ]
        );
      }
      await tx.query(
        `UPDATE chat_context_segments
         SET user_question_count=user_question_count+1, last_user_message_at=now()
         WHERE id=$1`,
        [input.segmentId]
      );
      await tx.query(
        `UPDATE chat_threads
         SET title=CASE WHEN title='새 대화' THEN $3 ELSE title END,
             updated_at=now(), last_activity_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [input.threadId, input.ownerUserId, titleFromQuestion(input.question)]
      );
    });
    return assistantMessageId;
  }

  async failRun(runId: string, code: string): Promise<void> {
    await this.db.query(`UPDATE chat_runs SET status='failed', completed_at=now(), error_code=$2 WHERE id=$1`, [runId, code]);
  }

  async cancelRun(runId: string, threadId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM chat_pending_actions WHERE thread_id=$1 AND status IN ('awaiting_clarification', 'ready')`, [threadId]);
      await tx.query(`DELETE FROM chat_runs WHERE id=$1 AND status='running'`, [runId]);
    });
  }

  async cleanupExpired(): Promise<Record<string, number>> {
    return this.db.transaction(async (tx) => {
      const pending = await tx.query(`DELETE FROM chat_pending_actions WHERE expires_at < now()`);
      const threads = await tx.query(`DELETE FROM chat_threads WHERE created_at < now() - interval '30 days'`);
      // Sweeps threads abandoned before their first message (tab closed mid-run, crashed stream).
      // The grace period keeps a run that is still streaming its first answer.
      const emptyThreads = await tx.query(
        `DELETE FROM chat_threads t
         WHERE t.created_at < now() - interval '1 hour'
           AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.thread_id = t.id)
           AND NOT EXISTS (SELECT 1 FROM chat_runs r WHERE r.thread_id = t.id AND r.status = 'running')`
      );
      // 메시지와 실행 기록은 chat_threads 의 ON DELETE CASCADE 로 함께 지워진다.
      // 나이로 따로 지우면 아직 보존 기간이 남은 대화의 앞부분만 사라져 이력에 구멍이 생긴다.
      return { pending: pending.rowCount, threads: threads.rowCount, empty_threads: emptyThreads.rowCount };
    });
  }
}

function titleFromQuestion(question: string): string {
  const normalized = question.replace(/\s+/g, ' ').trim();
  return normalized.length <= 36 ? normalized : `${normalized.slice(0, 35)}…`;
}
