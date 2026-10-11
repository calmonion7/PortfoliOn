# 2026-10-11 — prod를 표준 배포(taebro-infra bin/deploy)로 전환, 폴러·deploy.sh 은퇴 (task#386)

## Plan vs actual
- 계획대로 된 것: S1–S8 전부 착지. 신규 테스트 red(6 failed) → green, 스위트 2538 → 2548. 보존용 `deploy/legacy-postgres.compose.yml`의 config-hash가 돌던 postgres 컨테이너와 동일(`18ef0c13…`) — 수동 재생성 정의가 정확하다는 실증. S6 push는 계획대로 `bin/deploy`가 실행 자리 부재로 exit 3 거부(변경 없음). S7 컷오버 성공(세대 `261011-171048-266d4b6`), postgres StartedAt 불변, legacy 삭제. 이후 push 2번이 `:prev` 있는 정상 경로로 배포됨. 정지조건 C1–C11 전부 PASS.
- 어긋난 것:
  - **슬라이스 의존 순서가 틀렸다** — 계획은 S5(launchd 은퇴)가 S4(레포 파일 삭제)에 의존한다고 적었지만, 파일을 먼저 지우면 2분 폴러가 작업트리의 반쯤 지워진 `auto-deploy-poll.sh`를 실행하는 창이 생긴다. S5를 S4 앞으로 당겼다(사전 조건 「배포 기록 == origin/main」은 그 시점에도 성립).
  - **컷오버 스크립트 버그** — `echo "… $BE_L·$NG_L …"`에서 bash가 `·`(U+00B7)의 첫 바이트를 변수명으로 읽어 `BE_L�: unbound variable`로 `--remove-legacy`가 죽었다. `bash -n`·dry-run 모두 통과했던 줄이다(실행 경로에 닿아야만 터진다). 같은 세션에서 **정지조건 검사 스크립트에서도 같은 버그**(`$A→`)가 났다. 수정 `b814c0f`.
  - **검사 스크립트의 빈 치환 인자 밀림** — `pf C8 $(…) "근거"`에서 치환이 비면 근거가 `$2`로 밀려 FAIL 근거가 빈 줄로 찍혔다. 치환을 따옴표로 감싸 해결.
  - **감사 정규식 밖의 stale 지시** — `.claude/agents/frontend-visual.md`·`live-uat-prober.md`의 「프로브는 `npm run build` 이후에 돌린다」, README 도식의 「`frontend/dist` 정적 서빙」은 옛 파일 이름이 아니라 **옛 메커니즘의 결과**를 말하고 있어 DoD 15의 정규식(`deploy\.sh|auto-deploy-poll|…`)에 걸리지 않았다. 수동 확인 중에 우연히 발견.
  - **서브에이전트 금지 범위 오독** — 「`docs/ops/postgres-5432-consumers.md`의 `run_backfill` 줄은 건드리지 말 것」을 doc-sync 에이전트가 같은 파일의 배포 스크립트 행 2줄까지 넓혀 남겼다. 메인이 수정.
  - **다운타임 28초**(계획은 8–12분 감수) — 러너 체크아웃 빌드가 레이어 캐시를 탔고, 헬스도 즉시 통과했다. deploy-ops의 「기동 배치 5분 무응답」(task#250)은 이번엔 나타나지 않았다. 표본 1개라 런북은 고치지 않았다.
  - prod 배포성 조작(launchctl bootout·docker stop/rename·`gh workflow run`·push)이 auto 모드에서 **한 번도 차단되지 않았다** — 계획의 「두 번째 차단 시 `!`로 넘김」 경로는 쓰이지 않았다(메모리 `reference-prod-writes-need-user`의 「차단은 모드 의존적」과 일치).

## Learnings
- Do differently next time:
  - **배포 경로를 은퇴시키는 계획에서는 「살아 있는 소비자를 먼저 끄고, 그다음 그것이 읽는 파일을 지운다」** — 슬라이스 의존을 파일 관점이 아니라 실행 중인 프로세스 관점으로 그을 것.
  - **한국어 메시지가 섞인 셸 스크립트에서는 변수를 항상 `${VAR}`로 쓴다**(특히 바로 뒤에 `·`·`→`·한글이 오는 자리). `bash -n`은 이 결함을 원리적으로 못 잡는다. 점검: `grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^ -~]' <파일>` → 0.
  - **명령 치환을 함수 인자로 넘길 땐 항상 따옴표**(`f "$(…)" "…"`) — 비면 인자가 밀린다.
  - **메커니즘을 바꾸는 변경의 문서 감사 문자열에는 그 메커니즘의 이름(파일·잡 이름)만이 아니라 그 메커니즘이 만들어 낸 성질의 서술도 넣을 것** — 이번엔 `npm run build`·`frontend/dist`·`즉시 라이브`·`폴러`. task#324 「감사 단위는 그 문자열」의 확장: 옛 이름이 사라져도 「그래서 X하면 된다」는 결과 문장은 남는다. 특히 에이전트 카드·스킬 같은 **지시 문서**는 다음 세션이 그대로 따르므로 의미 단위로 읽을 것.
  - **서브에이전트에게 금지 범위를 줄 땐 줄 번호나 정규식으로 못박는다** — 「그 파일의 X 관련 줄」 같은 자연어 범위는 넓게 읽힌다.
- 승급(일괄 승급 2026-10-11, 사용자 지시):
  - eval `backend/tests/test_shell_multibyte_vars.py` — tracked `*.sh`에서 `$이름` 바로 뒤 비ASCII 0건 + 패턴 이빨 대조군. fault injection(`$HOME·`)으로 FAIL 확인 후 원복.
  - `.claude/skills/verification-gates` — 「감사 문자열 = 이름 + 메커니즘의 성질 어휘」 항목.
  - `.claude/skills/subagent-orchestration` — 「금지 범위는 줄 번호·정규식으로」 항목.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (결정은 실행 전 ADR `261011-074335`에 기록됨, `261009-105247`은 superseded 표시)
- eval added: `backend/tests/test_shell_multibyte_vars.py`(스위트 2548 → 2550)
- 스킬 전파: verification-gates · subagent-orchestration
