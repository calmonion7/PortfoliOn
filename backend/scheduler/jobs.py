from __future__ import annotations

from services import storage, report_generator, consensus_pipeline as _pipeline, job_runs
from services import batch_registry


def _in_market(stock: dict, market: str) -> bool:
    """KR = market=='KR', US = 그 외 전부(기본 'US'). 비-KR을 US로 잡아 누락 방지."""
    m = stock.get("market") or "US"
    return (m == "KR") if market == "KR" else (m != "KR")


def _generate_all(market: str, job_id: str):
    from services.db import query
    with job_runs.record(job_id, "auto"):
        user_ids = list({r["user_id"] for r in query("SELECT DISTINCT user_id FROM user_stocks")})
        all_stocks: dict = {}
        for user_id in user_ids:
            stocks = storage.get_all_stocks(user_id)
            for stock in stocks:
                if not _in_market(stock, market):
                    continue
                try:
                    report_generator.generate_report_with_retry(stock)
                    print(f"[Scheduler] Report generated for {stock['ticker']}")
                except Exception as e:
                    print(f"[Scheduler] Failed for {stock['ticker']}: {e}")
                all_stocks[stock["ticker"]] = stock
        try:
            _pipeline.run_daily(list(all_stocks.values()))
            print(f"[Scheduler] Pipeline run_daily completed for {len(all_stocks)} stocks")
        except Exception as e:
            print(f"[Scheduler] Pipeline run_daily failed: {e}")


def _generate_kr():
    _generate_all("KR", "daily_report_kr")


def _generate_us():
    _generate_all("US", "daily_report_us")


def _run_guru_crawl():
    from services.guru_scraper import scrape_all_managers
    from datetime import datetime
    with job_runs.record("guru_crawl", "auto"):
        try:
            managers = scrape_all_managers()
            storage.save_guru_managers({
                "last_updated": datetime.now().isoformat(timespec="seconds"),
                "managers": managers,
            })
            print("[Scheduler] Guru crawl completed")
        except Exception as e:
            print(f"[Scheduler] Guru crawl failed: {e}")


def _refresh_monthly_us():
    from services.market_indicators import _fetch_and_save_econ_indicators
    with job_runs.record("monthly_us", "auto"):
        try:
            _fetch_and_save_econ_indicators()
            print("[Scheduler] Econ indicators refreshed")
        except Exception as e:
            print(f"[Scheduler] Econ indicators refresh failed: {e}")


def _refresh_macro_signals():
    from services.market_indicators import _fetch_and_save_macro_signals
    with job_runs.record("macro_signals_fetch", "auto"):
        try:
            _fetch_and_save_macro_signals()
            print("[Scheduler] Macro signals refreshed")
        except Exception as e:
            print(f"[Scheduler] Macro signals refresh failed: {e}")


def _refresh_monthly_kr():
    from services.market_indicators import _fetch_and_save_kr_exports
    with job_runs.record("monthly_kr", "auto"):
        try:
            _fetch_and_save_kr_exports()
            print("[Scheduler] KR exports refreshed")
        except Exception as e:
            print(f"[Scheduler] KR exports refresh failed: {e}")


def _refresh_earnings_us():
    from services.market_indicators import _fetch_and_save_m7_earnings
    with job_runs.record("earnings_us", "auto"):
        try:
            _fetch_and_save_m7_earnings()
            print("[Scheduler] M7 earnings refreshed")
        except Exception as e:
            print(f"[Scheduler] M7 earnings refresh failed: {e}")


def _refresh_earnings_kr():
    from services.market_indicators import _fetch_and_save_kr_top2_earnings
    with job_runs.record("earnings_kr", "auto"):
        try:
            _fetch_and_save_kr_top2_earnings()
            print("[Scheduler] KR Top2 earnings refreshed")
        except Exception as e:
            print(f"[Scheduler] KR Top2 earnings refresh failed: {e}")


def _run_digest():
    from services import digest_service
    from services.db import query
    with job_runs.record("daily_digest", "auto"):
        try:
            user_ids = list({r["user_id"] for r in query("SELECT DISTINCT user_id FROM user_stocks WHERE type = 'holding'")})
        except Exception as e:
            print(f"[Scheduler] Digest: failed to fetch user list: {e}")
            return
        for user_id in user_ids:
            try:
                d = digest_service.generate(user_id)
                digest_service.send_telegram(d)
                print(f"[Scheduler] Daily digest generated for {user_id}")
            except Exception as e:
                print(f"[Scheduler] Daily digest failed for {user_id}: {e}")


def _fetch_leverage():
    from services.leverage_service import fetch_and_store
    with job_runs.record("leverage_fetch", "auto"):
        try:
            fetch_and_store()
            print("[Scheduler] Leverage indicators fetched")
        except Exception as e:
            print(f"[Scheduler] Leverage fetch failed: {e}")


def _fetch_lending():
    from services.lending_service import fetch_and_store
    with job_runs.record("lending_fetch", "auto"):
        try:
            n = fetch_and_store()
            print(f"[Scheduler] Lending balance fetched: {n} rows")
        except Exception as e:
            print(f"[Scheduler] Lending fetch failed: {e}")


def _fetch_backlog():
    from services.backlog import fetch_all_backlog
    with job_runs.record("backlog_fetch", "auto"):
        try:
            r = fetch_all_backlog()
            print(f"[Scheduler] Backlog fetched: {r}")
        except Exception as e:
            print(f"[Scheduler] Backlog fetch failed: {e}")


def _fetch_disclosures():
    from services.disclosures import fetch_all_disclosures
    with job_runs.record("disclosure_fetch", "auto"):
        try:
            r = fetch_all_disclosures()
            print(f"[Scheduler] Disclosures fetched: {r}")
        except Exception as e:
            print(f"[Scheduler] Disclosure fetch failed: {e}")


def _fetch_agm():
    from services.agm import fetch_agm_meeting_dates
    with job_runs.record("agm_fetch", "auto"):
        try:
            r = fetch_agm_meeting_dates()
            print(f"[Scheduler] AGM meeting dates fetched: {r}")
        except Exception as e:
            print(f"[Scheduler] AGM fetch failed: {e}")


def _fetch_insider():
    from services.insider_trades import fetch_all_insider_trades
    with job_runs.record("insider_fetch", "auto"):
        try:
            r = fetch_all_insider_trades()
            print(f"[Scheduler] Insider trades fetched: {r}")
        except Exception as e:
            print(f"[Scheduler] Insider fetch failed: {e}")


def _fetch_dividends():
    from services.dividends import fetch_all_dividends
    with job_runs.record("dividend_fetch", "auto"):
        try:
            r = fetch_all_dividends()
            print(f"[Scheduler] Dividends fetched: {r}")
        except Exception as e:
            print(f"[Scheduler] Dividend fetch failed: {e}")


def _fetch_kr_rankings():
    from services import ranking_service
    with job_runs.record("kr_rankings_fetch", "auto"):
        try:
            ranking_service.replace_market_rankings("KR", ranking_service.get_kr_rankings())
            print("[Scheduler] KR rankings refreshed")
        except Exception as e:
            print(f"[Scheduler] KR rankings refresh failed: {e}")


def _fetch_us_rankings():
    from services import ranking_service
    with job_runs.record("us_rankings_fetch", "auto"):
        try:
            ranking_service.replace_market_rankings("US", ranking_service.get_us_rankings())
            print("[Scheduler] US rankings refreshed")
        except Exception as e:
            print(f"[Scheduler] US rankings refresh failed: {e}")


def _fetch_investor_trend():
    with job_runs.record("investor_trend_fetch", "auto"):
        _investor_trend_work()


def _investor_trend_work():
    """KR 랭킹 종목 일일 수급 배치: 전진 적립 + 종목당 1청크 후진 백필.

    전진: 최신 /trend → upsert (빈 테이블이면 ~10일 시드).
    후진: oldest_date가 ~1년(약 365일) 이내면 그 날짜 이전 10일을 1청크 fetch.
    종목당 ~2 호출/회, ThreadPoolExecutor 병렬(정중한 동시성)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from datetime import date, timedelta
    from services import investor_service as svc
    from services.db import query as db_query

    try:
        # 랭킹 KR ∪ 보유/관심 KR (랭킹 밖 보유/관심 종목도 커버)
        tickers = [r["ticker"] for r in db_query(
            "SELECT DISTINCT ticker FROM market_rankings WHERE market = 'KR' "
            "UNION "
            "SELECT DISTINCT t.ticker FROM tickers t "
            "JOIN user_stocks us ON us.ticker = t.ticker WHERE t.market = 'KR'")]
    except Exception as e:
        print(f"[Scheduler] Investor trend: failed to fetch KR universe: {e}")
        return

    backfill_floor = date.today() - timedelta(days=365)

    def _fetch_one(ticker):
        # 전진
        try:
            svc.upsert_trend(ticker, svc.fetch_trend(ticker))
        except Exception as e:
            print(f"[Scheduler] Investor trend forward failed for {ticker}: {e}")
        # 후진 (1청크) — oldest가 1년 캡 이내일 때만
        try:
            oldest = svc.oldest_date(ticker)
            if oldest is not None and oldest > backfill_floor:
                older = svc.fetch_trend(ticker, bizdate=oldest.strftime("%Y%m%d"))
                if older:
                    svc.upsert_trend(ticker, older)
        except Exception as e:
            print(f"[Scheduler] Investor trend backfill failed for {ticker}: {e}")

    if not tickers:
        print("[Scheduler] Investor trend: no KR tickers")
        return
    # max_workers ≤ 8: 워커가 DB 풀(maxconn=10)에서 커넥션을 점유하므로 풀 초과(PoolError) 방지
    with ThreadPoolExecutor(max_workers=max(1, min(len(tickers), 8))) as executor:
        futures = [executor.submit(_fetch_one, t) for t in tickers]
        for future in as_completed(futures):
            future.result()
    print(f"[Scheduler] Investor trend fetched for {len(tickers)} KR tickers")


def _fetch_short_sell():
    with job_runs.record("short_sell_fetch", "auto"):
        _short_sell_work()


def _fetch_supply_score():
    with job_runs.record("supply_score_fetch", "auto"):
        _supply_score_work()


def _supply_score_work():
    """보유/관심 KR 종목 수급 종합 스코어 산출 배치(.forge/adr/0014).

    저장된 공매도(market_short_sell)+외인/기관(market_investor_trend) 시계열에서
    파생 산출 — 요청·기동 경로 라이브 외부 호출 0(short_sell_fetch 18:30·
    investor_trend_fetch 18:00 이후 19:00 실행). 산출 불가(None)면 save 생략+로깅
    (silent except 금지, 직전 양호값 유지)."""
    from services import short_sell_service, investor_service, supply_score
    from services.db import query as db_query

    try:
        tickers = [r["ticker"] for r in db_query(
            "SELECT DISTINCT t.ticker FROM tickers t "
            "JOIN user_stocks us ON us.ticker = t.ticker WHERE t.market = 'KR'")]
    except Exception as e:
        print(f"[Scheduler] Supply score: failed to fetch KR universe: {e}")
        return

    if not tickers:
        print("[Scheduler] Supply score: no KR tickers")
        return

    saved = 0
    for ticker in tickers:
        try:
            short_series = short_sell_service.read_series(ticker)
            investor_series = investor_service.read_series(ticker)
            result = supply_score.compute_band(short_series, investor_series)
            if result is None:
                # 양쪽 시계열 모두 결측 — 직전 양호값 유지(빈/None 박제 금지)
                print(f"[Scheduler] Supply score: no data for {ticker}, skipping save")
                continue
            supply_score.upsert_score(
                ticker, result["band"], result["flags"], result["as_of"])
            saved += 1
        except Exception as e:
            print(f"[Scheduler] Supply score failed for {ticker}: {e}")
    print(f"[Scheduler] Supply score computed for {saved}/{len(tickers)} KR tickers")


def _fetch_recommendation_kr():
    with job_runs.record("recommendation_kr", "auto"):
        _recommendation_work("KR")


def _fetch_recommendation_us():
    with job_runs.record("recommendation_us", "auto"):
        _recommendation_work("US")


def _recommendation_work(market: str):
    """발굴 유니버스 추천 점수 사전계산 배치(.forge/adr/0015).

    2단 깔때기로 점수를 계산해 stock_recommendations에 통째 교체 저장 —
    요청·기동 경로 라이브 호출 0(이 함수만 외부 fetch). 산출 불가(전부 None)면
    save 생략+로깅(silent except 금지, all-None 박제 금지)."""
    from services import recommendation
    try:
        stats = recommendation.run_recommendation_batch(market)
        print(f"[Scheduler] Recommendation {market} computed: {stats}")
    except Exception as e:
        print(f"[Scheduler] Recommendation {market} failed: {e}")


def _fetch_us_supply():
    from services.us_supply import fetch_all_us_supply
    with job_runs.record("us_supply_fetch", "auto"):
        try:
            r = fetch_all_us_supply()
            print(f"[Scheduler] US supply fetched: {r}")
        except Exception as e:
            print(f"[Scheduler] US supply fetch failed: {e}")


def _fetch_kr_sector():
    from services import kr_sector_service
    with job_runs.record("kr_sector_fetch", "auto"):
        try:
            sectors = kr_sector_service.refresh()
            print(f"[Scheduler] KR sector momentum refreshed: {len(sectors)} sectors")
        except Exception as e:
            print(f"[Scheduler] KR sector momentum refresh failed: {e}")


def _short_sell_work():
    """보유/관심 KR 종목 일일 공매도 추이 배치(키움 ka10014). 종목당 1콜로 252일 멱등 적립.

    ka10014가 날짜범위로 전 구간을 한 번에 주므로 후진 백필 불필요(전진 upsert만)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from services import short_sell_service as svc
    from services.db import query as db_query

    try:
        tickers = [r["ticker"] for r in db_query(
            "SELECT DISTINCT t.ticker FROM tickers t "
            "JOIN user_stocks us ON us.ticker = t.ticker WHERE t.market = 'KR'")]
    except Exception as e:
        print(f"[Scheduler] Short-sell: failed to fetch KR universe: {e}")
        return

    if not tickers:
        print("[Scheduler] Short-sell: no KR tickers")
        return

    def _fetch_one(ticker):
        try:
            svc.upsert_trend(ticker, svc.fetch_trend(ticker))
        except Exception as e:
            print(f"[Scheduler] Short-sell failed for {ticker}: {e}")

    # max_workers ≤ 8: DB 풀(maxconn=10) 초과(PoolError) 방지 (investor_trend와 동일 가드)
    with ThreadPoolExecutor(max_workers=max(1, min(len(tickers), 8))) as executor:
        futures = [executor.submit(_fetch_one, t) for t in tickers]
        for future in as_completed(futures):
            future.result()
    print(f"[Scheduler] Short-sell fetched for {len(tickers)} KR tickers")


def _seed_rankings_if_empty():
    """기동 시 market_rankings가 비어 있으면(예: 장외 시간 배포) 즉시 1회 적재.
    장중 cron이 돌기 전까지 랭킹 탭이 빈 상태로 남는 것을 방지(_check_missed_report와 동일 취지)."""
    from services.db import query as db_query
    try:
        rows = db_query("SELECT 1 FROM market_rankings LIMIT 1")
    except Exception as e:
        print(f"[Scheduler] Rankings seed check failed: {e}")
        return
    if rows:
        return
    print("[Scheduler] market_rankings empty, seeding now...")
    _fetch_kr_rankings()
    _fetch_us_rankings()


def _fetch_us_sector():
    from services import us_sector_service
    with job_runs.record("us_sector_fetch", "auto"):
        try:
            sectors = us_sector_service.refresh()
            print(f"[Scheduler] US sector momentum refreshed: {len(sectors)} sectors")
        except Exception as e:
            print(f"[Scheduler] US sector momentum refresh failed: {e}")


def _seed_us_sector_if_empty():
    """기동 시 us_sector_momentum 캐시가 비어 있으면 즉시 1회 적재."""
    from services import us_sector_service
    try:
        if us_sector_service.load_momentum():
            return
        print("[Scheduler] us_sector_momentum empty, seeding now...")
        us_sector_service.refresh()
    except Exception as e:
        print(f"[Scheduler] US sector seed failed: {e}")


def _seed_kr_sector_if_empty():
    """기동 시 kr_sector_momentum 캐시가 비어 있으면(신규 배포·16:00 cron 전) 즉시 1회 적재.
    분석탭 섹터 모멘텀 KR 토글이 첫 배치 전까지 빈 표로 남는 것을 방지(_seed_rankings_if_empty와 동일 취지)."""
    from services import kr_sector_service
    try:
        if kr_sector_service.load_momentum():
            return
        print("[Scheduler] kr_sector_momentum empty, seeding now...")
        kr_sector_service.refresh()
    except Exception as e:
        print(f"[Scheduler] KR sector seed failed: {e}")


_JOB_FUNCS = {
    "daily_report_kr": _generate_kr,
    "daily_report_us": _generate_us,
    "guru_crawl": _run_guru_crawl,
    "daily_digest": _run_digest,
    "earnings_kr": _refresh_earnings_kr,
    "earnings_us": _refresh_earnings_us,
    "monthly_kr": _refresh_monthly_kr,
    "monthly_us": _refresh_monthly_us,
    "macro_signals_fetch": _refresh_macro_signals,
    "leverage_fetch": _fetch_leverage,
    "lending_fetch": _fetch_lending,
    "kr_rankings_fetch": _fetch_kr_rankings,
    "us_rankings_fetch": _fetch_us_rankings,
    "investor_trend_fetch": _fetch_investor_trend,
    "short_sell_fetch": _fetch_short_sell,
    "supply_score_fetch": _fetch_supply_score,
    "backlog_fetch": _fetch_backlog,
    "kr_sector_fetch": _fetch_kr_sector,
    "disclosure_fetch": _fetch_disclosures,
    "agm_fetch": _fetch_agm,
    "dividend_fetch": _fetch_dividends,
    "insider_fetch": _fetch_insider,
    "recommendation_kr": _fetch_recommendation_kr,
    "recommendation_us": _fetch_recommendation_us,
    "us_supply_fetch": _fetch_us_supply,
    "us_sector_fetch": _fetch_us_sector,
}
