import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../core/config.js';
import { resolveUserId } from './auth.js';
import { ChatRepository } from './repository.js';
import { ChatService } from './service.js';

const threadParams = z.object({ threadId: z.string().uuid() });

export function registerChatRoutes(app: FastifyInstance, dependencies: {
  config: AppConfig;
  repository: ChatRepository;
  service: ChatService;
}): void {
  const { config, repository, service } = dependencies;

  app.post('/api/chat/threads', async (request, reply) => {
    const userId = resolveUserId(request, config.devUserId);
    return reply.code(201).send(await repository.createThread(userId));
  });

  app.get('/api/chat/threads', async (request) => {
    const userId = resolveUserId(request, config.devUserId);
    const query = z.object({
      cursor: z.string().optional(),
      status: z.enum(['active', 'archived']).default('active'),
      limit: z.coerce.number().int().min(1).max(100).default(30)
    }).parse(request.query);
    return repository.listThreads(userId, query.status, query.limit, query.cursor);
  });

  app.get('/api/chat/threads/search', async (request) => {
    const userId = resolveUserId(request, config.devUserId);
    const query = z.object({ q: z.string().trim().min(1), limit: z.coerce.number().int().min(1).max(5).default(5) }).parse(request.query);
    return { items: await repository.searchThreads(userId, query.q, query.limit) };
  });

  app.get('/api/chat/threads/:threadId', async (request) => {
    const userId = resolveUserId(request, config.devUserId);
    const { threadId } = threadParams.parse(request.params);
    const thread = await repository.getThread(userId, threadId);
    if (!thread) throw Object.assign(new Error('Thread not found'), { statusCode: 404, code: 'THREAD_NOT_FOUND' });
    return thread;
  });

  app.get('/api/chat/threads/:threadId/messages', async (request) => {
    const userId = resolveUserId(request, config.devUserId);
    const { threadId } = threadParams.parse(request.params);
    const query = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    const thread = await repository.getThread(userId, threadId);
    if (!thread) throw Object.assign(new Error('Thread not found'), { statusCode: 404, code: 'THREAD_NOT_FOUND' });
    return repository.listMessages(userId, threadId, query.limit, query.cursor);
  });

  app.patch('/api/chat/threads/:threadId', async (request) => {
    const userId = resolveUserId(request, config.devUserId);
    const { threadId } = threadParams.parse(request.params);
    const body = z.object({ status: z.enum(['active', 'archived']) }).parse(request.body);
    const thread = await repository.updateThreadStatus(userId, threadId, body.status);
    if (!thread) throw Object.assign(new Error('Thread not found'), { statusCode: 404, code: 'THREAD_NOT_FOUND' });
    return thread;
  });

  app.post('/api/chat/threads/:threadId/messages', async (request, reply) => {
    const userId = resolveUserId(request, config.devUserId);
    const { threadId } = threadParams.parse(request.params);
    const { content } = z.object({ content: z.string().trim().min(1).max(20000) }).parse(request.body);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once('aborted', abort);
    reply.raw.once('close', () => {
      if (!reply.raw.writableEnded) abort();
    });
    await streamResponse(reply, service.sendMessage({ ownerUserId: userId, threadId, question: content, signal: controller.signal }));
    request.raw.removeListener('aborted', abort);
  });
}

async function streamResponse(reply: FastifyReply, events: AsyncIterable<unknown>): Promise<void> {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-content-type-options': 'nosniff'
  });
  try {
    for await (const event of events) {
      if (reply.raw.destroyed) break;
      reply.raw.write(`${JSON.stringify(event)}\n`);
    }
  } finally {
    if (!reply.raw.destroyed) reply.raw.end();
  }
}
