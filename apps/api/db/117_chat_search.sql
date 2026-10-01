CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX chat_threads_title_trgm_idx
ON chat_threads USING gin (title gin_trgm_ops);

CREATE INDEX chat_segments_summary_trgm_idx
ON chat_context_segments USING gin (handoff_summary gin_trgm_ops);

