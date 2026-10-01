# 2026-10-01 — cc.sh 빈 세션에 첫 프롬프트를 넣어 ← 뒤에도 이름 유지 (#363)

## 계획 대비 실제
- 계획대로 된 것:
  - 원인 확정: 빈 세션(사용자 프롬프트 0개)에서 ←를 누르면, 데몬이 세션을 이어받지 않는다. 대신 "send a prompt to start" 상태의 새 bg 세션을 만들고 이름은 비우거나 자동 제목으로 붙인다(`nameSource: null|auto`, `intent: ""`).
  - #362 회고가 「원인 미확정」으로 남긴 `continued-in` 이름 소실이 이것으로 설명된다.
  - `~/cc.sh` 수정: 인자가 없을 때만 `set --`로 첫 프롬프트를 주입한다. 추가 인자 경로(`--resume`·직접 프롬프트)는 무변경이다.
  - pty 하니스 대조 재현으로 ⓐ 재현 → ⓒ 해소를 확인했다. 사용자 UAT도 통과했다.
- 차이:
  - **`/rename`(로컬 명령) 가설이 거짓이었다.** "Session renamed"는 떴지만 ← 뒤에는 여전히 이름 없는 새 세션이 생겼다. 데몬이 "비어 있지 않음"으로 보려면 **실제 모델 턴**이 필요하다. 그래서 탭마다 1턴 비용이 생긴다(PLAN은 opus).
    - 계획에 「ⓑ 실패 시 S1 전에 cx 범위를 다시 묻는다」를 조건부 단서로 미리 박아 둬서, 재그릴링 없이 한 질문으로 넘어갔다(사용자: cx·cxa 모두 적용).
  - **첫 S0 실행 무효(하니스 env 오염)**: bg claude 세션 안에서 띄운 자식 claude가 부모 env를 물려받았다(`CLAUDE_CODE_CHILD_SESSION`·`CLAUDE_CODE_BRIDGE_SESSION_ID`·`CLAUDE_CODE_SESSION_ID` 등). 결과는 셋이었다.
    - 「Transcript saving is off」가 떴다.
    - 탭 제목이 부모 이름(`[PortfoliOn] PLAN`)으로 바뀌었다.
    - ← 결과가 `claude agents`에 잡히지 않았다.

    그대로 판정했으면 "대조군이 버그를 재현 못 함"으로 오독했을 자리다. `HOME/USER/LOGNAME/PATH/SHELL/LANG/TERM`만 주는 최소 env로 정정했다.
  - 계획 밖 추가 검증: 스텁 인자 검사에 더해 **수정된 cc.sh 실경로 e2e**(pty ←)도 돌렸다.

## 배운 점
- 다음엔 다르게:
  - **claude 세션 안에서 claude TUI를 실험할 때는 env를 반드시 걷어낼 것**(`os.execvpe(..., 최소 env)` 또는 `env -i HOME=… USER=… LOGNAME=… PATH=… TERM=…`). 상속된 브리지·child 마커는 transcript·이름·목록 등록을 전부 바꾼다. 「이상하게 재현이 안 된다」의 1순위 용의자다.
  - **"비어 있음" 같은 외부 도구의 판정 기준은 비용이 0인 후보부터 대조군과 함께 실측할 것.** 이번엔 ⓐ(대조군)를 먼저 돌려 하니스가 ←에 실제로 닿는다는 것부터 확인했다. 그래서 ⓑ의 실패가 하니스 문제가 아니라 진짜 실패임이 바로 판정됐다.
  - pty 하니스 요령: 실제 claude TUI는 ~12초 뒤 프롬프트가 뜨고, 모델 응답을 기다리면 ~40초가 걸린다. ←는 `\x1b[D`로 보낸다. ← 성공 여부는 출력의 「Your conversation moved to the background」 문구와 `~/.claude/jobs/<short>/state.json`의 `name`·`nameSource`·`intent`로 판정한다.
  - 판정 지표: `nameSource`가 `user`면 이름 유지, `null`·`auto`면 소실이다. `intent`가 `""`면 빈 세션 경로, 프롬프트 문자열이나 `(backgrounded)`면 이어받기 경로다.
- 후속 후보:
  - "준비됨" 응답이 끝나기 전에 바로 ←를 누르는 경우는 미측정이다. 프롬프트 제출 직후라 이어받기 경로일 가능성이 높지만 확인하지 않았다.
  - 버그 때 생긴 `clear-conversation-state`(584d279e) bg 세션이 남아 있다. 사용자 세션이라 손대지 않았다.

## 문서 갱신
- CONTEXT.md 승급: 없음(PortfoliOn 도메인 밖 개인 도구)
- ADR 추가: 없음
- eval 추가: 없음(저장소 테스트 스위트 대상 밖 dotfile)
- 사용자 결정: env 오염 교훈은 전역 CLAUDE.md로 승급하지 않고 이 회고에만 둔다.
