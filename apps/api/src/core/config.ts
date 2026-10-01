import { resolve } from 'node:path';

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl?: string;
  pgliteDataDir: string;
  provider: 'mock' | 'claude-cli';
  claudeCommand: string;
  claudeModel: string;
  contextMaxTokens: number;
  devUserId: string;
}

export function loadConfig(): AppConfig {
  const provider = process.env.CHAT_PROVIDER ?? 'claude-cli';
  if (provider !== 'mock' && provider !== 'claude-cli') {
    throw new Error(`Unsupported CHAT_PROVIDER: ${provider}`);
  }

  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL || undefined,
    pgliteDataDir: resolve(process.env.PGLITE_DATA_DIR ?? '.data/chat'),
    provider,
    claudeCommand: process.env.CLAUDE_COMMAND ?? 'claude',
    claudeModel: process.env.CLAUDE_MODEL ?? 'sonnet',
    contextMaxTokens: Number(process.env.CHAT_CONTEXT_MAX_TOKENS ?? 200000),
    devUserId: process.env.DEV_USER_ID ?? '00000000-0000-4000-8000-000000000001'
  };
}
