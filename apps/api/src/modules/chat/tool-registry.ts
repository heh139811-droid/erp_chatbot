import { z } from 'zod';

export interface ToolDefinition<TInput, TResult> {
  name: string;
  description: string;
  capability: string;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput) => Promise<TResult>;
}

/** What the model is told about a tool. Mirrors FR-10 step 2 of the spec. */
export interface ToolSpec {
  name: string;
  description: string;
  capability: string;
  input_schema: unknown;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();

  register<TInput, TResult>(definition: ToolDefinition<TInput, TResult>): void {
    if (this.tools.has(definition.name)) throw new Error(`Duplicate tool: ${definition.name}`);
    this.tools.set(definition.name, definition as ToolDefinition<unknown, unknown>);
  }

  get size(): number {
    return this.tools.size;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Array<Pick<ToolDefinition<unknown, unknown>, 'name' | 'description' | 'capability'>> {
    return [...this.tools.values()].map(({ name, description, capability }) => ({ name, description, capability }));
  }

  /** Tool definitions rendered for the model prompt. */
  specs(): ToolSpec[] {
    return [...this.tools.values()].map(({ name, description, capability, inputSchema }) => ({
      name,
      description,
      capability,
      input_schema: toInputSchema(inputSchema)
    }));
  }

  async execute(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw Object.assign(new Error(`Tool not allowed: ${name}`), { code: 'TOOL_NOT_ALLOWED' });
    return tool.handler(tool.inputSchema.parse(input));
  }
}

function toInputSchema(schema: z.ZodType<unknown>): unknown {
  const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}
