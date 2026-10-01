export interface PageCursor {
  timestamp: string;
  id: string;
}

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(value?: string): PageCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<PageCursor>;
    if (typeof parsed.timestamp !== 'string' || typeof parsed.id !== 'string') throw new Error('Invalid cursor');
    return { timestamp: parsed.timestamp, id: parsed.id };
  } catch {
    throw Object.assign(new Error('Invalid cursor'), { statusCode: 400, code: 'INVALID_INPUT' });
  }
}

