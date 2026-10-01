---
작성일: 2026-10-01
상태: 1차 설계 기준
태그:
  - ERP
  - 챗봇
  - 아키텍처
관련:
  - "[[챗봇 초안]]"
  - "[[권한 분기]]"
---

# ERP 챗봇 아키텍처

## 1. 결정 요약

- 대화 스레드·메시지·컨텍스트 구간의 정본은 **ERP PostgreSQL**이다.
- **Hermes는 사용하지 않는다.** 대화 저장·세션 유지·이전 대화 검색 모두 ERP가 직접 관리한다.
- 이전 대화 검색은 별도 벡터 DB 없이 **PostgreSQL 일반 검색 + `pg_trgm` 유사도 검색**으로 처리한다.
- 모델 호출은 **Claude OAuth 또는 Codex OAuth**를 사용한다. API 키 종량제는 기본 호출 경로에서 제외한다.
- 브라우저가 한 번 요청하면 같은 연결에서 AI가 만든 텍스트를 즉시 스트리밍한다. 답변 완성 뒤 별도 조회 요청을 보내는 이중 구조를 만들지 않는다.
- 1차 목표는 대화 기반과 스트리밍이다. 계속 바뀔 수 있는 ERP 업무 권한 분기는 2차 목표에서 적용한다.
- 1차에 입력 검증·추가 질문·도구 실행을 담당하는 **Fastify 내부 로컬 Tool Registry**를 먼저 만든다. 별도 Gateway 서버나 실제 MCP 서버는 두지 않으며, ERP 업무 도구는 아직 등록하지 않고 대화 관리 도구만 허용한다.
- 2차에서 권한 분기가 확정되면 **Semantic 권한 게이트웨이**를 둔다. Semantic 값은 기존 도메인 권한 판정을 선택하는 라우팅 정보이며, LLM은 권한을 판단하지 않는다.
- Gateway와 도구 결과가 업무 답변의 사실 정본이다. **도구 결과에 없는 숫자·상태·대상·기간은 LLM이 답하지 않는다.** 금액·순위·계약·권한처럼 오답 위험이 큰 결과는 Gateway가 최종 문장까지 확정해 직접 스트리밍한다.

---

## 2. 전체 구조

```text
브라우저(React)
  │
  │ POST /api/chat/threads/:threadId/messages
  │ 세션 쿠키 + Origin/CSRF + 스트리밍 응답
  ▼
Fastify API
  ├─ 현재 로그인 사용자 확인
  ├─ 대화 스레드·컨텍스트 구간 결정
  ├─ 로컬 Tool Registry 입력 검증·추가 질문·도구 실행
  ├─ 미완성 도구 요청(pending action) 관리
  ├─ PostgreSQL에서 최근 문맥·요약 구성
  ├─ Claude OAuth / Codex OAuth 모델 호출
  ├─ 일반 답변은 모델의 text delta를 즉시 브라우저로 중계
  ├─ 고위험 사실 답변은 Gateway의 고정 answer_text를 직접 중계
  └─ 완료된 질문·답변·실행 결과 저장
  │
  ▼
PostgreSQL
  ├─ chat_threads
  ├─ chat_context_segments
  ├─ chat_messages
  ├─ chat_runs
  ├─ chat_tool_calls
  └─ chat_pending_actions
```

Fastify는 일반 답변을 완성 뒤 다시 포장하지 않는다. 인증·세션·저장 경계를 책임지고, 일반 답변은 모델이 생성하는 텍스트를 버퍼링하지 않고 같은 HTTP 응답으로 전달한다. 다만 금액·순위·계약·권한처럼 정확성이 우선인 답변은 Gateway가 구조화된 결과와 고정 템플릿으로 만든 `answer_text`를 모델의 재서술 없이 직접 전달한다.

---

## 3. 대화 단위

서로 다른 의미의 세션을 분리한다.

| 단위 | 의미 | 종료·전환 기준 |
|---|---|---|
| 로그인 세션 | 네이버웍스 인증 | 로그아웃·만료·차단 |
| 대화 스레드 | 화면에 보이는 하나의 대화방 | 사용자가 새 대화 생성·보관 |
| 컨텍스트 구간 | 모델에 이어서 전달할 문맥 범위 | 질문 100회 또는 6시간 미사용 |
| 실행(run) | 사용자 질문 1개부터 AI 최종 답변까지 | 완료·실패·취소 |

화면의 대화 스레드와 모델의 컨텍스트 구간은 다르다. 같은 대화 화면 안에서도 내부 컨텍스트 구간은 여러 개가 될 수 있다.

---

## 4. 컨텍스트 정책

### 질문 100회

- 질문 횟수는 **사용자 질문만** 센다. AI 답변과 도구 호출은 제외한다.
- 1~100번째 질문은 같은 컨텍스트 구간에 속한다.
- 101번째 질문이 들어오면 새 컨텍스트 구간을 만든다.
- 새 구간에는 이전 메시지 원문 전체가 아니라 `handoff_summary`와 현재 작업 대상 ID만 인계한다.
- 같은 구간 안에서도 모델 입력은 전체 100회 원문이 아니라 **누적 요약 + 최근 대화 일부**로 제한한다.

### 6시간 미사용

- 대화 시작 시각이 아니라 **마지막 사용자 질문 이후의 미사용 시간**을 본다.
- 다음 질문이 들어왔을 때 6시간 이상 지났다면 새 컨텍스트 구간을 만든다.
- 6시간 초기화는 이전 요약을 자동 인계하지 않는 완전 초기화를 기본으로 한다.
- 사용자가 이전 이야기를 명시하면 이전 대화 검색으로 필요한 문맥만 다시 가져온다.

### 틱·주기 작업

6시간마다 세션을 닫는 타이머나 틱은 필요 없다. 요청이 들어올 때 다음 조건을 계산한다.

```text
idle_expired = 현재 시각 - 마지막 사용자 질문 시각 >= 6시간
question_limit_reached = 현재 구간의 사용자 질문 수 >= 100
```

- `idle_expired`이면 인계 없는 새 구간
- 그렇지 않고 `question_limit_reached`이면 요약을 인계한 새 구간
- 두 조건이 아니면 현재 구간 유지

오래된 메시지 정리·통계 집계 같은 유지보수만 별도 주기 작업으로 처리한다.

---

## 5. 이전 대화 검색

이전 대화 검색은 Hermes 세션 검색이 아니라 ERP DB 검색으로 구현한다.

```text
사용자: "지난번 A브랜드 얘기 이어서 해줘"
  ↓
AI가 search_my_conversations 호출
  ↓
현재 로그인 사용자의 대화 제목·요약·질문을 SQL로 검색
  ↓
정확한 결과가 하나면 get_conversation_context 호출
  ↓
handoff_summary와 최근 메시지 일부를 현재 컨텍스트에 추가
```

### `search_my_conversations`

입력:

- `query`
- `from?`
- `to?`
- `limit?` — 최대 5

출력:

- `thread_id`
- `title`
- `last_activity_at`
- `summary_preview`

### `get_conversation_context`

입력:

- `thread_id`

출력:

- `handoff_summary`
- `referenced_entities`
- 최근 메시지 최대 5개

검색 대상 사용자는 도구 입력으로 받지 않는다. 서버가 로그인 세션에서 현재 사용자 ID를 정하고, 다른 사용자의 대화는 검색 결과에 포함하지 않는다.

### 검색 방식

별도 벡터 DB나 범용 DB MCP를 두지 않는다. PostgreSQL에서 다음 순서로 검색한다.

1. 대화 ID·티켓 ID·고객 ID처럼 식별자가 있으면 정확히 일치하는 항목을 먼저 찾는다.
2. 대화 제목과 `handoff_summary`에 일반 문자열 검색을 적용한다.
3. 일반 검색 결과가 부족하면 `pg_trgm` 유사도 검색을 적용한다.
4. 유사도와 최근 활동 시각을 함께 정렬하고 최대 5건만 반환한다.

1차 인덱스 대상은 `chat_threads.title`과 컨텍스트의 `handoff_summary`다. 메시지 원문 전체에는 처음부터 GIN 인덱스를 만들지 않는다. 실제 검색 로그에서 필요성이 확인될 때 최근 사용자 질문 등 제한된 범위만 추가한다.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX chat_threads_title_trgm_idx
ON chat_threads
USING gin (title gin_trgm_ops);
```

`handoff_summary`의 실제 저장 위치가 `chat_threads`인지 `chat_context_segments`인지는 스키마 확정 시 결정하고, 정해진 테이블에 별도 `gin (... gin_trgm_ops)` 인덱스를 만든다. 확장은 새 번호 마이그레이션으로 추가하며 이미 적용된 SQL 원문은 수정하지 않는다.

검색 도구는 다음 조건을 강제한다.

- `user_id`는 입력으로 받지 않고 로그인 세션에서 서버가 지정한다.
- 다른 사용자의 대화를 검색 후보에 포함하지 않는다.
- 한두 글자 검색은 일반 검색만 사용하고, `pg_trgm` 유사도 검색은 기본 3글자 이상부터 사용한다.
- 결과는 최대 5건이며 제목·마지막 활동 시각·요약 미리보기만 반환한다.
- 선택된 대화의 상세 문맥은 별도 `get_conversation_context` 호출에서 가져온다.

대화에는 이후 고객·티켓·계약 내용이 섞일 수 있으므로 원문을 별도 벡터 DB에 복제하지 않는다.

---

## 6. 메시지와 실행 저장

### `chat_threads`

- 사용자에게 보이는 대화방
- 소유 사용자, 제목, 상태, 마지막 활동 시각
- 공급자나 Hermes 세션 ID를 정본으로 사용하지 않는다.

### `chat_context_segments`

- 스레드 내부의 모델 문맥 구간
- 구간 번호, 사용자 질문 수, 마지막 활동 시각
- `handoff_summary`
- 종료 사유: `question_limit`, `idle_6h`, `manual_new_chat`

### `chat_messages`

- 최종 사용자 질문과 최종 AI 답변
- 스트리밍 text delta를 행마다 저장하지 않는다.
- 실행 완료 후 합쳐진 최종 텍스트를 한 메시지로 저장한다.

### `chat_runs`

- 질문 1개에 대한 모델 실행 상태
- 모델·공급자, 시작·완료 시각, 첫 토큰 시간, 전체 시간, 토큰 사용량, 실패 코드

### `chat_tool_calls`

- 호출 도구명, 대상 ID, 결과 건수, 실행시간, 성공·실패
- 대용량 도구 결과 원문이나 전체 프롬프트 사본을 중복 저장하지 않는다.

### `chat_pending_actions`

- 추가 질문이 필요한 미완성 도구 요청
- `thread_id`, `segment_id`, `tool_name`
- 지금까지 확정된 `partial_arguments`
- 아직 필요한 `missing_fields`
- 상태: `awaiting_clarification`, `ready`, `completed`, `cancelled`
- 새 대화·6시간 초기화·만료 시 폐기한다.

같은 스레드에 질문이 동시에 두 개 들어오면 문맥 순서가 깨질 수 있다. 실행 시작 시 짧은 DB 트랜잭션으로 활성 실행을 예약하고, 이미 실행 중이면 새 요청을 거절하거나 대기시킨다. 모델 응답을 기다리는 동안 DB 트랜잭션을 계속 열어두지 않는다.

---

## 7. 스트리밍 계약

한 번의 `POST` 요청이 다음 이벤트를 같은 응답에서 순서대로 보낸다.

```text
run_started
text_delta
text_delta
completed
```

`text_delta`의 출처는 실행 결과의 `render_mode`에 따라 달라진다.

- `deterministic`: Gateway의 고정 `answer_text`를 Fastify가 직접 스트리밍한다. 두 번째 모델 호출을 하지 않는다.
- `grounded_narrative`: LLM이 Gateway의 구조화된 사실만 문장으로 표현하고, 생성되는 delta를 즉시 중계한다.

2차에서 업무 조회 도구가 추가되면 다음 이벤트를 확장할 수 있다.

```text
tool_started
tool_completed
```

브라우저는 `fetch()`의 `ReadableStream`으로 SSE 형식 또는 NDJSON을 읽는다. 별도의 폴링이나 "요청 생성 후 결과 조회" API는 두지 않는다.

연결이 끊겼다고 같은 질문을 자동으로 다시 실행하지 않는다. 서버의 `run_id`로 완료·실패 상태를 확인한 뒤 사용자가 명시적으로 재시도하게 한다.

---

## 8. 1차 로컬 Tool Registry와 멀티턴

1차에서는 권한 분기보다 먼저 도구 실행 파이프라인과 멀티턴 추가 질문을 완성한다. 이 구성 요소는 Fastify 프로세스 안에서 동작하는 로컬 함수 레지스트리이며 별도 서비스가 아니다.

```text
LLM 도구 요청
  ↓
Fastify 내부 Registry에 등록된 도구인지 확인
  ↓
입력 스키마 검증
  ↓
필수 조건·중복 후보 확인
  ├─ 부족함 → pending action 저장 → 사용자에게 추가 질문
  └─ 충분함 → 허용된 1차 도구 실행
  ↓
결과를 LLM에 반환해 최종 텍스트 스트리밍
```

도구는 코드에 등록된 정의만 실행한다.

```text
ToolDefinition
- name
- capability
- input_schema
- required_fields
- handler
```

모델에는 `name`, `description`, `input_schema`만 도구 정의로 전달한다. 모델이 `tool_call`을 반환하면 Fastify가 같은 프로세스 안에서 Registry를 찾아 입력을 검증하고 로컬 handler를 실행한다.

```text
Claude/Codex tool_call
  ↓
Fastify Tool Registry
  ↓ schema 검증
로컬 TypeScript handler
  ↓
PostgreSQL
```

### 실제 MCP를 사용하지 않는 이유

- 현재 도구 소비자는 ERP의 Fastify 챗봇 하나다.
- 별도 MCP 프로세스·연결·재시작·세션 동기화가 필요하지 않다.
- 현재 로그인 사용자와 DB 트랜잭션 문맥을 다른 프로세스로 전달하지 않아도 된다.
- 추가 네트워크 왕복 없이 모델의 도구 호출을 즉시 실행할 수 있다.
- 별도 MCP 세션이나 Gateway 세션을 ERP 대화 세션과 맞출 필요가 없다.

내부 도구 계약은 MCP 도구와 비슷한 `name`, `description`, `input_schema`, `handler` 형태로 유지한다. 추후 외부 에이전트나 다른 서비스가 같은 도구를 호출해야 할 때만 Registry 위에 MCP 어댑터를 추가한다. 이때도 도메인 handler와 권한 코드는 복제하지 않는다.

### 실제 데이터 기반 답변 원칙

Gateway와 각 도구의 결과가 업무 답변의 유일한 사실 정본이다.

```text
사용자 자연어
  ↓
LLM: 의도·조건을 구조화
  ↓
Gateway: 스키마·필수 조건 검사
  ↓
도구: 실제 DB 조회·집계
  ↓
Gateway: 사실·미확인·출처·표현 방식을 확정
  ├─ deterministic → 고정 answer_text 직접 스트리밍
  └─ grounded_narrative → 허용된 facts만 LLM이 문장화
```

도구 결과는 가능한 한 다음 공통 형태를 사용한다.

```text
answerable
render_mode: deterministic | grounded_narrative
facts
unknowns
source_refs
evidence
answer_text?    # deterministic일 때 Gateway가 생성
```

- `answerable=false`이면 LLM이 상식이나 과거 대화로 답을 채우지 않는다.
- 모든 숫자·상태·대상·기간은 `facts`에 존재해야 한다.
- `unknowns`의 null·미확인·제외 건수는 숨기거나 0으로 바꾸지 않는다.
- `source_refs`에는 원본 ID·조회 기준 시각·적용 기간처럼 답을 검증할 근거를 넣는다.
- `evidence`에는 비개발자에게 표시할 조회 자료·기간·범위·집계 방식·반영/제외 건수·기준 시각을 구조화해 넣는다.
- 도구 결과가 없으면 업무 사실에 답하지 않고 확인 불가 또는 필요한 추가 조건을 안내한다.

LLM의 역할은 다음으로 제한한다.

1. 사용자 자연어를 도구 이름과 구조화된 인자로 변환
2. `clarification_required`의 빠진 조건을 자연스럽게 되묻기
3. `grounded_narrative`에서 Gateway가 반환한 사실을 읽기 쉬운 문장으로 표현

LLM은 금액 합산·순위 계산·권한 추론·기간 임의 확정·없는 데이터 보완·과거 대화의 현재 사실화를 하지 않는다.

### 답변 방식 구분

| 대상 | 방식 |
|---|---|
| 금액·취급고·비율·순위 | Gateway가 계산하고 고정 문장 직접 스트리밍 |
| 계약 상태·권한 허용/거절 | Gateway의 결정적 결과와 고정 문구 직접 스트리밍 |
| null·미확인·제외 건수 | Gateway가 원래 의미를 유지해 직접 표시 |
| 일반 안내·대화 요약 | LLM이 허용된 facts 안에서 문장화 |

고위험 결과를 직접 스트리밍하면 LLM의 자의적 재해석을 제거하고 두 번째 모델 호출도 줄여 응답 속도를 높일 수 있다.

### `근거 보기` UX

업무 답변의 근거는 기본 화면에서 펼쳐 놓지 않는다. 답변 아래에 `근거 보기` 버튼을 두고 사용자가 눌렀을 때만 상세 카드를 표시한다.

```text
2026년 10월 영업1팀의 취급고 1위는
홍길동 사원이며 32,500,000원입니다.

[근거 보기 ▾]
```

펼친 상태:

```text
[근거 접기 ▴]

조회 자료      확인된 취급고 입력 내역
조회 기간      2026.10.01 ~ 2026.10.31
조회 범위      영업1팀
집계 방식      직원별 확인 금액 합계
반영 자료      128건
제외 자료      미확인 2건
기준 시각      2026.10.01 11:30

[ERP 원본에서 확인]
```

근거는 LLM이 작성하지 않는다. Gateway가 실제 조회 결과와 도구 실행 메타데이터로 `evidence`를 확정하고, 프론트가 고정 컴포넌트로 렌더링한다.

- `evidence`는 답변과 같은 스트리밍 실행 결과에 포함한다.
- `근거 보기` 클릭은 프론트의 펼침 상태만 바꾸며 추가 LLM 호출이나 DB 재조회를 하지 않는다.
- 기본값은 접힘이며 각 답변별로 독립적으로 펼치고 접는다.
- 버튼은 `aria-expanded`를 제공한다.
- 일반 사용자에게는 테이블명·컬럼명·SQL 대신 업무 용어를 표시한다.
- 실제 테이블명·query ID·실행 policy·내부 오류 정보는 감사 로그에 남기고, 필요하면 개발팀 관리자 전용 `기술 상세`에서만 제공한다.
- 원본 화면 링크는 사용자가 현재 열 수 있는 자료에만 제공하며, 링크를 열 때도 현재 권한을 다시 확인한다.
- 여러 자료를 사용한 답변은 `근거 1`, `근거 2`처럼 출처별로 나눈다.
- `unknowns`의 미확인·제외 건수와 조회 기준 시각은 근거 카드에서 생략하지 않는다.

예시 응답:

```json
{
  "answerable": true,
  "render_mode": "deterministic",
  "answer_text": "2026년 10월 영업1팀의 취급고 1위는 홍길동 사원이며 32,500,000원입니다.",
  "evidence": {
    "source_label": "확인된 취급고 입력 내역",
    "period": { "from": "2026-10-01", "to": "2026-10-31" },
    "scope_label": "영업1팀",
    "aggregation_label": "직원별 확인 금액 합계",
    "included_count": 128,
    "excluded": [{ "reason": "미확인", "count": 2 }],
    "as_of": "2026-10-01T11:30:00+09:00",
    "source_links": []
  }
}
```

### 추가 질문 기준

Gateway가 다음 상태 중 하나를 결정한다.

| 상태 | 처리 |
|---|---|
| `ready` | 검증된 조건으로 도구 실행 |
| `clarification_required` | 빠진 조건과 기존 인자를 저장하고 한 번에 되묻기 |
| `partial_data` | 미확인·제외 건수를 결과와 함께 반환 |
| `forbidden` | 고정된 제한 응답. LLM이 우회하지 않음 |

추가 질문은 기간·대상·집계 단위처럼 결과를 실질적으로 바꾸는 필수 조건이 없거나, 같은 이름의 후보가 여러 개라 하나를 확정할 수 없을 때만 한다. 미확인 값·공동 1위·0건은 되묻지 않고 정해진 결과 형식으로 표시한다.

다음 사용자 답변은 같은 `pending_action`의 `partial_arguments`에 합친다. 필수값이 모두 채워지면 새 도구 요청을 추측해서 만들지 않고 저장된 도구를 실행한다.

### 1차 허용 범위

- `search_my_conversations`
- `get_conversation_context`
- 대화 제목·요약 갱신
- 컨텍스트 구간 관리

ERP 고객·티켓·계약·취급고 조회 도구는 1차에 등록하지 않는다. 임시 `allow all` policy도 두지 않으며, 등록되지 않은 도구와 capability는 기본 거절한다.

---

## 9. 2차 권한 게이트웨이

> 이 구조는 **2차 목표**다. 현재는 권한 분기가 확정되지 않았으므로 1차에서 구현하지 않는다. [[권한 분기]]가 확정된 뒤 1차 로컬 Tool Registry의 handler 실행 직전에 현재 actor와 domain policy 판정을 추가한다.

### 원칙

- Gateway가 도구의 Semantic capability를 보고 실행할 도메인 권한 함수와 조회 함수를 선택한다.
- Semantic capability는 권한 그 자체가 아니라 **서버 내부 라우팅 키**다.
- 최종 허용·거절과 조회 가능한 행의 범위는 기존 도메인 코드와 SQL이 결정한다.
- LLM은 사용자의 역할, 소속, 권한 목록을 보고 허용 여부를 추론하지 않는다.
- LLM에는 권한 검사를 통과한 도구 결과만 전달한다.
- 프론트·사용자 입력·LLM이 `actor`, `user_id`, 권한 범위, 실행할 policy를 임의로 지정하지 못하게 한다.
- 알 수 없거나 등록되지 않은 capability는 기본 거절한다.
- 요청마다 `loadActor`로 현재 소속·역할·적용일·만료를 다시 확인한다. 이전 요청의 역할 판정을 재사용하지 않는다.
- Gateway에 역할별 권한표를 새로 복제하지 않는다. 도메인에 이미 있는 가시성 함수와 SQL을 정본으로 사용한다.

### 실행 흐름

```text
LLM의 도구 호출
  ↓
Fastify 로컬 Tool Registry
  ↓ 도구에 서버가 등록한 semantic capability 확인
Semantic capability registry
  ↓ 해당 도메인 handler와 policy 선택
loadActor(db, session.userId)
  ↓
기존 도메인 권한 함수·가시성 SQL
  ↓
허용된 행과 필드만 LLM에 반환
```

예시:

```text
tickets.list   → visibleTicket(actor)
tasks.list     → visibleTask(actor)
contracts.read → canReadCompanyContracts(actor) + 계약 조회 범위
customers.read → customerScope(actor)
```

Semantic registry에는 역할별 허용 규칙을 적지 않는다. 다음 연결 정보만 둔다.

```text
tool name → capability → domain handler → 기존 policy 함수
```

감사·실행 기록에는 `tool`, `capability`, 실행한 `policy`, 성공·거절 결과를 남기되 OAuth 토큰이나 조회 원문 전체는 남기지 않는다.

### LLM 금지 사항

- 질문의 업무상 필요성을 보고 권한을 확대하는 판단
- "팀장처럼 보인다" 같은 자연어 추론으로 역할 결정
- 모델이 지정한 사용자 ID나 조직 ID를 권한 주체로 사용
- 결과가 없을 때 권한이 없다고 임의 추정하거나, 권한이 있다고 보고 다른 도구로 우회
- 과거 대화에 나온 역할·소속·자료를 현재 권한의 근거로 사용

LLM은 어떤 도구가 필요한지만 선택한다. **누가 무엇을 볼 수 있는지는 Gateway 뒤의 결정적 코드와 SQL만 판단한다.**

---

## 10. 모델 공급자와 OAuth

- Claude와 Codex를 같은 `ChatModelProvider` 인터페이스 뒤에 둔다.
- OAuth access token·refresh token은 서버에서만 관리한다.
- 토큰을 브라우저, 평문 DB, 애플리케이션 로그, 감사 payload에 남기지 않는다.
- OAuth 만료·플랜 사용량 초과·공급자 장애 때 API 키로 자동 우회하지 않는다.
- 공급자 세션 ID는 선택적 실행 최적화 값일 뿐 ERP 대화의 정본이 아니다.
- 공급자를 바꿔도 PostgreSQL의 대화와 컨텍스트 요약으로 이어갈 수 있어야 한다.

---

## 11. Hermes를 제외하는 이유

- PostgreSQL에 이미 대화 원본을 저장하므로 Hermes 세션 저장소가 중복된다.
- ERP 대화 ID와 Hermes 세션 ID를 동기화해야 하는 장애 지점이 생긴다.
- Claude와 Codex를 전환할 때 외부 세션 형식에 종속된다.
- 보존기간·삭제·검색 결과의 정본이 두 군데로 갈린다.
- 현재 목표는 다중 에이전트나 장시간 워크플로가 아니라 텍스트 질문과 실시간 답변이다.

다중 에이전트·중단 지점 복구·복잡한 장기 워크플로가 실제 요구사항이 될 때만 별도 실행 엔진을 다시 검토한다.

---

## 12. 단계별 범위

### 1차

- PostgreSQL 기반 대화 스레드·메시지·컨텍스트 구간·실행 이력
- Fastify 내부 로컬 Tool Registry와 입력 스키마 검증
- 별도 Gateway 서버·실제 MCP 서버 제외
- `pending_action` 기반 멀티턴 추가 질문과 만료 처리
- 사용자 질문 100회 구간 전환
- 6시간 미사용 지연 초기화
- 이전 대화 일반 검색 + `pg_trgm` 유사도 검색과 문맥 불러오기
- Claude/Codex OAuth 모델 호출
- 한 요청 안에서 AI 텍스트 실시간 스트리밍
- ERP 업무 데이터와 권한별 조회 도구는 제외

### 2차

- [[권한 분기]]의 당시 확정 정책 적용
- 1차 로컬 Tool Registry의 handler 실행 직전에 `loadActor`와 domain policy 단계 추가
- 확정된 권한을 Semantic capability로 연결하는 권한 게이트웨이
- Gateway는 기존 도메인 policy를 선택하고, LLM은 권한 판단에서 완전히 제외
- ERP 업무 데이터 조회 도구
- 요청마다 현재 소속·역할·자료 관계 재확인
- 과거 대화가 현재 권한을 우회하지 않도록 대상 자료를 다시 조회

---

## 13. 열린 결정사항

- 대화 메시지 보존기간과 사용자 삭제 정책
  => 메시지 삭제는 없다  => 증거 떄문
  => 
  
- OAuth를 회사 공용 계정으로 운영할지 사용자별로 연결할지 
  
- Claude/Codex 플랜의 동시 호출·사용량·자동화 허용 범위
  
- 최근 대화로 모델에 전달할 정확한 턴 수와 토큰 상한
  
- 연결 중단 후 실행 상태 확인 API와 재시도 UX
  
- 2차 권한 확정 후 capability 이름·도구별 domain policy 연결표
