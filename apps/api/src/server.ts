import { createApp } from './app.js';
import { loadConfig } from './core/config.js';
import { createDatabase, migrate } from './core/db.js';

const config = loadConfig();
const db = await createDatabase(config.databaseUrl, config.pgliteDataDir);
await migrate(db);
const app = await createApp(config, db);

const shutdown = async () => {
  await app.close();
  await db.close();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
await app.listen({ host: config.host, port: config.port });

