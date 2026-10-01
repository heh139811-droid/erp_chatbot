export type ThreadStatus = 'active' | 'archived';
export type MessageRole = 'user' | 'assistant';

export interface ChatThread {
  id: string;
  owner_user_id: string;
  title: string;
  status: ThreadStatus;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  segment_id: string;
  run_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  answer_basis: AnswerBasis[];
}

export interface AnswerBasis {
  id: string;
  source_system: string;
  source_label: string;
  explanation: string;
  period_label: string | null;
  conditions: string[];
  calculation: string | null;
  record_count: number | null;
  queried_at: string;
}

export type NewAnswerBasis = Omit<AnswerBasis, 'id' | 'queried_at'> & { queried_at?: string };

export interface ContextSegment {
  id: string;
  thread_id: string;
  segment_number: number;
  user_question_count: number;
  handoff_summary: string | null;
  referenced_entities: unknown[];
  started_at: string;
  last_user_message_at: string | null;
  ended_at: string | null;
  end_reason: 'question_limit' | 'idle_6h' | 'manual_new_chat' | null;
}

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface ModelMessage {
  role: MessageRole;
  content: string;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProviderResult {
  usage?: ProviderUsage;
}

export interface ChatModelProvider {
  readonly name: string;
  readonly model: string;
  stream(messages: ModelMessage[], signal: AbortSignal, systemPrompt: string): AsyncGenerator<string, ProviderResult>;
}

export type StreamEvent =
  | { type: 'run_started'; run_id: string }
  | { type: 'text_delta'; run_id: string; delta: string }
  | { type: 'completed'; run_id: string; message_id: string }
  | { type: 'error'; run_id: string; code: string; message: string };
