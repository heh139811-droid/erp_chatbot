import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import type { CrmDatabase } from '../../core/crm-db.js';
import type { ToolDefinition } from '../chat/tool-registry.js';
import type { ToolRegistry } from '../chat/tool-registry.js';

/** Hard ceilings. The model picks what to read; these decide how much it may read. */
const MAX_ROWS = 200;
const DEFAULT_ROWS = 50;
const STATEMENT_TIMEOUT_MS = 5_000;
const MAX_RESULT_CHARS = 12_000;

interface TableRow extends RowDataPacket {
  TABLE_NAME: string;
  TABLE_COMMENT: string;
  TABLE_ROWS: number | null;
}

interface ColumnRow extends RowDataPacket {
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: string;
  COLUMN_KEY: string;
  COLUMN_COMMENT: string;
}

const identifier = z.string().trim().regex(/^[A-Za-z0-9_]{1,64}$/, '테이블 이름은 영문자·숫자·밑줄만 쓸 수 있습니다.');

export function registerCrmTools(registry: ToolRegistry, db: CrmDatabase): void {
  for (const tool of createCrmTools(db)) registry.register(tool);
}

export function createCrmTools(db: CrmDatabase): Array<ToolDefinition<never, unknown>> {
  const listTables: ToolDefinition<{ name_contains?: string }, unknown> = {
    name: 'crm_list_tables',
    description: 'CRM 데이터베이스의 테이블 목록을 조회한다. 각 테이블의 설명과 추정 행 수(approx_rows)를 함께 돌려준다. 추정치이므로 정확한 건수는 crm_query 로 COUNT(*) 를 조회해야 한다. 어떤 테이블을 봐야 할지 모를 때 가장 먼저 쓴다.',
    capability: 'crm:read',
    inputSchema: z.object({
      name_contains: z.string().trim().min(1).max(64).optional().describe('테이블 이름에 포함된 문자열로 거른다. 생략하면 전체를 돌려준다.')
    }),
    handler: async ({ name_contains }) => {
      const rows = await db.query<TableRow>(
        `SELECT TABLE_NAME, TABLE_COMMENT, TABLE_ROWS
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_TYPE = 'BASE TABLE'
            AND (? IS NULL OR TABLE_NAME LIKE CONCAT('%', ?, '%'))
          ORDER BY TABLE_ROWS DESC
          LIMIT ${MAX_ROWS}`,
        [name_contains ?? null, name_contains ?? '']
      );
      return {
        table_count: rows.length,
        note: 'approx_rows 는 엔진이 추정한 값이라 정확하지 않다. 정확한 건수가 필요하면 crm_query 로 COUNT(*) 를 조회한다.',
        tables: rows.map((row) => ({ table: row.TABLE_NAME, description: row.TABLE_COMMENT || null, approx_rows: Number(row.TABLE_ROWS ?? 0) }))
      };
    }
  };

  const describeTable: ToolDefinition<{ table: string }, unknown> = {
    name: 'crm_describe_table',
    description: '테이블 하나의 컬럼 구조를 조회한다. 컬럼 이름, 자료형, 설명, 키 여부를 돌려준다. crm_query 로 조회하기 전에 컬럼을 확인할 때 쓴다.',
    capability: 'crm:read',
    inputSchema: z.object({ table: identifier.describe('조회할 테이블 이름') }),
    handler: async ({ table }) => {
      const rows = await db.query<ColumnRow>(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_COMMENT
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION`,
        [table]
      );
      if (rows.length === 0) throw Object.assign(new Error(`존재하지 않는 테이블입니다: ${table}`), { code: 'CRM_TABLE_NOT_FOUND' });
      return {
        table,
        columns: rows.map((row) => ({
          column: row.COLUMN_NAME,
          type: row.COLUMN_TYPE,
          nullable: row.IS_NULLABLE === 'YES',
          key: row.COLUMN_KEY || null,
          description: row.COLUMN_COMMENT || null
        }))
      };
    }
  };

  const query: ToolDefinition<{ sql: string; limit?: number; purpose: string }, unknown> = {
    name: 'crm_query',
    description: [
      'CRM 데이터베이스에 읽기 전용 SELECT 를 실행한다.',
      'SELECT 만 허용되며 쓰기·잠금·파일 출력은 거부된다.',
      `결과는 최대 ${MAX_ROWS}행으로 잘린다. 집계가 필요하면 SQL 안에서 GROUP BY 로 집계해서 가져온다.`,
      '세미콜론으로 여러 문을 넣을 수 없다.'
    ].join(' '),
    capability: 'crm:read',
    inputSchema: z.object({
      sql: z.string().trim().min(1).max(4000).describe('실행할 SELECT 문 하나'),
      limit: z.coerce.number().int().min(1).max(MAX_ROWS).optional().describe(`돌려받을 최대 행 수 (기본 ${DEFAULT_ROWS})`),
      purpose: z.string().trim().min(1).max(200).describe('이 조회로 확인하려는 내용을 한 문장으로 적는다. 답변 근거로 사용자에게 표시된다.')
    }),
    handler: async ({ sql, limit, purpose }) => {
      const statement = assertSingleSelect(sql);
      const rowLimit = limit ?? DEFAULT_ROWS;
      const rows = await db.query<RowDataPacket>(
        `SELECT /*+ MAX_EXECUTION_TIME(${STATEMENT_TIMEOUT_MS}) */ * FROM (${statement}) AS _crm_scoped LIMIT ${rowLimit}`
      );
      const result = {
        purpose,
        executed_sql: statement,
        row_count: rows.length,
        truncated: rows.length >= rowLimit,
        rows: rows.map(normalizeRow)
      };
      return capSize(result);
    }
  };

  return [listTables, describeTable, query] as unknown as Array<ToolDefinition<never, unknown>>;
}

/** Rejects anything that is not exactly one SELECT, before the connection-level read-only guard sees it. */
function assertSingleSelect(sql: string): string {
  const statement = sql.trim().replace(/;\s*$/, '');
  if (statement.includes(';')) {
    throw Object.assign(new Error('한 번에 하나의 SELECT 문만 실행할 수 있습니다.'), { code: 'CRM_MULTIPLE_STATEMENTS' });
  }
  if (!/^SELECT\b/i.test(statement) && !/^WITH\b/i.test(statement)) {
    throw Object.assign(new Error('SELECT 문만 실행할 수 있습니다.'), { code: 'CRM_WRITE_BLOCKED' });
  }
  return statement;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) output[key] = value.toISOString();
    else if (typeof value === 'bigint') output[key] = Number(value);
    else if (Buffer.isBuffer(value)) output[key] = `<binary ${value.length}B>`;
    else output[key] = value;
  }
  return output;
}

/** Keeps one tool result from eating the whole context window. */
function capSize<T extends { rows: unknown[] }>(result: T): T | (Omit<T, 'rows'> & { rows: unknown[]; note: string }) {
  if (JSON.stringify(result).length <= MAX_RESULT_CHARS) return result;
  const kept: unknown[] = [];
  for (const row of result.rows) {
    kept.push(row);
    if (JSON.stringify({ ...result, rows: kept }).length > MAX_RESULT_CHARS) {
      kept.pop();
      break;
    }
  }
  return { ...result, rows: kept, note: `결과가 커서 ${kept.length}행만 돌려줬습니다. 더 좁은 조건이나 집계 쿼리를 쓰세요.` };
}
