# 2026-10-03 — cx/cxa `/clear` 뒤 1턴 주입 제거 (#366)

## 계획 대비 실제
- 계획대로 된 것: S2(`cc.sh`에서 `--plugin-dir`·주석 제거, `cc-clear-prime` → `cc-clear-prime.disabled` 보존), S3(`cxa --dry-run` 8→8).
- 차이: S1(rename 핸들러 시제품)을 만들지 않았다. 계획 전제 「`/clear`가 이름을 잃는다」가 실측에서 반대로 나왔다. Claude Code 2.1.287에서 `/clear`는 `~/.claude/sessions/<pid>.json`의 `name`·`nameSource:user`를 지우지 않고(sessionId만 갱신), 빈 세션을 ←로 내보내면 기존 `cc-name-restore`가 이미 복원한다(4/4, 모델 턴 0). 1턴 주입이 필요했던 것은 복원 플러그인(#365) 이전이었다.

## 배운 점
- 다음엔 다르게:
  - **회고의 「미측정」 후속 후보를 계획 전제로 쓰기 전에 기준선(아무것도 바꾸지 않은 상태)을 먼저 잰다.** #365가 「`/clear` 뒤 ←에서도 복원되는지 미측정」이라 적었는데 그 미측정 사항을 전제로 그릴링 4문항과 계획을 썼고, 기준선 한 번으로 해소됐다. 해결책을 설계하기 전에 문제가 지금 존재하는지부터 잰다.
  - **tmux로 `claude`를 측정할 땐 부모의 `CLAUDE_CODE_*`(MESSAGING_SOCKET·TOKEN·SESSION_ID·CHILD_SESSION 등)와 `CC_SESSION_NAME`을 비울 것.** 안 비우면 자식 세션이 부모 이름을 `nameSource:peer`로 물려받아 `-n`을 무시한 것처럼 보이고 측정이 오염된다. 격리 하니스는 `env -u …`로 만들고 `~/.claude/sessions/*.json`의 name·nameSource와 `claude agents --json`을 함께 본다.
  - **도구 동작 사실에는 버전을 붙인다.** `/clear`의 이름 유지는 2.1.287 실측이다. #364 때는 사라졌다고 기록돼 있어, 그 사이 동작이 바뀌었거나 관측 경로(목록 vs 세션 파일)가 달랐을 수 있다. 어느 쪽인지는 미확정이다.
  - **조건부 단계의 사용자 `!` 명령 문구는 조건이 확정된 뒤에 준다.** S1 통과 전에 settings.json 편집 명령을 미리 줘서 사용자가 지금 실행해야 하는 줄 알고 혼란이 있었다(실행 불필요로 끝났다).
- 후속 후보:
  - 직접 지은 이름을 `/clear` 후 ←까지 잇는 일은 `cc-name-restore`의 형식 가드(`[프로젝트] PLAN|RUN`)를 풀어야 한다(이번 비목표 그대로).
  - 실제 `cxa`(opus/sonnet) 세션에서 `/clear` → ← 육안 확인은 다음 실행 때 한 번 한다.

## 문서 갱신
- CONTEXT.md 승급: 없음(PortfoliOn 도메인 밖 개인 도구)
- ADR 추가: 없음
- eval 추가: 없음(저장소 테스트 스위트 대상 밖 dotfile)
