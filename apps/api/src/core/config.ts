import { resolve } from 'node:path';
import { DEFAULT_TIME_ZONE } from './db.js';

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl?: string;
  pgliteDataDir: string;
  timeZone: string;
  /** 보존 기간이 지난 데이터를 지우는 주기. 0 이면 내부 타이머를 띄우지 않는다. */
  cleanupIntervalMs: number;
  provider: 'mock' | 'claude-cli';
  claudeCommand: string;
  claudeModel: string;
  contextMaxTokens: number;
  devUserId: string;
  crm?: CrmConfig;
}

export interface CrmConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionLimit: number;
}

export function loadConfig(): AppConfig {
  const provider = process.env.CHAT_PROVIDER ?? 'claude-cli';
  if (provider !== 'mock' && provider !== 'claude-cli') {
    throw new Error(`Unsupported CHAT_PROVIDER: ${provider}`);
  }

  const crmEnabled = (process.env.CRM_MYSQL_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true';
  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL || undefined,
    pgliteDataDir: resolve(process.env.PGLITE_DATA_DIR ?? '.data/chat'),
    timeZone: process.env.DB_TIME_ZONE ?? DEFAULT_TIME_ZONE,
    cleanupIntervalMs: Number(process.env.CLEANUP_INTERVAL_MS ?? 24 * 60 * 60 * 1000),
    provider,
    claudeCommand: process.env.CLAUDE_COMMAND ?? 'claude',
    claudeModel: process.env.CLAUDE_MODEL ?? 'sonnet',
    contextMaxTokens: Number(process.env.CHAT_CONTEXT_MAX_TOKENS ?? 200000),
    devUserId: process.env.DEV_USER_ID ?? '00000000-0000-4000-8000-000000000001',
    crm: crmEnabled ? {
      host: process.env.CRM_MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.CRM_MYSQL_PORT ?? 3306),
      database: process.env.CRM_MYSQL_DATABASE ?? 'crm',
      user: process.env.CRM_MYSQL_USER ?? 'root',
      password: process.env.CRM_MYSQL_PASSWORD ?? '',
      connectionLimit: Number(process.env.CRM_MYSQL_CONNECTION_LIMIT ?? 5)
    } : undefined
  };
}
