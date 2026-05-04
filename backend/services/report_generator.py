from pathlib import Path
from datetime import date
import pandas as pd
import yfinance as yf

from services import market, indicators, scraper, charts

REPORTS_DIR = Path(__file__).parent.parent / "reports"

def generate_report(stock: dict, output_base_dir: Path = REPORTS_DIR) -> str:
    ticker = stock["ticker"]
    today = date.today().strftime("%Y-%m-%d")
    output_dir = output_base_dir / ticker
    output_dir.mkdir(parents=True, exist_ok=True)

    quote = market.get_quote(ticker)
    financials = market.get_financials(ticker)
    analyst = market.get_analyst_data(ticker)
    competitor_quotes = [market.get_quote(c) for c in stock.get("competitors", [])]
    timeframe_rsi = indicators.get_timeframe_rsi(ticker)
    t = yf.Ticker(ticker)
    daily_df = t.history(period="1y")
    sr = indicators.get_support_resistance(daily_df) if not daily_df.empty else {}
    finviz = scraper.scrape_finviz_consensus(ticker)
    news = scraper.get_news(ticker)
    charts.generate_revenue_chart(financials, ticker, output_dir)
    rsi_close = daily_df["Close"] if not daily_df.empty else pd.Series(dtype=float)
    charts.generate_rsi_chart(rsi_close, ticker, output_dir)

    sections = [
        _header(stock, quote, today),
        _section1(quote, competitor_quotes),
        _section2(financials),
        _section3(analyst, finviz),
        _section4(stock),
        _section5(stock),
        _section6(quote, news),
        _section7(timeframe_rsi, sr),
    ]

    md_path = output_dir / f"{today}.md"
    md_path.write_text("\n\n".join(filter(None, sections)), encoding="utf-8")
    return str(md_path)

def _header(stock: dict, quote: dict, today: str) -> str:
    price = quote.get("price")
    avg_cost = stock.get("avg_cost")
    ret = f"{(price - avg_cost) / avg_cost * 100:+.2f}%" if price and avg_cost else "N/A"
    if price:
        return (
            f"# {stock.get('name', stock['ticker'])} ({stock['ticker']}) — {today}\n\n"
            f"**현재가:** ${price:.2f}  |  **보유 수익률:** {ret}  |  "
            f"**전일 대비:** {quote.get('daily_change', 'N/A')}"
        )
    return f"# {stock.get('name', stock['ticker'])} ({stock['ticker']}) — {today}\n\n데이터 조회 실패"

def _section1(quote: dict, competitor_quotes: list[dict]) -> str:
    rows = [quote] + competitor_quotes
    lines = [
        "## ① 사업영역 & 시장순위\n",
        "| 종목 | 티커 | 현재가 | 시가총액 | YTD 수익률 |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        mc = f"${r['market_cap']/1e9:.1f}B" if r.get("market_cap") else "N/A"
        ytd = f"{r['ytd_return']:+.1f}%" if r.get("ytd_return") is not None else "N/A"
        price = f"${r['price']:.2f}" if r.get("price") else "N/A"
        lines.append(f"| {r.get('name', r['ticker'])} | {r['ticker']} | {price} | {mc} | {ytd} |")
    return "\n".join(lines)

def _section2(financials: list[dict]) -> str:
    lines = [
        "## ② 매출/영업이익 추이 (최근 4분기)\n",
        "| 분기 | 매출 | 영업이익 |",
        "|---|---|---|",
    ]
    if not financials:
        lines.append("| N/A | N/A | N/A |")
    else:
        for q in financials:
            rev = f"${q['revenue']/1e9:.2f}B" if q.get("revenue") else "N/A"
            op = f"${q['operating_income']/1e9:.2f}B" if q.get("operating_income") else "N/A"
            lines.append(f"| {q['period']} | {rev} | {op} |")
    lines.append("\n![Revenue Chart](./revenue_chart.png)")
    return "\n".join(lines)

def _section3(analyst: dict, finviz: dict) -> str:
    target = analyst.get("target_mean") or finviz.get("finviz_target")
    total = (analyst.get("buy", 0) + analyst.get("hold", 0) + analyst.get("sell", 0)) or 1
    lines = [
        "## ③ 증권사 컨센서스\n",
        "| 항목 | 값 |",
        "|---|---|",
        f"| 평균 목표가 | ${target:.2f} |" if target else "| 평균 목표가 | N/A |",
        f"| 최고 목표가 | ${analyst['target_high']:.2f} |" if analyst.get("target_high") else "| 최고 목표가 | N/A |",
        f"| 최저 목표가 | ${analyst['target_low']:.2f} |" if analyst.get("target_low") else "| 최저 목표가 | N/A |",
        f"| Buy | {analyst.get('buy', 0)}명 ({analyst.get('buy', 0)/total*100:.0f}%) |",
        f"| Hold | {analyst.get('hold', 0)}명 ({analyst.get('hold', 0)/total*100:.0f}%) |",
        f"| Sell | {analyst.get('sell', 0)}명 ({analyst.get('sell', 0)/total*100:.0f}%) |",
    ]
    if finviz.get("finviz_recom"):
        lines.append(f"| Finviz 추천지수 | {finviz['finviz_recom']:.1f} (1=강매수, 5=강매도) |")
    return "\n".join(lines)

def _section4(stock: dict) -> str:
    return f"## ④ 경제적 해자\n\n{stock.get('moat', '정보 없음')}"

def _section5(stock: dict) -> str:
    return f"## ⑤ 장기 성장 계획\n\n{stock.get('growth_plan', '정보 없음')}"

def _section6(quote: dict, news: list[dict]) -> str:
    lines = ["## ⑥ 최근 공시 & 주가 영향\n"]
    if quote.get("prev_close"):
        lines.append(f"**어제 종가:** ${quote['prev_close']:.2f}  |  **전일 대비:** {quote.get('daily_change', 'N/A')}\n")
    lines.append("### 최근 뉴스\n")
    if not news:
        lines.append("_(뉴스 없음)_")
    else:
        for item in news:
            lines.append(f"- [{item['title']}]({item['link']}) — {item['publisher']} ({item['published_at']})")
    return "\n".join(lines)

def _section7(timeframe_rsi: dict, sr: dict) -> str:
    lines = [
        "## ⑦ 매수/매도 타점\n",
        "### RSI 현황\n",
        "| 시간대 | 현재 RSI | RSI 30 도달 예상가 | RSI 70 도달 예상가 |",
        "|---|---|---|---|",
    ]
    for tf, label in [("daily", "일봉"), ("weekly", "주봉"), ("monthly", "월봉")]:
        d = timeframe_rsi.get(tf, {})
        rsi = f"{d['rsi']:.1f}" if d.get("rsi") else "N/A"
        t30 = f"${d['target_30']:.2f}" if d.get("target_30") else "N/A"
        t70 = f"${d['target_70']:.2f}" if d.get("target_70") else "N/A"
        lines.append(f"| {label} | {rsi} | {t30} | {t70} |")
    lines += [
        "\n### 지지·저항 & EMA\n",
        "| 항목 | 값 |",
        "|---|---|",
        f"| 52주 고점 | ${sr['week52_high']:.2f} |" if sr.get("week52_high") else "| 52주 고점 | N/A |",
        f"| 52주 저점 | ${sr['week52_low']:.2f} |" if sr.get("week52_low") else "| 52주 저점 | N/A |",
        f"| EMA(20) | ${sr['ema20']:.2f} |" if sr.get("ema20") else "| EMA(20) | N/A |",
        f"| EMA(50) | ${sr['ema50']:.2f} |" if sr.get("ema50") else "| EMA(50) | N/A |",
        f"| EMA(200) | ${sr['ema200']:.2f} |" if sr.get("ema200") else "| EMA(200) | N/A |",
        "\n![RSI Chart](./rsi_chart.png)",
    ]
    return "\n".join(lines)
