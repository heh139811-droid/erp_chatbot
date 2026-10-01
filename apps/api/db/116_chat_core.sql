CREATE TABLE chat_threads (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  title text NOT NULL DEFAULT '새 대화',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_context_segments (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  segment_number integer NOT NULL,
  user_question_count integer NOT NULL DEFAULT 0,
  handoff_summary text,
  referenced_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_user_message_at timestamptz,
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('question_limit', 'idle_6h', 'manual_new_chat')),
  UNIQUE (thread_id, segment_number)
);

CREATE TABLE chat_runs (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES chat_context_segments(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  first_token_at timestamptz,
  completed_at timestamptz,
  input_tokens integer,
  output_tokens integer,
  error_code text
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES chat_context_segments(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_tool_calls (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  target_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_count integer,
  status text NOT NULL,
  duration_ms integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_pending_actions (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES chat_context_segments(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  partial_arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('awaiting_clarification', 'ready', 'completed', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chat_runs_one_active_per_thread_idx
ON chat_runs (thread_id)
WHERE status = 'running';

CREATE INDEX chat_threads_owner_status_activity_idx
ON chat_threads (owner_user_id, status, last_activity_at DESC, id DESC);

CREATE INDEX chat_messages_thread_created_idx
ON chat_messages (thread_id, created_at DESC, id DESC);

CREATE INDEX chat_messages_created_at_idx ON chat_messages (created_at);
CREATE INDEX chat_runs_created_at_idx ON chat_runs (started_at);
CREATE INDEX chat_tool_calls_created_at_idx ON chat_tool_calls (created_at);
CREATE INDEX chat_segments_thread_number_idx ON chat_context_segments (thread_id, segment_number DESC);
CREATE INDEX chat_pending_actions_expiry_idx ON chat_pending_actions (expires_at);

