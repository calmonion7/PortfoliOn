<!-- forge-slug: shared-postgres-migration-prod -->
<!-- task: 388 -->
<!-- tdd: on -->
<!-- priority: high -->
# ⑥-2 PortfoliOn prod DB 를 공용 postgres(`portfolion`)로 이전

> 2026-10-12 taebro-infra 허브 그릴링(G5 ✅, FitCheck ⑤-2 뒤). 절차 정본: taebro-infra `docs/DB-MIGRATION.md`.
> **사람 손**: 쓰기 멈춤 시작 확인, 릴리스 PR 머지(prod 배포). 장 시작(09:00 KST) 전에 끝낸다.

## Goal / Non-goals
- Goal: prod backend 가 공용 postgres 의 `portfolion` 으로 돌고(dev 는 이미 `portfolion_dev`), 사람이 만든 데이터는 이전 전후 정확히 같으며, 스케줄러가 새 DB 에서 첫 실행에 성공한다.
- Non-goals: 옛 `portfolion-postgres-1` 삭제(롤백용 — G6). `deploy/dev-db.compose.yml` 정리(dev 에 남겨도 무해 — 후속). 스케줄러 일시 정지(기각 — prod 재기동이 하나 더 든다).

## Source of truth
- ADR `261011-074335`(prod postgres 는 compose 밖, 결정 3 dev 무키). taebro-infra `docs/DB-MIGRATION.md` 1-3(같은 키 전환은 새 변수로 덮기 — 롤백 안전).
- 결정(그릴링):
  - 쓰기 멈춤 = 사람 쓰기만(보유·관심종목·메모·루틴 enrich). 스케줄러(10분 주기)는 계속 돈다 → 사후 대조는 **사람 데이터 테이블 정확히 같음 + 바뀐 테이블은 전부 스케줄러가 쓰는 것**으로 판정, 전환 뒤 새 DB 에서 스케줄 실행 success 를 확인.
  - compose: backend `environment: DATABASE_URL: ${PORTFOLION_DATABASE_URL:-}`, `networks: [default, taebro-db]`. 실행 자리 `.env` 의 옛 `DATABASE_URL`(별칭 `postgres` → 옛 컨테이너)은 그대로 — 롤백된 옛 compose 가 쓴다. dev `.env` 에도 `PORTFOLION_DATABASE_URL`(= `portfolion_dev` 발급 내용)을 넣은 뒤 dev 부터 배포.
  - eval `backend/tests/test_compose_dev_network.py`(task#387 회고)를 **의도적으로** 바꾼다: 「기본 compose 가 taebro-db 에 붙으면 backend `DATABASE_URL` 은 environment 의 `${PORTFOLION_DATABASE_URL…}` 로 고정」.
  - 로컬 `backend/.env`(호스트 도구·loopcheck 가 읽음, `localhost:5432` = 옛 prod)는 전환 뒤 새 DB(`127.0.0.1:5433/portfolion`)로 바꾼다 — 안 바꾸면 호스트 도구가 조용히 옛 DB 를 읽는다.
- Definition of Done:
  - P1 `portfolion.url` 발급 (사전: 없음 → 2026-10-12 06:30 발급)
  - P2 eval red → green, `pytest backend/tests/test_compose_dev_network.py` 통과
  - P3 dev Deploy success, dev backend `DATABASE_URL` → `taebro-postgres:5432/portfolion_dev`, 8084 `/health` portfolion
  - P4 prod: 쓰기 멈춤 중 덤프 → `portfolion` 전 테이블 행 수 일치, 릴리스 PR 사람 머지 → main Deploy success, prod backend → `portfolion`
  - P5 사후 대조: 옛 DB 재집계 vs 이전 직전 — 다른 테이블은 모두 스케줄러 쓰기 테이블, 사람 데이터 테이블 불변. 전환 뒤 새 DB `job_runs` 에 success 1건 이상
  - P6 옛 `portfolion-postgres-1`·볼륨 보관, 공개 `/health` 200, `backend/.env` 새 DB

## Work slices
- [ ] S1. 발급 — P1
- [ ] S2. (TDD) eval 갱신 → compose 변경 → dev `.env` → dev 배포 — P2·P3 (depends: S1)
- [ ] S3. prod 이전 → 릴리스 → 사후 대조 → `backend/.env` — P4·P5·P6 (depends: S2)
