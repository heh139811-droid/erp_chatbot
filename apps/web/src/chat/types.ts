export type ThreadStatus = 'active' | 'archived';
export type MessageRole = 'user' | 'assistant';

export interface ChatThread {
  id: string;
  title: string;
  status: ThreadStatus;
  last_activity_at: string;
  created_at: string;
}

export interface ConversationSearchResult {
  id: string;
  title: string;
  last_activity_at: string;
  summary_preview: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  pending?: boolean;
  answer_basis?: AnswerBasis[];
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

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export type StreamEvent =
  | { type: 'run_started'; run_id: string }
  | { type: 'text_delta'; run_id: string; delta: string }
  | { type: 'completed'; run_id: string; message_id: string }
  | { type: 'error'; run_id: string; code: string; message: string };
