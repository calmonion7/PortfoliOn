# run — ⑥-1 2/2 dev 스택(8084, portfolion_dev = prod 복사본) (task#387)

## 슬라이스 결과
- S1 착수 확인 — ✅ 계획대로: 사람 선행 1(DB Provision 실전 38130053434)·2(`env-from-issuance.sh portfolion dev`) 완료, prod `StartedAt` 기록 backend/nginx 2026-10-11T09:18:29Z · postgres 2026-10-05T11:02:15Z
- S2 dev 네트워크 — ⚠ 방법 선택: 실행 자리 dev `.env` 의 `COMPOSE_FILE=docker-compose.yml:deploy/dev-db.compose.yml` 로 dev 에서만 backend 를 `taebro-db` 에 붙임(`RUNTIME_FILES` 공용 override 는 prod 에도 실려 제외). `compose config`: dev backend `default`+`taebro-db`, prod backend `default` 만. 커밋 `30786dd`
- S3 `.env` 덧붙이기 + 복원 — ⚠ 경로 우회: `SCHEDULER_ENABLED=false`·dev 전용 새 `JWT_SECRET`/`SESSION_SECRET`·`FRONTEND_URL` 덧붙임. 복원은 첫 허브 세션(백그라운드 잡, `--settings` 없음)에서 `[Production Reads]` 로 막혔고 스크립트가 잡 tmp 와 함께 두 번 사라짐 → taebro-infra task 9(런처 `--` 수정 + hub-scripts 규칙) 뒤 `~/.local/share/taebro-infra/hub-scripts/pf387-restore.sh` 로 다시 만들어 `--settings` 허브에서 실행 — 막히지 않음. 덤프 65,299,323 바이트, 공개 테이블 36=36, users 9=9, 전 테이블 행 수 일치
- S4 push·dev Deploy — ⚠ `dev` 가 main 보다 1커밋 앞(`30786dd`, main 직접 push 안 함 — 허브 규칙). Deploy 38133479935 success, `완료 — portfolion-dev 세대 261011-195205-30786dd`
- S5 prod 무영향·G4·문서 — ✅ prod 3개 `StartedAt` 불변, G4 `["dev","main"]`, CLAUDE.md Deployment 절의 dev 줄은 `30786dd` 에 이미 포함(`grep -c 8084` = 1)

## DoD baseline → after
1. dev `.env` `DATABASE_URL` 줄: 폴더 없음 → 1
2. 외부 키 0 → 0(회귀 가드) · `SCHEDULER_ENABLED=false` 0 → 1
3. 공개 테이블 수·users: dev DB 비어 있음 → 36=36 · 9=9(전 테이블 행 수 일치)
4. `git ls-remote --heads origin dev`: 0 → 1
5. dev Deploy success: 없음 → 38133479935 success · `.taebro-deploy` `generation=261011-195205-30786dd`
6. `/health` 8084: 없음 → `{"status":"ok","service":"portfolion"}` · 포트 `127.0.0.1:8084` 만 · mem backend 1073741824 / nginx 67108864
7. 스케줄러: — → 로그 `SCHEDULER_ENABLED=false — 스케줄러 기동 건너뜀` · 컨테이너 외부 키 env 0
8. prod `StartedAt`: 착수 기록 → 불변(3개 모두)
9. G4: `["main"]` → `["dev","main"]`
10. 덤프 임시 파일: — → mktemp + trap 으로 삭제

## 메모
- 실행은 두 허브 세션에 걸쳤다(285fb7ef: S1~S3 .env 까지, 6bf3faaf: 복원~S5). 사이에 taebro-infra task 9 가 끼었다.
- 새 autoMode allow(`hub-automode.json`)가 prod 읽기(pg_dump)·dev 복원을 실제로 통과시켰다 — `--settings` 로 띄운 세션에서만.
