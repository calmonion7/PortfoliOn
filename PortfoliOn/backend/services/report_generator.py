from pathlib import Path
from datetime import date
import json
import yfinance as yf

from services import market as mkt, indicators, scraper

REPORTS_DIR = Path(__file__).parent.parent / "reports"


def _yf_sym(ticker: str, market: str, exchange: str) -> str:
    return mkt._yf_sym(ticker, market, exchange)


def _fp(price, market: str) -> str:
    """Format price with currency symbol."""
    if price is None:
        return "N/A"
    if market == "KR":
        return f"₩{int(price):,}"
    return f"${float(price):.2f}"


def _fmc(mc, market: str) -> str:
    if mc is None:
        return "N/A"
    return mkt._fmt_market_cap(mc, market)


def generate_report(stock: dict, output_base_dir: Path = REPORTS_DIR) -> str:
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
    if market == "KR":
        sector   = quote.get("sector", "")
        industry = quote.get("industry", "")
        current_price = quote.get("price")

        actual_f = [f for f in financials if not f.get("is_consensus")]

        # Trailing PER = 현재가 / 최근 4개 실제 분기 EPS 합산
        eps_list = [f["eps"] for f in actual_f if f.get("eps") is not None]
        trailing_eps = sum(eps_list[:4]) if len(eps_list) >= 2 else None
        trailing_per = round(current_price / trailing_eps, 1) if current_price and trailing_eps else None

        # Forward PER = 현재가 / (컨센서스 분기 EPS × 4)
        consensus_f = next((f for f in financials if f.get("is_consensus") and f.get("eps")), None)
        forward_per = round(current_price / (consensus_f["eps"] * 4), 1) if current_price and consensus_f else None

        # PBR = 현재가 / 가장 최근 실제 분기 BPS
        actual_bps = next((f["bps"] for f in actual_f if f.get("bps") is not None), None)
        pbr = round(current_price / actual_bps, 2) if current_price and actual_bps else None
    else:
        try:
            _info = t.info
            sector = _info.get('sector', '')
            industry = _info.get('industry', '')
            trailing_per = _info.get('trailingPE')
            forward_per = _info.get('forwardPE')
            pbr = _info.get('priceToBook')
        except Exception:
            sector, industry = '', ''
            trailing_per = forward_per = pbr = None
    quote["ticker"] = ticker
    finviz = scraper.scrape_finviz_consensus(ticker) if market == "US" else {}
    news = scraper.get_news(ticker, market)

    sections = [
        _header(stock, quote, today, market),
        _section1(quote, competitor_quotes, market),
        _section_risk(stock),
        _section3(stock),
        _section4(stock),
        _section5(quote, news, stock.get("recent_disclosures", ""), market),
    ]

    md_path = output_dir / f"{today}.md"
    md_path.write_text("\n\n".join(filter(None, sections)), encoding="utf-8")

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
    }
    json_path = output_dir / f"{today}.json"
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    return str(md_path)


def _header(stock: dict, quote: dict, today: str, market: str) -> str:
    price = quote.get("price")
    avg_cost = stock.get("avg_cost")
    ret = f"{(price - avg_cost) / avg_cost * 100:+.2f}%" if price and avg_cost else "N/A"
    if price:
        return (
            f"# {stock.get('name', stock['ticker'])} ({stock['ticker']}) — {today}\n\n"
            f"**현재가:** {_fp(price, market)}  |  **보유 수익률:** {ret}  |  "
            f"**전일 대비:** {quote.get('daily_change', 'N/A')}"
        )
    return f"# {stock.get('name', stock['ticker'])} ({stock['ticker']}) — {today}\n\n데이터 조회 실패"


def _section1(quote: dict, competitor_quotes: list[dict], market: str) -> str:
    rows = [quote] + competitor_quotes
    lines = [
        "## 1️⃣ 사업영역 & 시장순위\n",
        "| 종목 | 티커 | 현재가 | 시가총액 | YTD 수익률 |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        mc = _fmc(r.get("market_cap"), market)
        ytd = f"{r['ytd_return']:+.1f}%" if r.get("ytd_return") is not None else "N/A"
        price = _fp(r.get("price"), market)
        lines.append(f"| {r.get('name', r['ticker'])} | {r['ticker']} | {price} | {mc} | {ytd} |")
    return "\n".join(lines)



def _section_risk(stock: dict) -> str:
    return f"## 2️⃣ 리스크\n\n{stock.get('risks', '정보 없음')}"


def _section3(stock: dict) -> str:
    return f"## 3️⃣ 경제적 해자\n\n{stock.get('moat', '정보 없음')}"


def _section4(stock: dict) -> str:
    return f"## 4️⃣ 장기 성장 계획\n\n{stock.get('growth_plan', '정보 없음')}"


def _section5(quote: dict, news: list[dict], recent_disclosures: str, market: str) -> str:
    lines = ["## 5️⃣ 최근 공시 & 주가 영향\n"]
    if quote.get("prev_close"):
        lines.append(f"**어제 종가:** {_fp(quote['prev_close'], market)}  |  **전일 대비:** {quote.get('daily_change', 'N/A')}\n")
    if recent_disclosures:
        lines += ["### AI 분석\n", recent_disclosures, ""]
    lines.append("### 최근 뉴스\n")
    if not news:
        lines.append("_(뉴스 없음)_")
    else:
        for item in news:
            lines.append(f"- [{item['title']}]({item['link']}) — {item['publisher']} ({item['published_at']})")
    return "\n".join(lines)


