<!-- forge-slug: standard-deploy-cutover-2of2 -->
<!-- task: 387 -->
<!-- part: 2/2 -->
<!-- priority: high -->
<!-- tdd: off -->
# ⑥-1 2/2 — dev 스택(8084, 공용 DB `portfolion_dev` = prod 복사본, 스케줄러·외부 키 없음) 배포 1회

## 목표 / 비목표
- 목표:
  1. `dev` 브랜치 push → `bin/deploy portfolion dev` → `127.0.0.1:8084`에 dev 스택이 뜬다. **dev Deploy run success 1회**.
  2. dev는 외부 키가 없고 스케줄러가 꺼져 있어서, prod 외부 자원(키움·KIS 토큰, 루틴 발사)을 **구조적으로** 건드릴 수 없다.
  3. fg-done 봉인으로 infra에 ⑥-1 완료를 보고한다(G4의 PortfoliOn 줄).
- 비목표:
  - `dev` 브랜치 작업 흐름(dev에서 작업 → main 머지). 이번엔 main과 같은 커밋으로 만들기만 한다.
  - dev의 tailnet 노출(`tailscale serve` — infra 몫, 계약 2절).
  - prod 쪽 변경 일체(1/2에서 끝남). prod DB는 **덤프 읽기만** 한다.
  - dev OAuth 로그인(OAuth 키 없음 — 이메일/비번 로그인만).

## 진실의 원천
- 용어: 없음.
- 관련 ADR: `.forge/adr/261011-074335-standard-deploy-cutover-poller-retired.md`(결정 3 — dev는 외부 키 없음·스케줄러 꺼짐).
- 외부 근거: 계약 v5 3·6절(`~/runtime/taebro-infra/docs/CONTRACT.md`), 템플릿 체크리스트 `~/runtime/taebro-infra/templates/project/README.md` 2·3절.
- **사람 선행 단계(계약상 사람만 — 이것이 끝나기 전에는 fg-run을 시작하지 말 것)**:
  1. taebro-infra Actions → **DB Provision** → `project=portfolion`, `env=dev`(먼저 `dry_run`, 그다음 실전).
  2. `! bash ~/runtime/taebro-infra/scripts/human/env-from-issuance.sh portfolion dev` → `~/runtime/portfolion/dev/.env`(600)에 `DATABASE_URL`.
  - 에이전트는 발급 파일(`~/.config/taebro-infra/db/*.url`)을 읽지 않는다.
- 그릴링 결정:
  - dev DB = **prod 복사본**(계약 6절 허용 — dev는 터널 미연결). 에이전트가 직접 한다: `docker exec portfolion-postgres-1 pg_dump -Fc` → 덤프 파일 → `docker run --rm --network taebro-db --env-file ~/runtime/portfolion/dev/.env -v <덤프>:/d.dump postgres:16-alpine sh -c 'pg_restore --no-owner --no-acl -d "$DATABASE_URL" /d.dump'`. 비밀번호는 출력하지 않는다. 덤프 파일은 `$CLAUDE_JOB_DIR/tmp` 같은 임시 위치에 두고 끝나면 삭제한다. 분류기에 막히면 두 번째에 같은 명령을 `!` 스크립트로 넘긴다.
  - dev `.env`에 에이전트가 **덧붙이는** 것: `SCHEDULER_ENABLED=false`, dev 전용 새 난수 `JWT_SECRET`·`SESSION_SECRET`(`openssl rand -hex 32` — prod 값 복사 금지). 그 밖에 기동에 필수인 키가 있으면 실측해 더한다(비밀 아닌 값만). **외부 키(KIWOOM·KIS·DART·FRED·KITA·KOFIA·ANTHROPIC·COWORK_*·GOOGLE·GITHUB)는 넣지 않는다.**
  - `DATABASE_URL` 호스트 = `taebro-postgres:5432` → dev backend가 외부 네트워크 `taebro-db`에 붙어야 한다. 1/2의 compose는 prod 전용 네트워크만 가지므로, dev에서만 `taebro-db`에 붙는 방법을 정해야 한다. **prod backend를 `taebro-db`에 붙이는 변경은 하지 말 것**(⑥-2 범위). 근거(실측 2026-10-11): `taebro-db`에서 `taebro-postgres-1`이 별칭 `postgres`를 가진다. prod backend가 두 네트워크에 붙으면 `DATABASE_URL`의 호스트 `postgres`가 prod DB와 공용 DB 중 어느 쪽으로 풀릴지 모호해져, prod가 엉뚱한 DB로 붙을 수 있다. 후보: `COMPOSE_PROFILES`나 실행 자리 `.env` 보간으로 네트워크를 고르는 방법, 또는 `docker-compose.override.yml`을 `RUNTIME_FILES`에 dev 전용으로 넣는 방법. `bin/deploy`는 override를 인식한다(117–118행). 다만 `RUNTIME_FILES`는 prod·dev 공용이다. 착수 시 계약 범위 안에서 가장 작은 방법을 고르고, run.md에 근거를 적는다. 막히면 멈추고 사람에게 묻는다.
  - 백엔드 이미지는 prod와 같은 레포 커밋으로 빌드된다(compose 프로젝트 `portfolion-dev` → 이미지 `portfolion-dev-backend`·`portfolion-dev-nginx`).
- 완료 정의(DoD):
  1. 사람 선행: `grep -c '^DATABASE_URL=' ~/runtime/portfolion/dev/.env` → `1`(값 비출력). 착수 전 폴더 없음.
  2. `grep -cE '^(KIWOOM|KIS|DART|FRED|KITA|KOFIA|ANTHROPIC|COWORK|GOOGLE|GITHUB)_' ~/runtime/portfolion/dev/.env` → `0`, `grep -c '^SCHEDULER_ENABLED=false$'` → `1`. 회귀 가드 + 전진 검사.
  3. 복원 검증: dev DB와 prod DB에서 `select count(*) from information_schema.tables where table_schema='public'`과 `select count(*) from users`가 같다(dev는 `--env-file` 컨테이너 안에서 `psql "$DATABASE_URL"`, prod는 `docker exec portfolion-postgres-1 psql -U portfolion`).
  4. `git ls-remote --heads origin dev | wc -l` → `1`. 착수 전 0.
  5. `gh run list --workflow deploy.yml --branch dev -L5 --json conclusion,headSha` 중 success ≥1, 로그에 `완료 — portfolion-dev 세대`. `cat ~/runtime/portfolion/dev/.taebro-deploy` → 세대 기록.
  6. `curl -s http://127.0.0.1:8084/health` → `portfolion` 포함. `docker port portfolion-dev-nginx-1` → `127.0.0.1:8084`만(0.0.0.0 아님). `docker inspect -f '{{.HostConfig.Memory}}'` → dev backend·nginx 모두 0 아님.
  7. 스케줄러 꺼짐: dev backend 로그에 스케줄러 기동 흔적이 없다(1/2 S1이 넣은 「건너뜀」 로그 줄이 있다). 그리고 `docker exec portfolion-dev-backend-1 env | grep -cE '^(KIWOOM|KIS|COWORK)_'` → `0`.
  8. prod 무영향: 2/2 동안 `portfolion-backend-1`·`portfolion-nginx-1`·`portfolion-postgres-1`의 `StartedAt` 불변(착수 시 기록 → 끝에 대조).
  9. G4 PortfoliOn 줄: `gh run list -R calmonion7/PortfoliOn --workflow deploy.yml -L20 --json headBranch,conclusion --jq 'map(select(.conclusion=="success").headBranch)'` → `"main"`과 `"dev"` 모두. (주의: `"main"`은 옛 run으로도 채워진다 — 1/2의 DoD 6이 headSha로 따로 보증한다.)
  10. 덤프 임시 파일 삭제됨.

## 작업 슬라이스
- [ ] S1. 착수 확인: 사람 선행 1·2 완료(DoD 1), prod 컨테이너 3개 `StartedAt` 기록 — 완료기준: DoD 1 통과 + 기록이 run.md에.
- [ ] S2. dev 네트워크 방법 결정·구현(prod 경로 무변경) — 완료기준: `TAEBRO_HTTP_PORT=8084 docker compose -p portfolion-dev --env-file ~/runtime/portfolion/dev/.env config`에서 dev backend가 `taebro-db`에 붙고, 같은 명령을 prod `.env`로 돌리면 prod backend는 `taebro-db`에 붙지 않는다. (depends: S1)
- [ ] S3. dev `.env` 덧붙이기 + prod → dev 덤프·복원 — 완료기준: DoD 2·3·10. (depends: S1)
- [ ] S4. 커밋·push(main, 변경이 있으면) → `dev` 브랜치를 main과 같은 커밋으로 만들어 push → dev Deploy run 관찰 — 완료기준: DoD 4·5·6·7. (depends: S2, S3)
- [ ] S5. prod 무영향 대조 + G4 확인 + 문서 한 줄(CLAUDE.md Deployment 절에 dev 스택 8084·외부 키 없음·스케줄러 꺼짐) — 완료기준: DoD 8·9, `grep -c '8084' CLAUDE.md` ≥1. (depends: S4)
