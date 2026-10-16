# run — ⑥-2 PortfoliOn prod DB 를 공용 postgres(`portfolion`)로 이전 (task#388)

실행: 2026-10-12 06:30~06:40 KST(장 시작 전), taebro-infra 허브 세션에서 직접.

## 슬라이스 결과
- S1 발급 — ✅ DB Provision dry_run 38176569915 → 실전 38176610620(「만듦」, `portfolion.url` 600)
- S2 (TDD) eval 개정 → compose → dev — ✅ eval 「taebro-db 에 붙는 서비스는 `DATABASE_URL` 을 `${PORTFOLION_DATABASE_URL:-}` 로 고정」 red 2 → green 4. compose: backend `environment` 덮기 + `networks: [default, taebro-db]`(옛 `.env` 의 `DATABASE_URL` 은 그대로 — 롤백 안전, DB-MIGRATION 1-3). dev `.env` 에 `PORTFOLION_DATABASE_URL` → dev Deploy 38176722925 success `c242e99`
- S3 prod — ✅ 쓰기 멈춤 2026-10-11T21:33:06Z(사람 쓰기만, 스케줄러는 계속) → 덤프 65MB·12초 → `portfolion` 36테이블 == 덤프 직전 옛 DB → `.env` `PORTFOLION_DATABASE_URL`(원본 `migrate/prod.env.pre-task388`) → 릴리스 PR #17 사람 머지 `be2cd7d` → Deploy 38177058468 success 세대 `261012-063626-be2cd7d` → 사후 대조 → 로컬 `backend/.env` 새 DB → 해제 2026-10-11T21:37:03Z(약 4분)

## DoD baseline → after
- P1 `portfolion.url`: 없음 → 있음(600)
- P2 eval: 옛 불변식(기본 compose 는 taebro-db 금지) → 새 불변식 red 2 → green 4
- P3 dev: `DATABASE_URL` 은 COMPOSE_FILE 덧붙임 + 옛 키 → environment 고정, `portfolion_dev`, 8084 health ok
- P4 prod: 옛 `postgres:5432/portfolion`(옛 컨테이너) → `taebro-postgres:5432/portfolion`, 네트워크 `portfolion_default,taebro-db`, 새 DB 연결 1 · 옛 DB 연결 0, 공개 /health 200
- P5 사후 대조: 옛 DB 36테이블 **전부 불변**(전환 창 21:33~21:36Z 에 스케줄 실행이 없었다 — 「스케줄러 테이블은 예상된 차이」 분류가 필요 없었음). 새 DB 첫 스케줄 `fx_fetch` success 21:40:00Z
- P6 옛 `portfolion-postgres-1` 계속 동작·볼륨 보관(롤백·G6), 로컬 `backend/.env` → `127.0.0.1:5433/portfolion`(36테이블 접속 확인, 원본 `migrate/backend.env.pre-task388`)

## 메모
- 장 시작 전 10분 주기 사이에 전환을 끼워 넣어 스케줄러 쓰기 손실이 0이었다. 장중이면 그 사이 쓰기는 옛 DB 로 가고 다음 실행이 새 DB 에 다시 채운다(분류 대조 필요).
- 숨은 소비자: 로컬 `backend/.env`(호스트 도구·loopcheck)가 옛 prod(`localhost:5432`)를 가리켰다 — 안 바꾸면 조용히 옛 DB 를 읽는다. → DB-MIGRATION 에 「호스트 쪽 소비자」 항목으로 승격.
