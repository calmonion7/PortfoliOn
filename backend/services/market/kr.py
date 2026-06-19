from __future__ import annotations
import yfinance as yf
import requests

from services.market.format import _norm_sector, _n

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


_FNGUIDE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://comp.fnguide.com/",
}

def _fnguide_market_cap(ticker: str) -> float | None:
    import re
    try:
        url = f"https://comp.fnguide.com/SVO2/asp/SVD_main.asp?gicode=A{ticker}"
        r = requests.get(url, headers=_FNGUIDE_HEADERS, timeout=8)
        clean = re.sub(r"<[^>]+>", " ", r.text)
        m = re.search(r"시가총액\s*\(보통주,억원\)\s*([\d,]+)", clean)
        if m:
            return int(m.group(1).replace(",", "")) * 100_000_000
    except Exception:
        pass
    return None


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


def _kr_basic_naver(ticker: str) -> tuple:
    """Naver basic → (price, ratio, prev_close, mc, name). HTTP 오류(상폐 409)는 전파."""
    d = _naver_get(ticker, "basic")
    price = _n(d.get("closePrice"))
    change = _n(d.get("compareToPreviousClosePrice"))
    ratio = _n(d.get("fluctuationsRatio"))
    mc = _n(d.get("marketValue")) or _fnguide_market_cap(ticker)
    name = d.get("stockName", ticker)
    if ratio is not None and change is not None and ratio > 0 and change < 0:
        ratio = -ratio
    prev_close = (price - change) if (price is not None and change is not None) else None
    return price, ratio, (round(prev_close, 0) if prev_close is not None else None), mc, name


def _kr_basic_kiwoom(ticker: str) -> tuple | None:
    """키움 ka10001 → (price, ratio, prev_close, mc, name). 미설정/실패/빈 price면 None."""
    from services.kiwoom import client, quote as kq
    if not client.configured():
        return None
    try:
        q = kq.get_quote(ticker)
    except Exception:
        return None
    if q.get("price") is None:
        return None
    return q["price"], q.get("daily_change_pct"), q.get("prev_close"), q.get("market_cap"), (q.get("name") or ticker)


def _kr_basic_kis(ticker: str) -> tuple | None:
    """KIS 국내 현재가 → (price, ratio, prev_close, mc, name). 미설정/실패/빈 price면 None.
    백업 폴백(키움 다음, Naver 앞): .forge/adr/0011."""
    from services.kis import client, quote as kisq
    if not client.configured():
        return None
    try:
        q = kisq.get_quote_kr(ticker)
    except Exception:
        return None
    if q.get("price") is None:
        return None
    return q["price"], q.get("daily_change_pct"), q.get("prev_close"), q.get("market_cap"), (q.get("name") or ticker)


def _kr_closes_kiwoom(ticker: str, max_items: int = 30) -> list:
    """키움 일봉 종가 시리즈(과거→현재). 미설정/실패 시 [] (호출측 폴백). monthly(-23)용 30개."""
    from services.kiwoom import chart as kchart
    try:
        return kchart.daily_closes(ticker, max_items=max_items)
    except Exception:
        return []


def get_quote_kr(ticker: str, exchange: str = "KS") -> dict:
    try:
        # 키움 우선 → KIS 백업 → Naver 폴백 (경계: .forge/adr/0009·0011). 상폐 종목은 Naver 409로 검출.
        basic = _kr_basic_kiwoom(ticker) or _kr_basic_kis(ticker) or _kr_basic_naver(ticker)
        price, ratio, prev_close, mc, name = basic
        daily_change = f"{ratio:+.2f}%" if ratio is not None else "N/A"

        sector = ""
        industry = ""

        ytd_return = None
        weekly_change_pct = None
        monthly_change_pct = None

        # 가격 변동률(ytd/주/월): 키움 일봉 우선
        kcloses = _kr_closes_kiwoom(ticker, max_items=260)
        if kcloses and price:
            start = kcloses[0]
            if start:
                ytd_return = round((price - start) / start * 100, 2)
            if len(kcloses) >= 6 and kcloses[-6]:
                weekly_change_pct = round((price - kcloses[-6]) / kcloses[-6] * 100, 2)
            if len(kcloses) >= 23 and kcloses[-23]:
                monthly_change_pct = round((price - kcloses[-23]) / kcloses[-23] * 100, 2)

        # sector/industry는 키움에 TR이 없어 yfinance 유지(.forge/adr/0009). 키움 변동률 실패 시 여기서 폴백.
        try:
            yf_t = yf.Ticker(f"{ticker}.{exchange or 'KS'}")
            if not kcloses and price:
                hist = yf_t.history(period="1y")
                if not hist.empty:
                    start = float(hist["Close"].iloc[0])
                    ytd_return = round((price - start) / start * 100, 2)
                    if len(hist) >= 6:
                        week_ago = float(hist["Close"].iloc[-6])
                        weekly_change_pct = round((price - week_ago) / week_ago * 100, 2)
                    if len(hist) >= 23:
                        month_ago = float(hist["Close"].iloc[-23])
                        monthly_change_pct = round((price - month_ago) / month_ago * 100, 2)
            yf_info = yf_t.info
            sector = _norm_sector(yf_info.get("sector", "") or "")
            industry = yf_info.get("industry", "") or ""
            if not mc:
                mc = _n(yf_info.get("marketCap"))
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
        import requests as _req
        delisted = isinstance(e, _req.exceptions.HTTPError) and getattr(e.response, "status_code", None) == 409
        return {
            "ticker": ticker, "name": ticker, "price": None, "prev_close": None,
            "daily_change": "N/A",
            "daily_change_pct": None, "weekly_change_pct": None, "monthly_change_pct": None,
            "market_cap": None, "ytd_return": None,
            "market": "KR", "sector": "", "industry": "",
            "delisted": delisted,
            "error": "상장폐지 종목입니다." if delisted else str(e),
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
