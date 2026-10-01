import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import type { CrmConfig } from './config.js';

export interface CrmDatabase {
  query<T extends RowDataPacket>(sql: string, params?: readonly CrmValue[]): Promise<T[]>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export type CrmValue = string | number | boolean | Date | Buffer | null;

export async function createCrmDatabase(config: CrmConfig): Promise<CrmDatabase> {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionLimit: config.connectionLimit,
    waitForConnections: true,
    enableKeepAlive: true,
    charset: 'utf8mb4',
    multipleStatements: false
  });
  const database = wrapPool(pool);
  await database.ping();
  return database;
}

function wrapPool(pool: Pool): CrmDatabase {
  return {
    query: async <T extends RowDataPacket>(sql: string, params: readonly CrmValue[] = []) => {
      assertReadOnly(sql);
      const [rows] = await pool.execute<T[]>(sql, [...params]);
      return rows;
    },
    ping: async () => {
      const connection = await pool.getConnection();
      try {
        await connection.ping();
      } finally {
        connection.release();
      }
    },
    close: () => pool.end()
  };
}

function assertReadOnly(sql: string): void {
  const normalized = sql.trim().replace(/^\/\*[\s\S]*?\*\//, '').trimStart();
  if (!/^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(normalized)) {
    throw Object.assign(new Error('CRM datasource only allows read operations'), { code: 'CRM_WRITE_BLOCKED' });
  }
  if (/\b(INTO\s+(OUTFILE|DUMPFILE)|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE)\b/i.test(normalized)) {
    throw Object.assign(new Error('Unsafe CRM read operation blocked'), { code: 'CRM_UNSAFE_QUERY' });
  }
}
