import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { Pool, type PoolClient } from 'pg';
import type { Database, Queryable } from './types.js';

/**
 * 세션 시간대를 고정한다. timestamptz 저장은 늘 절대 시각이라 바뀌지 않고,
 * 오프셋 없는 입력 문자열의 해석과 출력 표기만 이 기준을 따른다.
 * 모델이 넘기는 "어제 00:00" 같은 값이 한국 시각으로 읽히게 하려면 필요하다.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Seoul';

export async function createDatabase(databaseUrl?: string, dataDir?: string, timeZone: string = DEFAULT_TIME_ZONE): Promise<Database> {
  assertTimeZone(timeZone);
  if (databaseUrl) {
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      options: `-c timezone=${timeZone}`
    });
    const wrap = (client: Pool | PoolClient): Queryable => ({
      query: async <T>(sql: string, params: unknown[] = []) => {
        const result = await client.query(sql, params);
        return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
      }
    });
    return {
      dialect: 'postgres',
      ...wrap(pool),
      transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const value = await fn(wrap(client));
          await client.query('COMMIT');
          return value;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end()
    };
  }

  if (dataDir) await mkdir(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;
  // PGlite 는 연결이 하나뿐이라 세션 설정이 그대로 유지된다.
  await db.query(`SET TIME ZONE '${timeZone}'`);
  const wrap = (client: Pick<PGlite, 'query'>): Queryable => ({
    query: async <T>(sql: string, params: unknown[] = []) => {
      const result = await client.query<T>(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    }
  });
  return {
    dialect: 'pglite',
    ...wrap(db),
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close()
  };
}

/** Rejects anything that could escape the quoted SET TIME ZONE literal. */
function assertTimeZone(timeZone: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(timeZone)) {
    throw new Error(`Unsupported time zone: ${timeZone}`);
  }
}

export async function migrate(db: Database): Promise<void> {
  const directory = fileURLToPath(new URL('../../db/', import.meta.url));
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of names) {
    const sql = await readFile(`${directory}/${name}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (db.dialect === 'pglite' && sql.includes('CREATE EXTENSION IF NOT EXISTS pg_trgm')) continue;
    await db.transaction(async (tx) => {
      const existing = (await tx.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE name=$1', [name])).rows[0];
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        return;
      }
      for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
        await tx.query(statement);
      }
      await tx.query('INSERT INTO schema_migrations(name, checksum) VALUES($1, $2)', [name, checksum]);
    });
  }
}
