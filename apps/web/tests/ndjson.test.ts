import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNdjson } from '../src/chat/utils/ndjson.js';

test('parses NDJSON split across transport chunks', async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"type":"run_'));
      controller.enqueue(encoder.encode('started"}\n{"type":"text_delta","delta":"안녕"}\n'));
      controller.close();
    }
  });
  const values: unknown[] = [];
  for await (const value of parseNdjson(new Response(body))) values.push(value);
  assert.deepEqual(values, [
    { type: 'run_started' },
    { type: 'text_delta', delta: '안녕' }
  ]);
});

