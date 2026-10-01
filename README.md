# ERP Chatbot

ERP 챗봇 1차 초안입니다. 현재 저장소에서 독립 실행한 뒤 `wjd-erp`의 `apps/api`와 `apps/web`에 모듈 단위로 이식할 수 있도록 npm workspaces 모노레포로 구성했습니다.

## 실행

요구 환경은 Node.js 22 이상입니다.

```bash
npm install
npm run start:all
```

API와 Web 개발 서버를 한 번에 띄우고, `Ctrl+C`로 끄거나 한쪽이 종료되면 나머지도 함께 종료됩니다. 개별 실행이 필요하면 `npm run dev`(API), `npm run dev:web`(Web)을 쓸 수 있습니다.

- API: `http://127.0.0.1:3000`
- Web: `http://127.0.0.1:5173`
- 기본 모델 공급자: 로컬 Claude Code CLI OAuth (`claude-cli`)
- 로컬 DB: `.data/chat`의 PGlite
- 운영 DB: `DATABASE_URL`이 있으면 PostgreSQL 사용

`.env.example`을 참고해 `.env.local`을 구성합니다. `.env.local`은 Git에서 제외되며 OAuth 토큰을 브라우저나 DB로 전달하지 않습니다.

## 주요 명령

```bash
npm run typecheck
npm test
npm run build
npm run db:migrate
npm run db:cleanup
```

운영 환경에서는 `npm run db:cleanup`을 하루 한 번 스케줄링합니다. 만료된 데이터는 소프트 삭제 없이 완전 삭제하며, 공간 재사용은 PostgreSQL autovacuum에 맡깁니다.

## 이식 지점

- API 모듈: `apps/api/src/modules/chat`
- SQL 마이그레이션: `apps/api/db/116_chat_core.sql`, `117_chat_search.sql`
- React 기능 모듈: `apps/web/src/chat`
- shadcn/ui 프리미티브: `apps/web/src/components/ui`

운영 이식 시 `request.user.id`를 기존 ERP 세션 인증 훅에서 주입해야 합니다. 프로덕션에서는 개발용 사용자 헤더와 기본 사용자 ID를 사용하지 않습니다.
