# 2026-10-12 — ⑥-2 PortfoliOn prod DB 를 공용 postgres 로 이전 (task#388)

## Plan vs actual
- 계획대로 된 것: P1~P6. eval 을 새 불변식으로 TDD 개정, dev → prod, 쓰기 멈춤 약 4분, 36테이블 일치, 옛 DB 사후 전부 불변, 새 DB 첫 스케줄 success. FitCheck ⑤-2 의 「새 변수로 덮기」 규칙을 그대로 써서 롤백 경로 유지.
- 어긋난 것: 「스케줄러 테이블은 예상된 차이로 분류」 준비는 필요 없었다(전환 창이 10분 주기 사이에 들어감). 계획 밖: 로컬 `backend/.env` 가 옛 prod 를 가리키는 숨은 소비자 — 전환 직후 바꿈.

## Learnings
- Do differently next time:
  - 자동 writer 가 있는 DB 는 **주기 사이의 빈 창**에 전환을 넣으면 사후 대조가 단순해진다 — 전환 전에 job_runs 로 다음 실행 시각을 본다.
  - 이전 체크리스트에 「컨테이너 밖 소비자」(호스트 스크립트·로컬 .env·loopcheck)를 넣는다 — 배포 대상이 아니라서 아무 검사도 잡지 못한다.

## Doc updates
- CONTEXT.md promotion: 없음 · ADR added: 없음(ADR 261011-074335 결정 1 「⑥-2 까지」는 이번에 끝난 것 — 봉인 노트로 충분)
- Eval: `backend/tests/test_compose_dev_network.py` 개정(실행 중)
- 프로젝트 밖 승격: taebro-infra `docs/DB-MIGRATION.md` — 「컨테이너 밖 소비자」·「주기 사이 창」
