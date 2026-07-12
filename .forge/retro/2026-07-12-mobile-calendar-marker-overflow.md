<!-- forge-slug: mobile-calendar-marker-overflow -->
# 2026-07-12 — 모바일 캘린더 이벤트 마커 오버플로우 수정 (task#179)

## Plan vs actual
- **계획대로**: 단일 슬라이스. 근본원인은 PC/모바일 공용 `MonthGrid`가 정사각 셀(aspectRatio 1/1)+pc.css padding 10px+`flex-wrap:wrap`+`overflow:hidden` 조합이라 ~55px 모바일 셀에서 이벤트 2~3개만 돼도 둘째 줄 wrap→clip. 기존 `useIsMobile()` 훅으로 모바일만 분기(셀 패딩 4px·마커 nowrap·이모지 10px·cap 3). PC 무변경. 라이브 UAT(390px) broken 0·PC 1280px 무회귀, main c58e88e 배포.
- **Divergences(경미)**:
  - 그릴링의 "cap ≈3, 라이브 조정"을 **≤3개 전부 표시 / >3개는 이모지 2개 + "+N"**으로 확정 — 모바일 행을 항상 최대 3슬롯으로 바운드. "항상 3이모지"면 >3인 날 "3이모지+ +N"이 ~43px 내부폭을 넘겨 clip되므로 초과 시 이모지를 2개로 줄여 +N 자리 확보.
  - 구현 방식: CSS 클래스 신설 + mobile.css @media 대신 기존 `useIsMobile` JS 분기 선택.

## Learnings
- Do differently next time: 특별한 함정 없음 — 소규모 반응형 폴리시. 기록할 두 기법만:
  - **좁은 셀 마커는 오버플로우 시 "개수를 줄여 슬롯 폭을 고정"해야 +N이 clip 안 된다** — 셀 폭이 마커+"+N"을 못 담으면 마커를 더 보여주는 게 아니라 줄여서 "+N"에 자리를 내줘야 한다(고정폭 원칙).
  - **"+N" 개수 계산이 JS에 있어야 하는 반응형 분기는 CSS media query보다 기존 `useIsMobile` 훅 분기가 깔끔** — 로직 일원화 + `.cal-cell`처럼 인라인/클래스 혼합이거나 미렌더 dead 클래스(CONCERNS #17, retro 2026-06-20 #80)를 건드릴 위험 회피. count 로직 없는 순수 스타일이면 반대로 mobile.css @media가 맞음.
- 검증 포인트: 정적 스크린샷만으론 clip을 못 잡아 DOM 치수 측정(scrollWidth/clientWidth·행높이/자식높이·셀 경계 초과)으로 broken 판정 — fixture-pass-live-fail 계열 재확인.

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음)
- ADR added: none (되돌리기 쉬운 반응형 레이아웃 수정, 신규 개념·결정 없음)
- 기타: 두 기법은 retro-log 수준(일반 CSS/반응형 지식이라 CLAUDE.md/CONCERNS 승급 불요).
