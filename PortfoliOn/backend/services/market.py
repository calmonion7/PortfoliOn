import yfinance as yf
import pandas as pd


def _yf_sym(ticker: str, market: str = "US", exchange: str = "") -> str:
    if market == "KR":
        suffix = exchange if exchange else "KS"
        return f"{ticker}.{suffix}"
    return ticker.replace(".", "-")


def _fmt_price(price, market: str = "US") -> str:
    if price is None:
        return "N/A"
    if market == "KR":
        return f"₩{int(price):,}"
    return f"${float(price):.2f}"


def _fmt_market_cap(mc, market: str = "US") -> str:
    if mc is None:
        return "N/A"
    if market == "KR":
        v = mc / 1e8  # 억원
        return f"₩{v:,.0f}억" if v < 10000 else f"₩{v/10000:,.1f}조"
    return f"${mc/1e9:.1f}B"


def get_quote(ticker: str, market: str = "US", exchange: str = "") -> dict:
    yf_sym = _yf_sym(ticker, market, exchange)
    try:
        t = yf.Ticker(yf_sym)
        info = t.info
        hist = t.history(period="1y")
        current = info.get("currentPrice") or info.get("regularMarketPrice") or 0.0
        prev_close = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else None
        ytd_start = float(hist["Close"].iloc[0]) if not hist.empty else None
        daily_change_pct = ((current - prev_close) / prev_close * 100) if prev_close else None
        ytd_return = ((current - ytd_start) / ytd_start * 100) if ytd_start else None
        return {
            "ticker": ticker,
            "name": info.get("shortName", ticker),
            "price": float(current),
            "prev_close": round(prev_close, 2) if prev_close else None,
            "daily_change": f"{daily_change_pct:+.2f}%" if daily_change_pct is not None else "N/A",
            "market_cap": info.get("marketCap"),
            "ytd_return": round(ytd_return, 2) if ytd_return else None,
            "market": market,
        }
    except Exception as e:
        return {
            "ticker": ticker, "name": ticker, "price": None,
            "prev_close": None, "daily_change": "N/A",
            "market_cap": None, "ytd_return": None,
            "market": market, "error": str(e),
        }


def get_financials(ticker: str, market: str = "US", exchange: str = "") -> list[dict]:
    yf_sym = _yf_sym(ticker, market, exchange)
    try:
        t = yf.Ticker(yf_sym)
        stmt = t.quarterly_income_stmt
        if stmt is None or stmt.empty:
            return []

        balance = t.quarterly_balance_sheet
        hist = t.history(period="2y")
        info = t.info
        fallback_shares = info.get("sharesOutstanding") or info.get("impliedSharesOutstanding")

        def _val(src, key, col):
            if src is None or src.empty or key not in src.index or col not in src.columns:
                return None
            v = src.loc[key, col]
            return None if v is None or (isinstance(v, float) and pd.isna(v)) else v

        def _price_at(col):
            if hist.empty or not hasattr(col, "date"):
                return None
            target = col.date()
            dates = [d.date() if hasattr(d, "date") else d for d in hist.index]
            closes = list(hist["Close"])
            valid = [(d, c) for d, c in zip(dates, closes) if d <= target]
            return float(valid[-1][1]) if valid else None

        results = []
        for col in stmt.columns[:4]:
            period_str = col.strftime("%Y-%m") if hasattr(col, "strftime") else str(col)[:7]

            revenue   = _val(stmt, "Total Revenue", col)
            op_income = _val(stmt, "Operating Income", col)
            net_income = _val(stmt, "Net Income", col)
            diluted_shares = _val(stmt, "Diluted Average Shares", col) or fallback_shares

            price = _price_at(col)

            per = None
            if price and net_income and diluted_shares and float(diluted_shares) != 0:
                ann_eps = float(net_income) / float(diluted_shares) * 4
                if ann_eps > 0:
                    per = round(price / ann_eps, 1)

            pbr = None
            if balance is not None and not balance.empty and col in balance.columns:
                equity = None
                for k in ("Common Stock Equity", "Stockholders Equity", "Total Equity Gross Minority Interest"):
                    v = _val(balance, k, col)
                    if v is not None:
                        equity = float(v)
                        break
                shares = float(diluted_shares) if diluted_shares else None
                if price and equity and shares and shares != 0:
                    bvps = equity / shares
                    if bvps > 0:
                        pbr = round(price / bvps, 2)

            results.append({
                "period": period_str,
                "revenue": int(revenue) if revenue is not None else None,
                "operating_income": int(op_income) if op_income is not None else None,
                "per": per,
                "pbr": pbr,
            })
        return results
    except Exception:
        return []


def get_analyst_data(ticker: str, market: str = "US", exchange: str = "") -> dict:
    yf_sym = _yf_sym(ticker, market, exchange)
    try:
        t = yf.Ticker(yf_sym)
        targets = t.analyst_price_targets or {}
        recs = t.recommendations_summary
        buy = hold = sell = 0
        if recs is not None and not recs.empty:
            row = recs.iloc[0]
            buy = int(row.get("strongBuy", 0)) + int(row.get("buy", 0))
            hold = int(row.get("hold", 0))
            sell = int(row.get("sell", 0)) + int(row.get("strongSell", 0))
        return {
            "target_mean": targets.get("mean"),
            "target_high": targets.get("high"),
            "target_low": targets.get("low"),
            "buy": buy,
            "hold": hold,
            "sell": sell,
        }
    except Exception:
        return {"target_mean": None, "target_high": None, "target_low": None, "buy": 0, "hold": 0, "sell": 0}
