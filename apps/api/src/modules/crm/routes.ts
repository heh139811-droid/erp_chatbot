import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../core/config.js';
import { resolveUserId } from '../chat/auth.js';
import { CrmRepository } from './repository.js';

export function registerCrmRoutes(app: FastifyInstance, config: AppConfig, repository: CrmRepository): void {
  app.get('/api/crm/status', async (request) => {
    resolveUserId(request, config.devUserId);
    return repository.status();
  });
}
