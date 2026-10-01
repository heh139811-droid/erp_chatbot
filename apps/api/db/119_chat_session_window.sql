-- 세션 종료 기준을 "마지막 질문 이후 6시간 미사용"에서 "구간 시작 후 총 6시간"으로 바꾼다.
-- idle_6h 라는 이름이 더 이상 의미를 설명하지 못하므로 session_6h 를 추가하고,
-- 이미 쌓인 행은 당시 기준 그대로 두기 위해 기존 값도 계속 허용한다.
ALTER TABLE chat_context_segments DROP CONSTRAINT chat_context_segments_end_reason_check;

ALTER TABLE chat_context_segments
  ADD CONSTRAINT chat_context_segments_end_reason_check
  CHECK (end_reason IN ('question_limit', 'session_6h', 'idle_6h', 'manual_new_chat'));

-- 보존 기간을 대화 생성 시점 기준으로 계산하므로 목록·검색·삭제가 모두 이 인덱스를 쓴다.
CREATE INDEX chat_threads_owner_created_idx
  ON chat_threads (owner_user_id, status, created_at DESC, id DESC);
