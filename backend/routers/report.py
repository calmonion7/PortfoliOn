from __future__ import annotations
import json
from datetime import date as _date, timedelta, datetime as _datetime
from zoneinfo import ZoneInfo as _ZoneInfo

_KST = _ZoneInfo("Asia/Seoul")
from typing import Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Body
from pathlib import Path
from services import storage, report_generator
from services import market as market_svc
from services import consensus as consensus_svc
from services import consensus_pipeline as _pipeline
from services import cache as cache_svc
from services.utils import sanitize as _sanitize
from services.progress import ProgressTracker
from services.parallel import parallel_map
from services.db import query, execute
from auth import get_current_user, require_admin, get_current_user_or_api_key, require_admin_or_api_key, _API_KEY_USER_ID
from services import auth_service as _auth_svc

router = APIRouter(prefix="/api", tags=["report"])

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"
REPORTS_DIR = Path(__file__).parent.parent / "reports"

_DAY_MAP = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}

def _last_scheduled_date(schedule: dict) -> str:
    """Return the most recent date matching the schedule's days of week."""
    enabled_days = {_DAY_MAP[d] for d in schedule.get("days", []) if d in _DAY_MAP}
    today = _datetime.now(tz=_KST).date()
    if not schedule.get("enabled") or not enabled_days:
        return today.strftime("%Y-%m-%d")
    for i in range(7):
        d = today - timedelta(days=i)
        if d.weekday() in enabled_days:
            return d.strftime("%Y-%m-%d")
    return today.strftime("%Y-%m-%d")

_RSI_KEYS = ("rsi", "target_20", "target_25", "target_30", "target_70", "target_75", "target_80")
_SLIM_KEYS = (
    "name", "market", "price", "sector", "industry",
    "drop_from_high_20d", "target_mean", "target_high", "target_low",
    "buy", "hold", "sell", "per", "forward_per", "pbr", "finviz_recom",
)


def _slim_summary(data: dict) -> dict:
    """list_reports용 — financials/news/competitors_data 등 무거운 필드 제외."""
    s = {k: data.get(k) for k in _SLIM_KEYS}
    for rsi_field in ("daily_rsi", "weekly_rsi", "monthly_rsi"):
        rsi = data.get(rsi_field) or {}
        s[rsi_field] = {k: rsi[k] for k in _RSI_KEYS if k in rsi} if rsi else None
    vp = data.get("volume_profile") or {}
    s["volume_profile"] = {"poc": vp["poc"]} if vp.get("poc") is not None else None
    return _sanitize(s)

_progress = ProgressTracker()
_backfill_progress = ProgressTracker(created=0)


@router.get("/report/progress")
def get_progress():
    return _progress.get()


@router.get("/report/backfill/progress")
def get_backfill_progress():
    return _backfill_progress.get()


@router.post("/report/backfill", status_code=202)
def backfill_all(background_tasks: BackgroundTasks, days: int = 60, force: bool = False, user_id: str = Depends(require_admin)):
    portfolio = storage.get_global_portfolio()
    stocks = portfolio.get("stocks", []) + portfolio.get("watchlist", [])
    if not stocks:
        raise HTTPException(status_code=400, detail="No stocks in portfolio or watchlist")
    background_tasks.add_task(_run_backfill, stocks, days, force)
    return {"message": f"과거 {days}일 스냅샷 백필 시작: {len(stocks)}개 종목 (force={force})"}


def _run_backfill(stocks: list, days: int, force: bool = False):
    _backfill_progress.start(len(stocks))
    _backfill_progress.set(created=0)
    total_created = 0
    for stock in stocks:
        _backfill_progress.set(current=stock["ticker"])
        try:
            n = report_generator.backfill_ticker(stock, days=days, force=force)
            total_created += n
            cache_svc.invalidate(stock["ticker"])
        except Exception as e:
            print(f"[Backfill] Failed for {stock['ticker']}: {e}")
        _backfill_progress.increment()
        _backfill_progress.set(created=total_created)
    _backfill_progress.finish()


@router.post("/report/generate", status_code=202)
def generate_all(background_tasks: BackgroundTasks, tickers: Optional[str] = None, date: Optional[str] = None, user_id: str = Depends(require_admin_or_api_key)):
    portfolio = storage.get_global_portfolio()
    all_stocks = portfolio.get("stocks", []) + portfolio.get("watchlist", [])
    if tickers:
        ticker_set = {t.strip().upper() for t in tickers.split(',')}
        stocks = [s for s in all_stocks if s['ticker'].upper() in ticker_set]
    else:
        stocks = all_stocks
    if not stocks:
        raise HTTPException(status_code=400, detail="No stocks in portfolio or watchlist")
    if not date:
        date = _last_scheduled_date(storage.get_schedule())
    _progress.start(len(stocks))
    background_tasks.add_task(_run_generation, stocks, date)
    return {"message": f"Generating reports for {len(stocks)} stock(s)"}


@router.post("/report/generate/{ticker}", status_code=202)
def generate_one(ticker: str, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    from services.utils import find_ticker
    stock = find_ticker(storage.get_all_stocks(user_id), ticker)
    if not stock:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in portfolio or watchlist")
    _progress.start(1)
    background_tasks.add_task(_run_generation, [stock])
    return {"message": f"Generating report for {ticker.upper()}"}


def _run_generation(stocks: list, target_date: str = None):
    # start()는 호출한 엔드포인트에서 이미 호출함 — 여기서 이중 호출 금지

    def _process_one(stock):
        _progress.set(current=stock["ticker"])
        try:
            report_generator.generate_report(stock, target_date=target_date)
            cache_svc.invalidate(stock["ticker"])
            _pipeline.run_daily([stock])
        except Exception as e:
            print(f"[Report] Failed for {stock['ticker']}: {e}")
            _progress.add_failed(stock["ticker"], str(e))
        finally:
            _progress.increment()

    parallel_map(_process_one, stocks, max_workers=5)
    _progress.finish()


def _read_snapshot(ticker: str, date_str: str) -> Optional[dict]:
    rows = query(
        "SELECT data FROM snapshots WHERE ticker = %s AND date = %s",
        (ticker.upper(), date_str),
    )
    if rows:
        return _sanitize(rows[0]["data"])
    # 로컬 파일 폴백
    for base in (SNAPSHOTS_DIR, REPORTS_DIR):
        path = base / ticker / f"{date_str}.json"
        if path.exists():
            return _sanitize(json.loads(path.read_text(encoding="utf-8")))
    return None


@router.get("/report/list")
def list_reports(scope: str = "mine", user_id: str = Depends(get_current_user_or_api_key)):
    all_scope = scope == "all" and user_id != _API_KEY_USER_ID
    if all_scope:
        caller = _auth_svc.get_user_by_id(user_id)
        if not caller or caller.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin only")

    def _build():
        if all_scope:
            portfolio = storage.get_global_portfolio()
            my_tickers = {s["ticker"].upper() for s in storage.get_all_stocks(user_id)}
        else:
            portfolio = storage.get_global_portfolio() if user_id == _API_KEY_USER_ID else storage.get_full_portfolio(user_id)
            my_tickers = None

        portfolio_stocks = {s["ticker"].upper(): s for s in portfolio.get("stocks", [])}
        portfolio_watchlist = {s["ticker"].upper(): s for s in portfolio.get("watchlist", [])}
        holding_tickers = set(portfolio_stocks.keys())
        watchlist_tickers = set(portfolio_watchlist.keys())

        user_tickers = holding_tickers | watchlist_tickers

        ticker_dates: dict = {}
        if user_tickers:
            date_rows = query(
                "SELECT ticker, date FROM snapshots WHERE ticker = ANY(%s) ORDER BY date DESC",
                (list(user_tickers),),
            )
            for r in date_rows:
                t = r["ticker"].upper()
                if t not in ticker_dates:
                    ticker_dates[t] = []
                ticker_dates[t].append(r["date"])

        # ticker별 최신 날짜 목록으로 data를 한 번에 fetch
        ticker_summary: dict = {}
        if ticker_dates:
            latest_dates = list({dates[0] for dates in ticker_dates.values()})
            summary_rows = query(
                "SELECT ticker, date, data FROM snapshots WHERE ticker = ANY(%s) AND date = ANY(%s)",
                (list(user_tickers), latest_dates),
            )
            for r in summary_rows:
                t = r["ticker"].upper()
                if t in ticker_dates and t not in ticker_summary \
                        and r["date"] == ticker_dates[t][0] and r.get("data"):
                    ticker_summary[t] = _slim_summary(r["data"])

        def _mk_entry(ticker, dates, category, stock_info, summary):
            market = stock_info.get("market") or (summary or {}).get("market", "US")
            e = {"dates": dates, "category": category, "summary": summary, "market": market, "exchange": stock_info.get("exchange", "")}
            if my_tickers is not None:
                e["is_mine"] = ticker in my_tickers
            return e

        result = {}
        for ticker, dates in ticker_dates.items():
            category = "holdings" if ticker in holding_tickers else "watchlist"
            summary = ticker_summary.get(ticker)
            stock_info = portfolio_stocks.get(ticker) or portfolio_watchlist.get(ticker) or {}
            result[ticker] = _mk_entry(ticker, dates, category, stock_info, summary)

        for ticker, stock in portfolio_stocks.items():
            if ticker not in result:
                result[ticker] = _mk_entry(ticker, [], "holdings", stock, None)
        for ticker, stock in portfolio_watchlist.items():
            if ticker not in result:
                result[ticker] = _mk_entry(ticker, [], "watchlist", stock, None)

        schedule = storage.get_schedule()
        return {"stocks": result, "last_scheduled_date": _last_scheduled_date(schedule)}

    if all_scope:
        return _build()
    return cache_svc.get_list(_build)


@router.get("/report/{ticker}/history")
def get_history(ticker: str):
    upper = ticker.upper()
    crows = query(
        "SELECT date, target_high, target_mean, target_low, buy, hold, sell"
        " FROM consensus_history WHERE ticker = %s ORDER BY date",
        (upper,),
    )
    srows = query("SELECT date, data FROM snapshots WHERE ticker = %s", (upper,))
    snap_by_date = {}
    for r in srows:
        raw = r["data"] or {}
        snap_by_date[str(r["date"])] = {
            "price": raw.get("price"),
            "rsi_daily": (raw.get("daily_rsi") or {}).get("rsi"),
            "rsi_weekly": (raw.get("weekly_rsi") or {}).get("rsi"),
            "rsi_monthly": (raw.get("monthly_rsi") or {}).get("rsi"),
        }

    if crows:
        result = []
        for r in crows:
            d = str(r["date"])
            snap = snap_by_date.get(d, {})
            result.append({
                "date": d,
                "price": snap.get("price"),
                "target_high": r.get("target_high"),
                "target_mean": r.get("target_mean"),
                "target_low": r.get("target_low"),
                "buy": r.get("buy"),
                "hold": r.get("hold"),
                "sell": r.get("sell"),
                "rsi_daily": snap.get("rsi_daily"),
                "rsi_weekly": snap.get("rsi_weekly"),
                "rsi_monthly": snap.get("rsi_monthly"),
                "has_snapshot": d in snap_by_date,
            })
        return result

    # consensus 데이터 없으면 snapshots fallback
    result = []
    for r in sorted(srows, key=lambda x: x["date"]):
        raw = r["data"] or {}
        result.append({
            "date": str(r["date"]),
            "price": raw.get("price"),
            "target_high": raw.get("target_high"),
            "target_mean": raw.get("target_mean"),
            "target_low": raw.get("target_low"),
            "buy": raw.get("buy"),
            "hold": raw.get("hold"),
            "sell": raw.get("sell"),
            "rsi_daily": (raw.get("daily_rsi") or {}).get("rsi"),
            "rsi_weekly": (raw.get("weekly_rsi") or {}).get("rsi"),
            "rsi_monthly": (raw.get("monthly_rsi") or {}).get("rsi"),
            "has_snapshot": True,
        })
    return result


@router.get("/report/{ticker}/{date_str}")
def get_report(ticker: str, date_str: str):
    upper = ticker.upper()
    summary = cache_svc.get_snapshot(upper, date_str, lambda: _read_snapshot(upper, date_str))
    if summary is None:
        raise HTTPException(status_code=404, detail="Report not found")
    rows = query(
        "SELECT buy_count AS buy, hold_count AS hold, sell_count AS sell"
        " FROM daily_consensus_mart WHERE ticker = %s ORDER BY base_date DESC LIMIT 1",
        (upper,),
    )
    if not rows:
        rows = query(
            "SELECT buy, hold, sell FROM consensus_history WHERE ticker = %s ORDER BY date DESC LIMIT 1",
            (upper,),
        )
    if rows:
        summary = dict(summary)
        summary["buy"] = rows[0]["buy"]
        summary["hold"] = rows[0]["hold"]
        summary["sell"] = rows[0]["sell"]
    enriched_at = None
    ea_rows = query("SELECT enriched_at FROM tickers WHERE ticker = %s", (upper,))
    if ea_rows and ea_rows[0].get("enriched_at"):
        enriched_at = ea_rows[0]["enriched_at"].isoformat()
    return {"ticker": upper, "date": date_str, "summary": summary, "enriched_at": enriched_at}


_consensus_progress = ProgressTracker()


@router.get("/consensus/batch/progress")
def get_consensus_batch_progress():
    return _consensus_progress.get()


@router.post("/consensus/batch", status_code=202)
def batch_consensus(background_tasks: BackgroundTasks, days: int = 180, force: bool = False, user_id: str = Depends(require_admin)):
    portfolio = storage.get_global_portfolio()
    stocks = portfolio.get("stocks", []) + portfolio.get("watchlist", [])
    if not stocks:
        raise HTTPException(status_code=400, detail="No stocks in portfolio or watchlist")
    background_tasks.add_task(_run_consensus_batch, stocks, days, force)
    return {"message": f"컨센서스 수집/백필 시작: {len(stocks)}개 종목"}


def _run_consensus_batch(stocks: list, days: int = 180, force: bool = False):
    _consensus_progress.start(len(stocks))
    for stock in stocks:
        _consensus_progress.set(current=stock["ticker"])
        try:
            _pipeline.backfill([stock], days, force)
        except Exception as e:
            print(f"[Consensus] backfill failed for {stock['ticker']}: {e}")
        _consensus_progress.increment()
    _consensus_progress.finish()


@router.get("/consensus/{ticker}")
def get_consensus(ticker: str):
    return consensus_svc.get_history(ticker)


@router.post("/consensus/{ticker}")
def collect_consensus(ticker: str):
    entry = consensus_svc.collect(ticker)
    if entry is None:
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    return entry


@router.post("/report/{ticker}/refresh-analyst")
def refresh_analyst(ticker: str):
    import yfinance as yf
    upper = ticker.upper()
    rows = query(
        "SELECT date, data FROM snapshots WHERE ticker = %s ORDER BY date DESC LIMIT 1",
        (upper,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="리포트를 먼저 생성하세요")
    row = rows[0]
    snap_date = row["date"]
    summary = row["data"] or {}
    market = summary.get("market", "US")
    exchange = summary.get("exchange")

    analyst = market_svc.get_analyst_data(upper, market, exchange)
    quote = market_svc.get_quote(upper, market, exchange or "")
    price = quote.get("price") or None

    patched: dict = {}
    for k in ("target_mean", "target_high", "target_low", "buy", "hold", "sell"):
        if analyst.get(k) is not None:
            summary[k] = analyst[k]
            patched[k] = analyst[k]
    if price:
        summary["price"] = price
        patched["price"] = price
        try:
            from services import market as _mkt
            yf_sym = _mkt._yf_sym(upper, market, exchange or "")
            hist = yf.Ticker(yf_sym).history(period="1mo")
            if not hist.empty:
                high_20d = round(float(hist["High"].tail(20).max()), 2)
                drop = round((price - high_20d) / high_20d * 100, 2)
                summary["drop_from_high_20d"] = drop
                patched["drop_from_high_20d"] = drop
        except Exception:
            pass

    if not patched:
        raise HTTPException(status_code=502, detail="데이터를 가져올 수 없습니다")
    execute(
        "UPDATE snapshots SET data = %s WHERE ticker = %s AND date = %s",
        (json.dumps(summary), upper, snap_date),
    )
    cache_svc.invalidate(upper)
    return patched


@router.post("/consensus/{ticker}/backfill")
def backfill_consensus(ticker: str):
    upper = ticker.upper()
    rows = query(
        "SELECT date, data FROM snapshots WHERE ticker = %s ORDER BY date DESC LIMIT 1",
        (upper,),
    )
    if not rows:
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    summary = rows[0]["data"] or {}
    market = summary.get("market", "US")
    added = consensus_svc.backfill(upper, market)
    return {"added": len(added), "entries": added}


@router.get("/report/backlog/pending")
def get_pending_backlog(user_id: str = Depends(get_current_user_or_api_key)):
    from services.backlog import get_pending_backlog as _get_pending
    return _get_pending()


@router.get("/report/{ticker}/backlog")
def get_backlog(ticker: str):
    from services.backlog import get_backlog as _get_backlog
    return _get_backlog(ticker)


@router.put("/report/{ticker}/backlog")
def put_backlog(ticker: str, entries: list = Body(...), user_id: str = Depends(get_current_user_or_api_key)):
    from services.backlog import save_llm_backlog
    save_llm_backlog(ticker, entries)
    return {"ticker": ticker.upper(), "saved": len(entries)}


@router.post("/report/{ticker}/backlog/refresh", status_code=202)
def refresh_backlog(ticker: str, user_id: str = Depends(require_admin)):
    from services.backlog import fetch_and_save_backlog
    result = fetch_and_save_backlog(ticker)
    return {"ticker": ticker.upper(), "count": len(result), "entries": result}


@router.get("/schedule")
def get_schedule():
    return storage.get_schedule()


@router.put("/schedule")
def update_schedule(schedule: dict):
    required = {"enabled", "time", "days"}
    if not required.issubset(schedule.keys()):
        raise HTTPException(
            status_code=400, detail=f"Missing fields: {required - schedule.keys()}"
        )
    storage.save_schedule(schedule)
    return schedule
