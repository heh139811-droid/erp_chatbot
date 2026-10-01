import { createApp } from './app.js';
import { startCleanupScheduler } from './core/cleanup-scheduler.js';
import { loadConfig } from './core/config.js';
import { createDatabase, migrate } from './core/db.js';
import { createCrmDatabase } from './core/crm-db.js';
import { ChatRepository } from './modules/chat/repository.js';

const config = loadConfig();
const db = await createDatabase(config.databaseUrl, config.pgliteDataDir, config.timeZone);
await migrate(db);
const crmDb = config.crm ? await createCrmDatabase(config.crm) : undefined;
const app = await createApp(config, db, crmDb);

// 보존 기간 삭제는 이 프로세스가 직접 돌린다. 첫 회를 바로 실행해 서버가 꺼져 있던
// 동안 지나간 주기를 메운다.
const cleanup = config.cleanupIntervalMs > 0
  ? startCleanupScheduler(new ChatRepository(db), config.cleanupIntervalMs)
  : undefined;
void cleanup?.runOnce();

const shutdown = async () => {
  cleanup?.stop();
  await app.close();
  await db.close();
  await crmDb?.close();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
await app.listen({ host: config.host, port: config.port });
