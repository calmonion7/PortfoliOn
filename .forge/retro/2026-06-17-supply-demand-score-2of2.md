# 2026-06-17 — 수급 종합 스코어 프론트 (대시보드 배지·상세 헤더, task#60 2of2)

## Plan vs actual
- What went as planned: 3/3 슬라이스. `ui/SupplyBadge.jsx` 공유 헬퍼(단일 매핑), `DashboardCard` 수급 배지(item.supply?.band, 추가 fetch 0), `reports/SupplySection.jsx`(밴드 헤더+근거 플래그 칩, `/{ticker}/supply-score` fetch) + `ReportDetailTabs` 기술·수급 탭 KR 게이트 한 줄, README 화면 절. npm build OK. 워크플로우 UI 리뷰 0건. Dynamic Workflow 6에이전트(직렬+리뷰).
- Divergences:
  - **(라이브 UAT FIXED · 중요)** SupplyBadge가 favorable→`success`·caution→`danger` 변형 사용. 이 앱은 KR 관례 `--up`=빨강(상승)·`--down`=파랑(하락)이라 `.badge--success`=빨강·`.badge--danger`=파랑 → 실제 렌더 **우호=빨강·경계=파랑**으로 plan(우호=녹·경계=경고색)과 **반전**. 워크플로우 UI 리뷰(mapping-correctness)는 "success=녹/danger=빨" *통념*만 가정하고 토큰 실제값을 대조 안 해 통과시킴. 사용자 결정(녹·회·주황)으로 SupplyBadge에 전용 색 명시(가격 토큰 미사용)·단일 소스라 대시보드/상세 동시 반영. 라이브 재캡처로 경계=주황 확인(b288f394).
  - (발견) `warning` 변형은 `--color-warning`/`--warning-tint` 미정의로 깨져 있음(Showcase에서만 사용) — caution 색으로 못 씀, 인라인 색으로 우회.
- 라이브 UAT: 대시보드 배지 시각 확인(테스트 계정 005930 추가→"경계"=주황, US/결측 "해당 없음"). 상세 헤더(SupplySection) 리터럴 캡처는 미수행 — Reports는 보유종목, Ranking 상세는 리포트 보유 종목만 모달, 게다가 **리서치>랭킹 국내 탭이 로딩에서 멈춤**(rankings_fetch_kr 별건 데이터 이슈, 수급 무관). 컴포넌트 배선+`/supply-score` 데이터+공유 SupplyBadge(주황 확인) 재사용으로 검증, 사용자 admin 계정 글랜스로 확정 권장.

## Learnings
- Do differently next time:
  - **variant 이름 ≠ 색. 토큰 실제값으로 검증** — "plan 힌트=추측, 코드로 검증"([[batch-source-field]])의 UI판. 이 KR 앱은 `--up`=빨/`--down`=파라 success/danger 변형이 Western 통념(녹/빨)과 정반대다. 의미 상태 배지(밴드 등)는 가격 변형(success/danger)을 쓰지 말고 **전용 색 명시**. UI 리뷰는 variant→토큰→실제 색까지 따라가 대조. → CLAUDE.md gotcha 승격.
  - **워크플로우 자동 리뷰가 통과시켜도 라이브 UAT가 시각 회귀를 잡는다** — 색/단위 같은 "보면 안다"류는 빌드/타입/리뷰가 못 본다(빌드는 클래스만 본다). 색·포매팅 변경은 사용자 직접 테스트(또는 Playwright 캡처)로 종단 확인. ([[kiwoom-short-sell-trend]] krFmt 단위 오표기와 동일 클래스.)
  - 프론트 라이브 UAT 환경 제약: 테스트 계정은 비-admin·보유 0개라 자기 데이터 추가(POST/DELETE /api/portfolio)로 대시보드는 캡처 가능하나, 리포트-의존 상세 화면은 환경 한계. 리포트/스냅샷은 shared라 스코어+리포트 둘 다 있는 종목이면 Ranking 모달로 접근 가능(단 KR 랭킹 로딩 별건 이슈로 이번엔 막힘).
- 검증 게이트: npm build·계획검증 3/3·UI 리뷰 0건·라이브 대시보드 배지 캡처(색버그 수정 후 주황 확인)으로 verified: yes. 커밋 b1588d67(기능)·b288f394(색수정) push.

## Doc updates
- CONTEXT.md promotion: none.
- ADR added: none (색 선택은 가역적, ADR 3조건 미충족; boundary는 ADR-0014).
- CLAUDE.md: **추가** — "KR 색 관례 토큰 — 의미 배지에 success/danger 변형 쓰지 말 것"(가격색 반전 트랩·전용 색 명시·warning 변형 깨짐, 사용자 확인 후 승격).
