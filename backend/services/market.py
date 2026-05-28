from __future__ import annotations
import yfinance as yf
import pandas as pd
import requests

_NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json, text/plain, */*",
}
_NAVER_BASE = "https://m.stock.naver.com/api/stock"


def _naver_get(ticker: str, path: str) -> dict | list:
    r = requests.get(f"{_NAVER_BASE}/{ticker}/{path}", headers=_NAVER_HEADERS, timeout=8)
    r.raise_for_status()
    return r.json()


def _n(val) -> float | None:
    if val is None:
        return None
    try:
        return float(str(val).replace(",", ""))
    except (ValueError, TypeError):
        return None


def _to_won(val) -> int | None:
    if val is None:
        return None
    v = _n(val)
    if v is None:
        return None
    return int(v * 1e8) if abs(v) < 1e10 else int(v)


def _naver_row_val(rows: list, row_idx: int, key: str) -> float | None:
    if row_idx >= len(rows):
        return None
    val = rows[row_idx].get("columns", {}).get(key, {}).get("value", "-")
    if not val or val == "-":
        return None
    try:
        return float(str(val).replace(",", ""))
    except ValueError:
        return None


def _yf_val(src, key, col):
    if src is None or src.empty or key not in src.index or col not in src.columns:
        return None
    v = src.loc[key, col]
    return None if v is None or (isinstance(v, float) and pd.isna(v)) else v


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
        v = mc / 1e8
        return f"₩{v:,.0f}억" if v < 10000 else f"₩{v/10000:,.1f}조"
    return f"${mc/1e9:.1f}B"


def get_quote_kr(ticker: str, exchange: str = "KS") -> dict:
    try:
        d = _naver_get(ticker, "basic")
        price = _n(d.get("closePrice"))
        change = _n(d.get("compareToPreviousClosePrice"))
        ratio = _n(d.get("fluctuationsRatio"))
        mc = _n(d.get("marketValue"))
        name = d.get("stockName", ticker)

        if ratio is not None and change is not None and ratio > 0 and change < 0:
            ratio = -ratio

        prev_close = (price - change) if (price is not None and change is not None) else None
        daily_change = f"{ratio:+.2f}%" if ratio is not None else "N/A"

        sector = ""
        industry = ""

        ytd_return = None
        weekly_change_pct = None
        monthly_change_pct = None
        try:
            yf_t = yf.Ticker(f"{ticker}.{exchange or 'KS'}")
            hist = yf_t.history(period="1y")
            if not hist.empty and price:
                start = float(hist["Close"].iloc[0])
                ytd_return = round((price - start) / start * 100, 2)
                if len(hist) >= 6:
                    week_ago = float(hist["Close"].iloc[-6])
                    weekly_change_pct = round((price - week_ago) / week_ago * 100, 2)
                if len(hist) >= 23:
                    month_ago = float(hist["Close"].iloc[-23])
                    monthly_change_pct = round((price - month_ago) / month_ago * 100, 2)
            yf_info = yf_t.info
            sector = yf_info.get("sector", "") or ""
            industry = yf_info.get("industry", "") or ""
        except Exception:
            pass

        return {
            "ticker": ticker,
            "name": name,
            "price": price,
            "prev_close": round(prev_close, 0) if prev_close is not None else None,
            "daily_change": daily_change,
            "daily_change_pct": ratio,
            "weekly_change_pct": weekly_change_pct,
            "monthly_change_pct": monthly_change_pct,
            "market_cap": int(mc) if mc else None,
            "ytd_return": ytd_return,
            "market": "KR",
            "sector": sector,
            "industry": industry,
        }
    except Exception as e:
        return {
            "ticker": ticker, "name": ticker, "price": None, "prev_close": None,
            "daily_change": "N/A",
            "daily_change_pct": None, "weekly_change_pct": None, "monthly_change_pct": None,
            "market_cap": None, "ytd_return": None,
            "market": "KR", "sector": "", "industry": "", "error": str(e),
        }


def get_financials_kr(ticker: str) -> list[dict]:
    try:
        d = _naver_get(ticker, "finance/quarter")
        fi = d.get("financeInfo", {})
        period_meta = fi.get("trTitleList", [])
        rows = fi.get("rowList", [])

        if not period_meta or not rows:
            return []

        sorted_meta = sorted(period_meta, key=lambda t: t["key"], reverse=True)
        rv = lambda idx, k: _naver_row_val(rows, idx, k)

        latest_actual_bps = None
        for meta in sorted_meta[:6]:
            if meta.get("isConsensus") != "Y":
                v = rv(13, meta["key"])
                if v is not None:
                    latest_actual_bps = v
                    break

        results = []
        for meta in sorted_meta[:6]:
            key = meta["key"]
            period_str = f"{key[:4]}-{key[4:]}"
            is_consensus = meta.get("isConsensus") == "Y"

            revenue   = rv(0,  key)
            op_income = rv(1,  key)
            eps       = rv(11, key)
            per       = rv(12, key)
            bps       = rv(13, key)
            pbr       = rv(14, key)

            if is_consensus and bps is None and latest_actual_bps is not None:
                bps = latest_actual_bps

            if pbr is None and per is not None and eps is not None and bps and bps > 0:
                pbr = round(per * eps / bps, 2)

            results.append({
                "period": period_str,
                "revenue":          int(revenue   * 1e8) if revenue   is not None else None,
                "operating_income": int(op_income * 1e8) if op_income is not None else None,
                "eps": round(eps, 0) if eps is not None else None,
                "bps": round(bps, 0) if bps is not None else None,
                "per": round(per, 1) if per is not None else None,
                "pbr": round(pbr, 2) if pbr is not None else None,
                "is_consensus": is_consensus,
            })
        return results
    except Exception:
        return []


def get_annual_financials_kr(ticker: str) -> list[dict]:
    try:
        d = _naver_get(ticker, "finance/annual")
        fi = d.get("financeInfo", {})
        period_meta = fi.get("trTitleList", [])
        rows = fi.get("rowList", [])
        if not period_meta or not rows:
            return []

        sorted_meta = sorted(period_meta, key=lambda t: t["key"], reverse=True)
        rv = lambda idx, k: _naver_row_val(rows, idx, k)

        results = []
        for meta in sorted_meta[:4]:
            key = meta["key"]
            is_consensus = meta.get("isConsensus") == "Y"

            revenue   = rv(0,  key)
            op_income = rv(1,  key)
            eps       = rv(11, key)
            bps       = rv(13, key)
            per       = rv(12, key)
            pbr       = rv(14, key)

            results.append({
                "period": key[:4],
                "revenue":          int(revenue   * 1e8) if revenue   is not None else None,
                "operating_income": int(op_income * 1e8) if op_income is not None else None,
                "eps": round(eps, 0) if eps is not None else None,
                "bps": round(bps, 0) if bps is not None else None,
                "per": round(per, 1) if per is not None else None,
                "pbr": round(pbr, 2) if pbr is not None else None,
                "is_consensus": is_consensus,
            })
        return results
    except Exception:
        return []


def get_annual_financials_us(ticker: str, exchange: str = "") -> list[dict]:
    yf_sym = _yf_sym(ticker, "US", exchange)
    try:
        t = yf.Ticker(yf_sym)
        stmt = t.get_income_stmt(freq='yearly', as_dict=False)
        balance = t.get_balance_sheet(freq='yearly', as_dict=False)
        info = t.info
        fallback_shares = info.get("sharesOutstanding") or info.get("impliedSharesOutstanding")

        if stmt is None or stmt.empty:
            return []

        results = []
        for col in stmt.columns[:4]:
            period_str = col.strftime("%Y") if hasattr(col, "strftime") else str(col)[:4]
            revenue      = _yf_val(stmt, "TotalRevenue", col)
            op_income    = _yf_val(stmt, "OperatingIncome", col)
            net_income   = _yf_val(stmt, "NetIncome", col)
            diluted_shares = _yf_val(stmt, "DilutedAverageShares", col) or fallback_shares
            diluted_eps  = _yf_val(stmt, "DilutedEPS", col)

            eps = bps = per = pbr = None
            try:
                hist = t.history(period="5y")
                price = None
                if not hist.empty and hasattr(col, "date"):
                    tgt = col.date()
                    dates = [d.date() if hasattr(d, "date") else d for d in hist.index]
                    closes = list(hist["Close"])
                    valid = [(d, c) for d, c in zip(dates, closes) if d <= tgt]
                    price = float(valid[-1][1]) if valid else None

                if diluted_eps is not None:
                    eps = round(float(diluted_eps), 4)
                elif net_income and diluted_shares and float(diluted_shares) != 0:
                    eps = round(float(net_income) / float(diluted_shares), 4)
                if price and eps is not None and eps > 0:
                    per = round(price / eps, 1)

                if balance is not None and not balance.empty and col in balance.columns:
                    equity = None
                    for k in ("CommonStockEquity", "StockholdersEquity", "TotalEquityGrossMinorityInterest"):
                        v = _yf_val(balance, k, col)
                        if v is not None:
                            equity = float(v)
                            break
                    shares_count = _yf_val(balance, "OrdinarySharesNumber", col) or (float(diluted_shares) if diluted_shares else None)
                    if equity and shares_count and shares_count != 0:
                        bps = round(float(equity) / float(shares_count), 4)
                        if price and bps > 0:
                            pbr = round(price / bps, 2)
            except Exception:
                pass

            results.append({
                "period": period_str,
                "revenue":          int(revenue)   if revenue   is not None else None,
                "operating_income": int(op_income) if op_income is not None else None,
                "eps": eps, "bps": bps,
                "per": per, "pbr": pbr,
                "is_consensus": False,
            })

        # Append forward estimates (0y, +1y) from analyst consensus
        try:
            ee = t.earnings_estimate
            re = t.revenue_estimate
            if ee is not None and not ee.empty and re is not None and not re.empty:
                latest_col = stmt.columns[0]
                base_year = latest_col.year if hasattr(latest_col, "year") else int(str(latest_col)[:4])
                forward = []
                for i, period_key in enumerate(["0y", "+1y"]):
                    if period_key in ee.index and period_key in re.index:
                        eps_est = ee.loc[period_key, "avg"] if "avg" in ee.columns else None
                        rev_est = re.loc[period_key, "avg"] if "avg" in re.columns else None
                        forward.append({
                            "period": str(base_year + i + 1),
                            "revenue": int(rev_est) if rev_est is not None and not pd.isna(rev_est) else None,
                            "operating_income": None,
                            "eps": round(float(eps_est), 4) if eps_est is not None and not pd.isna(eps_est) else None,
                            "bps": None, "per": None, "pbr": None,
                            "is_consensus": True,
                        })
                # Prepend reversed so that after frontend .reverse() they appear at the right (most future)
                results = list(reversed(forward)) + results
        except Exception:
            pass

        return results
    except Exception:
        return []


def get_annual_financials(ticker: str, market: str = "US", exchange: str = "") -> list[dict]:
    if market == "KR":
        return get_annual_financials_kr(ticker)
    return get_annual_financials_us(ticker, exchange)


def get_analyst_data_kr(ticker: str) -> dict:
    _empty = {"target_mean": None, "target_high": None, "target_low": None, "buy": 0, "hold": 0, "sell": 0}
    try:
        import json as _json
        gicode = f"A{ticker}"
        url = f"https://comp.fnguide.com/SVO2/json/data/01_06/03_{gicode}.json"
        _headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://comp.fnguide.com/",
        }
        r = requests.get(url, headers=_headers, timeout=8)
        r.raise_for_status()
        d = _json.loads(r.content.decode("utf-8-sig"))
        items = d.get("comp", [])
        if not items:
            return _empty

        prices, recom_codes = [], []
        for item in items:
            try:
                prices.append(float(item["TARGET_PRC"].replace(",", "")))
            except (ValueError, KeyError):
                pass
            try:
                recom_codes.append(float(item["RECOM_CD"]))
            except (ValueError, KeyError):
                pass

        avg_str = items[0].get("AVG_PRC", "")
        target_mean = float(avg_str.replace(",", "")) if avg_str else (sum(prices) / len(prices) if prices else None)

        buy  = sum(1 for c in recom_codes if c >= 3.5)
        hold = sum(1 for c in recom_codes if 2.5 <= c < 3.5)
        sell = sum(1 for c in recom_codes if c < 2.5)

        return {
            "target_mean": target_mean,
            "target_high": max(prices) if prices else None,
            "target_low":  min(prices) if prices else None,
            "buy": buy, "hold": hold, "sell": sell,
        }
    except Exception:
        return _empty


def get_quote(ticker: str, market: str = "US", exchange: str = "", _t=None) -> dict:
    if market == "KR":
        return get_quote_kr(ticker, exchange)

    yf_sym = _yf_sym(ticker, market, exchange)
    try:
        t = _t if _t is not None else yf.Ticker(yf_sym)
        info = t.info
        hist = t.history(period="1y")
        current = info.get("currentPrice") or info.get("regularMarketPrice")
        # info 실패 시 history 마지막 종가로 폴백
        if not current and not hist.empty:
            current = float(hist["Close"].iloc[-1])
        current = current or None
        prev_close = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else None
        week_ago = float(hist["Close"].iloc[-6]) if len(hist) >= 6 else None
        month_ago = float(hist["Close"].iloc[-23]) if len(hist) >= 23 else None
        ytd_start = float(hist["Close"].iloc[0]) if not hist.empty else None
        daily_change_pct = round((current - prev_close) / prev_close * 100, 2) if current and prev_close else None
        weekly_change_pct = round((current - week_ago) / week_ago * 100, 2) if current and week_ago else None
        monthly_change_pct = round((current - month_ago) / month_ago * 100, 2) if current and month_ago else None
        ytd_return = ((current - ytd_start) / ytd_start * 100) if current and ytd_start else None
        return {
            "ticker": ticker,
            "name": info.get("shortName", ticker),
            "price": float(current) if current else None,
            "prev_close": round(prev_close, 2) if prev_close else None,
            "daily_change": f"{daily_change_pct:+.2f}%" if daily_change_pct is not None else "N/A",
            "daily_change_pct": daily_change_pct,
            "weekly_change_pct": weekly_change_pct,
            "monthly_change_pct": monthly_change_pct,
            "market_cap": info.get("marketCap"),
            "ytd_return": round(ytd_return, 2) if ytd_return else None,
            "market": market,
            "sector": info.get("sector", "") or "",
            "industry": info.get("industry", "") or "",
        }
    except Exception as e:
        return {
            "ticker": ticker, "name": ticker, "price": None,
            "prev_close": None, "daily_change": "N/A",
            "daily_change_pct": None, "weekly_change_pct": None, "monthly_change_pct": None,
            "market_cap": None, "ytd_return": None, "market": market,
            "sector": "", "industry": "", "error": str(e),
        }


def get_financials(ticker: str, market: str = "US", exchange: str = "") -> list[dict]:
    if market == "KR":
        return get_financials_kr(ticker)

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

            revenue    = _yf_val(stmt, "Total Revenue", col)
            op_income  = _yf_val(stmt, "Operating Income", col)
            net_income = _yf_val(stmt, "Net Income", col)
            diluted_shares = _yf_val(stmt, "Diluted Average Shares", col) or fallback_shares

            price = _price_at(col)

            eps = None
            if net_income and diluted_shares and float(diluted_shares) != 0:
                eps = round(float(net_income) / float(diluted_shares), 4)

            per = None
            if price and eps is not None and eps * 4 > 0:
                per = round(price / (eps * 4), 1)

            bps = pbr = None
            if balance is not None and not balance.empty and col in balance.columns:
                equity = None
                for k in ("Common Stock Equity", "Stockholders Equity", "Total Equity Gross Minority Interest"):
                    v = _yf_val(balance, k, col)
                    if v is not None:
                        equity = float(v)
                        break
                shares = float(diluted_shares) if diluted_shares else None
                if equity and shares and shares != 0:
                    bps = round(equity / shares, 4)
                    if price and bps > 0:
                        pbr = round(price / bps, 2)

            results.append({
                "period": period_str,
                "revenue": int(revenue) if revenue is not None else None,
                "operating_income": int(op_income) if op_income is not None else None,
                "eps": eps,
                "bps": bps,
                "per": per,
                "pbr": pbr,
                "is_consensus": False,
            })
        return results
    except Exception:
        return []


def get_analyst_data(ticker: str, market: str = "US", exchange: str = "", _t=None) -> dict:
    if market == "KR":
        return get_analyst_data_kr(ticker)

    yf_sym = _yf_sym(ticker, market, exchange)
    try:
        t = _t if _t is not None else yf.Ticker(yf_sym)
        targets = t.analyst_price_targets or {}
        recs = t.recommendations_summary
        buy = hold = sell = 0
        if recs is not None and not recs.empty:
            row = recs.iloc[0]
            buy  = int(row.get("strongBuy", 0)) + int(row.get("buy", 0))
            hold = int(row.get("hold", 0))
            sell = int(row.get("sell", 0)) + int(row.get("strongSell", 0))
        return {
            "target_mean": targets.get("mean"),
            "target_high": targets.get("high"),
            "target_low":  targets.get("low"),
            "buy": buy, "hold": hold, "sell": sell,
        }
    except Exception:
        return {"target_mean": None, "target_high": None, "target_low": None, "buy": 0, "hold": 0, "sell": 0}
