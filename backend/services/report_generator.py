from pathlib import Path
from datetime import date, timedelta
import json
import math
import pandas as pd
import yfinance as yf

from services import market as mkt, indicators, scraper


def _sanitize(obj):
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"


def _yf_sym(ticker: str, market: str, exchange: str) -> str:
    return mkt._yf_sym(ticker, market, exchange)


def generate_report(stock: dict, output_base_dir: Path = SNAPSHOTS_DIR) -> str:
    ticker = stock["ticker"]
    market = stock.get("market", "US")
    exchange = stock.get("exchange", "")
    yf_sym = _yf_sym(ticker, market, exchange)
    today = date.today().strftime("%Y-%m-%d")
    output_dir = output_base_dir / ticker
    output_dir.mkdir(parents=True, exist_ok=True)

    quote = mkt.get_quote(ticker, market, exchange)
    financials = mkt.get_financials(ticker, market, exchange)
    financials_annual = mkt.get_annual_financials(ticker, market, exchange)
    analyst = mkt.get_analyst_data(ticker, market, exchange)
    competitor_quotes = [
        mkt.get_quote(c, market, exchange)
        for c in stock.get("competitors", [])
    ]
    timeframe_rsi = indicators.get_timeframe_rsi(yf_sym)
    t = yf.Ticker(yf_sym)
    daily_df = t.history(period="1y")
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
            _info = t.info
            sector = _info.get("sector", "")
            industry = _info.get("industry", "")
            trailing_per = _info.get("trailingPE")
            forward_per = _info.get("forwardPE")
            pbr = _info.get("priceToBook")
        except Exception:
            sector, industry = "", ""
            trailing_per = forward_per = pbr = None

    finviz = scraper.scrape_finviz_consensus(ticker) if market == "US" else {}
    news = scraper.get_news(ticker, market)

    summary = {
        "ticker": ticker,
        "name": stock.get("name", ticker),
        "date": today,
        "market": market,
        "price": quote.get("price"),
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
                "name": q.get("name", ""),
                "price": q.get("price"),
                "market_cap": q.get("market_cap"),
                "ytd_return": q.get("ytd_return"),
            }
            for c, q in zip(
                [ticker] + list(stock.get("competitors", [])),
                [quote] + competitor_quotes,
            )
        ],
        "news": news,
    }

    json_path = output_dir / f"{today}.json"
    json_path.write_text(json.dumps(_sanitize(summary), ensure_ascii=False, indent=2), encoding="utf-8")
    return str(json_path)


def _rsi_block(df: pd.DataFrame) -> dict:
    """DataFrame(tail까지 trim된 상태)에서 RSI + 목표가 블록 계산."""
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
    """ticker의 과거 N거래일치 스냅샷을 생성. 이미 있는 날짜는 스킵. 생성 건수 반환."""
    ticker = stock["ticker"]
    market = stock.get("market", "US")
    exchange = stock.get("exchange", "")
    yf_sym = _yf_sym(ticker, market, exchange)

    output_dir = output_base_dir / ticker
    output_dir.mkdir(parents=True, exist_ok=True)

    # 이미 있는 날짜 수집
    existing = {f.stem for f in output_dir.glob("*.json")}

    # yfinance 이력 1회 다운로드
    try:
        t = yf.Ticker(yf_sym)
        daily_df  = _normalize_index(t.history(period="2y",  interval="1d"))
        weekly_df = _normalize_index(t.history(period="5y",  interval="1wk"))
        monthly_df = _normalize_index(t.history(period="10y", interval="1mo"))
    except Exception:
        return 0

    if daily_df.empty:
        return 0

    # 현재 애널리스트/재무 데이터 1회 조회 (모든 날짜에 재사용)
    analyst   = mkt.get_analyst_data(ticker, market, exchange)
    financials = mkt.get_financials(ticker, market, exchange)
    financials_annual = mkt.get_annual_financials(ticker, market, exchange)
    finviz = scraper.scrape_finviz_consensus(ticker) if market == "US" else {}

    if market == "KR":
        quote = mkt.get_quote(ticker, market, exchange)
        sector = quote.get("sector", "")
        industry = quote.get("industry", "")
        actual_f = [f for f in financials if not f.get("is_consensus")]
        eps_list = [f["eps"] for f in actual_f if f.get("eps") is not None]
        trailing_eps = sum(eps_list[:4]) if len(eps_list) >= 2 else None
        consensus_f = next((f for f in financials if f.get("is_consensus") and f.get("eps")), None)
        _per_base = None   # 날짜별 가격으로 재계산
        _fper_base = None
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

    # 대상 날짜: 최근 days일 내 거래일 (daily_df에 있는 날짜)
    cutoff = pd.Timestamp(date.today() - timedelta(days=days)).normalize()
    trade_dates = daily_df[daily_df.index >= cutoff].index

    created = 0
    for ts in trade_dates:
        date_str = ts.strftime("%Y-%m-%d")
        if date_str in existing:
            continue

        # 해당 날짜까지의 데이터로 trim
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

        out_path = output_dir / f"{date_str}.json"
        out_path.write_text(json.dumps(_sanitize(summary), ensure_ascii=False, indent=2), encoding="utf-8")
        created += 1

    return created
