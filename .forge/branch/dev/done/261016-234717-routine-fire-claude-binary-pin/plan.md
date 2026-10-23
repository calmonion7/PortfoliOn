<!-- forge-slug: routine-fire-claude-binary-pin -->
<!-- task: 389 -->
<!-- priority: high -->
<!-- tdd: on -->
# 루틴 fire 리스너가 깨진 npm `claude`를 실행해 이틀째 전 회차 실패 — 네이티브 절대경로 고정 + fire마다 사전 점검

## 배경 (그릴링에서 확정한 사실)
- 증상: ASML을 심층 리포트 대상으로 지정(`PUT /api/admin/analyst-targets/ASML` 200)한 뒤 즉시 발행 → `POST /api/admin/cowork/fire` **502** 2회(10-16 21:35·21:38). backend 로그: `[CoworkTrigger] fire 실패 (HTTP 500): {"ok": false, "error": "[Errno 8] Exec format error: 'claude'"}`.
- 원인: 10-14 22:25 fnm 기본 node의 npm 전역 `@anthropic-ai/claude-code`가 2.1.299로 올라가면서 네이티브 바이너리 postinstall이 안 돌았다. 그래서 `bin/claude.exe`가 **shebang 없는 셸 스크립트**(`Error: claude native binary not installed.`)로 남았다. 리스너 plist PATH의 맨 앞이 `fnm/aliases/default/bin`이고 `~/.local/bin`은 **아예 없다**. 그래서 리스너는 원래부터 npm 쪽 `claude`를 써 왔고, 이번 업그레이드로 그 경로가 깨졌다.
- 영향(리스너 로그 `~/Library/Logs/portfolion-cowork-fire.log`): 10-15·10-16 02:00 야간 enrich **전량 회차 실패**. 이때 리스너는 먼저 `200 queued`로 응답했기 때문에 backend는 성공으로 기록했다. 10-15·10-16 07시대 fire 500. 10-16 ASML 2회 500.
- 정상 실행기: `~/.local/bin/claude` → 네이티브 arm64 2.1.143, `--version` 65ms.
- 기본 동작 재현: shebang 없는 실행 파일을 `subprocess`로 띄우면 `OSError errno 8`(Exec format error)이 난다 — 스크래치에서 확인함.
- 리스너 정본: `scripts/cowork-fire-listener.py`. **dev는 main보다 5커밋 뒤**라 이 파일이 실행 사본과 다르다. 실행 사본은 `~/runtime/portfolion/prod/scripts/`이고 `669b390` 기준이다. prod 배포 훅(`ea3f787`)이 사본을 복사한 뒤 리스너를 재기동하고, 8787 LISTEN을 확인한다.

## 목표 / 비목표
- 목표: 리스너가 PATH·npm 상태와 무관하게 **네이티브 `claude`**를 실행한다. 실행기를 띄울 수 없으면 **fire를 받는 시점에 500과 사유**를 응답한다(전량 모드의 거짓 `200 queued` 제거). 그다음 호스트의 깨진 npm 설치를 지우고, ASML 첫 발행과 야간 enrich 1회로 복구를 확인한다.
- 비목표:
  - 외부 알림·대시보드 경보 신설(fire 실패를 화면에 띄우는 것). backend `cowork_trigger`·`job_runs` 배선은 무변경.
  - plist 수정. plist는 레포 밖 호스트 자원이고, 절대경로 고정으로 필요가 없어졌다.
  - opencode 실행기 경로 변경. `shutil.which` 폴백은 그대로 두고, 사전 점검만 두 실행기에 공통으로 적용한다.
  - 07시대 회차 별도 재실행. ASML 즉시 발행이 같은 「전 정책」 수동 fire라서 그걸로 메운다.
  - ADR. 되돌리기 쉬운 결정이라 남기지 않는다.

## 정본
- 용어: `.forge/CONTEXT.md`의 「심층 리포트 (Analyst Report)」, 「루틴」
- 관련 ADR: ADR-0027(심층 리포트 발행 자원·가드레일), ADR-0028(fire 리스너 — 백엔드는 LLM 미호출)
- 완료 정의(DoD):
  1. `cd backend && .venv/bin/python -m pytest -q tests/test_cowork_fire_listener.py` → 전부 통과. 아래 신규 테스트를 포함한다.
     - ⓐ 실행기가 shebang 없는 실행 스크립트(실제 고장 모양 그대로)이면 **전량 모드** `POST /fire`가 500이고, 본문에 실행기 경로와 사유가 있으며, 큐는 비어 있다.
     - ⓑ 같은 조건에서 **단일 모드**도 500이다.
     - ⓒ claude 분기 argv[0]이 `Path.home()/".local/bin/claude"` 절대경로다. 기존 `test_runner_argv_claude_unchanged`를 이 단언으로 **고친다**(무회귀 이빨 → 절대경로 이빨).
     - ⓓ 정상 실행기(`--version` exit 0)이면 기존 200 경로가 그대로다.
     - 작성 시점 사전상태: ⓐ~ⓒ는 아직 없는 전방 검사다. TDD로 **먼저 빨간불**을 내야 하고, 현 코드에서 ⓐ는 200 queued, ⓒ는 `"claude"`라서 실패해야 한다. ⓓ는 회귀 가드라 미리 통과한다.
  2. `cd backend && .venv/bin/python -m pytest -q` 전체 green(작업 브랜치 기준).
  3. 배포 확인: Deploy run의 `headSha`가 머지 커밋이고 `conclusion=success`다. `/usr/bin/grep -c 'local/bin/claude' ~/runtime/portfolion/prod/scripts/cowork-fire-listener.py` → ≥1. 리스너 로그에 배포 시각 이후 `listening on 127.0.0.1:8787` 줄이 있다.
     - 사전상태: grep 결과 `0`(전방 검사, 정상).
  4. 호스트 정리(실행 직전 한 줄 확인): fnm 기본 node에서 `npm uninstall -g @anthropic-ai/claude-code`. 이후 `/bin/ls -d ~/.local/share/fnm/aliases/default/lib/node_modules/@anthropic-ai/claude-code`가 없음이어야 하고, `which -a claude`에는 네이티브 경로만 남는다.
     - 사전상태: 디렉터리 존재(전방 검사, 정상).
  5. ASML 첫 발행(즉시 발행 버튼, 또는 `POST /api/admin/cowork/fire`): 리스너 로그가 `POST /fire 200`이고, 그 run의 `run.log`에 세션 작업이 남는다. `docker exec portfolion-backend-1 python -c "from services import db; print(db.query(\"SELECT ticker, published_date FROM analyst_reports WHERE ticker='ASML' ORDER BY published_date DESC LIMIT 1\"))"` → 1행.
     - 사전상태: `[]` — ASML은 발행 이력 0(전방 검사, 정상).
     - 이 검사가 통과하면서도 깨질 수 있는 방식: 루틴이 「7일 게이트·회당 2종목」 재량으로 ASML을 건너뛰면 fire 200인데 발행 0이다. 그때는 run.log에서 건너뛴 사유를 보고, 트리거 text로 ASML을 명시해 재fire한다.
  6. 야간 enrich 1회 수동(실행 직전 한 줄 확인): `docker exec portfolion-backend-1 python -c "from scheduler.jobs import _run_nightly_enrich; _run_nightly_enrich()"` → 리스너 로그에 `청크 k/k 완료`가 끝까지 찍히고 `전량 회차 실패`는 0이다. 배치현황 trigger가 `auto`로 찍히는 것은 감수한다.
  - 영구 회귀 검사(eval): DoD 1의 ⓐ·ⓒ가 이번 고장(깨진 실행기 → 거짓 200 / PATH 의존)을 기계적으로 재현하고, 빨강 → 초록으로 증명한다.

## 작업 슬라이스
- [ ] S1. `origin/main`에서 작업 브랜치를 판다(dev는 리스너 파일이 5커밋 뒤). `scripts/cowork-fire-listener.py`의 `_runner_argv` claude 분기를 `str(Path.home() / ".local" / "bin" / "claude")`로 고정하고 docstring의 「바이트 동일」 서술을 정정한다. 「fire마다 사전 점검」 헬퍼를 넣는다: `[argv0, "--version"]`을 짧은 timeout으로 실행해, `OSError`·timeout·비0 exit이면 사유 문자열을 반환한다. `do_POST`가 큐 적재·스폰 **전에** 호출해 실패면 500 `{"ok": false, "error": "<실행기 경로>: <사유>"}`를 응답하고 `_log`로 남긴다. TDD: DoD 1 ⓐ~ⓓ를 먼저 쓰고 빨간불을 확인한 뒤 구현한다. — 완료기준: DoD 1·2 통과.
- [ ] S2. PR을 만들어 사람에게 머지를 넘긴다(main 직접 push 금지). 머지 후 배포를 판정한다. — 완료기준: DoD 3. (depends: S1)
- [ ] S3. 호스트의 깨진 npm `claude-code`를 제거한다(한 줄 확인 뒤). — 완료기준: DoD 4. (depends: S2 — 배포 전에 지우면 옛 코드 리스너가 `No such file`로 계속 실패하니 순서를 지킨다)
- [ ] S4. ASML 즉시 발행으로 종단 확인. — 완료기준: DoD 5. (depends: S2)
- [ ] S5. 야간 enrich 1회 수동 실행(한 줄 확인 뒤). S4 세션이 끝난 뒤에 돌려 동시 세션을 피한다. — 완료기준: DoD 6. (depends: S4)
