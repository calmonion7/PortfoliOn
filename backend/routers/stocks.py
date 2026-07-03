from fastapi import APIRouter, HTTPException, Query, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List, Any
from services import storage
from services.db import query
from services.utils import sanitize
import re
import sys
import math
import json
import requests as http_requests
import yfinance as yf
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from services import market
from services import scraper
from services import cache as cache_svc
from services import consensus as consensus_svc
from services import job_runs
from services import dividends
from services import supply_score
from services import insider_trades
from services.market_indicators.cache import _mc_load
from auth import get_current_user, get_current_user_or_api_key, _API_KEY_USER_ID, require_admin, require_admin_or_api_key
import logging

logger = logging.getLogger(__name__)

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"
REPORTS_DIR = Path(__file__).parent.parent / "reports"


def _latest_snapshot(ticker: str) -> tuple:
    """Find and load the latest snapshot for a ticker. Tries DB first, falls back to filesystem."""
    try:
        rows = query(
            "SELECT date, data FROM snapshots WHERE ticker = %s ORDER BY date DESC LIMIT 1",
            (ticker.upper(),),
        )
        if rows:
            return rows[0]["data"], rows[0]["date"]
    except Exception as e:
        logger.warning(f"[Snapshot] DB 조회 실패 ({ticker}): {e}")
        pass
    # Filesystem fallback (pre-migration)
    for base in (SNAPSHOTS_DIR, REPORTS_DIR):
        ticker_dir = base / ticker
        if ticker_dir.exists():
            dates = sorted([f.stem for f in ticker_dir.glob("*.json")], reverse=True)
            if dates:
                path = ticker_dir / f"{dates[0]}.json"
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    return data, dates[0]
                except Exception as e:
                    logger.warning(f"[Snapshot] 파일 읽기 실패 ({path}): {e}")
                    pass
    return None, None


def _latest_snapshots(tickers: list) -> dict:
    """Batch-load the latest snapshot for many tickers in one DB query.

    Returns {UPPER_ticker: (data, date)}. Tickers absent from the batch result
    (DB miss, or DB error → all of them) fall back to per-ticker _latest_snapshot,
    preserving the filesystem fallback path so the response is unchanged. Empty/None-safe.
    """
    clean = [t.upper() for t in (tickers or []) if t]
    if not clean:
        return {}
    result = {}
    try:
        rows = query(
            "SELECT DISTINCT ON (ticker) ticker, date, data FROM snapshots "
            "WHERE ticker = ANY(%s) ORDER BY ticker, date DESC",
            (clean,),
        )
        for row in rows:
            result[row["ticker"].upper()] = (row["data"], row["date"])
    except Exception as e:
        logger.warning(f"[Snapshot] 배치 DB 조회 실패: {e}")
        pass
    for t in clean:
        if t not in result:
            result[t] = _latest_snapshot(t)
    return result


router = APIRouter(prefix="/api/stocks", tags=["stocks"])

_KR_PATTERN = re.compile(r'[가-힣]')
# Matches exchange suffixes for non-US/KR markets (e.g. .T .L .HK .PA .DE .AX)
_INTL_SUFFIX = re.compile(r'\.[A-Z]{1,4}$')


def _search_naver(q: str, max_results: int = 12) -> list:
    """Search Korean stocks via Naver Finance autocomplete (supports Korean text)."""
    try:
        r = http_requests.get(
            "https://ac.stock.naver.com/ac",
            params={"q": q, "target": "stock"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=5,
        )
        items = r.json().get("items", [])
        results = []
        for item in items[:max_results]:
            code = item.get("code", "")
            name = item.get("name", "")
            type_code = item.get("typeCode", "KOSPI")
            if type_code == "KOSDAQ":
                exchange, security_type = "KQ", "EQUITY"
            elif type_code in ("ETF", "KOSPI ETF", "KOSDAQ ETF"):
                exchange, security_type = "KS", "ETF"
            else:
                exchange, security_type = "KS", "EQUITY"
            results.append({
                "ticker": code,
                "name": name,
                "market": "KR",
                "exchange": exchange,
                "exchange_display": type_code,
                "security_type": security_type,
            })
        return results
    except Exception as e:
        logger.warning(f"[Search] Naver 자동완성 실패 ({q!r}): {e}")
        return []


class EnrichBody(BaseModel):
    moat: Optional[Any] = None
    growth_plan: Optional[Any] = None
    risks: Optional[Any] = None
    recent_disclosures: Optional[Any] = None
    insights: Optional[Any] = None
    competitors: Optional[List[str]] = None


class BatchEnrichItem(BaseModel):
    ticker: str
    moat: Optional[Any] = None
    growth_plan: Optional[Any] = None
    risks: Optional[Any] = None
    recent_disclosures: Optional[Any] = None
    insights: Optional[Any] = None
    competitors: Optional[List[str]] = None


@router.get("/search")
def search_stocks(q: str = Query(..., min_length=1), market: str = "ALL"):
    # Yahoo Finance doesn't support Korean text — use Naver autocomplete instead
    if _KR_PATTERN.search(q):
        results = _search_naver(q)
        if market != "ALL":
            results = [r for r in results if r["market"] == market]
        return results

    try:
        results = yf.Search(q, max_results=12, enable_fuzzy_query=True)
        quotes = results.quotes or []
    except Exception as e:
        logger.warning(f"[Search] yfinance 검색 실패 ({q!r}): {e}")
        return []

    filtered = []
    for item in quotes:
        symbol = item.get("symbol", "")
        if item.get("quoteType") not in ("EQUITY", "ETF"):
            continue
        if symbol.endswith(".KS"):
            item_market, item_exchange, item_ticker = "KR", "KS", symbol[:-3]
        elif symbol.endswith(".KQ"):
            item_market, item_exchange, item_ticker = "KR", "KQ", symbol[:-3]
        elif _INTL_SUFFIX.search(symbol):
            continue  # unsupported international market (e.g. .T .L .HK)
        else:
            item_market, item_exchange = "US", ""
            item_ticker = symbol.replace("-", ".")
        if market != "ALL" and item_market != market:
            continue
        name = item.get("shortname") or item.get("longname") or item_ticker
        security_type = "ETF" if item.get("quoteType") == "ETF" else "EQUITY"
        filtered.append({
            "ticker": item_ticker,
            "name": name,
            "market": item_market,
            "exchange": item_exchange,
            "exchange_display": item.get("exchDisp", item.get("exchange", "")),
            "security_type": security_type,
        })
    return filtered


@router.get("/{ticker}/news")
def get_stock_news(ticker: str, market: str = "US"):
    """종목 최근 뉴스 (랭킹 등 리포트 없는 종목용 on-demand 조회). scraper.get_news 재사용, 공개 read."""
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="market must be KR or US")
    try:
        news = scraper.get_news(ticker, market)
    except Exception as e:
        logger.warning(f"[News] 뉴스 조회 실패 ({ticker}): {e}")
        news = []
    return {"news": news}


@router.get("/{ticker}/supply-score")
def get_supply_score(ticker: str, user_id: str = Depends(get_current_user)):
    """종목 수급 종합 스코어(ADR-0014) 저장값 조회 — 라이브 호출 0.

    저장된 {band,flags,as_of}만 투영해 반환. 미산출(US·결측 포함)이면 None."""
    score = supply_score.read_score(ticker)
    if not score:
        return None
    return {"band": score.get("band"), "flags": score.get("flags"), "as_of": score.get("as_of")}


@router.get("")
def get_stocks(user_id: str = Depends(get_current_user_or_api_key)):
    portfolio = storage.get_global_portfolio() if user_id == _API_KEY_USER_ID else storage.get_full_portfolio(user_id)
    result = []
    for s in portfolio["stocks"]:
        result.append({"ticker": s["ticker"], "name": s.get("name", s["ticker"]), "type": "holding", "market": s.get("market", "US")})
    for s in portfolio["watchlist"]:
        result.append({"ticker": s["ticker"], "name": s.get("name", s["ticker"]), "type": "watchlist", "market": s.get("market", "US")})
    return result


@router.put("/enrich/batch")
def enrich_batch(items: List[BatchEnrichItem], user_id: str = Depends(require_admin_or_api_key)):
    if not items:
        raise HTTPException(status_code=400, detail="No items provided")
    updated, not_found = [], []
    for item in items:
        fields = {k: v for k, v in item.model_dump().items() if k != "ticker" and v is not None}
        if not fields:
            not_found.append(item.ticker.upper())
            continue
        ok = storage.enrich_stock(item.ticker, fields)
        (updated if ok else not_found).append(item.ticker.upper())
    return {"updated": updated, "not_found": not_found}


@router.put("/{ticker}/enrich")
def enrich_single(ticker: str, body: EnrichBody, user_id: str = Depends(require_admin_or_api_key)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided")
    ok = storage.enrich_stock(ticker, fields)
    if not ok:
        raise HTTPException(status_code=404, detail="Ticker not found")
    return {"ticker": ticker.upper(), "updated": list(fields.keys())}


@router.delete("/dashboard/cache")
def clear_dashboard_cache(user_id: str = Depends(get_current_user)):
    cache_svc.invalidate_dashboard()
    return {"cleared": True}


@router.post("/names/backfill", status_code=202)
def backfill_names(_: str = Depends(require_admin)):
    """name이 비었거나 티커와 같은(=종목번호로 박힌) 종목을 quote 실명으로 일괄 교정.
    tickers.name + 기존 스냅샷 name 동기 갱신(KR=키움/Naver, US=yfinance). admin 전용."""
    candidates = storage.tickers_missing_name()

    def _one(row):
        ticker = row["ticker"]
        name = market.resolve_name(ticker, row.get("market") or "US", row.get("exchange") or "", "")
        if name and name.upper() != ticker.upper():
            storage.set_ticker_name(ticker, name)
            return ticker, True
        return ticker, False  # resolve_name이 실명 못 찾음(빈값/티커형 반환) — skip

    updated, skipped = [], []
    if candidates:
        # max_workers ≤ 8: 워커가 DB 풀(maxconn=10)을 점유(set_ticker_name 2 writes) → 풀 초과 방지
        with ThreadPoolExecutor(max_workers=max(1, min(len(candidates), 8))) as executor:
            for future in as_completed([executor.submit(_one, c) for c in candidates]):
                ticker, ok = future.result()
                if ok:
                    updated.append(ticker)
                else:
                    # silent skip 금지(CLAUDE.md): resolve_name이 티커형/빈값을 반환해 건너뜀.
                    # 시세 일시실패와 '실명 없음'을 구분 못 하므로 재시도 대신 진단 로그+표면화.
                    skipped.append(ticker)
                    print(f"[backfill_names] skip {ticker}: resolve_name이 실명을 못 찾음(시세 일시실패 가능, 결과가 예상보다 작으면 재실행 권장)")

    # tickers.name을 이미 고쳤지만 스냅샷이 옛 이름인 종목(예: 수동교정)까지 동기화
    reconciled = storage.reconcile_snapshot_names()
    for t in set(updated) | set(reconciled):
        cache_svc.invalidate(t)
    cache_svc.invalidate_portfolio_caches()
    return {"ok": True, "candidates": len(candidates), "updated": len(updated), "skipped": skipped, "reconciled": len(reconciled)}


@router.post("/dividends/refresh", status_code=202)
def refresh_all_dividends(background_tasks: BackgroundTasks, user_id: str = Depends(require_admin)):
    background_tasks.add_task(_run_dividends_all)
    return {"message": "배당 전 종목 수집 시작"}


def _run_dividends_all():
    from services.dividends import fetch_all_dividends
    with job_runs.record("dividend_fetch", "manual"):
        fetch_all_dividends()


@router.post("/supply-score/refresh", status_code=202)
def refresh_supply_score(background_tasks: BackgroundTasks, user_id: str = Depends(require_admin)):
    background_tasks.add_task(_run_supply_score_all)
    return {"message": "수급 종합 스코어 전 종목 산출 시작"}


def _run_supply_score_all():
    from scheduler import _supply_score_work
    with job_runs.record("supply_score_fetch", "manual"):
        _supply_score_work()


def _usdkrw_rate() -> "float | None":
    """저장된 USD/KRW 환율(market_cache 'fx')만 읽는다 — 요청 경로 라이브 FX 호출 0.

    FX 배치(get_fx)가 채운 영구 캐시를 읽는다. 없으면 None(US 배당은 KRW 환산서 제외)."""
    stored = _mc_load("fx")
    if not stored:
        return None
    rate = ((stored.get("data") or {}).get("rates") or {}).get("usdkrw") or {}
    cur = rate.get("current")
    try:
        v = float(cur) if cur else None
    except (TypeError, ValueError):
        return None
    # 비유한(nan/inf)은 None — 안 그러면 _portfolio_totals의 `if fx is None` 가드를 통과해(NaN≠None)
    # totals가 NaN→응답 직렬화 500(CONCERNS §3, task#104). None이면 US 카드가 totals서 graceful 제외.
    return v if (v is not None and math.isfinite(v)) else None


@router.get("/dashboard")
def get_dashboard(user_id: str = Depends(get_current_user)):
    portfolio = storage.get_full_portfolio(user_id)
    holdings = portfolio.get("stocks", [])
    if not holdings:
        return {"holdings": [], "totals": None}

    def _build_card(stock: dict, quote: dict) -> dict:
        ticker = stock["ticker"].upper()
        snapshot, snapshot_date = _latest_snapshot(ticker)

        rsi = None
        target_mean = buy = hold = sell = None
        poc = vah = val = None
        hvn = []
        sector = ""
        if snapshot:
            rsi = (snapshot.get("daily_rsi") or {}).get("rsi")
            target_mean = snapshot.get("target_mean")
            buy = snapshot.get("buy")
            hold = snapshot.get("hold")
            sell = snapshot.get("sell")
            vp = snapshot.get("volume_profile") or {}
            poc = vp.get("poc")
            vah = vp.get("vah")
            val = vp.get("val")
            hvn = vp.get("hvn") or []
            # sector는 snapshot에서(part2 — t.info 제거). 기존 동치 위해 _norm_sector 적용.
            sector = market._norm_sector(snapshot.get("sector") or "")
            # 목표가·의견수 정본 = daily_consensus_mart as-of(최신 snapshot 날짜). 상세·목록과 동일 헬퍼로 정합. ADR-0008.
            _c = consensus_svc.apply_asof(
                {"target_mean": target_mean, "buy": buy, "hold": hold, "sell": sell},
                ticker, snapshot_date,
            )
            target_mean, buy, hold, sell = _c["target_mean"], _c["buy"], _c["hold"], _c["sell"]

        # 배당(income 뷰): 저장값만 읽음(라이브 yfinance/DART 호출 0). 무배당은 None graceful.
        div = dividends.get_dividend(ticker)
        annual_div = div.get("annual_dividend_per_share") if div else None
        div_yield = div.get("dividend_yield") if div else None
        avg_cost = stock.get("avg_cost")
        qty = stock.get("quantity")
        # 사용자 목표가/손절가(선택, 저장값만). 거리%는 프론트에서 current_price와 계산(task#142).
        target_price = stock.get("target_price")
        stop_price = stock.get("stop_price")
        # avg_cost/qty는 DB NUMERIC→Decimal, annual_div는 float이라 그대로 나누면
        # float/Decimal TypeError로 카드 빌드가 throw→minimal 폴백된다(대시보드 enrichment 전멸,
        # task#102 증상의 실제 트리거). 양쪽을 float로 정규화.
        yield_on_cost = (round(float(annual_div) / float(avg_cost) * 100, 2)
                         if (annual_div is not None and avg_cost) else None)
        expected_income = (round(float(annual_div) * float(qty), 2)
                           if (annual_div is not None and qty) else None)

        # 수급 종합 스코어(ADR-0014): KR 종목만 저장값(stock_supply_score) 조회 — 라이브 호출 0.
        # US/결측은 None. read_score 행에서 {band,flags,as_of}만 투영.
        supply = None
        if (stock.get("market") or "US") == "KR":
            score = supply_score.read_score(ticker)
            if score:
                supply = {"band": score.get("band"), "flags": score.get("flags"), "as_of": score.get("as_of")}

        # 내부자·5%지분 순매수 신호(S6): KR 종목만 저장값(stock_insider_trades) 집계 — 라이브 DART 0.
        # US/무데이터는 None. compute_net_signal에서 {direction,net_shares,count,window_days} 투영.
        insider = None
        if (stock.get("market") or "US") == "KR":
            insider = insider_trades.compute_net_signal(ticker)

        return {
            "ticker": ticker,
            "name": stock.get("name", ticker),
            "market": stock.get("market", "US"),
            "exchange": stock.get("exchange", ""),
            "avg_cost": avg_cost,
            "quantity": qty,
            "target_price": target_price,
            "stop_price": stop_price,
            "current_price": quote.get("price"),
            "daily_change_pct": quote.get("daily_change_pct"),
            "weekly_change_pct": quote.get("weekly_change_pct"),
            "monthly_change_pct": quote.get("monthly_change_pct"),
            "rsi": rsi,
            "poc": poc,
            "vah": vah,
            "val": val,
            "hvn": hvn,
            "target_mean": target_mean,
            "buy": buy,
            "hold": hold,
            "sell": sell,
            "snapshot_date": snapshot_date,
            "sector": sector or "기타",
            "annual_dividend_per_share": annual_div,
            "dividend_yield": div_yield,
            "yield_on_cost": yield_on_cost,
            "expected_annual_income": expected_income,
            "supply": supply,
            "insider": insider,
        }

    def _portfolio_totals(cards: list) -> "dict | None":
        """통화 혼재 합산은 KRW로 환산(US$×usdkrw, KR원×1). 평균 수익률=총배당/총평가.

        usdkrw는 저장 FX(_usdkrw_rate)만 사용. US 카드에 환율이 없으면 그 종목은
        총계에서 제외해 단위 혼동(달러를 원으로 오합산)을 막는다."""
        usdkrw = _usdkrw_rate()

        def _fx(card) -> "float | None":
            if (card.get("market") or "US") == "KR":
                return 1.0
            return usdkrw

        total_income = 0.0
        total_value = 0.0
        for c in cards:
            fx = _fx(c)
            if fx is None:
                continue
            inc = c.get("expected_annual_income")
            if inc is not None:
                total_income += inc * fx
            price, qty = c.get("current_price"), c.get("quantity")
            if price is not None and qty:
                total_value += float(price) * float(qty) * fx
        avg_yield = round(total_income / total_value * 100, 2) if total_value > 0 else None
        return {
            "total_expected_annual_income_krw": round(total_income, 2),
            "total_market_value_krw": round(total_value, 2),
            "avg_dividend_yield": avg_yield,
        }

    def _minimal_card(stock: dict, quote: dict) -> dict:
        """enrichment 실패 시 폴백 카드 — 기본 식별/보유 정보 + quote 시세만, 나머지 None.
        holdings=N이면 그리드도 N을 보장(빈 그리드 금지, task#102). 지표/배당은 폴링·재fetch가 채운다."""
        return {
            "ticker": stock["ticker"].upper(), "name": stock.get("name", stock["ticker"]),
            "market": stock.get("market", "US"), "exchange": stock.get("exchange", ""),
            "avg_cost": stock.get("avg_cost"), "quantity": stock.get("quantity"),
            "target_price": stock.get("target_price"), "stop_price": stock.get("stop_price"),
            "current_price": quote.get("price"),
            "daily_change_pct": quote.get("daily_change_pct"),
            "weekly_change_pct": quote.get("weekly_change_pct"),
            "monthly_change_pct": quote.get("monthly_change_pct"),
            "rsi": None, "poc": None, "vah": None, "val": None, "hvn": [],
            "target_mean": None, "buy": None, "hold": None, "sell": None,
            "snapshot_date": None, "sector": "기타",
            "annual_dividend_per_share": None, "dividend_yield": None,
            "yield_on_cost": None, "expected_annual_income": None,
            "supply": None, "insider": None,
        }

    def _build_all():
        # 일괄시세 실패도 카드 빌드를 막지 않는다 — 시세 없이 빌드(price None, 폴링이 채움).
        try:
            quotes = market.get_quotes_batch(holdings)
        except Exception as e:
            print(f"[dashboard] 일괄시세 실패 — 시세 없이 카드 빌드: {e}", file=sys.stderr)
            quotes = {}

        # 카드당 graceful — 한 종목 enrichment(snapshot/consensus/배당/수급/내부자 등)가 throw해도
        # 그 카드만 최소카드로 폴백하고 전체 500-to-empty를 막는다. holdings=N → 항상 N카드(task#102).
        def _safe(stock: dict) -> dict:
            q = quotes.get(stock["ticker"].upper(), {})
            try:
                return _build_card(stock, q)
            except Exception as e:
                print(f"[dashboard] {stock.get('ticker')} 카드 빌드 실패 — 최소카드 폴백: {e}", file=sys.stderr)
                return _minimal_card(stock, q)

        with ThreadPoolExecutor(max_workers=min(len(holdings), 10)) as executor:
            cards = list(executor.map(_safe, holdings))
        # NaN/inf는 None으로 — starlette JSONResponse(allow_nan=False)가 응답에 NaN/inf 있으면
        # 직렬화 500을 내므로(CONCERNS §3, task#104) 외부시세서 흘러든 비유한값을 안전망으로 제거.
        return sanitize({"holdings": cards, "totals": _portfolio_totals(cards)})

    return cache_svc.get_dashboard(user_id, _build_all)
