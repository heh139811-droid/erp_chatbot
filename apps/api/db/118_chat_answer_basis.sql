CREATE TABLE chat_answer_basis (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  source_label text NOT NULL,
  explanation text NOT NULL,
  period_label text,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculation text,
  record_count integer,
  queried_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_answer_basis_message_idx
ON chat_answer_basis (message_id, created_at);
