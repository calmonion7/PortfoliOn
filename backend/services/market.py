import yfinance as yf
import pandas as pd

def get_quote(ticker: str) -> dict:
    try:
        t = yf.Ticker(ticker)
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
        }
    except Exception as e:
        return {
            "ticker": ticker, "name": ticker, "price": None,
            "prev_close": None, "daily_change": "N/A",
            "market_cap": None, "ytd_return": None,
            "error": str(e),
        }

def get_financials(ticker: str) -> list[dict]:
    try:
        t = yf.Ticker(ticker)
        stmt = t.quarterly_income_stmt
        if stmt is None or stmt.empty:
            return []
        results = []
        for col in stmt.columns[:4]:
            revenue = stmt.loc["Total Revenue", col] if "Total Revenue" in stmt.index else None
            op_income = stmt.loc["Operating Income", col] if "Operating Income" in stmt.index else None
            period_str = col.strftime("%Y-%m") if hasattr(col, "strftime") else str(col)[:7]
            results.append({
                "period": period_str,
                "revenue": int(revenue) if revenue is not None and not pd.isna(revenue) else None,
                "operating_income": int(op_income) if op_income is not None and not pd.isna(op_income) else None,
            })
        return results
    except Exception:
        return []

def get_analyst_data(ticker: str) -> dict:
    try:
        t = yf.Ticker(ticker)
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
