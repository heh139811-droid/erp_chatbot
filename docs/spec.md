---
작성일: 2026-10-01
상태: 1차 구축 기준
버전: 0.2
태그:
  - ERP
  - 챗봇
  - 제품스펙
관련:
  - "[[architecture]]"
  - "[[seperatorOfDuties]]"
---

# ERP 챗봇 1차 구축 기능 명세서

## 1. 개요 (Overview)

- **목적:** ERP 내부 사용자가 자연어로 질문하고 Claude의 답변을 실시간으로 받을 수 있는 대화형 챗봇 기반을 구축한다. 완료된 대화를 저장·조회·검색할 수 있게 하고, 이후 ERP 업무 조회와 권한 게이트웨이를 붙일 수 있는 기반을 만든다.
- **담당자:** PM 미정 / Frontend 미정 / Backend 미정
- **관련 링크:** [아키텍처](./architecture.md) / [권한 분기](./seperatorOfDuties.md) / Figma 미등록 / Jira Ticket 미등록

### 1.1. 문서 우선순위

문서 내용이 충돌하면 다음 순서로 적용한다.

1. 이 기능 명세서
2. `docs/architecture.md`
3. `docs/seperatorOfDuties.md`

### 1.2. 1차 범위

포함 범위:

- React 기반 챗봇 화면
- 대화방 생성·조회·검색·보관
- 최근 30일 대화 목록과 무한 스크롤
- Claude OAuth 기반 답변 생성
- 한 HTTP 응답 안에서 NDJSON 실시간 스트리밍
- 정상 완료된 질문과 답변 저장
- 50회 또는 구간 시작 후 6시간 기준의 컨텍스트 구간 관리
- 최근 7일 문맥과 공급자 컨텍스트 한도 80% 제한
- Fastify 내부 로컬 Tool Registry
- `pending_action` 기반 추가 질문
- PostgreSQL 저장 및 30일 보존 후 완전 삭제
- 현재 저장소에 npm workspaces 모노레포로 구축하고 이후 `wjd-erp`에 모듈 단위 이식

제외 범위:

- ERP 고객·티켓·계약·취급고 등 업무 데이터 조회
- 역할·조직·담당 관계에 따른 권한 분기
- Semantic 권한 게이트웨이
- 실제 MCP 서버와 Hermes
- 별도 벡터 데이터베이스
- 모델 자동 전환과 API 키 우회
- 답변 중지·재시도·재생성
- 중단 실행 복구
- 다중 사용자 동시 사용 최적화
- 다중 에이전트와 장시간 워크플로
- TypeORM 등 신규 ORM 도입
- Turborepo, Nx, pnpm workspace 등 신규 모노레포 도구 도입

### 1.3. 운영 전제

- 사용자는 ERP의 기존 로그인 세션을 가진 내부 직원이다.
- 1차 운영은 동시 사용자가 없는 단일 사용자 환경을 전제로 한다.
- 모델 공급자는 Claude 하나만 사용한다.
- 서버에 연결된 단일 Claude Max 계정의 OAuth 인증을 사용한다.
- Codex는 1차 호출 경로에 포함하지 않는다.

### 1.4. 저장소와 기술 기준

- 1차 초안은 현재 `erp_chatbot` 저장소에 독립 실행 가능한 형태로 구축한다.
- 루트 `package.json`의 npm workspaces `apps/*` 구성을 사용한다.
- 백엔드는 `apps/api` Fastify 애플리케이션으로 구성한다.
- 프론트엔드는 `apps/web` React·Vite 애플리케이션으로 구성한다.
- 이후 `wjd-erp`의 동일한 `apps/api`, `apps/web` 경로로 모듈 단위 이식한다.
- 챗봇 기능의 확장을 고려해 백엔드와 프론트엔드 모두 전용 디렉터리로 분리한다.
- DB 접근은 기존 `apps/api/src/core/db.ts`의 `Database`·`Query` 추상화와 파라미터 SQL을 사용한다.
- 운영 PostgreSQL은 `pg` connection pool, 로컬·테스트는 기존 PGlite 구성을 따른다.
- TypeORM이나 다른 ORM을 새로 도입하지 않는다.
- DB 변경은 `apps/api/db`의 번호 기반 SQL 마이그레이션으로만 적용한다.
- 이미 적용된 SQL 마이그레이션은 수정하지 않고 다음 번호의 파일을 추가한다.

---

## 2. 사용자 스토리 (User Story)

- [ ] As an ERP 사용자, I want to 새 대화를 만들고 질문하고 싶다, so that 업무 중 필요한 설명을 즉시 받을 수 있다.
- [ ] As an ERP 사용자, I want to 생성되는 답변을 실시간으로 보고 싶다, so that 전체 답변이 완성될 때까지 기다리지 않아도 된다.
- [ ] As an ERP 사용자, I want to 최근 30일 대화를 날짜별로 보고 싶다, so that 이전 작업을 빠르게 찾을 수 있다.
- [ ] As an ERP 사용자, I want to 대화 목록을 계속 스크롤해 과거 항목을 불러오고 싶다, so that 별도 페이지 이동 없이 기록을 탐색할 수 있다.
- [ ] As an ERP 사용자, I want to 제목과 요약으로 내 이전 대화를 검색하고 싶다, so that 과거 문맥을 현재 대화에 다시 활용할 수 있다.
- [ ] As an ERP 사용자, I want to 조건이 부족한 질문에 필요한 항목을 한 번에 안내받고 싶다, so that 원하는 결과를 다시 처음부터 설명하지 않아도 된다.
- [ ] As an ERP 사용자, I want to 새로고침 후 완료된 대화만 다시 보고 싶다, so that 불완전한 답변이 기록으로 남지 않는다.
- [ ] As an ERP 사용자, I want to 다른 사용자의 대화가 노출되지 않기를 원한다, so that 개인 업무 대화가 보호된다.
- [ ] As an 운영자, I want to 30일이 지난 데이터를 자동 삭제하고 싶다, so that 정해진 보존 범위만 유지할 수 있다.

---

## 3. 요구사항 (Requirements)

### 3.1. 기능적 요구사항 (Functional)

#### FR-01. 인증과 소유권

- 사용자 식별자는 ERP 로그인 세션에서 가져온다.
- 프론트 요청과 모델 입력으로 `user_id`를 받지 않는다.
- 인증되지 않은 요청은 챗봇 데이터 조회와 모델 호출을 허용하지 않는다.
- 모든 대화 조회·변경에서 현재 세션 사용자와 `owner_user_id`를 서버가 비교한다.
- 소유하지 않은 대화는 존재 여부를 노출하지 않고 `404`로 처리한다.

#### FR-02. 새 대화

- 사용자가 `새 대화` 버튼을 누르면 빈 대화 스레드를 생성한다.
- 생성 직후 새 대화 화면으로 이동하고 입력창에 포커스를 둔다.
- 시작 화면에서 질문을 전송하면 서버 응답을 기다리지 않고 즉시 대화 화면으로 전환해 사용자 메시지와 AI 대기 상태를 표시한다.
- 첫 질문과 답변이 정상 완료되면 대화 제목을 자동 생성한다.
- 대화 제목은 목록에서 한 줄로 표시하고 넘치는 텍스트는 말줄임 처리한다.

#### FR-03. 좌측 대화 목록

- 좌측 탭에 생성한 지 30일 이내인 현재 사용자의 대화를 `last_activity_at` 최신순으로 표시한다.
- 목록은 `오늘`, `어제`, `최근 7일`, `최근 30일` 그룹으로 구분한다.
- 각 항목에는 대화 제목과 마지막 활동 시각을 표시한다.
- 현재 열린 대화는 시각적으로 구분한다.
- 목록 바깥 레이아웃은 `overflow: hidden`, 목록 컨테이너는 `overflow-y: auto`로 구성한다.
- 최초 페이지를 불러온 뒤 목록 하단 200px 이내에 진입하면 다음 커서 페이지를 요청한다.
- 다음 페이지 요청 중에는 추가 호출을 막는다.
- 불러온 항목은 기존 목록 뒤에 중복 없이 추가한다.
- `has_more=false`이면 관찰과 추가 호출을 중단한다.
- 로딩, 빈 목록, 오류, 마지막 페이지 상태를 각각 표시한다.

#### FR-04. 대화 열기와 영구 삭제

- 대화 항목을 선택하면 정상 완료된 메시지를 생성 시각 오름차순으로 표시한다.
- 메시지 목록도 커서 기반으로 이전 메시지를 추가 조회할 수 있어야 한다.
- 대화 항목에 마우스를 올리면 `…` 메뉴를 표시한다. 터치 화면에서는 메뉴 버튼을 항상 조작할 수 있어야 한다.
- `…` 메뉴의 삭제를 누르면 복구할 수 없다는 내용을 포함한 확인 다이얼로그를 표시한다.
- 사용자가 `영구 삭제`를 확인한 경우 현재 사용자가 소유한 대화와 메시지, 실행 기록, 컨텍스트 구간, 도구 기록, 답변 근거를 즉시 완전 삭제한다.
- 삭제 취소 시 데이터와 현재 화면 상태를 변경하지 않는다.
- 소유하지 않은 대화의 삭제 요청은 존재 여부를 노출하지 않고 `404`로 처리한다.

#### FR-05. 질문 입력

- 여러 줄 텍스트 입력을 지원한다.
- `Enter`는 전송, `Shift+Enter`는 줄바꿈으로 처리한다.
- 한글 IME 조합을 완료하는 Enter도 중복 없이 한 번만 전송되어야 한다.
- 빈 문자열과 공백만 있는 입력은 전송하지 않는다.
- 실행 중에는 입력창과 전송 버튼을 비활성화한다.
- 동일 스레드에 활성 실행이 있으면 새 요청을 거절한다.
- 1차에는 중지, 재시도, 답변 재생성 버튼을 제공하지 않는다.

#### FR-06. 스트리밍 답변

- 질문은 `POST` 요청 한 번으로 전송한다.
- 응답은 `application/x-ndjson` 형식으로 스트리밍한다.
- 이벤트 순서는 `run_started → text_delta 반복 → completed`이다.
- 첫 `text_delta` 전에는 빈 AI 말풍선에 `...` 대기 애니메이션을 표시한다.
- `text_delta`가 오면 같은 AI 말풍선 끝에 순서대로 추가한다.
- 서버는 사용자 질문과 최종 AI 답변을 먼저 저장한 뒤 `completed`를 보낸다.
- `completed` 이후에는 추가 이벤트를 보내지 않는다.

#### FR-07. 메시지 표시

- 사용자와 AI 메시지를 서로 다른 말풍선으로 표시한다.
- AI 답변은 Markdown 문단, 목록, 표, 인라인 코드와 코드 블록을 지원한다.
- 모델이 생성한 HTML을 그대로 삽입하지 않는다.
- 사용자가 하단 근처에 있을 때만 새 텍스트에 맞춰 자동 스크롤한다.
- 사용자가 과거 메시지를 읽는 중이면 강제로 하단으로 이동시키지 않는다.
- CRM 쿼리 결과를 사용한 AI 답변에는 `답변 근거 보기`를 표시한다.
- 근거 패널에는 데이터 출처, 조회 범위, 적용 조건, 계산 기준, 확인 건수와 조회 시각을 비개발자 용어로 표시한다.
- SQL 원문, 실제 테이블명·컬럼명, 내부 쿼리 계획과 접속 정보는 사용자 화면에 노출하지 않는다.
- 답변 근거는 AI 메시지와 함께 저장하며 새로고침 후에도 동일하게 조회되어야 한다.

#### FR-08. 연결 종료

- 브라우저 새로고침 또는 스트리밍 연결 종료가 감지되면 모델 요청과 진행 중인 도구 실행을 취소한다.
- 중단된 실행의 사용자 질문, 미완성 AI 답변, `pending_action`, 미완성 도구 결과와 임시 실행 상태를 삭제한다.
- 새로고침 후에는 마지막으로 정상 완료된 메시지까지만 표시한다.
- 중단 실행의 상태 조회, 복구, 자동 재시도와 수동 재시도를 제공하지 않는다.
- 모델 응답을 기다리는 동안 DB 트랜잭션을 열어두지 않는다.

#### FR-09. 컨텍스트 구간

- 사용자 질문만 세어 50번째 질문까지 같은 컨텍스트 구간을 사용한다.
- 51번째 질문부터 새 구간을 만든다.
- 질문 횟수 전환 시 직전 구간의 `handoff_summary`와 작업 대상 ID만 새 구간에 인계한다.
- 구간이 시작된 시점부터 6시간이 지나면 인계 없는 새 구간을 만든다. 중간 무활동 시간은 따지지 않는다.
- 질문 50회와 6시간 조건이 동시에 성립하면 6시간 초기화를 우선한다.
- 별도 타이머로 구간을 종료하지 않고 다음 질문이 들어올 때 조건을 계산한다.

#### FR-10. 모델 입력 범위

모델 입력은 다음 순서로 구성한다.

1. 시스템 지침
2. 등록된 도구 정의
3. 활성 `pending_action`
4. 현재 컨텍스트 구간의 누적 요약
5. 현재 구간에 속하면서 최근 7일 이내인 메시지
6. 현재 사용자 질문

- 전체 입력은 선택한 Claude 모델 컨텍스트 한도의 80%까지만 사용한다.
- 한도를 넘으면 오래된 원문, 요약에 반영된 원문, 검색으로 가져온 원문 순서로 제거한다.
- 시스템 지침, 현재 질문, 활성 `pending_action`의 필수 정보는 제거하지 않는다.
- 6시간 초기화 뒤에는 과거 문맥을 자동으로 넣지 않는다.

#### FR-11. 이전 대화 검색

- 검색 대상은 현재 로그인 사용자의 데이터로 제한한다.
- 대화 ID 등 정확한 식별자, 제목·요약 문자열, `pg_trgm` 유사도 순서로 검색한다.
- 1~2글자 검색어에는 `pg_trgm`을 적용하지 않는다.
- 검색 결과는 최대 5건이다.
- 결과에는 대화 ID, 제목, 마지막 활동 시각, 요약 미리보기만 포함한다.
- 선택한 대화 문맥은 `handoff_summary`, 참조 대상, 최근 메시지 최대 5개만 반환한다.
- 검색으로 가져온 문맥에도 최근 7일과 컨텍스트 80% 제한을 적용한다.

#### FR-12. 로컬 Tool Registry

- 1차 도구는 Fastify 프로세스 내부의 TypeScript 함수로 구현한다.
- 허용 도구는 `search_my_conversations`, `get_conversation_context`, `update_conversation_title`, `update_context_summary`다.
- 각 도구는 이름, 설명, capability, 입력 스키마, 필수 필드와 handler를 가진다.
- 입력 스키마 검증에 실패하면 handler를 호출하지 않는다.
- 도구 입력에 사용자 ID를 허용하지 않고 서버 세션에서 범위를 주입한다.
- 등록되지 않은 도구와 capability는 기본 거절한다.
- 범용 SQL 도구와 범용 DB MCP를 등록하지 않는다.

#### FR-13. 추가 질문

- 필수 조건이 없거나 같은 이름의 후보가 여러 개면 도구를 실행하지 않고 필요한 조건을 한 번에 질문한다.
- 확정된 값은 `partial_arguments`, 필요한 값은 `missing_fields`에 저장한다.
- 다음 사용자 답변을 같은 `pending_action`에 합친다.
- 필수값이 모두 채워지면 저장된 동일 도구를 실행한다.
- 새 대화, 6시간 초기화, 연결 중단 또는 만료 시 `pending_action`을 폐기한다.

#### FR-14. 저장과 트랜잭션

- 스트리밍 조각을 메시지 행으로 저장하지 않는다.
- 정상 완료 시 사용자 질문과 합쳐진 AI 최종 답변을 하나의 짧은 트랜잭션에서 함께 저장한다.
- 질문이나 답변 중 하나만 저장된 상태를 허용하지 않는다.
- 실행 예약과 실행 완료 처리는 짧은 트랜잭션으로 분리한다.
- 연결 종료 취소 처리는 여러 번 호출돼도 같은 결과를 내야 한다.

#### FR-15. 보존과 삭제

- 사용자는 대화 단위로 직접 영구 삭제할 수 있다. 개별 메시지만 선택해 삭제하는 기능은 제공하지 않는다.
- 보존 기간은 대화 생성 시각 하나로 통일한다. 대화를 만든 지 30일이 지나면 삭제한다.
- 챗봇은 보존 기간 안의 본인 대화를 도구로 찾아 참조할 수 있다. 조회 범위는 서버 세션의 사용자로 고정하며 다른 사용자의 대화는 노출하지 않는다.
- 메시지, 실행, 도구 호출, 컨텍스트 구간은 대화에 딸려 함께 삭제한다. 자체 생성 시각으로 따로 지우지 않는다.
- `pending_action`은 자체 만료, 연결 중단 또는 소속 스레드 삭제 시 제거한다.
- 정리 작업은 매일 1회 보존기간이 지난 데이터를 `DELETE`로 완전 삭제한다. 소프트 삭제 컬럼은 사용하지 않는다.
- 삭제 작업은 자식 데이터를 먼저 삭제하거나 FK의 `ON DELETE CASCADE`를 사용해 참조가 남지 않게 한다.
- 1회 삭제 대상이 수십만 행 이상으로 증가하면 5천~1만 행 단위의 배치 삭제로 전환한다.
- 하드 삭제 후의 물리 공간 정리는 PostgreSQL autovacuum에 맡긴다.
- 정기 작업에서 `VACUUM FULL`을 실행하지 않는다.
- 삭제된 데이터는 검색·복구·관리자 화면에서 다시 제공하지 않는다.
- 사용자 직접 삭제는 30일 정리 작업을 기다리지 않고 즉시 적용한다.

### 3.2. 비기능적 요구사항 (Non-Functional)

#### NFR-01. 사용자 반응성

- 질문 전송 후 200ms 이내에 대기 말풍선을 표시한다.
- 대화 목록 다음 페이지 요청 중에도 기존 항목을 유지한다.
- 무한 스크롤 요청은 한 번에 하나만 실행한다.
- 일반 대화 목록 API의 목표 응답시간은 로컬 환경 p95 500ms 이하다.
- 모델 첫 토큰 시간은 측정하되 외부 공급자 상태에 영향을 받으므로 1차 완료 차단 기준으로 사용하지 않는다.

#### NFR-02. 접근성과 반응형

- 데스크톱과 모바일 웹 레이아웃을 지원한다.
- 좁은 화면에서 대화 목록은 열고 닫을 수 있는 별도 패널로 표시한다.
- 전송, 새 대화, 검색과 보관 기능은 키보드로 조작할 수 있어야 한다.
- 실행 상태에는 `aria-live="polite"`를 적용한다.
- 색상만으로 사용자·AI·오류 상태를 구분하지 않는다.

#### NFR-03. 보안

- 상태 변경 요청에 Origin과 CSRF 검사를 적용한다.
- OAuth access token과 refresh token은 서버에서만 관리한다.
- OAuth 토큰을 브라우저, 평문 DB, 애플리케이션 로그 또는 도구 로그에 기록하지 않는다.
- Markdown에서 스크립트, 이벤트 속성과 위험한 URL을 제거한다.
- 모델 출력의 명령이나 링크를 서버 명령으로 실행하지 않는다.
- 오류 응답에 SQL, 토큰, 공급자 원문과 스택 트레이스를 노출하지 않는다.

#### NFR-04. 관측성

- 실행 ID, 공급자·모델, 시작·첫 토큰·완료 시각, 전체 소요시간, 토큰 수, 도구 실행시간과 오류 코드를 기록한다.
- 로그에 OAuth 토큰, 세션 쿠키, 전체 프롬프트, 메시지 원문과 대용량 DB 결과를 남기지 않는다.
- 데이터 정리 실패는 운영 로그에 남기고 다음 정리 작업에서 다시 시도한다.

#### NFR-05. 데이터베이스 용량과 최적화

- 전사 사용자 130명, 사용자당 하루 100질문, 30일 보존을 최대 예상 사용량으로 둔다.
- 최대 예상량은 질문·답변 39만 쌍, 메시지 약 78만 행이다.
- 최종 질문·답변과 최소 실행 메타데이터만 저장할 때 30일 DB 데이터는 약 5~10GB를 예상한다.
- 운영 DB 디스크는 WAL과 임시 공간을 포함해 챗봇 데이터용 최소 20~30GB 여유를 확보한다.
- 전체 프롬프트 사본, 스트리밍 delta, Claude 원본 응답 JSON과 대용량 도구 결과 원문을 저장하지 않는다.
- 1차에서는 테이블 파티셔닝을 적용하지 않는다.
- 테이블 크기, dead tuple과 autovacuum 실행 상태를 측정한 뒤에만 파티셔닝을 재검토한다.

---

## 4. API 및 데이터 설계 (API & Data)

모든 API는 ERP 세션 쿠키를 사용한다. 상태 변경 요청에는 CSRF 토큰이 필요하다.

### 4.1. 대화 생성

- **Method & Endpoint:** `POST /api/chat/threads`

```json
{
  "thread_id": "uuid",
  "title": "새 대화",
  "status": "active",
  "created_at": "2026-10-01T15:00:00+09:00"
}
```

### 4.2. 대화 목록

- **Method & Endpoint:** `GET /api/chat/threads?cursor={cursor}&status=active&limit={limit}`
- **정렬:** `last_activity_at DESC, id DESC`
- **범위:** 생성한 지 30일 이내인 현재 사용자의 대화

```json
{
  "items": [
    {
      "thread_id": "uuid",
      "title": "9월 광고 실적 정리",
      "status": "active",
      "last_activity_at": "2026-10-01T14:30:00+09:00"
    }
  ],
  "next_cursor": "opaque-cursor-or-null",
  "has_more": true
}
```

### 4.3. 대화와 메시지 조회

- **Method & Endpoint:** `GET /api/chat/threads/:threadId`
- **Method & Endpoint:** `GET /api/chat/threads/:threadId/messages?cursor={cursor}&limit={limit}`
- 정상 완료된 메시지만 반환한다.
- 메시지 응답도 `items`, `next_cursor`, `has_more` 형식을 사용한다.

### 4.4. 대화 영구 삭제

- **Method & Endpoint:** `DELETE /api/chat/threads/:threadId`
- 성공 시 `204 No Content`를 반환한다.
- 소유 대화가 아니거나 존재하지 않으면 `404 THREAD_NOT_FOUND`를 반환한다.
- 하위 데이터는 FK `ON DELETE CASCADE`로 함께 완전 삭제한다.

### 4.5. 질문 전송과 스트리밍

- **Method & Endpoint:** `POST /api/chat/threads/:threadId/messages`
- **Request Content-Type:** `application/json`
- **Response Content-Type:** `application/x-ndjson`

요청:

```json
{
  "content": "지난 대화 내용을 요약해줘"
}
```

스트리밍 응답:

```json
{"type":"run_started","run_id":"uuid"}
{"type":"text_delta","run_id":"uuid","delta":"지난 대화에서는"}
{"type":"text_delta","run_id":"uuid","delta":" 다음 내용을 다뤘습니다."}
{"type":"completed","run_id":"uuid","message_id":"uuid"}
```

연결 안에서 전달 가능한 오류:

```json
{
  "type": "error",
  "run_id": "uuid",
  "code": "PROVIDER_UNAVAILABLE",
  "message": "현재 답변을 생성할 수 없습니다."
}
```

### 4.6. 대화 검색

- **Method & Endpoint:** `GET /api/chat/threads/search?q={query}&from={date}&to={date}&limit={1..5}`
- 빈 검색어는 `400 INVALID_INPUT`을 반환한다.

```json
{
  "items": [
    {
      "thread_id": "uuid",
      "title": "A브랜드 대화",
      "last_activity_at": "2026-10-01T11:00:00+09:00",
      "summary_preview": "A브랜드 캠페인 관련 대화"
    }
  ]
}
```

### 4.7. 공통 오류

| HTTP | 코드 | 의미 |
|---|---|---|
| 400 | `INVALID_INPUT` | 비어 있거나 형식이 잘못된 요청 |
| 401 | `AUTH_REQUIRED` | 로그인 세션 없음 또는 만료 |
| 404 | `THREAD_NOT_FOUND` | 없거나 소유하지 않은 대화 |
| 409 | `RUN_ALREADY_ACTIVE` | 동일 스레드에서 이미 실행 중 |
| 429 | `PROVIDER_LIMITED` | Claude 사용량 또는 호출 제한 |
| 502 | `PROVIDER_ERROR` | Claude 호출 실패 |
| 500 | `INTERNAL_ERROR` | 서버 내부 오류 |

### 4.8. 데이터 모델

| 테이블 | 주요 필드 | 목적 |
|---|---|---|
| `chat_threads` | `id`, `owner_user_id`, `title`, `status`, `last_activity_at`, timestamps | 사용자에게 보이는 대화방 |
| `chat_context_segments` | `id`, `thread_id`, `segment_number`, `user_question_count`, `handoff_summary`, `referenced_entities`, `end_reason`, timestamps | 모델 문맥 구간 |
| `chat_messages` | `id`, `thread_id`, `segment_id`, `run_id`, `role`, `content`, `created_at` | 완료된 사용자·AI 메시지 |
| `chat_runs` | `id`, `thread_id`, `segment_id`, `provider`, `model`, `status`, token counts, timing, `error_code` | 질문 단위 실행 기록 |
| `chat_tool_calls` | `id`, `run_id`, `tool_name`, `target_refs`, `result_count`, `status`, `duration_ms`, `error_code` | 도구 실행 기록 |
| `chat_pending_actions` | `id`, `thread_id`, `segment_id`, `tool_name`, `partial_arguments`, `missing_fields`, `status`, `expires_at` | 추가 질문 상태 |
| `chat_answer_basis` | `id`, `message_id`, `source_system`, `source_label`, `explanation`, `period_label`, `conditions`, `calculation`, `record_count`, `queried_at` | 쿼리 기반 답변의 사용자용 근거 |

### 4.9. 인덱스와 검색

- 사용자별 최근 대화 목록에는 다음 복합 인덱스를 사용한다.

```sql
CREATE INDEX chat_threads_owner_status_activity_idx
ON chat_threads (
  owner_user_id,
  status,
  last_activity_at DESC,
  id DESC
);
```

- `owner_user_id` 단일 인덱스는 별도로 만들지 않는다. 위 복합 인덱스의 선두 컬럼으로 사용자 조건을 처리한다.
- `chat_messages`에는 `owner_user_id`를 중복 저장하지 않는다. 먼저 `chat_threads.owner_user_id`로 소유권을 확인한 뒤 검증된 `thread_id`로 메시지를 조회한다.
- 대화방 메시지 목록에는 다음 복합 인덱스를 사용한다.

```sql
CREATE INDEX chat_messages_thread_created_idx
ON chat_messages (
  thread_id,
  created_at DESC,
  id DESC
);
```

- 30일 하드 삭제 대상을 찾기 위해 다음 인덱스를 사용한다.

```sql
CREATE INDEX chat_messages_created_at_idx
ON chat_messages (created_at);

CREATE INDEX chat_runs_created_at_idx
ON chat_runs (created_at);
```

- `chat_threads.title`에 `gin_trgm_ops` 인덱스를 둔다.
- `handoff_summary` 저장 컬럼에 `gin_trgm_ops` 인덱스를 둔다.
- 메시지 원문 전체에는 1차부터 GIN 인덱스를 만들지 않는다.
- 실제 조회와 삭제 조건에 사용하지 않는 컬럼에는 인덱스를 추가하지 않는다.

### 4.10. 데이터 정리와 autovacuum

- 매일 1회 실행되는 애플리케이션 배치 또는 별도 작업이 30일을 초과한 데이터를 하드 삭제한다.
- PostgreSQL의 `autovacuum`은 활성 상태를 유지한다.
- 하드 삭제된 행은 즉시 조회 대상에서 사라지며, autovacuum이 dead tuple 공간을 새로운 데이터가 재사용할 수 있게 정리한다.
- 일반 autovacuum은 DB 파일 크기를 즉시 줄이지 않지만 반복적으로 들어오는 신규 메시지가 정리된 공간을 재사용하게 한다.
- `VACUUM FULL`은 테이블 전체 재작성과 강한 잠금이 필요하므로 일상 배치에 포함하지 않는다.
- 초기에는 기본 autovacuum 설정을 사용하고 다음 값으로 상태를 관찰한다.

```sql
SELECT
  relname,
  n_live_tup,
  n_dead_tup,
  last_autovacuum,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE relname LIKE 'chat_%';
```

- 테이블·인덱스·TOAST를 포함한 실제 크기는 다음 쿼리로 확인한다.

```sql
SELECT pg_size_pretty(pg_total_relation_size('chat_messages'));
```

- `n_dead_tup`이 지속적으로 증가하거나 autovacuum이 삭제량을 따라가지 못할 때만 테이블별 autovacuum 값을 조정한다.
- 1차에서는 일별·월별 파티셔닝을 사용하지 않는다. 수천만 행 규모, 테이블 크기가 서버 메모리를 초과하거나 대량 삭제가 병목이 될 때 다시 검토한다.

### 4.11. 모노레포 모듈 구조

```text
erp_chatbot/ (이후 wjd-erp로 이식)
├─ apps/
│  ├─ api/
│  │  ├─ db/
│  │  │  ├─ 116_chat_core.sql
│  │  │  └─ 117_chat_search.sql
│  │  ├─ src/
│  │  │  └─ modules/
│  │  │     └─ chat/
│  │  │        ├─ index.ts
│  │  │        ├─ routes.ts
│  │  │        ├─ service.ts
│  │  │        ├─ repository.ts
│  │  │        ├─ context.ts
│  │  │        ├─ provider.ts
│  │  │        ├─ stream.ts
│  │  │        ├─ tool-registry.ts
│  │  │        ├─ tools/
│  │  │        │  ├─ search-my-conversations.ts
│  │  │        │  ├─ get-conversation-context.ts
│  │  │        │  ├─ update-conversation-title.ts
│  │  │        │  └─ update-context-summary.ts
│  │  │        └─ types.ts
│  │  └─ tests/
│  │     └─ chat/
│  └─ web/
│     ├─ src/
│     │  └─ chat/
│     │     ├─ ChatPage.tsx
│     │     ├─ api.ts
│     │     ├─ types.ts
│     │     ├─ hooks/
│     │     ├─ components/
│     │     │  ├─ ConversationSidebar.tsx
│     │     │  ├─ ConversationList.tsx
│     │     │  ├─ MessageList.tsx
│     │     │  ├─ MessageBubble.tsx
│     │     │  ├─ MessageComposer.tsx
│     │     │  └─ StreamingIndicator.tsx
│     │     └─ utils/
│     │        └─ ndjson.ts
│     └─ tests/
│        └─ chat/
└─ package.json
```

백엔드 역할:

- `routes.ts`: Fastify 라우트와 요청·응답 스키마
- `service.ts`: 대화 실행 흐름과 트랜잭션 경계
- `repository.ts`: 기존 `Database` 인터페이스를 사용하는 파라미터 SQL
- `context.ts`: 50회·6시간·최근 7일·80% 컨텍스트 정책
- `provider.ts`: Claude OAuth 모델 어댑터
- `stream.ts`: NDJSON 이벤트 생성과 연결 종료 처리
- `tool-registry.ts`: 허용 도구 등록·입력 검증·실행
- `tools/`: 개별 대화 관리 도구 handler

프론트엔드 역할:

- `ChatPage.tsx`: 챗봇 화면 조합과 라우트 진입점
- `api.ts`: 대화 CRUD·검색·스트리밍 API 클라이언트
- `hooks/`: 대화 목록, 무한 스크롤, 스트리밍 상태 관리
- `components/`: 사이드바·메시지·입력 등 표시 컴포넌트
- `utils/ndjson.ts`: 조각난 NDJSON 스트림 파싱

의존 방향:

```text
Fastify route → chat service → repository/provider/tool registry
React ChatPage → hooks/api → chat components
```

- route와 React 컴포넌트에서 SQL을 직접 실행하지 않는다.
- repository에서 HTTP 응답을 만들지 않는다.
- provider에서 ERP DB를 조회하지 않는다.
- 프론트엔드는 백엔드 내부 타입 파일을 상대경로로 직접 import하지 않고 API 계약에 맞는 프론트 타입을 유지한다.
- 공통 패키지는 1차에 만들지 않는다. 실제 중복 타입과 소비자가 늘어날 때 `packages/` 도입을 별도로 결정한다.

---

## 5. 작업 목록 (Task Breakdown)

### 기획·공통

- [ ] 담당자 지정
- [ ] Figma 또는 화면 기준안 등록
- [ ] Claude 모델 ID 확정
- [ ] 대화·메시지 목록 기본 페이지 크기 확정
- [ ] `handoff_summary` 저장 컬럼 확정
- [ ] 30일 정리 작업 실행 시각 확정

### Backend

- [ ] `apps/api/src/modules/chat/` 모듈 기본 구조 생성
- [ ] `apps/api/tests/chat/` 테스트 구조 생성
- [ ] PostgreSQL 마이그레이션과 인덱스 작성
- [ ] 다음 번호의 `chat` SQL 마이그레이션 작성
- [ ] 사용자별 대화·스레드별 메시지 복합 인덱스 작성
- [ ] 30일 삭제용 `created_at` 인덱스 작성
- [ ] ERP 세션 인증·소유권 검사 구현
- [ ] 대화 생성·목록·상세·영구 삭제 API 구현
- [ ] 커서 기반 대화·메시지 페이지네이션 구현
- [ ] NDJSON 스트리밍 API 구현
- [ ] 연결 종료 감지와 실행 취소 구현
- [ ] 완료 시 질문·답변 원자적 저장 구현
- [ ] 동일 스레드 활성 실행 잠금 구현
- [ ] Claude OAuth 공급자 어댑터 구현
- [ ] 50회·6시간 컨텍스트 구간 전환 구현
- [ ] 최근 7일·컨텍스트 80% 입력 제한 구현
- [ ] 대화 제목·요약 생성 구현
- [ ] PostgreSQL 문자열·`pg_trgm` 검색 구현
- [ ] 로컬 Tool Registry와 입력 스키마 검증 구현
- [ ] `pending_action` 저장·병합·폐기 구현
- [ ] 30일 데이터 정리 작업 구현
- [ ] PostgreSQL autovacuum 활성 상태와 dead tuple 모니터링 구현
- [ ] DB 전체 크기와 `chat_messages` 실제 크기 모니터링 구현
- [ ] 메트릭과 오류 로그 구현

### Frontend

- [ ] `apps/web/src/chat/` 기능 모듈 기본 구조 생성
- [ ] `apps/web/tests/chat/` 테스트 구조 생성
- [ ] React 기본 레이아웃과 라우팅 구현
- [ ] 모바일 대화 목록 패널 구현
- [ ] 날짜 그룹별 대화 목록 구현
- [ ] 커서 기반 무한 스크롤 구현
- [ ] 목록 로딩·빈 결과·오류·마지막 페이지 상태 구현
- [ ] 새 대화와 삭제 확인 다이얼로그 UI 구현
- [ ] 메시지 목록과 과거 메시지 로딩 구현
- [ ] Markdown 안전 렌더링 구현
- [ ] 다중 행 입력과 전송 단축키 구현
- [ ] NDJSON 스트림 파서 구현
- [ ] 대기 애니메이션과 스트리밍 말풍선 구현
- [ ] 연결 종료 시 임시 질문·답변 롤백 구현
- [ ] 키보드 접근성과 `aria-live` 적용

### 연동·검증

- [ ] 프론트엔드와 API 계약 연동
- [ ] 인증 만료와 공통 오류 UI 연동
- [ ] DB 마이그레이션 적용·롤백 확인
- [ ] 단위·통합·E2E 테스트 작성
- [ ] 30일 삭제 작업 검증
- [ ] 보안 점검과 로그 민감정보 검사

---

## 6. 테스트 계획 (Test Plan)

### 6.1. 단위 테스트

- 컨텍스트 질문 수 계산에서 AI 답변과 도구 호출이 제외되는지 검증한다.
- 50번째 질문은 현재 구간, 51번째 질문은 새 구간으로 계산되는지 검증한다.
- 6시간 경계와 두 조건 동시 성립 시 6시간 초기화가 우선되는지 검증한다.
- 최근 7일 필터와 컨텍스트 80% 절삭 순서를 검증한다.
- 커서 인코딩·디코딩, 정렬 안정성과 중복 제거를 검증한다.
- `pg_trgm` 적용 최소 검색어 길이를 검증한다.
- Tool Registry의 허용 목록과 입력 스키마 거절을 검증한다.
- `pending_action` 인자 병합과 폐기 조건을 검증한다.
- Markdown 위험 요소 제거를 검증한다.
- 30일 보존 경계 계산을 검증한다.
- 사용자별 최근 대화 쿼리가 복합 인덱스를 사용하는지 실행 계획으로 검증한다.
- 스레드별 메시지 조회가 복합 인덱스를 사용하는지 실행 계획으로 검증한다.

### 6.2. 통합 테스트

- 인증된 사용자만 자신의 대화를 생성·조회·보관하는지 검증한다.
- 다른 사용자의 스레드 ID 접근이 `404`인지 검증한다.
- 다른 사용자의 대화 삭제가 `404`이고 소유 대화 삭제 시 모든 하위 데이터가 제거되는지 검증한다.
- 대화 목록 커서가 누락·중복 없이 다음 페이지를 반환하는지 검증한다.
- 서버가 질문과 답변을 저장한 뒤 `completed`를 보내는지 검증한다.
- 동일 스레드의 두 번째 실행이 `409 RUN_ALREADY_ACTIVE`인지 검증한다.
- 스트리밍 연결 종료 시 모델·도구 호출이 취소되고 임시 데이터가 제거되는지 검증한다.
- OAuth 만료·사용량 초과·공급자 오류 시 자동 우회하지 않는지 검증한다.
- 30일 정리 작업이 대상 데이터와 참조 데이터를 완전 삭제하는지 검증한다.
- 하드 삭제 후 autovacuum 실행 시 dead tuple이 정리되고 공간이 신규 데이터에 재사용되는지 검증한다.
- 정리 작업에 `VACUUM FULL`이 포함되지 않았는지 검증한다.

### 6.3. E2E 테스트

- 새 대화 생성 → 질문 전송 → 대기 애니메이션 → 스트리밍 → 완료 → 새로고침 후 재조회 흐름을 검증한다.
- 좌측 목록이 오늘·어제·최근 7일·최근 30일 그룹으로 표시되는지 검증한다.
- 목록 하단 200px 이내에서 다음 페이지를 한 번만 요청하는지 검증한다.
- 다음 페이지 항목이 기존 목록 뒤에 중복 없이 추가되는지 검증한다.
- `has_more=false` 이후 추가 요청이 발생하지 않는지 검증한다.
- 대화 검색 결과 선택 후 제한된 문맥으로 대화를 이어가는지 검증한다.
- 입력 부족 질문에 필요한 조건을 한 번에 묻고 답변 후 같은 도구를 실행하는지 검증한다.
- 스트리밍 도중 새로고침 후 미완성 질문·답변이 화면과 DB에 남지 않는지 검증한다.
- 모바일 화면에서 대화 목록 패널과 입력 영역을 사용할 수 있는지 검증한다.

### 6.4. 완료 판정

- 1차 범위의 모든 사용자 스토리와 필수 작업이 완료되어야 한다.
- 단위·통합·E2E 필수 시나리오가 모두 통과해야 한다.
- 미완성 메시지, 타 사용자 대화, OAuth 토큰과 내부 오류 정보가 노출되지 않아야 한다.
- 2차 이관 항목은 1차 완료 판정에 포함하지 않는다.
