# 2026-07-06 — 시장 Fear & Greed 지수 (task#151)

워크플로우 4-phase(백엔드 S1 → 적대적 검토 → 수정(생략) → 프론트 S2) + 색토큰 안전성 메인 확인. eco: sonnet 캡+ECO. 배포·라이브 UAT 통과(verified: yes).

## Plan vs actual
- What went as planned:
  - S1 `services/market_indicators/sentiment.py`(CNN F&G fetch+파싱·graceful) + `GET /api/market/fear-greed`(요청경로 증분·배치 무등록) + API_SPEC(Cowork 미갱신) + test_fear_greed 7테스트. S2 `FearGreedSection`(순수 CSS 5색 그라디언트 게이지+마커·전용색) + Market.jsx 등록 + VIX "변동성지수" relabel + README + stale 표기. pytest 1156·npm build green·검토 findings 0.
  - **그릴링서 라이브 프로브가 방식·헤더를 확정**: CNN이 헤더 불완전 시 418("teapot")임을 프로브로 확인 → 동작 헤더셋(UA+Accept+Origin+Referer+sec-ch-ua)을 워크플로우에 주입 → 실데이터로 즉시 200(score 34.06). 외부소스 프로브-선행 규율이 fixture-pass-live-fail을 또 막음.
- Divergences (전부 저위험·정당):
  1. **graceful 폴백을 `get_or_refresh` 대신 VIX 수동 패턴으로**: 계획은 `get_or_refresh` 지목했으나 그 래퍼는 "캐시 있으면 fetch 스킵"이라 **"fetch 실패→직전 저장값 사용"을 구현 못 함**. VIX의 `_get_cache→try fetch→_mc_load 폴백` 수동 구조로 계획 의도(실패 시 graceful stale)를 정확 달성.
  2. **eco: 히스토리 증분 병합 생략** — CNN이 매 호출 완전 윈도우 반환(yfinance 성장 시계열과 달리)이라 `_merge_history` 불필요. ceiling=호출당 60포인트 스냅샷.
  3. **게이지 색 안전성 메인 확인**: `--color-success`(#2e7d32 녹)·`--color-error`(#d32f2f 적)가 `--up`(적)/`--down`(청) 가격토큰과 **별개**임을 tokens.css로 확인 → 탐욕=녹/공포=적 정상(반전 없음).

## Learnings
- Do differently next time:
  - **`get_or_refresh`는 stale-폴백을 안 한다 — 비공식·취약 외부소스는 VIX식 수동 폴백**(`_get_cache→try fetch→실패 시 _mc_load 직전값`). `get_or_refresh`는 "캐시/저장값 있으면 fetch 스킵"만 하지 "fetch 실패 시 직전값 반환"은 안 해주므로, 소스가 언제든 막힐 수 있는 지표(CNN F&G 등)엔 부적합. 향후 시장지표 추가 시 소스 안정성으로 패턴 선택. (CLAUDE.md gotcha 추가 후보.)
  - **KR 색 관례 재확인**: 의미 게이지 색은 `success/danger` *배지 변형*은 금지지만 `--color-success/--color-error` *토큰*(녹/적)은 `--up`/`--down`(적/청)과 별개라 안전 — 커밋 전 tokens.css로 실제 값 대조가 확실.
  - **외부 비공식 API는 그릴링서 라이브 프로브로 접근성·필수 헤더 확정**(CNN 418→헤더 규명). 워크플로우가 헤더를 재발견하느라 헤매지 않게 프로브 결과를 프롬프트에 주입.

## Doc updates
- CONTEXT.md promotion: none — 「시장 센티먼트 지수」는 fg-ask 그릴링 때 헤더·graceful·US전용·VIX 구분까지 이미 등재.
- ADR added: none — CNN F&G 소스 선택은 국소·가역(소스 교체 localized), 되돌리기 힘듦 미충족. "왜 CNN+헤더+graceful"은 CONTEXT·이 retro에 기록.
- 후속: `get_or_refresh` stale-폴백 한계 → CLAUDE.md gotcha 추가(fg-quick 후보). 이월분: report_generator KR beta tz-strip 통일·CLAUDE.md doc-sync 단서(둘 다 fg-quick).
