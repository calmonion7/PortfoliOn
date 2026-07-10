# 2026-06-13 — 키움 KR 시세·차트 대체 (Phase 2 part 1/3)

## Plan vs actual
- What went as planned: 4 슬라이스(차트클라이언트·배치·단건·RSI/리포트) 계획대로. yfinance를 KR 가격 히스토리에서 제거하고 sector/industry만 yfinance 유지(계획된 non-goal). 전체 485 테스트 통과, main cf82dcba 배포·/health 정상. 라이브 키움 weekly/monthly == yfinance 정확 일치.
- Divergences (낮음~중간):
  - **계획에 없던 seam 도입** — S4를 위해 `market.get_history_df(ticker,market,exchange,timeframe)`를 신설해 KR(키움 우선)/US(yfinance) 분기를 한 곳에 모음. indicators·report_generator의 직접 yfinance 호출을 이 seam 경유로 전환.
  - **시그니처 변경 파급** — `get_timeframe_rsi(yf_sym)` → `(ticker,market,exchange)`. indicators의 `import yfinance`가 고아가 돼 제거 → 그걸 patch하던 기존 테스트(`test_indicators`)가 깨져 새 seam patch로 갱신.
  - **코드리뷰가 회귀 1건 포착** — 키움 차트는 1콜에 600봉(일)을 줘서, `_kr_closes_kiwoom(max_items=260)`이 600개를 그대로 반환 → `get_quote_kr` ytd가 ≈2.4년 기준으로 오산출. `fetch_bars`가 "최근 max_items개"로 절단하도록 수정.

## Learnings
- Do differently next time:
  - **라우팅 seam(`get_history_df`)을 part 2/3에도 적용** — 새 소스로 갈아끼울 때 "KR=키움 우선/실패 시 기존 폴백"을 호출처마다 흩뿌리지 말고 **데이터 종류별 단일 함수**에 몰면 폴백이 일관되고 호출처 수정이 1줄로 끝난다. part 2(랭킹)·part 3(수급)도 같은 패턴(서비스 함수 내부 분기 + 폴백)으로.
  - **키움 차트 TR은 1콜에 과다 반환(일 600·주 300·월 240봉)** — 기간 기준 계산(ytd처럼 시작점 인덱스를 쓰는 것)은 반드시 "최근 N개" 절단을 거칠 것. 끝에서 인덱싱하는 계산(daily/weekly/monthly = closes[-2/-6/-23])은 절단 없이도 무사하지만, 시작점(closes[0]) 계산은 절단 안 하면 기간이 늘어나 값이 틀어진다. (Phase 1 "단위/부호 fixture 먼저" 교훈의 연장 — 이번엔 **기간/범위**가 함정.)
  - **함수 시그니처/내부 소스를 바꾸면 그걸 patch하던 기존 테스트도 같은 PR에서 갱신** — `test_indicators`가 `services.indicators.yf.Ticker`를 patch하다 import 제거로 깨졌다. 전체 스위트를 돌려야 이런 patch-타깃 깨짐이 드러난다(단위테스트만 보면 놓침).

## Doc updates
- CONTEXT.md promotion: none (키움 용어는 [[키움 시세 소스]]로 이미 존재, 새 용어 없음)
- ADR added: none (`get_history_df`는 되돌리기 쉬운 라우팅 패턴 — ADR 기준 미달)
