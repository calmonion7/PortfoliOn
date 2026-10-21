# RUN — 심층 리포트 화면 m278 모바일 넘침 수정 + uat369 넘침 축 정정 (task 394)

실행: 2026-10-21 · fg-loop 드라이브 · 직접 실행(워크플로 없음 — 파일 4개 규모)

## 조각별 결과
- S1 uat369 `BASE` env·`no-h-scroll` 설정 폭 기준·`no-element-beyond-viewport`·`content-preserved` 추가(기대 총계 230→246, pc1440을 먼저 재도록 순서 변경) — ✅ 계획대로, CSS 수정 전 dev 스택에서 red 확인
- S2 사업부문 그리드 `minmax(min(260px, 100%), 1fr)` · 증권사 행 `flexWrap` — ⚠ 육안 확인 후 2차 수정 추가(아래)
- S3 dev push → Deploy 2회(`2d024b2`, `3596014`) success → uat369 CRCL·000660 green → 스크린샷 확인 — ✅

## DoD 기준선 → 결과
1. 프로브 red(수정 전 dev 스택, 새 프로브): CRCL m278 `no-h-scroll — innerWidth=314 scrollWidth=314 vs 278` ✗ · `no-element-beyond-viewport — n=22` ✗ (light·dark 4 FAIL, 242/246) · 000660 6 FAIL(위 2축 + `help-popover-question` 2) → red 확인. `content-preserved`는 수정 전에도 통과(내용 손실 없음의 기준선).
2. green: CRCL 246/246 · 000660 246/246 (FAIL 0, 총계 == 기대 총계). 000660 m278 「?」 팝오버도 함께 풀렸다 — task#393이 기록한 클릭 가로챔의 원인이 이 넘침이었음을 확인.
3. vitest 1090 → 1090 passed. 바꾼 파일 eslint 새 오류 0(`AnalystReport.jsx:39`·`:340` 2건은 선재).
4. 스크린샷(m278 light, 에이전트 육안): `scratchpad/CRCL-brokers.png`·`000660-brokers.png`·`CRCL-seg.png`·`000660-seg.png` — 카드·행 모두 278 안, 잘림·겹침 없음.

## 계획과 달라진 점
- **1차 수정 후 육안 확인에서 결함 발견 → 2차 커밋**: `flexWrap`만 넣으니 넘침은 사라졌지만(프로브 246/246 green) 증권사 이름이 「B.」·「I」 한두 글자로 눌리고, 행마다 줄바꿈 위치가 갈렸다(Keefe 행은 수치가 왼쪽 아래로, 다른 행은 날짜만 내려감). **프로브가 ALL PASS인 상태에서 육안만 잡은 결함**이다(CLAUDE.md ⓐ 규율 그대로). `mobile.css`에 `.broker-row__break`(360 미만에서만 `flex-basis:100%`)를 넣어 모든 행을 「이름·의견 / 수치·날짜」 2줄로 고정했다. 360 이상은 무변경(break는 `display:none`).
- 계획이 넘침 원인으로 적었던 「← 종목 리포트」 pill·하단 탭바는 `position:fixed`라 넓어진 레이아웃 뷰포트를 따라간 증상이었다 — 따로 고치지 않았고 넘침 해소로 함께 사라졌다.
- 증권사 행의 가용 폭이 실측 172px(m278)이었다 — 고정폭 요소(수치 76 + 날짜 66 + 간격 30)만으로 꽉 차서 한 줄 배치가 원리적으로 불가능했다.

## 메모
- dev 스택 데이터는 10-09판까지(9렌즈)라 렌즈 10 구역은 dev에서 못 쟀다. prod 10-21판(000660) m278 실측에서 렌즈 10은 넘침 원인이 아니었다(넘친 것은 날짜 span·탭바뿐).
- prod 반영은 dev→main 머지(사람) 후. 머지 뒤 `TICKER=000660 node scripts/uat369-lens-report.mjs`(기본 BASE = prod)로 렌즈 10 판 포함 재확인 가능.
