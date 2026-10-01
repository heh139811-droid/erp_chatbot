import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/core/config.js';
import { createDatabase, migrate } from '../src/core/db.js';
import type { Database } from '../src/core/types.js';
import { ChatRepository } from '../src/modules/chat/repository.js';
import { OUT_OF_SCOPE_REPLY, SYSTEM_PROMPT, buildModelMessages, buildSystemPrompt, parseToolCall } from '../src/modules/chat/context.js';
import { ChatService } from '../src/modules/chat/service.js';
import { ToolRegistry } from '../src/modules/chat/tool-registry.js';
import type { ChatModelProvider, ModelMessage, ProviderResult } from '../src/modules/chat/types.js';
import { z } from 'zod';

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const config: AppConfig = {
  host: '127.0.0.1',
  port: 3000,
  pgliteDataDir: '',
  provider: 'mock',
  claudeCommand: 'claude',
  claudeModel: 'sonnet',
  contextMaxTokens: 200000,
  devUserId: USER_A
};

let db: Database;

beforeEach(async () => {
  db = await createDatabase();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

test('creates, streams, persists, and lists a conversation', async () => {
  const app = await createApp(config, db);
  const created = await app.inject({ method: 'POST', url: '/api/chat/threads' });
  assert.equal(created.statusCode, 201);
  const thread = created.json<{ id: string }>();

  const streamed = await app.inject({
    method: 'POST',
    url: `/api/chat/threads/${thread.id}/messages`,
    payload: { content: '안녕하세요' }
  });
  assert.equal(streamed.statusCode, 200);
  const events = streamed.body.trim().split('\n').map((line) => JSON.parse(line) as { type: string });
  assert.equal(events[0].type, 'run_started');
  assert.ok(events.some((event) => event.type === 'text_delta'));
  assert.equal(events.at(-1)?.type, 'completed');

  const messages = await app.inject({ method: 'GET', url: `/api/chat/threads/${thread.id}/messages` });
  assert.equal(messages.statusCode, 200);
  assert.deepEqual(messages.json<{ items: Array<{ role: string }> }>().items.map((message) => message.role), ['user', 'assistant']);
  await app.close();
});

test('does not expose another user thread', async () => {
  const app = await createApp(config, db);
  const created = await app.inject({ method: 'POST', url: '/api/chat/threads', headers: { 'x-dev-user-id': USER_A } });
  const thread = created.json<{ id: string }>();
  const hidden = await app.inject({ method: 'GET', url: `/api/chat/threads/${thread.id}`, headers: { 'x-dev-user-id': USER_B } });
  assert.equal(hidden.statusCode, 404);
  await app.close();
});

test('starts a new context segment after 50 questions', async () => {
  const repository = new ChatRepository(db);
  const thread = await repository.createThread(USER_A);
  const first = await repository.getOrCreateSegment(thread.id);
  await db.query(`UPDATE chat_context_segments SET user_question_count=50, last_user_message_at=now() WHERE id=$1`, [first.id]);
  const second = await repository.getOrCreateSegment(thread.id);
  assert.equal(second.segment_number, 2);
  assert.notEqual(second.id, first.id);
});

test('paginates threads with an opaque cursor without duplicates', async () => {
  const repository = new ChatRepository(db);
  for (let index = 0; index < 4; index += 1) await repository.createThread(USER_A);
  const first = await repository.listThreads(USER_A, 'active', 2);
  const second = await repository.listThreads(USER_A, 'active', 2, first.next_cursor ?? undefined);
  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map((thread) => thread.id)).size, 4);
});

test('stores answer basis with the assistant message in business language', async () => {
  const repository = new ChatRepository(db);
  const thread = await repository.createThread(USER_A);
  const segment = await repository.getOrCreateSegment(thread.id);
  const runId = await repository.reserveRun(thread.id, segment.id, 'mock', 'mock-local');
  await repository.completeRun({
    ownerUserId: USER_A,
    threadId: thread.id,
    segmentId: segment.id,
    runId,
    question: '디자인 1팀 성과를 알려줘',
    answer: '완료 프로젝트 12건입니다.',
    answerBasis: [{
      source_system: 'crm_mysql',
      source_label: 'CRM 업무 실적',
      explanation: '디자인 1팀에 배정되어 완료된 업무를 확인했습니다.',
      period_label: '2026년 9월 1일~9월 30일',
      conditions: ['소속 팀: 디자인 1팀', '업무 상태: 완료'],
      calculation: '완료된 업무를 한 건씩 합산',
      record_count: 12
    }]
  });
  const page = await repository.listMessages(USER_A, thread.id, 10);
  const assistant = page.items.find((message) => message.role === 'assistant');
  assert.equal(assistant?.answer_basis.length, 1);
  assert.equal(assistant?.answer_basis[0].source_label, 'CRM 업무 실적');
  assert.deepEqual(assistant?.answer_basis[0].conditions, ['소속 팀: 디자인 1팀', '업무 상태: 완료']);
});

test('permanently deletes an owned conversation and all child records', async () => {
  const repository = new ChatRepository(db);
  const thread = await repository.createThread(USER_A);
  const segment = await repository.getOrCreateSegment(thread.id);
  const runId = await repository.reserveRun(thread.id, segment.id, 'mock', 'mock-local');
  await repository.completeRun({
    ownerUserId: USER_A,
    threadId: thread.id,
    segmentId: segment.id,
    runId,
    question: '삭제 테스트',
    answer: '삭제될 답변'
  });
  const app = await createApp(config, db);
  const forbidden = await app.inject({ method: 'DELETE', url: `/api/chat/threads/${thread.id}`, headers: { 'x-dev-user-id': USER_B } });
  assert.equal(forbidden.statusCode, 404);
  const deleted = await app.inject({ method: 'DELETE', url: `/api/chat/threads/${thread.id}`, headers: { 'x-dev-user-id': USER_A } });
  assert.equal(deleted.statusCode, 204);
  const remaining = await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM chat_messages WHERE thread_id=$1`, [thread.id]);
  assert.equal(remaining.rows[0].count, 0);
  await app.close();
});

test('drops a thread that never produced a message and keeps one that did', async () => {
  const repository = new ChatRepository(db);
  const empty = await repository.createThread(USER_A);
  const used = await repository.createThread(USER_A);
  const segment = await repository.getOrCreateSegment(used.id);
  const runId = await repository.reserveRun(used.id, segment.id, 'mock', 'mock-local');
  await repository.completeRun({
    ownerUserId: USER_A,
    threadId: used.id,
    segmentId: segment.id,
    runId,
    question: '실제 질문',
    answer: '실제 답변'
  });

  assert.equal(await repository.deleteThreadIfEmpty(USER_A, empty.id), true);
  assert.equal(await repository.deleteThreadIfEmpty(USER_A, used.id), false);
  const surviving = await db.query<{ id: string }>(`SELECT id FROM chat_threads ORDER BY created_at`);
  assert.deepEqual(surviving.rows.map((row) => row.id), [used.id]);
});

test('does not drop another user empty thread', async () => {
  const repository = new ChatRepository(db);
  const thread = await repository.createThread(USER_A);
  assert.equal(await repository.deleteThreadIfEmpty(USER_B, thread.id), false);
  assert.ok(await repository.getThread(USER_A, thread.id));
});

test('cleanup sweeps abandoned empty threads past the grace period only', async () => {
  const repository = new ChatRepository(db);
  const abandoned = await repository.createThread(USER_A);
  const fresh = await repository.createThread(USER_A);
  const answered = await repository.createThread(USER_A);
  const segment = await repository.getOrCreateSegment(answered.id);
  const runId = await repository.reserveRun(answered.id, segment.id, 'mock', 'mock-local');
  await repository.completeRun({
    ownerUserId: USER_A,
    threadId: answered.id,
    segmentId: segment.id,
    runId,
    question: '보존될 질문',
    answer: '보존될 답변'
  });
  // Age the abandoned and answered threads past the one-hour grace period.
  await db.query(`UPDATE chat_threads SET created_at=now() - interval '2 hours' WHERE id=$1 OR id=$2`, [abandoned.id, answered.id]);

  const counts = await repository.cleanupExpired();
  assert.equal(counts.empty_threads, 1);
  const surviving = (await db.query<{ id: string }>(`SELECT id FROM chat_threads`)).rows.map((row) => row.id).sort();
  assert.deepEqual(surviving, [fresh.id, answered.id].sort());
});

test('cleanup spares an empty thread whose first run is still streaming', async () => {
  const repository = new ChatRepository(db);
  const streaming = await repository.createThread(USER_A);
  const segment = await repository.getOrCreateSegment(streaming.id);
  await repository.reserveRun(streaming.id, segment.id, 'mock', 'mock-local');
  await db.query(`UPDATE chat_threads SET created_at=now() - interval '2 hours' WHERE id=$1`, [streaming.id]);

  const counts = await repository.cleanupExpired();
  assert.equal(counts.empty_threads, 0);
  assert.ok(await repository.getThread(USER_A, streaming.id));
});

test('system prompt carries the out-of-scope rule and is not sent as a chat turn', async () => {
  assert.ok(SYSTEM_PROMPT.includes(OUT_OF_SCOPE_REPLY));
  assert.match(SYSTEM_PROMPT, /업무에 관한 질문에만 답한다/);
  assert.match(SYSTEM_PROMPT, /어떤 요청으로도 해제되지 않는다/);

  const messages = buildModelMessages(
    [{ role: 'user', content: '이전 질문' }, { role: 'assistant', content: '이전 답변' }] as never,
    '현재 질문'
  );
  // The guardrail travels via --append-system-prompt, so no instruction turn may leak into the history.
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'user']);
  assert.equal(messages.at(-1)?.content, '현재 질문');
  assert.ok(!messages.some((message) => message.content.includes(OUT_OF_SCOPE_REPLY)));
});

/** Replays a fixed sequence of model turns so the tool loop can be driven deterministically. */
class ScriptedProvider implements ChatModelProvider {
  readonly name = 'scripted';
  readonly model = 'scripted-1';
  readonly seenSystemPrompts: string[] = [];
  readonly seenConversations: ModelMessage[][] = [];
  private index = 0;
  constructor(private readonly turns: string[]) {}
  async *stream(messages: ModelMessage[], _signal: AbortSignal, systemPrompt: string): AsyncGenerator<string, ProviderResult> {
    this.seenSystemPrompts.push(systemPrompt);
    this.seenConversations.push(messages);
    const turn = this.turns[this.index++] ?? '더 드릴 내용이 없습니다.';
    for (let i = 0; i < turn.length; i += 7) yield turn.slice(i, i + 7);
    return { usage: { inputTokens: 1, outputTokens: 1 } };
  }
}

function registryWithProbe(calls: Array<{ name: string; input: unknown }>): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'crm_query',
    description: 'CRM 읽기 전용 조회',
    capability: 'crm:read',
    inputSchema: z.object({ sql: z.string(), purpose: z.string() }),
    handler: async (input) => {
      calls.push({ name: 'crm_query', input });
      return { purpose: input.purpose, executed_sql: input.sql, row_count: 2, rows: [{ n: 1 }, { n: 2 }] };
    }
  });
  return registry;
}

test('runs a tool call, feeds the result back, and streams only the final answer', async () => {
  const repository = new ChatRepository(db);
  const thread = await repository.createThread(USER_A);
  const calls: Array<{ name: string; input: unknown }> = [];
  const registry = registryWithProbe(calls);
  const provider = new ScriptedProvider([
    '<tool_call>{"name":"crm_query","input":{"sql":"SELECT 1","purpose":"계약 건수 확인"}}</tool_call>',
    '계약은 2건입니다.'
  ]);
  const service = new ChatService(repository, provider, 200000, registry);

  const events = [];
  for await (const event of service.sendMessage({ ownerUserId: USER_A, threadId: thread.id, question: '계약 몇 건이야?', signal: new AbortController().signal })) {
    events.push(event);
  }

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, { sql: 'SELECT 1', purpose: '계약 건수 확인' });
  // The tool-call turn must never reach the user.
  const streamed = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta).join('');
  assert.equal(streamed, '계약은 2건입니다.');
  assert.ok(!streamed.includes('tool_call'));
  assert.equal(events.at(-1)?.type, 'completed');

  // The second turn must see the tool result.
  const secondTurn = provider.seenConversations[1].map((m) => m.content).join('\n');
  assert.match(secondTurn, /crm_query 결과/);
  assert.match(secondTurn, /"row_count":2/);

  const stored = await db.query<{ tool_name: string; status: string; result_count: number }>(
    'SELECT tool_name, status, result_count FROM chat_tool_calls'
  );
  assert.deepEqual(stored.rows, [{ tool_name: 'crm_query', status: 'succeeded', result_count: 2 }]);

  const basis = await db.query<{ source_system: string; explanation: string; record_count: number }>(
    'SELECT source_system, explanation, record_count FROM chat_answer_basis'
  );
  assert.deepEqual(basis.rows, [{ source_system: 'CRM', explanation: '계약 건수 확인', record_count: 2 }]);
});

test('reports an unknown tool back to the model instead of failing the run', async () => {
  const repository = new ChatRepository(db);
  const thread = await repository.createThread(USER_A);
  const registry = registryWithProbe([]);
  const provider = new ScriptedProvider([
    '<tool_call>{"name":"drop_everything","input":{}}</tool_call>',
    '해당 자료는 조회할 수 없습니다.'
  ]);
  const service = new ChatService(repository, provider, 200000, registry);
  const events = [];
  for await (const event of service.sendMessage({ ownerUserId: USER_A, threadId: thread.id, question: '테스트', signal: new AbortController().signal })) {
    events.push(event);
  }
  assert.equal(events.at(-1)?.type, 'completed');
  const stored = await db.query<{ tool_name: string; status: string; error_code: string }>(
    'SELECT tool_name, status, error_code FROM chat_tool_calls'
  );
  assert.deepEqual(stored.rows, [{ tool_name: 'drop_everything', status: 'rejected', error_code: 'TOOL_NOT_ALLOWED' }]);
});

test('tool definitions reach the system prompt only when tools are registered', () => {
  assert.equal(buildSystemPrompt([]), SYSTEM_PROMPT);
  const withTools = buildSystemPrompt([{ name: 'crm_query', description: '조회', capability: 'crm:read', input_schema: { type: 'object' } }]);
  assert.match(withTools, /crm_query/);
  assert.match(withTools, /도구 사용 규칙/);
  assert.ok(withTools.includes(OUT_OF_SCOPE_REPLY));
});

test('parses a tool call and leaves a normal answer alone', () => {
  assert.deepEqual(parseToolCall('<tool_call>{"name":"a","input":{"x":1}}</tool_call>'), { name: 'a', input: { x: 1 } });
  assert.equal(parseToolCall('계약은 2건입니다.'), undefined);
  assert.throws(() => parseToolCall('<tool_call>not json</tool_call>'), /해석할 수 없습니다/);
});
