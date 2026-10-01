import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/core/config.js';
import { createDatabase, migrate } from '../src/core/db.js';
import type { Database } from '../src/core/types.js';
import { ChatRepository } from '../src/modules/chat/repository.js';

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

