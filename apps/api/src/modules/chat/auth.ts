import type { FastifyRequest } from 'fastify';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveUserId(request: FastifyRequest, fallbackUserId: string): string {
  const sessionUserId = (request as FastifyRequest & { user?: { id?: unknown } }).user?.id;
  const developmentOverride = request.headers['x-dev-user-id'];
  const candidate = process.env.NODE_ENV === 'production'
    ? sessionUserId
    : (typeof developmentOverride === 'string' ? developmentOverride : sessionUserId ?? fallbackUserId);
  const value = typeof candidate === 'string' ? candidate : '';
  if (!UUID_PATTERN.test(value)) throw Object.assign(new Error('Authentication required'), { statusCode: 401, code: 'AUTH_REQUIRED' });
  return value;
}
