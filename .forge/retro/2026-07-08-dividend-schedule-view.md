# 2026-07-08 — 종목별 배당 스케줄 전용 '배당' 탭 (task#158)

## Plan vs actual
- What went as planned:
  - 6슬라이스(스키마·projection·배치·엔드포인트·프론트·README) 계획대로 이행. 배치-백킹(요청경로 라이브 fetch 0)·캘린더 exact-only 불변·projection은 새 뷰에만(ADR-0023) 전부 준수.
  - 라이브 검증 강함: 마이그레이션 테이블 생성, 배치 271행/86종목 적재, 엔드포인트 200 e2e, Playwright 배당 탭 74행 렌더. pytest 1218 green.
- Divergences:
  - **배당 float/Decimal TypeError를 in-run 셀프리뷰가 포착** — `get_full_portfolio.quantity`가 DB NUMERIC→Decimal이라 `amt(float)*qty(Decimal)`이 500 직전. **신규 아님**: CLAUDE.md 기존 가토("DB NUMERIC을 float·외부값과 산술하는 경로는 어디든 동일 위험")의 *재발*을 새 엔드포인트에서 잡은 것. `float(qty)` 정규화 + Decimal 회귀테스트(fixture가 float만 쓰면 못 잡는 케이스)로 마감.
  - **US 확정+지급일은 종목별 yfinance calendar 신선도 의존** — MSFT·MA·PFE 등은 confirmed+pay_date, AAPL·KO·COST는 calendar가 stale(과거)이라 projected 폴백. best-effort로 정상(버그 아님).
  - 테스트: 기존 2건이 additive `schedule_ok` 키로 exact-match 깨짐 → 갱신(스케줄 경로 모킹해 hermetic). projection 3건·snap_interval 1건·Decimal 회귀 1건 신규.

## Learnings
- Do differently next time:
  - **DB NUMERIC 컬럼(quantity·avg_cost 등)을 외부 float(배당액 등)와 산술하는 새 경로는 첫 구현부터 `float()` 정규화 + Decimal fixture 회귀테스트를 DoD에 넣을 것.** 이번엔 셀프리뷰가 잡았지만 fixture는 float만 써서 통과·라이브 실패였을 케이스. CLAUDE.md 가토가 이미 있으니, "DB NUMERIC 읽어 산술"을 보면 반사적으로 적용.
  - **외부소스(yfinance) 파싱 슬라이스는 라이브 프로브가 fixture-pass-live-fail을 실제로 막았다** — projection을 로컬+도커 실데이터로 대조해 KR 예상/US 확정+지급일 동작을 배포 전 확인. 이 DoD 계속 유지.
  - **projection 같은 추정 로직은 "확정이 왜 안 뜨지?"류 데이터-의존 혼란이 따라온다** — 예상/확정 상태의 데이터 의존성을 CONTEXT/문서에 명시해 두면 향후 오진 방지(이번에 [[배당 예상]]에 반영).

## Doc updates
- CONTEXT.md promotion: [[배당 예상]]에 "US 확정은 종목별 calendar 신선도 의존 — stale이면 예상 폴백" 한 줄 추가 (그릴링 때 이미 배당 스케줄/예상/배당 3용어 신규).
- ADR added: none (ADR-0023을 fg-ask 그릴링 단계에서 이미 생성).
