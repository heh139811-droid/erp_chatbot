export async function* parseNdjson(response: Response): AsyncGenerator<unknown> {
  if (!response.body) throw new Error('스트리밍 응답 본문이 없습니다.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as unknown;
      }
      if (done) break;
    }
    if (buffer.trim()) yield JSON.parse(buffer) as unknown;
  } finally {
    reader.releaseLock();
  }
}

