from pathlib import Path
from datetime import date
import json
import yfinance as yf

from services import market as mkt, indicators, scraper

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
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(json_path)
