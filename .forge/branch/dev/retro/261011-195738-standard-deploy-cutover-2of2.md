# 2026-10-11 — 표준 배포 전환 2/2: dev 스택(8084, portfolion_dev = prod 복사본) (task#387)

## Plan vs actual
- 계획대로 된 것: DoD 1~10 전부. dev Deploy 38133479935 success(세대 `261011-195205-30786dd`), 8084 `/health` service=portfolion, 루프백 포트·mem_limit, 스케줄러 「건너뜀」 로그·외부 키 0, prod 3개 `StartedAt` 불변, G4 `["dev","main"]`.
- 어긋난 것:
  - S2 방법 선택: 계획은 후보만 적었다. 실제로 dev 실행 자리 `.env` 의 `COMPOSE_FILE=docker-compose.yml:deploy/dev-db.compose.yml` 을 골랐다(`RUNTIME_FILES` override 는 prod 에도 실려 제외). 대가 — 안전이 「prod `.env` 에 `COMPOSE_FILE` 이 없다」 한 가지에 기대고, 덧붙임 파일 자체는 prod 실행 자리에도 복사된다(`deploy/taebro.env` 의 `RUNTIME_FILES`).
  - S3 복원이 두 번 막혔다: ① `--settings` 없는 백그라운드 잡 세션에서 `[Production Reads]` ② 스크립트가 잡 tmp 와 함께 사라짐(두 번). 실행이 세션 두 개에 걸쳤고 사이에 taebro-infra task 9(런처 `--`·hub-scripts 규칙)가 끼었다. `--settings` 허브에서는 막히지 않았다.
  - S4 `dev` 가 main 보다 1커밋 앞(`30786dd`) — 허브는 main 직접 push 를 하지 않는다. PR #15(dev→main)로 해소.
  - 복원 검증을 DoD(테이블 수·users)보다 강하게 — 전 공개 테이블 행 수를 `query_to_xml` 로 세어 diff(36=36, 전부 일치).

## Learnings
- Do differently next time:
  - 「한쪽 환경에서만 읽히는 덧붙임」을 설계할 땐 그 안전이 무엇 하나에 기대는지(여기선 prod `.env` 에 `COMPOSE_FILE` 부재) 적고, 그 반대편(기본 정의 쪽)을 테스트로 고정한다 — 실행 자리 `.env` 는 레포 밖이라 테스트가 못 보니 문서(deploy-ops)로 막는다.
  - prod 를 읽는 단계가 있는 계획은 그 단계를 `taebro-hub`(`--settings`) 세션에서 돌린다고 계획에 적는다. 백그라운드 잡에선 같은 명령이 막힌다.
  - 사람·세션을 건너 넘길 스크립트는 처음부터 `~/.local/share/taebro-infra/hub-scripts/` 에 둔다(잡 tmp 는 잡 종료와 함께 사라진다).
  - 복사본 검증은 표본(테이블 수·한 테이블) 대신 전 테이블 행 수 diff 로 — 비용이 같다.

## Doc updates
- CONTEXT.md promotion: 없음
- ADR added: 없음(방법 선택은 되돌리기 쉽고, dev 무키·스케줄러 꺼짐은 ADR `261011-074335` 결정 3)
- Eval added: `backend/tests/test_compose_dev_network.py` — 기본 `docker-compose.yml` 은 `taebro-db` 에 붙지 않고, `taebro-db` 를 쓰는 compose 는 `deploy/dev-db.compose.yml` 하나뿐. 3 passed; fault injection(기본 compose backend 에 `taebro-db`) → 2 failed 확인 후 원복.
- 스킬: `.claude/skills/deploy-ops` ⓒ — dev 네트워크 방식과 「⑥-2 전까지 prod `.env` 에 `COMPOSE_FILE`·기본 compose 에 `taebro-db` 금지」 한 줄
