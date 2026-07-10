# 2026-06-06 — ETF 종목 리포트 상세에 표시 가능한 탭/내용만 노출 (task 9)

## Plan vs actual
- What went as planned:
  - **ETF 식별 = tickers.is_etf 컬럼**(source of truth), `save_stocks`가 추가 시점 `security_type→is_etf` 저장, ON CONFLICT `is_etf=tickers.is_etf OR EXCLUDED.is_etf`로 재저장 다운그레이드 방지. 기본 FALSE·백필 없음(현재 ETF 없음). watchlist/portfolio 추가 경로 모두 이미 dict에 `security_type`을 담아 넘겨 라우터 변경 불필요.
  - **ETF 탭 축소**(지표 기술·수급 + 히스토리), 리포트 생성 로직(consensus-skip) 불변.
  - **TDD on**: 5개 테스트 red→green(save_stocks 매핑·보존 3 / get_report 노출 2), 전체 백엔드 340 passed, 프론트 빌드 통과.
  - **스키마 의존 배포 무사고**: advisory-insights 교훈대로 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`를 **push 전** Docker postgres에 적용 → 신규 `SELECT enriched_at, is_etf`가 라이브돼도 깨지지 않음. 사용자 라이브 UAT yes.
  - 결과물=계획(WHAT 일치): ETF=축소 탭, tickers.is_etf 기준, 일반종목 회귀 없음.
- Divergences:
  1. **[surfacing 경로 정정 — 핵심]** 플랜 S1은 `get_stocks/get_full_portfolio/get_global_portfolio` 3개 SELECT + `/api/stocks` → `selected.is_etf`로 명시했으나, **리포트 화면은 `/api/stocks`를 안 쓴다**. 목록=`/api/report/list`, 상세=`/api/report/{ticker}/{date}`, `selected`는 `{ticker,date}`뿐(Reports.jsx:39), 탭 렌더는 `detail.summary` 기반. → 읽기 경로를 **`get_report` 한 곳**으로 축소(기존 `SELECT enriched_at`를 `SELECT enriched_at, is_etf`로 확장 + `summary["is_etf"]` 주입). 3 SELECT는 화면이 안 써서 미수정(speculative 회피, Simplicity). WHAT·source of truth 동일, HOW만 더 외과적.
  2. **[UAT 후속] ETF 요약 탭도 제거**: 요약의 `VolumeRsiSnapshot`이 지표 기술·수급의 `RsiTable`과 **동일 `PriceLevelChart`**(요약=일봉 고정+범례, 지표=일/주/월 토글 상위호환), Insights는 ETF에 비어 요약탭 고유 가치 없음 → 사용자 제안으로 제거. `detailTab` 파생값으로 기본 진입을 지표로 보정. 내가 넣었던 `{!isEtf && <ConsensusSummary>}` 가드는 요약이 비-ETF 전용이 되며 죽은 코드 → plain 복원.
  3. **[UAT 후속] 랭킹 종목 모달(ResearchDetail)도 동일 조건**: 그 모달은 리포트 상세 탭 로직을 **별도 중복** 보유(로컬 `tab`/`analysisSubTab`). `summary`를 같은 `/api/report/{ticker}/{date}`에서 받아 `summary.is_etf` 이미 내려옴 → 백엔드 무변경, 프론트만 동일 분기 이식.
  4. **슬롯**: 활성 슬롯의 task 7(verified: yes, 회고 대기)을 `executed/`로 park 후 etf 승격(정석 park — sealable이라 적법).
  - 플랜 WHAT은 무발산(목표 달성), 발산은 전부 배선 경로·UAT 정제 측 → 재그릴링 불필요.

## Learnings
- Do differently next time:
  - **배선 슬라이스를 적기 전, 소비 화면의 실제 fetch 경로를 grep으로 확인**. "포트폴리오 종목이니 `/api/stocks`겠지"가 틀렸다 — 리포트 화면은 `/api/report/*`, `selected`는 `{ticker,date}`뿐. 데이터를 어디에 실을지는 *그리는 컴포넌트가 무엇을 읽는지*에서 역산해야 함. (이번엔 구현 중 확인해 1 SELECT로 축소했지만, 플랜 단계에서 확인했다면 S1 명세가 처음부터 맞았음.)
  - **탭을 숨겨 1~2개만 남으면 남은 탭끼리의 콘텐츠 중복이 드러난다**. 탭 숨김 설계 시 "숨길 것"뿐 아니라 "남는 것들끼리의 중복"까지 점검(요약 `VolumeRsiSnapshot` ⊂ 지표 `RsiTable`). UAT에서야 발견됨.
  - **리포트 상세 탭 오케스트레이션이 `Reports.jsx`·`Ranking.jsx(ResearchDetail)` 2곳에 복붙 중복** → 한쪽 변경 시 수동 동기화 필요(이번 ETF 분기도 양쪽에 각각 이식). 공통 `<ReportDetailTabs>` 추출 시 조건 분기를 한 곳에서 관리 가능 — **별도 리팩토링 후속 후보**(이번 범위는 동작 일치가 목적이라 미추출).
  - **(긍정 확인) 스키마 의존 코드 배포 = 마이그레이션 push 전 적용**이 이번엔 무사고로 작동. additive 컬럼이라도 공유 마스터(tickers)엔 `OR-preserve` 가드로 다운그레이드 차단. 폴러 회피는 commit+push 묶음으로 일관 처리.

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음 — ETF는 기존 용어, is_etf/security_type은 코드 레벨 플래그)
- ADR added: none (tickers.is_etf·get_report 주입·중복 미추출 모두 되돌리기 쉽거나 process성 → ADR 3조건 미달)
