# Report Generation Parallelization Design

**Date:** 2026-05-23  
**Status:** Approved

## Problem

리포트 생성이 느리다. 종목이 많을수록 선형으로 느려지고, 단일 종목도 8개 이상의 네트워크 요청을 순차로 보내 불필요하게 오래 걸린다.

## Approach

두 레벨에서 병렬화한다:
- A: 종목 간 병렬 (`report.py` — `_run_generation`)
- B: 종목 내 I/O 병렬 (`report_generator.py` — `generate_report`)

## A: 종목 간 병렬화

**파일:** `backend/routers/report.py`  
**함수:** `_run_generation`

현재 순차 루프를 `ThreadPoolExecutor(max_workers=5)`로 교체한다.

```python
def _run_generation(stocks: list):
    _progress.update({"running": True, "done": 0, "total": len(stocks), "current": ""})

    def _process_one(stock):
        _progress["current"] = stock["ticker"]
        try:
            report_generator.generate_report(stock)
            cache_svc.invalidate(stock["ticker"])
            consensus_svc.collect(stock["ticker"])
        except Exception as e:
            print(f"[Report] Failed for {stock['ticker']}: {e}")
        _progress["done"] += 1

    with ThreadPoolExecutor(max_workers=5) as executor:
        list(executor.map(_process_one, stocks))

    _progress.update({"running": False, "current": ""})
```

- `max_workers=5`: yfinance/Naver API 과부하 방지
- `_progress["current"]` 경쟁 조건은 허용 (done/total이 핵심)
- `ThreadPoolExecutor` import는 이미 stocks.py에서 쓰므로 report.py에 추가만 하면 됨

## B: 종목 내 I/O 병렬화

**파일:** `backend/services/report_generator.py`  
**함수:** `generate_report`

독립적인 I/O 호출들을 `ThreadPoolExecutor`로 동시에 실행한다.

병렬로 실행할 호출 목록:
- `mkt.get_quote(ticker, market, exchange)`
- `mkt.get_financials(ticker, market, exchange)`
- `mkt.get_annual_financials(ticker, market, exchange)`
- `mkt.get_analyst_data(ticker, market, exchange)`
- `indicators.get_timeframe_rsi(yf_sym)`
- `yf.Ticker(yf_sym).history(period="1y")`
- `yf.Ticker(yf_sym).info` (US only)
- `scraper.scrape_finviz_consensus(ticker)` (US only)
- `scraper.get_news(ticker, market)`
- `mkt.get_quote(c, market, exchange)` × 경쟁사 수

실행 구조:
```python
with ThreadPoolExecutor(max_workers=8) as ex:
    f_quote    = ex.submit(mkt.get_quote, ticker, market, exchange)
    f_fin      = ex.submit(mkt.get_financials, ticker, market, exchange)
    f_fin_ann  = ex.submit(mkt.get_annual_financials, ticker, market, exchange)
    f_analyst  = ex.submit(mkt.get_analyst_data, ticker, market, exchange)
    f_rsi      = ex.submit(indicators.get_timeframe_rsi, yf_sym)
    f_history  = ex.submit(yf.Ticker(yf_sym).history, period="1y")
    f_info     = ex.submit(yf.Ticker(yf_sym).info) if market == "US" else None
    f_finviz   = ex.submit(scraper.scrape_finviz_consensus, ticker) if market == "US" else None
    f_news     = ex.submit(scraper.get_news, ticker, market)
    f_comps    = [ex.submit(mkt.get_quote, c, market, exchange) for c in stock.get("competitors", [])]

quote            = f_quote.result()
financials       = f_fin.result()
financials_annual = f_fin_ann.result()
analyst          = f_analyst.result()
timeframe_rsi    = f_rsi.result()
daily_df         = f_history.result()
finviz           = f_finviz.result() if f_finviz else {}
news             = f_news.result()
competitor_quotes = [f.result() for f in f_comps]
```

US의 경우 `t.info`도 `f_info.result()`로 가져와 sector/industry/PER/PBR 계산에 사용한다.

이후 volume profile, PER/PBR, `high_20d` 등 순수 계산 로직은 기존대로 유지한다.

## Expected Impact

| 시나리오 | 현재 | 변경 후 |
|---------|------|---------|
| 종목 1개 | ~10초 | ~3초 |
| 종목 10개 | ~100초 | ~6초 |

## Out of Scope

- yfinance 응답 캐싱
- 리포트 생성 실패 시 재시도 로직
- 진행률 UI 개선
