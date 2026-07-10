# 2026-06-13 — 시세 조회 성능 (1/2): get_quote 종목 단위 TTL 캐시 (task 30)

## Plan vs actual
- What went as planned: `cache.py` `_quote_cache`(TTL 60s) + `market.get_quote` 캐시 래핑(US·KR 공통, `_get_quote_uncached`로 본문 분리) + 캐시 유닛테스트. backend 467 passed. 라이브 `/portfolio/prices`(5종목) 1.07s→6.6ms→5.2ms(~160× 캐시 히트).
- Divergences:
  - **conftest autouse 캐시 클리어 추가**(계획 외·필수): 전역 인메모리 quote 캐시가 기존 `test_market.py`의 "TEST" ticker 재사용 테스트를 교차오염시킬 수 있어, 매 테스트 전 `invalidate_quote()` autouse fixture로 격리.

## Learnings
- Do differently next time:
  - **"성능 체크"는 추측 전에 실측부터.** 코드베이스 맵(CONCERNS §4.1)은 dashboard/list의 mart N+1을 병목으로 지목했으나, 실측에서 **list 16ms vs dashboard 1.16s(같은 15종목)** 로 mart N+1은 ~1ms/쿼리(병목 아님)였고, 진짜 병목은 **미캐시 per-card `get_quote`(`yf.info` + `yf.history(period="1y")` 2 네트워크 콜)** 였다. 정적 맵 분석은 후보를 주지만, 개선 대상은 라이브 측정(cold/warm·캐시 격리)으로 확정할 것.
  - **서비스에 전역(모듈 레벨) 캐시를 추가하면 테스트 격리 fixture를 동반하라.** 전역 캐시는 테스트 간 상태가 새어 같은 입력(ticker)을 재사용하는 테스트를 교차오염시킨다. `conftest.py` autouse fixture로 매 테스트 전 캐시를 비우는 것을 기본 패턴으로(이번엔 `invalidate_quote()`).
  - 측정 시 테스트계정이 과소표본(3종목)이면 N+1류 비용이 안 드러난다 → 종목을 늘려(15) 재측정해 cold 비용을 노출시킨 것이 유효했다.

## Doc updates
- CONTEXT.md promotion: none (도메인 용어 없음)
- ADR added: none (인메모리 캐시 추가 = 가역적·비퍼즐 — ADR 3조건 미충족)
