import type { RowDataPacket } from 'mysql2/promise';
import type { CrmDatabase } from '../../core/crm-db.js';

interface StatusRow extends RowDataPacket {
  database_name: string;
  version: string;
  table_count: number;
  view_count: number;
  total_bytes: number;
}

export class CrmRepository {
  constructor(private readonly db: CrmDatabase) {}

  async status(): Promise<{
    connected: true;
    database: string;
    version: string;
    tables: number;
    views: number;
    size_bytes: number;
  }> {
    const rows = await this.db.query<StatusRow>(
      `SELECT DATABASE() AS database_name,
              VERSION() AS version,
              SUM(TABLE_TYPE = 'BASE TABLE') AS table_count,
              SUM(TABLE_TYPE = 'VIEW') AS view_count,
              COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) AS total_bytes
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()`
    );
    const row = rows[0];
    return {
      connected: true,
      database: row.database_name,
      version: row.version,
      tables: Number(row.table_count),
      views: Number(row.view_count),
      size_bytes: Number(row.total_bytes)
    };
  }
}
