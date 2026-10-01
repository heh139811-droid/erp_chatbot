import { loadConfig } from './core/config.js';
import { createDatabase, migrate } from './core/db.js';

const config = loadConfig();
const db = await createDatabase(config.databaseUrl, config.pgliteDataDir);
try {
  await migrate(db);
  console.info('Chat migrations applied.');
} finally {
  await db.close();
}

