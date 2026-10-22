# 2026-10-23 — 시장지표 반도체 카드 메모리 현물가를 분류 콤보로 압축 (task#404, fg-loop → 일괄 승급)

## 계획 vs 실제
- 계획대로 된 것: S1 select·선택 분류 표 1개·표 바로 뒤 차트(상태 2개, 초기 분류·대체 품목은 렌더 시 파생), S4 README 1줄. 계획이 예언한 red-first 이빨이 그대로 섰다 — 옛 배포에서 `chart-follows-table` 968.5px · `tap-chart-in-view` 차트 top 1612(vh 800) FAIL → 새 배포 8.0px · 418.
- 어긋난 것:
  - **육안 8번째** — 첫 캡처에서 select가 sticky 헤더 밑에 가려 안 보였는데 `tap-chart-in-view`는 PASS. 측정 기준점을 놓는 `scrollIntoView({block:'start'})`가 가림을 만들었다. hit-test로 되돌리고 `selVisible`을 축 조건에 넣어 재배포·재측정(커밋 `4afcc21`).
  - 프로브 축이 계획(2개)보다 3개 늘었다 — `cat-switch-chart`, 1회성 `api-total-literal`(6분류·23품목), `selVisible`. EXPECT_PER_VP 14→17.
  - red-first 실행이 ~10분 — 옛 배포엔 select가 없어 `selectOption`이 기본 30초씩 대기. 5초 타임아웃 명시.

## 학습
- 다음엔 다르게: 「한 화면」·「뷰포트 안」 축의 기준점을 스크롤로 놓을 때는 그 기준 요소의 가시성(hit-test)부터 단언할 것 — 위치 축은 가림에 블라인드하다.
- 확인된 것(유지): task#403에서 승급한 ㉦(소스 독립 리터럴)을 계획 단계에서 바로 축으로 옮겼다 — 승급 직후 다음 사이클에 실제로 적용된 사례.

## 문서 갱신
- CONTEXT.md 승급: 없음(용어 무변경)
- ADR 추가: 없음
- 스킬 가토: `.claude/skills/live-uat-probes/SKILL.md` ㉨(측정 기준점 스크롤이 sticky 헤더 밑에 대상을 가린다 + red-first 순회 호출 타임아웃)
- eval: 신규 없음 — 회귀 검사는 이미 프로브 축(`tap-chart-in-view`의 `selVisible`)에 들어갔다
