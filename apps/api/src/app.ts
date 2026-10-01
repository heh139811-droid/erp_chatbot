import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { AppConfig } from './core/config.js';
import type { Database } from './core/types.js';
import type { CrmDatabase } from './core/crm-db.js';
import { CrmRepository } from './modules/crm/repository.js';
import { registerCrmRoutes } from './modules/crm/routes.js';
import { ChatRepository } from './modules/chat/repository.js';
import { ClaudeCliProvider, MockChatProvider } from './modules/chat/provider.js';
import { registerChatRoutes } from './modules/chat/routes.js';
import { ChatService } from './modules/chat/service.js';
import { ToolRegistry } from './modules/chat/tool-registry.js';
import { registerCrmTools } from './modules/crm/tools.js';

export async function createApp(config: AppConfig, db: Database, crmDb?: CrmDatabase) {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: ['http://127.0.0.1:5173', 'http://localhost:5173'], credentials: true });
  const repository = new ChatRepository(db);
  const provider = config.provider === 'claude-cli'
    ? new ClaudeCliProvider(config.claudeModel, config.claudeCommand)
    : new MockChatProvider();
  const tools = new ToolRegistry();
  if (crmDb) registerCrmTools(tools, crmDb);
  const service = new ChatService(repository, provider, config.contextMaxTokens, tools);
  registerChatRoutes(app, { config, repository, service });
  if (crmDb) registerCrmRoutes(app, config, new CrmRepository(crmDb));

  app.get('/api/health', async () => ({
    ok: true,
    provider: provider.name,
    crm: crmDb ? 'connected' : 'disabled',
    tools: tools.list().map((tool) => tool.name)
  }));
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error instanceof ZodError ? 400 : Number((error as { statusCode?: number }).statusCode ?? 500);
    const code = error instanceof ZodError ? 'INVALID_INPUT' : String((error as { code?: string }).code ?? 'INTERNAL_ERROR');
    const message = error instanceof Error ? error.message : '요청을 처리할 수 없습니다.';
    if (statusCode >= 500) app.log.error(error);
    reply.code(statusCode).send({ code, message: statusCode >= 500 ? '서버 오류가 발생했습니다.' : message });
  });
  return app;
}
