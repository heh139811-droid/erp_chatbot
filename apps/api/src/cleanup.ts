import { loadConfig } from './core/config.js';
import { createDatabase, migrate } from './core/db.js';
import { ChatRepository } from './modules/chat/repository.js';

const config = loadConfig();
const db = await createDatabase(config.databaseUrl, config.pgliteDataDir, config.timeZone);
try {
  await migrate(db);
  const deleted = await new ChatRepository(db).cleanupExpired();
  console.info(JSON.stringify({ event: 'chat_cleanup_completed', deleted }));
} finally {
  await db.close();
}

