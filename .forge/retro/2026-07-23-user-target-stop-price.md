# 2026-07-23 — 사용자 목표가·손절가 설정 + 대시보드 거리% 표시 (일괄 승급 사후 회고)

2026-07-04 실행·봉인(fg-done all), run.md 기반 사후 회고.

## Plan vs actual
- What went as planned: `user_stocks`에 `target_price`·`stop_price`(app_schema.sql+`main._migrate` 쌍 — 컬럼 가토 준수), storage/router 왕복, DashboardCard 거리%·StockModal 입력, API_SPEC 동기, 라이브 왕복 UAT PASS.
- Divergences: ① **Python 3.9 런타임에서 PEP604 `float | None` 어노테이션이 TypeError** — 기존 `"dict | None"`은 문자열 주석이라 통과하던 것, 로컬 pytest가 배포 전 포착 → `Optional[float]` 교체. ② 거리%는 서버 정규화 대신 프론트 계산으로 결정 — Decimal↔float 혼산 자체가 소멸. ③ 색은 방향색·의미색 모두 미적용(부호+라벨만, KR 색 가토 회피). ④ Cloudflare가 raw urllib UA를 1010 차단 → Playwright request 컨텍스트로 우회.

## Learnings
- Do differently next time: **백엔드는 Python 3.9 — Pydantic/시그니처 어노테이션에 PEP604 `X | None` 금지, `Optional[X]` 사용**(하드 제약; 문자열 주석은 통과해서 더 헷갈림). CLAUDE.md 가토 승급 후보.
- **DB NUMERIC(Decimal)과 얽히는 파생 계산은 프론트로 옮기면 혼산 위험이 원천 소멸**할 수 있다(raw만 내리기) — 배당 `float/Decimal` TypeError 가토의 예방형 응용.
- **라이브 API 프로브는 raw urllib이 아니라 브라우저/Playwright 컨텍스트로** — Cloudflare가 비브라우저 UA를 차단(error 1010).

## Doc updates
- CONTEXT.md promotion: none 신규 — 「사용자 목표가·손절가」(≠컨센서스 목표가)는 그릴링 시점 이미 등재.
- ADR added: none.
