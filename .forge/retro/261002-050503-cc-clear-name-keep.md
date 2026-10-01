# 2026-10-02 — cx/cxa 세션 /clear → ← 후에도 이름 유지 (#364)

## 계획 대비 실제
- 계획대로 된 것(3차):
  - `~/.claude/cc-clear-prime` 플러그인이 `command.run{command:'clear'}`를 가로채, clear 직후 `$.prompt.submit`으로 「준비됨」 1턴을 넣는다.
  - `~/cc.sh`가 `--plugin-dir`로 이 플러그인을 cx 세션에만 싣는다.
  - e2e(← 뒤 `[S364h] PLAN`, `nameSource: user`)와 사용자 UAT를 통과했다.
- 차이(3번 시도, 2번 실패):
  - **1차 — 전제 오류.** 「bg 세션이 cc.sh env를 물려받는다」를 0bfe6655 **한 건**의 `CC_SESSION_NAME=[PortfoliOn] PLAN`만 보고 받아들였다.
    - 실제로는 그 env가 데몬 예비 프로세스(`claude bg-spare`)의 것이었고, 이름이 우연히 같았다. `[S364b]`로 재자 bg 쪽 env가 `[PortfoliOn] PLAN`으로 나와 바로 드러났다. env 기반으로 구현했다면 모든 bg 세션에 엉뚱한 이름을 붙였을 것이다.
    - 또 hook의 `sessionTitle`은 bg 세션의 `custom-title`만 바꿨다. 목록 이름(`agent-name`)은 같은 턴에 `ai-title`이 따로 덮었다. SessionStart fork와 UserPromptSubmit 둘 다 마찬가지였다.
    - 목록 이름을 `user`로 고정하는 경로는 `claude -n`과 세션 안 `/rename`뿐이었다.
  - **2차 — 문서(타입)만 믿은 기능 가정.** 타입 선언에 SessionStart가 `initialUserMessage`를 낼 수 있다고 나와 있었지만 `/clear`(source clear)에서는 무시됐다.
    - 사용자 플러그인의 `classic.SessionStart`는 Team 조직의 내장 `cc-plugin-sec-default`가 우회시켰다(`bypassed … tier user`, `seated outermost: the organization is team`).
    - pty 실측에서는 「mod 로그 0건」으로만 보여 모듈 미로드와 구별할 수 없었다. `claude -p --debug-file`로 판별했다.
  - **3차 — 시제품을 먼저 쟀다.** 사용자 질문(「스킬을 만드는 건?」)에 답하면서 두 가지를 그릴링 전에 측정했다.
    - 「/clear 뒤 직접 1턴」으로 이름이 유지된다.
    - 「command.run 가로채기 + `$.prompt.submit`」 시제품도 이름이 유지된다.

    그래서 3차 계획은 이식만 남았고 차이가 0이었다.
  - 일반 스킬(`SKILL.md`)로는 불가능하다. 모델은 `/clear`·`/rename` 같은 내장 명령을 실행하지 못한다. 플러그인 함수 hook(`$.command.run`·`$.prompt.submit`)은 가능하다.

## 배운 점
- 다음엔 다르게:
  - **전제를 단일 관측으로 받아들이지 말 것.** 값이 달라지게 바꾼 대조군으로 한 번 더 잴 것. 이번엔 다른 세션 이름이었다. 「우연히 같은 값」은 단일 관측에서 원리적으로 구별되지 않는다.
  - **외부 도구 기능은 「필드를 받는다」가 아니라 「목표 관측값이 바뀐다」로 확인할 것.**
    - hook `sessionTitle`·`initialUserMessage` 모두 출력은 정상 파싱됐다(transcript `hook_success` stdout에 있음). 그런데 목표인 목록 이름은 바뀌지 않았다.
    - 단위 DoD(「hook이 제목을 낸다」)는 통과하면서 목표는 미달일 수 있다. 판정은 `claude agents --json` name + `state.json` nameSource로 할 것.
  - **외부 동작에 기대는 설계는 시제품 e2e를 계획 전에 돌릴 것.** 1·2차는 계획 → 실측 순서라 실패마다 재그릴링이 필요했다. 3차는 실측 → 계획 순서라 한 번에 끝났다.
  - **플러그인이 「아무 일도 안 한다」면 `-p --debug-file`로 먼저 가를 것.** 로드됐는지(`hooks module … loaded`), 우회됐는지(`bypassed by`)가 거기 나온다.
  - Team 조직에서는 사용자 플러그인의 `classic.*` hook이 우회된다. 함수 hook 이벤트(`command.run`·`session.start` 등)는 통과한다.
  - bg 세션 프로세스의 env는 bg-spare 것이다. 세션 이름의 출처로 쓰지 말고 hook 입력 `session_title`을 쓸 것.
- 후속 후보:
  - attach한 bg 세션 안에서 하는 `/clear`는 덮지 못한다(bg-spare가 `--plugin-dir`를 모름). 필요해지면 `CLAUDE_CODE_PLUGIN_DIRS` 전역 설치를 검토한다. 다만 플러그인이 세션 이름을 몰라 모든 세션의 /clear에 1턴이 붙는다.
  - 현 clear hook(`cc-session-name.sh`)은 bg 세션 안 /clear에서 spare env의 엉뚱한 이름을 `custom-title`로 쓴다. 목록 이름엔 영향이 없어 실해는 작다. hook 입력 `session_title`을 쓰면 해소된다(미반영).

## 회고 후 추가 실측 (2026-10-02, 사용자 요청: 「턴 비용 없이 /rename으로는?」)
- 측정 방법: `settings.json` env `CLAUDE_CODE_PLUGIN_DIRS`로 측정 플러그인을 **전역 임시 탑재**했다. 측정 후 원복했다.
- 결과 1: **함수 이벤트 `session.start`는 ← 직후 bg 세션에서 그 bg 세션 ID로 실행된다**(bg-spare에도 플러그인이 실림). 2차 run의 「fork 시점 이벤트가 없다」는 틀렸다. classic만 우회되고 함수 이벤트는 산다.
- 결과 2: bg 기록에는 이전 이름이 따라오지 않는다(0bfe6655 때와 다름). 대신 원 세션 기록의 `continuedInSessionId: <bg id>`로 역추적할 수 있다. 최근 3분 내 수정된 jsonl만 `find -mmin -3 | grep -l`로 훑는다.
- 결과 3: 그 이름이 cc.sh 형식이면 `$.command.run({command:'rename'})` → 3/3 성공(`nameSource: user`, **추가 턴 0**). 부수 비용은 rename이 남기는 system-reminder 몇 줄뿐이다.
- 채택 시 트레이드오프:
  - 전역 설치라 모든 세션·예비 프로세스가 시작할 때 `find`+`grep`을 최대 10회(1초 간격) 돈다.
  - 경로 C(`/clear`마다 1턴)를 대체할 수 있다. #363의 첫 프롬프트 주입도 같은 방식으로 대체할 수 있을 가능성이 있다(미측정).
- 측정 플러그인 경로가 휘발 폴더(`$CLAUDE_JOB_DIR/tmp/cc-probe`)라, 측정 창 동안 뜬 예비 프로세스는 재기동 전까지 그 플러그인을 계속 싣는다(로그만 남기고 형식 일치 시 rename).

## 문서 갱신
- CONTEXT.md 승급: 없음(PortfoliOn 도메인 밖 개인 도구)
- ADR 추가: 없음
- eval 추가: 없음(저장소 테스트 스위트 대상 밖 dotfile)
- 사용자 결정: (가) Team 조직 classic hook 우회, (나) bg 목록 이름·env 출처 두 사실은 전역 문서로 승급하지 않고 이 회고에만 둔다.
