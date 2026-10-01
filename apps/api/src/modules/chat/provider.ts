import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ChatModelProvider, ModelMessage, ProviderResult } from './types.js';

export class MockChatProvider implements ChatModelProvider {
  readonly name = 'mock';
  readonly model = 'mock-local';

  async *stream(messages: ModelMessage[], signal: AbortSignal, _systemPrompt: string): AsyncGenerator<string, ProviderResult> {
    const question = messages.at(-1)?.content ?? '';
    const response = `질문을 확인했습니다: ${question}\n\n현재는 로컬 mock 공급자입니다. .env.local에서 CHAT_PROVIDER=claude-cli로 설정하면 Claude Code OAuth를 사용합니다.`;
    for (let index = 0; index < response.length; index += 24) {
      if (signal.aborted) throw abortError();
      await new Promise((resolve) => setTimeout(resolve, 8));
      yield response.slice(index, index + 24);
    }
    return { usage: { inputTokens: estimateTokens(messages.map((message) => message.content).join('\n')), outputTokens: estimateTokens(response) } };
  }
}

export class ClaudeCliProvider implements ChatModelProvider {
  readonly name = 'claude-cli';

  constructor(readonly model: string, private readonly command: string) {}

  async *stream(messages: ModelMessage[], signal: AbortSignal, systemPrompt: string): AsyncGenerator<string, ProviderResult> {
    const prompt = serializeMessages(messages);
    const child = spawn(this.command, [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', this.model,
      '--max-turns', '1',
      // Delivered as a real system prompt so the scope limit is not overridable from the chat turn.
      '--append-system-prompt', systemPrompt,
      '--disallowedTools', 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task'
    ], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.stdin.end(prompt);
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let emitted = '';
    let finalResult = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      for await (const line of lines) {
        if (signal.aborted) throw abortError();
        const event = parseJson(line);
        if (!event) continue;
        const delta = extractTextDelta(event);
        if (delta) {
          emitted += delta;
          yield delta;
        }
        const assistantText = extractAssistantText(event);
        if (assistantText) finalResult = assistantText;
        if (event.type === 'result') {
          if (typeof event.result === 'string') finalResult = event.result;
          const usage = isRecord(event.usage) ? event.usage : undefined;
          inputTokens = numberValue(usage?.input_tokens);
          outputTokens = numberValue(usage?.output_tokens);
          if (event.is_error === true) throw new Error(typeof event.result === 'string' ? event.result : 'Claude CLI failed');
        }
      }

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      if (exitCode !== 0) throw new Error(stderr.trim() || `Claude CLI exited with code ${exitCode}`);
      if (!emitted && finalResult) {
        for (let index = 0; index < finalResult.length; index += 48) yield finalResult.slice(index, index + 48);
      }
      return { usage: { inputTokens, outputTokens } };
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted && !child.killed) child.kill();
    }
  }
}

function serializeMessages(messages: ModelMessage[]): string {
  return messages.map((message) => `${message.role === 'user' ? '사용자' : '도우미'}: ${message.content}`).join('\n\n');
}

function parseJson(line: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function extractTextDelta(event: Record<string, unknown>): string {
  if (event.type !== 'stream_event' || !isRecord(event.event)) return '';
  const nested = event.event;
  if (nested.type !== 'content_block_delta' || !isRecord(nested.delta)) return '';
  return nested.delta.type === 'text_delta' && typeof nested.delta.text === 'string' ? nested.delta.text : '';
}

function extractAssistantText(event: Record<string, unknown>): string {
  if (event.type !== 'assistant' || !isRecord(event.message) || !Array.isArray(event.message.content)) return '';
  return event.message.content
    .filter(isRecord)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => String(block.text))
    .join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function abortError(): Error {
  return Object.assign(new Error('Request aborted'), { name: 'AbortError' });
}

