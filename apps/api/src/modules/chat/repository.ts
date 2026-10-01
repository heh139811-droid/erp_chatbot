import { randomUUID } from 'node:crypto';
import type { Database, Queryable } from '../../core/types.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import type { ChatMessage, ChatThread, ContextSegment, CursorPage, ThreadStatus } from './types.js';

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
         AND last_activity_at >= now() - interval '30 days'
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

  async listMessages(ownerUserId: string, threadId: string, limit: number, cursorValue?: string): Promise<CursorPage<ChatMessage>> {
    const cursor = decodeCursor(cursorValue);
    const params: unknown[] = [threadId, ownerUserId, limit + 1];
    const cursorSql = cursor ? `AND (m.created_at, m.id) < ($4::timestamptz, $5::uuid)` : '';
    if (cursor) params.push(cursor.timestamp, cursor.id);
    const rows = (await this.db.query<ChatMessage>(
      `SELECT m.* FROM chat_messages m
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
         AND t.last_activity_at >= now() - interval '30 days'
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

    const idleExpired = latest.last_user_message_at
      ? Date.now() - new Date(latest.last_user_message_at).getTime() >= 6 * 60 * 60 * 1000
      : false;
    const questionLimitReached = latest.user_question_count >= 50;
    if (!idleExpired && !questionLimitReached) return latest;

    const reason = idleExpired ? 'idle_6h' : 'question_limit';
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
      const threads = await tx.query(`DELETE FROM chat_threads WHERE last_activity_at < now() - interval '30 days'`);
      const messages = await tx.query(`DELETE FROM chat_messages WHERE created_at < now() - interval '30 days'`);
      const runs = await tx.query(`DELETE FROM chat_runs WHERE started_at < now() - interval '30 days'`);
      return { pending: pending.rowCount, threads: threads.rowCount, messages: messages.rowCount, runs: runs.rowCount };
    });
  }
}

function titleFromQuestion(question: string): string {
  const normalized = question.replace(/\s+/g, ' ').trim();
  return normalized.length <= 36 ? normalized : `${normalized.slice(0, 35)}…`;
}
