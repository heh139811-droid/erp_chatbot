import { createApp } from './app.js';
import { loadConfig } from './core/config.js';
import { createDatabase, migrate } from './core/db.js';
import { createCrmDatabase } from './core/crm-db.js';

const config = loadConfig();
const db = await createDatabase(config.databaseUrl, config.pgliteDataDir);
await migrate(db);
const crmDb = config.crm ? await createCrmDatabase(config.crm) : undefined;
const app = await createApp(config, db, crmDb);

const shutdown = async () => {
  await app.close();
  await db.close();
  await crmDb?.close();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
await app.listen({ host: config.host, port: config.port });
