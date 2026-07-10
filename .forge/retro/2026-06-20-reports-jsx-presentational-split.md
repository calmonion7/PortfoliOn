# 2026-06-20 — Reports.jsx 인라인 렌더 4개를 프레젠테이션 컴포넌트로 분리 (god-file-split R3)

## Plan vs actual
- What went as planned:
  - 인라인 렌더 함수 4개(renderStockCard·renderTickerItem·renderFilters·상세 헤더 블록)를 `components/reports/`의 StockCard·TickerListItem·ReportFilters·ReportDetailHeader로 추출. 동작·시각 무변경(순수 구조 추출), 로직·state·핸들러·훅·CSS 전부 잔류.
  - 슬라이스별 build green(728→729→730→731→732 모듈, 신규 4파일만큼 증가). props over closures 명시 배선, `pnlOf`는 부모 잔류·결과만 prop 전달(계획 결정대로). ADR 미생성(계획대로).
  - 검증: build green·ESLint 신규에러 0(현재=원본 동일 9건 전부 기존)·Playwright 데스크톱+모바일 UAT 16/16 PASS. main 91173837 커밋·푸시.
- Divergences:
  - **실행 방식**: fg-run 워크플로우 대신 직접 순차 실행. 4 슬라이스가 모두 동일 파일 `Reports.jsx`를 수정 → 병렬 서브에이전트는 쓰기 충돌. prop 배선 결정도 상호 의존적이라 파일 전체를 한 컨텍스트로 본 게 안전·저비용(스킬의 single-agent 허용).
  - **라인 수**: 목표 ~370줄 → 실제 447줄(원본 804에서 -44%). 갭의 주원인은 호출부 멀티라인 prop 배선(컴포넌트별 13·15·24·10 props, 기존 ReportDetailTabs 호출 스타일과 일치). 실질 목표(렌더 함수 4개 추출·god-file 해소·무동작변경)는 완전 달성.

## Learnings
- Do differently next time:
  - **props 많은 프레젠테이션 추출은 부모 호출부가 부푼다 — 라인 추정에 prop당 ~1줄을 반영하라.** "함수 본문이 빠지니 N줄 줄겠지"만 보면 빗나간다. 추출 컴포넌트가 클로저 대신 명시 props를 받으면(이 앱의 기존 멀티라인 prop 스타일), 호출부가 prop 개수만큼 늘어 절감폭을 깎는다(이번 24/15/13/10 props → 호출부 ~60줄 추가). god-file-split류 후속(R4 등) 추정 시 `Σ(컴포넌트별 prop 수)`를 호출부 비용으로 더할 것. 라인수 목표는 hard gate가 아니라 근사치로 둘 것(`≤~N`).
  - **같은 파일을 만지는 다중 슬라이스는 병렬 불가 — fg-run은 순차 single-agent로.** 모든 슬라이스가 한 파일을 수정하면 병렬 워크플로우는 쓰기 충돌이 보장된다. 게다가 추출 간 prop 배선 결정이 얽혀 있어, N개 에이전트가 파일 구조를 각자 재발견하는 것보다 한 컨텍스트가 일관·저비용. fg-run 워크플로우 구성 시 "슬라이스들이 공유하는 쓰기 대상이 있나?"를 먼저 보고, 있으면 직접 순차로 내릴 것.
  - **후속 후보(미수정, surgical-change 원칙)**: `Reports.jsx`에 추출 이전부터 있던 dead code — `hasFetched`(useReportList 구조분해)·`watchlistAll`·`setDetailRefreshKey`(setState 미호출) 미사용 + 기존 react-hooks lint 에러(set-state-in-effect 3·exhaustive-deps 2). 내 변경 소산 아님 → 제거 안 함. 별도 청소 작업(fg-quick 후보)로 분리 가능. 비목표였던 종목관리 핸들러/필터·정렬 훅 추출(R4)은 프론트 단위테스트 부재로 회귀 위험, 보류 유지.

## Doc updates
- CONTEXT.md promotion: none (프레젠테이션 컴포넌트 = 일반 React 개념, 컨텍스트 고유 용어 아님)
- ADR added: none (전부 기존 components/reports/ 패턴 내 가역적 변경 — 계획도 ADR 불요 명시)
