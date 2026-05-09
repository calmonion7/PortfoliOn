from pathlib import Path
from datetime import date
import json
import pandas as pd
import yfinance as yf

from services import market as mkt, indicators, scraper, charts

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
    analyst = mkt.get_analyst_data(ticker, market, exchange)
    competitor_quotes = [
        mkt.get_quote(c, market, exchange)
        for c in stock.get("competitors", [])
    ]
    timeframe_rsi = indicators.get_timeframe_rsi(yf_sym)
    t = yf.Ticker(yf_sym)
    daily_df = t.history(period="1y")
    sr = indicators.get_support_resistance(daily_df) if not daily_df.empty else {}
    vp = indicators.get_volume_profile(daily_df)
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
    news = scraper.get_news(ticker)
    charts.generate_revenue_chart(financials, ticker, output_dir)
    rsi_close = daily_df["Close"] if not daily_df.empty else pd.Series(dtype=float)
    charts.generate_rsi_chart(rsi_close, ticker, output_dir)

    sections = [
        _header(stock, quote, today, market),
        _section1(quote, competitor_quotes, market),
        _section2(financials, market),
        _section3(analyst, finviz, market),
        _section4(stock),
        _section5(stock),
        _section6(quote, news, stock.get("recent_disclosures", ""), market),
        _section7(timeframe_rsi, sr, market),
        _section8(vp, market),
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


def _section2(financials: list[dict], market: str) -> str:
    lines = [
        "## 2️⃣ 매출/영업이익 추이 (최근 4분기)\n",
        "| 분기 | 매출 | 영업이익 |",
        "|---|---|---|",
    ]
    if not financials:
        lines.append("| N/A | N/A | N/A |")
    else:
        for q in financials:
            if market == "KR":
                rev = f"₩{q['revenue']/1e8:,.0f}억" if q.get("revenue") else "N/A"
                op = f"₩{q['operating_income']/1e8:,.0f}억" if q.get("operating_income") else "N/A"
            else:
                rev = f"${q['revenue']/1e9:.2f}B" if q.get("revenue") else "N/A"
                op = f"${q['operating_income']/1e9:.2f}B" if q.get("operating_income") else "N/A"
            lines.append(f"| {q['period']} | {rev} | {op} |")
    lines.append("\n![Revenue Chart](./revenue_chart.png)")
    return "\n".join(lines)


def _section3(analyst: dict, finviz: dict, market: str) -> str:
    target = analyst.get("target_mean") or finviz.get("finviz_target")
    total = (analyst.get("buy", 0) + analyst.get("hold", 0) + analyst.get("sell", 0)) or 1
    lines = [
        "## 3️⃣ 증권사 컨센서스\n",
        "| 항목 | 값 |",
        "|---|---|",
        f"| 평균 목표가 | {_fp(target, market)} |" if target else "| 평균 목표가 | N/A |",
        f"| 최고 목표가 | {_fp(analyst.get('target_high'), market)} |" if analyst.get("target_high") else "| 최고 목표가 | N/A |",
        f"| 최저 목표가 | {_fp(analyst.get('target_low'), market)} |" if analyst.get("target_low") else "| 최저 목표가 | N/A |",
        f"| Buy | {analyst.get('buy', 0)}명 ({analyst.get('buy', 0)/total*100:.0f}%) |",
        f"| Hold | {analyst.get('hold', 0)}명 ({analyst.get('hold', 0)/total*100:.0f}%) |",
        f"| Sell | {analyst.get('sell', 0)}명 ({analyst.get('sell', 0)/total*100:.0f}%) |",
    ]
    if finviz.get("finviz_recom"):
        lines.append(f"| Finviz 추천지수 | {finviz['finviz_recom']:.1f} (1=강매수, 5=강매도) |")
    return "\n".join(lines)


def _section4(stock: dict) -> str:
    return f"## 4️⃣ 경제적 해자\n\n{stock.get('moat', '정보 없음')}"


def _section5(stock: dict) -> str:
    return f"## 5️⃣ 장기 성장 계획\n\n{stock.get('growth_plan', '정보 없음')}"


def _section6(quote: dict, news: list[dict], recent_disclosures: str, market: str) -> str:
    lines = ["## 6️⃣ 최근 공시 & 주가 영향\n"]
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


def _section7(timeframe_rsi: dict, sr: dict, market: str) -> str:
    lines = [
        "## 7️⃣ 매수/매도 타점\n",
        "### RSI 현황\n",
        "| 시간대 | 현재 RSI | RSI20 | RSI25 | RSI30 | RSI70 | RSI75 | RSI80 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for tf, label in [("daily", "일봉"), ("weekly", "주봉"), ("monthly", "월봉")]:
        d = timeframe_rsi.get(tf, {})
        rsi = f"{d['rsi']:.1f}" if d.get("rsi") else "N/A"
        t20 = _fp(d.get('target_20'), market)
        t25 = _fp(d.get('target_25'), market)
        t30 = _fp(d.get('target_30'), market)
        t70 = _fp(d.get('target_70'), market)
        t75 = _fp(d.get('target_75'), market)
        t80 = _fp(d.get('target_80'), market)
        lines.append(f"| {label} | {rsi} | {t20} | {t25} | {t30} | {t70} | {t75} | {t80} |")
    lines += [
        "\n### 지지·저항 & EMA\n",
        "| 항목 | 값 |",
        "|---|---|",
        f"| 52주 고점 | {_fp(sr.get('week52_high'), market)} |" if sr.get("week52_high") else "| 52주 고점 | N/A |",
        f"| 52주 저점 | {_fp(sr.get('week52_low'), market)} |" if sr.get("week52_low") else "| 52주 저점 | N/A |",
        f"| EMA(20) | {_fp(sr.get('ema20'), market)} |" if sr.get("ema20") else "| EMA(20) | N/A |",
        f"| EMA(50) | {_fp(sr.get('ema50'), market)} |" if sr.get("ema50") else "| EMA(50) | N/A |",
        f"| EMA(200) | {_fp(sr.get('ema200'), market)} |" if sr.get("ema200") else "| EMA(200) | N/A |",
        "\n![RSI Chart](./rsi_chart.png)",
    ]
    return "\n".join(lines)


def _section8(vp: dict, market: str) -> str:
    if not vp or vp.get("poc") is None:
        return ""
    poc = _fp(vp['poc'], market)
    hvn_str = " / ".join(_fp(v, market) for v in vp.get("hvn", [])) or "N/A"
    lvn_str = " / ".join(_fp(v, market) for v in vp.get("lvn", [])) or "N/A"
    lines = [
        "## 8️⃣ 매물대 분석 (Volume Profile, 1년 일봉)\n",
        "| POC | HVN (지지·저항 후보) | LVN (매물 공백) |",
        "|---|---|---|",
        f"| {poc} | {hvn_str} | {lvn_str} |",
    ]
    return "\n".join(lines)
