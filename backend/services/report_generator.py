from pathlib import Path
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor
import json
import pandas as pd
import yfinance as yf

from services import market as mkt, indicators, scraper
from services.utils import sanitize as _sanitize
from services.db import get_db

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"


def _fin_num(v):
    """yfinance info 값을 유한 float으로 변환. 'Infinity'/NaN/None → None."""
    import math
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def generate_report(stock: dict, output_base_dir: Path = SNAPSHOTS_DIR) -> str:
    ticker = stock["ticker"]
    market = stock.get("market", "US")
    exchange = stock.get("exchange", "")
    yf_sym = mkt._yf_sym(ticker, market, exchange)
    today = date.today().strftime("%Y-%m-%d")
    output_dir = output_base_dir / ticker
    output_dir.mkdir(parents=True, exist_ok=True)

    competitors = stock.get("competitors", [])

    # _t.history / _t.info는 thread-safe하지 않으므로 executor 외부에서 직렬 호출
    _t = yf.Ticker(yf_sym) if market != "KR" else None
    if _t is not None:
        try:
            _ = _t.info  # info 사전 캐싱
        except Exception:
            pass
    _hist_fn = _t.history if _t is not None else yf.Ticker(yf_sym).history
    daily_df = _hist_fn(period="1y")

    with ThreadPoolExecutor(max_workers=8) as ex:
        f_quote     = ex.submit(mkt.get_quote, ticker, market, exchange, _t)
        f_fin       = ex.submit(mkt.get_financials, ticker, market, exchange)
        f_fin_ann   = ex.submit(mkt.get_annual_financials, ticker, market, exchange)
        f_analyst   = ex.submit(mkt.get_analyst_data, ticker, market, exchange, _t)
        f_rsi       = ex.submit(indicators.get_timeframe_rsi, yf_sym)
        f_finviz    = ex.submit(scraper.scrape_finviz_consensus, ticker) if market == "US" else None
        f_news      = ex.submit(scraper.get_news, ticker, market)
        f_comps     = [ex.submit(mkt.get_quote, c, market, exchange) for c in competitors]

    quote             = f_quote.result()
    financials        = f_fin.result()
    financials_annual = f_fin_ann.result()
    analyst           = f_analyst.result()
    timeframe_rsi     = f_rsi.result()
    finviz            = f_finviz.result() if f_finviz is not None else {}
    news              = f_news.result()
    competitor_quotes = [f.result() for f in f_comps]

    vp = indicators.get_volume_profile(daily_df)

    high_20d = round(float(daily_df["High"].tail(20).max()), 2) if not daily_df.empty else None
    _cur = quote.get("price")
    drop_from_high_20d = round((_cur - high_20d) / high_20d * 100, 2) if high_20d and _cur else None

    if market == "KR":
        sector = quote.get("sector", "")
        industry = quote.get("industry", "")
        current_price = quote.get("price")
        actual_f = [f for f in financials if not f.get("is_consensus")]
        eps_list = [f["eps"] for f in actual_f if f.get("eps") is not None]
        trailing_eps = sum(eps_list[:4]) if len(eps_list) >= 2 else None
        trailing_per = round(current_price / trailing_eps, 1) if current_price and trailing_eps else None
        consensus_f = next((f for f in financials if f.get("is_consensus") and f.get("eps")), None)
        forward_per = round(current_price / (consensus_f["eps"] * 4), 1) if current_price and consensus_f else None
        actual_bps = next((f["bps"] for f in actual_f if f.get("bps") is not None), None)
        pbr = round(current_price / actual_bps, 2) if current_price and actual_bps else None
    else:
        try:
            _info = (_t.info if _t is not None else {}) or {}
            sector = _info.get("sector", "")
            industry = _info.get("industry", "")
            trailing_per = _fin_num(_info.get("trailingPE"))
            forward_per = _fin_num(_info.get("forwardPE"))
            pbr = _fin_num(_info.get("priceToBook"))
        except Exception:
            sector, industry = "", ""
            trailing_per = forward_per = pbr = None

    summary = {
        "ticker": ticker,
        "name": stock.get("name", ticker),
        "date": today,
        "market": market,
        "price": quote.get("price") or (round(float(daily_df["Close"].iloc[-1]), 2) if not daily_df.empty else None),
        "target_mean": analyst.get("target_mean") or finviz.get("finviz_target"),
        "target_high": analyst.get("target_high"),
        "target_low": analyst.get("target_low"),
        "buy": analyst.get("buy", 0),
        "hold": analyst.get("hold", 0),
        "sell": analyst.get("sell", 0),
        "finviz_recom": finviz.get("finviz_recom"),
        "daily_rsi": timeframe_rsi.get("daily", {}),
        "weekly_rsi": timeframe_rsi.get("weekly", {}),
        "monthly_rsi": timeframe_rsi.get("monthly", {}),
        "volume_profile": vp,
        "financials": financials,
        "financials_annual": financials_annual,
        "sector": sector,
        "industry": industry,
        "per": round(trailing_per, 2) if trailing_per else None,
        "forward_per": round(forward_per, 2) if forward_per else None,
        "pbr": round(pbr, 2) if pbr else None,
        "high_20d": high_20d,
        "drop_from_high_20d": drop_from_high_20d,
        "moat": stock.get("moat", ""),
        "growth_plan": stock.get("growth_plan", ""),
        "recent_disclosures": stock.get("recent_disclosures", ""),
        "risks": stock.get("risks", ""),
        "competitors_data": [
            {
                "ticker": q.get("ticker") or c,
                "name": q.get("name", "") or (stock.get("name", ticker) if c == ticker else ""),
                "price": (
                    q.get("price") or (round(float(daily_df["Close"].iloc[-1]), 2) if c == ticker and not daily_df.empty else None)
                ),
                "market_cap": q.get("market_cap"),
                "ytd_return": q.get("ytd_return"),
                "is_self": c == ticker,
            }
            for c, q in zip(
                [ticker] + list(competitors),
                [quote] + competitor_quotes,
            )
        ],
        "news": news,
    }

    if summary["price"] is None:
        detail = quote.get("error", "")
        raise ValueError(f"주가 데이터 없음{': ' + detail if detail else ''}")

    sanitized = _sanitize(summary)
    json_path = output_dir / f"{today}.json"
    json_path.write_text(json.dumps(sanitized, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        get_db().table("snapshots").upsert({"ticker": ticker, "date": today, "data": sanitized}).execute()
    except Exception as e:
        print(f"[Report] Supabase save failed for {ticker}: {e}")
    return str(json_path)


def _rsi_block(df: pd.DataFrame) -> dict:
    empty = {"rsi": None, "target_20": None, "target_25": None, "target_30": None,
             "target_70": None, "target_75": None, "target_80": None}
    if df.empty or len(df) < 15:
        return empty
    rsi = indicators.calc_rsi(df["Close"])
    if rsi.isna().all():
        return empty
    cur = round(float(rsi.iloc[-1]), 2)
    return {
        "rsi": cur,
        "target_20": indicators.calc_rsi_target_price(df["Close"], rsi, 20.0),
        "target_25": indicators.calc_rsi_target_price(df["Close"], rsi, 25.0),
        "target_30": indicators.calc_rsi_target_price(df["Close"], rsi, 30.0),
        "target_70": indicators.calc_rsi_target_price(df["Close"], rsi, 70.0),
        "target_75": indicators.calc_rsi_target_price(df["Close"], rsi, 75.0),
        "target_80": indicators.calc_rsi_target_price(df["Close"], rsi, 80.0),
    }


def _normalize_index(df: pd.DataFrame) -> pd.DataFrame:
    if df.index.tz is not None:
        df = df.copy()
        df.index = df.index.tz_localize(None)
    df.index = df.index.normalize()
    return df


def backfill_ticker(stock: dict, days: int = 60, output_base_dir: Path = SNAPSHOTS_DIR) -> int:
    ticker = stock["ticker"]
    market = stock.get("market", "US")
    exchange = stock.get("exchange", "")
    yf_sym = mkt._yf_sym(ticker, market, exchange)

    output_dir = output_base_dir / ticker
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        rows = get_db().table("snapshots").select("date").eq("ticker", ticker.upper()).execute().data
        existing = {str(r["date"]) for r in rows}
    except Exception:
        existing = {f.stem for f in output_dir.glob("*.json")}

    try:
        t = yf.Ticker(yf_sym)
        daily_df   = _normalize_index(t.history(period="2y",  interval="1d"))
        weekly_df  = _normalize_index(t.history(period="5y",  interval="1wk"))
        monthly_df = _normalize_index(t.history(period="10y", interval="1mo"))
    except Exception:
        return 0

    if daily_df.empty:
        return 0

    analyst           = mkt.get_analyst_data(ticker, market, exchange)
    financials        = mkt.get_financials(ticker, market, exchange)
    financials_annual = mkt.get_annual_financials(ticker, market, exchange)
    finviz            = scraper.scrape_finviz_consensus(ticker) if market == "US" else {}

    if market == "KR":
        quote = mkt.get_quote(ticker, market, exchange)
        sector = quote.get("sector", "")
        industry = quote.get("industry", "")
        actual_f = [f for f in financials if not f.get("is_consensus")]
        eps_list = [f["eps"] for f in actual_f if f.get("eps") is not None]
        trailing_eps = sum(eps_list[:4]) if len(eps_list) >= 2 else None
        consensus_f = next((f for f in financials if f.get("is_consensus") and f.get("eps")), None)
        actual_bps = next((f["bps"] for f in actual_f if f.get("bps") is not None), None)
    else:
        try:
            info = t.info
            sector = info.get("sector", "")
            industry = info.get("industry", "")
            trailing_per = info.get("trailingPE")
            forward_per = info.get("forwardPE")
            pbr = info.get("priceToBook")
        except Exception:
            sector = industry = ""
            trailing_per = forward_per = pbr = None

    cutoff = pd.Timestamp(date.today() - timedelta(days=days)).normalize()
    trade_dates = daily_df[daily_df.index >= cutoff].index

    created = 0
    for ts in trade_dates:
        date_str = ts.strftime("%Y-%m-%d")
        if date_str in existing:
            continue

        d_trim = daily_df[daily_df.index <= ts]
        w_trim = weekly_df[weekly_df.index <= ts]
        m_trim = monthly_df[monthly_df.index <= ts]

        price = round(float(d_trim["Close"].iloc[-1]), 2)

        daily_rsi   = _rsi_block(d_trim)
        weekly_rsi  = _rsi_block(w_trim)
        monthly_rsi = _rsi_block(m_trim)
        vp = indicators.get_volume_profile(d_trim)

        high_20d = round(float(d_trim["High"].tail(20).max()), 2) if not d_trim.empty else None
        drop_from_high_20d = round((price - high_20d) / high_20d * 100, 2) if high_20d and price else None

        if market == "KR":
            trailing_per = round(price / trailing_eps, 1) if price and trailing_eps else None
            forward_per = round(price / (consensus_f["eps"] * 4), 1) if price and consensus_f else None
            pbr = round(price / actual_bps, 2) if price and actual_bps else None

        summary = {
            "ticker": ticker,
            "name": stock.get("name", ticker),
            "date": date_str,
            "market": market,
            "price": price,
            "target_mean": analyst.get("target_mean") or finviz.get("finviz_target"),
            "target_high": analyst.get("target_high"),
            "target_low": analyst.get("target_low"),
            "buy": analyst.get("buy", 0),
            "hold": analyst.get("hold", 0),
            "sell": analyst.get("sell", 0),
            "finviz_recom": finviz.get("finviz_recom"),
            "daily_rsi": daily_rsi,
            "weekly_rsi": weekly_rsi,
            "monthly_rsi": monthly_rsi,
            "volume_profile": vp,
            "financials": financials,
            "financials_annual": financials_annual,
            "sector": sector,
            "industry": industry,
            "per": round(trailing_per, 2) if trailing_per else None,
            "forward_per": round(forward_per, 2) if forward_per else None,
            "pbr": round(pbr, 2) if pbr else None,
            "high_20d": high_20d,
            "drop_from_high_20d": drop_from_high_20d,
            "moat": stock.get("moat", ""),
            "growth_plan": stock.get("growth_plan", ""),
            "recent_disclosures": stock.get("recent_disclosures", ""),
            "risks": stock.get("risks", ""),
            "competitors_data": [],
            "news": [],
        }

        sanitized = _sanitize(summary)
        out_path = output_dir / f"{date_str}.json"
        out_path.write_text(json.dumps(sanitized, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            get_db().table("snapshots").upsert({"ticker": ticker, "date": date_str, "data": sanitized}).execute()
        except Exception as e:
            print(f"[Backfill] Supabase save failed for {ticker} {date_str}: {e}")
        created += 1

    return created
