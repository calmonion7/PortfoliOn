<!-- forge-slug: us-supply-demand-signals-2of3 -->
# 2026-06-30 — US 수급 보강 2/3 (내부자 Form4) (task#123, part 2/3)

## Plan vs actual
- **계획대로**: #122 `us_supply.py` `fetch_us_supply`를 같은 yf.Ticker 패스에서 insider도 수집하게 확장(2nd Ticker·신규 배치 0), `us_supply_snapshot`에 insider JSONB 컬럼(멱등 마이그레이션), `GET /report/{ticker}/us-insider`(catch-all 앞·저장값만), 프론트 `UsInsiderSection`(기술·수급 US 분기). TDD 8테스트·pytest 977·build green. 라이브 AAPL 78건/MRVL 140건 추출. 커밋 be653833. #122와 평행 구조라 매끄러움.

## Divergences
- **D1 (low, Review 수정)**: `pct_buy/pct_sell`를 API_SPEC 예시·fixture가 퍼센트(4.76/95.24)로 적었으나 yfinance는 분수(0.0476/0.9524). 문서/fixture-only(프론트 ×100 정상). Review가 분수로 정정. **#122 short% ×100에 이은 yfinance 퍼센트-분수 스케일 2연속 재발** → #122 회고가 정한 "재발 시 승급" 충족.
- **D2 (process, retro만)**: 백엔드 에이전트가 자기 작성 insider 코드를 "이미 존재"로 오인지(HEAD엔 없었음). 서브에이전트 self-report 신뢰성 한계 — 검증은 git diff로.
- **D3 (저장, 계획 허용)**: insider를 us_insider_trades 신규 테이블 대신 us_supply_snapshot JSONB 컬럼 2개로(eco-최소, 한 Ticker 패스/한 upsert).

## Learnings
- **Do differently next time**:
  - **yfinance 퍼센트 필드 스케일은 런타임·문서·fixture 3곳 모두 맞춰라** — CLAUDE.md gotcha로 승급(아래). 소수분수→×100, API_SPEC/fixture 예시도 분수. 단위테스트가 렌더 %를 안 봐서 못 잡는 fixture-pass-live-fail 프론트판. (#122·#123 2연속이 승급 트리거.)
  - **서브에이전트의 "이미 존재함" narration은 git으로 검증** — #123 에이전트가 자기 작성분을 기존 코드로 오인지. 워크플로 결과의 "변경 없음/이미 있음" 주장은 git diff/HEAD 대조로 확인(이번엔 메인세션 git 확인으로 실상 파악).
  - **part 시리즈에서 1번 part의 factored 설계가 후속을 매끄럽게** — #122가 fetch를 factored하고 "2of3가 같은 패스 확장"을 명시한 덕에 #123이 신규 배치 0·한 Ticker 패스로 깔끔히 확장. 시리즈 1번 part에서 후속 확장점을 미리 factor.

## Doc updates
- CLAUDE.md: **gotcha 1건 추가**(yfinance gotcha군 인접) — "yfinance 퍼센트 필드는 소수분수 — 표시 ×100 + 문서/fixture도 분수, 필드별 스케일 검증" (#122·#123 2연속, 사용자 승인).
- CONTEXT.md promotion: none. ADR added: none(additive, 기존 패턴 내).
- **후속(누적, 미해결)**: #124 US수급 3/3(구루 드릴다운, 프론트-only), #119 D4 `_warm_calendar_cache` 기동-FRED 가드(fg-quick), FOMC 정적.
