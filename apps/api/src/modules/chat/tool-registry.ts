import { z } from 'zod';

export interface ToolDefinition<TInput, TResult> {
  name: string;
  description: string;
  capability: string;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput) => Promise<TResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();

  register<TInput, TResult>(definition: ToolDefinition<TInput, TResult>): void {
    if (this.tools.has(definition.name)) throw new Error(`Duplicate tool: ${definition.name}`);
    this.tools.set(definition.name, definition as ToolDefinition<unknown, unknown>);
  }

  list(): Array<Pick<ToolDefinition<unknown, unknown>, 'name' | 'description' | 'capability'>> {
    return [...this.tools.values()].map(({ name, description, capability }) => ({ name, description, capability }));
  }

  async execute(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw Object.assign(new Error(`Tool not allowed: ${name}`), { code: 'TOOL_NOT_ALLOWED' });
    return tool.handler(tool.inputSchema.parse(input));
  }
}

