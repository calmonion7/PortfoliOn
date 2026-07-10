<!-- forge-slug: us-supply-demand-signals-1of3 -->
# 2026-06-29 — US 수급 보강 1/3 (공매도 + 기관 보유) (task#122, part 1/3)

## Plan vs actual
- **계획대로**: Backend(us_supply.py 파싱 + us_supply_snapshot 멱등 마이그레이션 + us_supply_fetch 배치 + GET /report/{ticker}/us-supply catch-all 앞 등록·저장값만 read + API_SPEC doc-sync) → Frontend(UsSupplySection US-only, 기술·수급 탭 US 분기) → Review. TDD 8테스트·pytest 969·build green. 라이브 AAPL/MRVL 추출 확정(short 0.98%/5.26%·기관 top-N QoQ). 커밋 7b855a7c.
- 소스 실현성을 **fg-ask 단계 라이브 프로브로 사전 확정**(yfinance institutional/short/insider 작동) → 게이팅 스파이크 불요, 계획이 매끄럽게 진행. (#121 교훈 "소스 라이브로 확인" 선반영 효과.)

## Divergences
- **D1 (HIGH, Review in-run 수정)**: `short_pct_float`(yfinance 0.0098 = 0.98%)를 ×100 없이 `.toFixed(2)%`로 표시 → "0.01%". 같은 컴포넌트 기관 테이블 `pct_held`/`pct_change`는 이미 ×100이라 *한 필드만* 누락. 프론트 에이전트가 스케일 위험을 divergence로 선플래그 → Review가 line 80 ×100 수정·재검증.
- **D2 (환경)**: Python 3.9라 `X|None` 타입힌트 미사용 → 테스트 시그니처서 제거(동작 무관).
- **검증 deferred**: us_supply_snapshot 실제 populate는 배포 후 us_supply_fetch 배치 실행 시(캘린더/배당 동일). 로컬=라이브 2종목 + fixture.

## Learnings
- **Do differently next time**:
  - **소수↔퍼센트 ×100 표시 스케일을 *필드별로* 검증하라.** yfinance 퍼센트 필드(shortPercentOfFloat·pctHeld·dividendYield 등)는 소수분수(0.0098)다. fixture/단위테스트는 *렌더된 %*를 단언하지 않아 이 트랩을 못 잡고 실표시에서만 드러난다(fixture-pass-live-fail의 프론트 표시판). 한 필드 맞고 다른 필드 틀리기 쉬움 — % 표시 필드는 각각 스케일 확인. (대시보드 배당 float/Decimal·HV ×100에 이은 N번째 스케일/타입 표시 트랩 — 또 재발 시 CLAUDE.md gotcha로 승급.)
  - **적대적 Review phase가 거듭 실버그를 잡는다** — #116(tz·재발성, 메인세션)·#120(증분 재발성, 메인세션)·#122(×100, Review). 수치/외부소스 작업엔 Review/메인 교차검증이 fixture-green을 넘어서는 안전망. 계속 유지.
  - **소스 라이브 프로브 선행이 그릴링·실행을 매끄럽게** — fg-ask서 yfinance US 3종을 미리 프로브해 실현성을 확정한 덕에 #122는 스파이크 없이 진행. 불확실-소스 작업은 그릴링 단계에서 라이브 프로브를 표준으로.

## Doc updates
- CONTEXT.md promotion: none(공매도/기관 보유=일반 개념; KR 수급 스코어와 별개임은 계획서 명시).
- ADR added: none(additive 배치/엔드포인트/표시, 기존 패턴 범위).
- CLAUDE.md: none(×100 트랩은 retro-only — 기존 NaN/float-Decimal gotcha와 동류·granular, 재발 시 승급). 사용자에게 gotcha 추가 옵션 제시함.
- **후속(누적, 미해결)**: #123 US수급 2/3(내부자 Form4)·#124 3/3(구루), #119 D4 `_warm_calendar_cache` 기동-FRED 가드(fg-quick), FOMC 정적.
