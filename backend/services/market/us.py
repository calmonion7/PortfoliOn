from __future__ import annotations
import yfinance as yf
import pandas as pd

from services.market.format import _yf_sym, _yf_val, _safe_pct


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
            equity = total_liabilities = current_assets = inventory = current_liabilities = None
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
                    tl = _yf_val(balance, "TotalLiabilitiesNetMinorityInterest", col)
                    total_liabilities = float(tl) if tl is not None else None
                    ca = _yf_val(balance, "CurrentAssets", col)
                    current_assets = float(ca) if ca is not None else None
                    inv = _yf_val(balance, "Inventory", col)
                    inventory = float(inv) if inv is not None else None
                    cl = _yf_val(balance, "CurrentLiabilities", col)
                    current_liabilities = float(cl) if cl is not None else None
            except Exception:
                pass

            results.append({
                "period": period_str,
                "revenue":          int(revenue)   if revenue   is not None else None,
                "operating_income": int(op_income) if op_income is not None else None,
                "net_income":       int(net_income) if net_income is not None else None,
                "eps": eps, "bps": bps,
                "per": per, "pbr": pbr,
                "operating_margin": _safe_pct(op_income, revenue),
                "net_margin":       _safe_pct(net_income, revenue),
                "roe":              _safe_pct(net_income, equity),
                "debt_ratio":       _safe_pct(total_liabilities, equity),
                "quick_ratio":      _safe_pct(
                    (current_assets or 0) - (inventory or 0), current_liabilities
                ) if current_assets is not None else None,
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
                            "net_income": None,
                            "eps": round(float(eps_est), 4) if eps_est is not None and not pd.isna(eps_est) else None,
                            "bps": None, "per": None, "pbr": None,
                            "operating_margin": None, "net_margin": None,
                            "roe": None, "debt_ratio": None, "quick_ratio": None,
                            "is_consensus": True,
                        })
                # Prepend reversed so that after frontend .reverse() they appear at the right (most future)
                results = list(reversed(forward)) + results
        except Exception:
            pass

        return results
    except Exception:
        return []


def _us_quote_kis(ticker: str, exchange: str = "") -> dict | None:
    """KIS 해외 현재가 백업 → get_quote(US) dict. 미설정/실패/빈 price면 None.
    백업 폴백(yfinance 다음): .forge/adr/0011. KIS 해외엔 sector/industry/ytd/시총이
    없어 빈값(price·prev_close·일간변동만). 15분 지연 수용(백업 한정)."""
    from services.kis import client, quote as kisq
    if not client.configured():
        return None
    try:
        q = kisq.get_quote_us(ticker, exchange)
    except Exception:
        return None
    if not q or q.get("price") is None:
        return None
    pct = q.get("daily_change_pct")
    return {
        "ticker": ticker,
        "name": ticker,                       # KIS 해외 현재가엔 종목명 없음 → 티커(resolve_name 후처리)
        "price": q["price"],
        "prev_close": q.get("prev_close"),
        "daily_change": f"{pct:+.2f}%" if pct is not None else "N/A",
        "daily_change_pct": pct,
        "weekly_change_pct": None,
        "monthly_change_pct": None,
        "market_cap": None,
        "ytd_return": None,
        "market": "US",
        "sector": "",
        "industry": "",
    }


def _us_none_quote(ticker: str, market: str, error: str | None = None) -> dict:
    d = {
        "ticker": ticker, "name": ticker, "price": None,
        "prev_close": None, "daily_change": "N/A",
        "daily_change_pct": None, "weekly_change_pct": None, "monthly_change_pct": None,
        "market_cap": None, "ytd_return": None, "market": market,
        "sector": "", "industry": "",
    }
    if error is not None:
        d["error"] = error
    return d
