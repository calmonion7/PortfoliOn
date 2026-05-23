from __future__ import annotations
import os
import json
import time
import pandas as pd
import yfinance as yf
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DATA_DIR = os.path.join(_BASE_DIR, "data")

_NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json, text/plain, */*",
}
_NAVER_BASE = "https://m.stock.naver.com/api/stock"

# 인메모리 TTL 캐시
_cache: dict = {}


def _get_cache(key: str) -> dict | None:
    entry = _cache.get(key)
    if entry and time.time() < entry["expires"]:
        return entry["data"]
    return None


def _set_cache(key: str, data: dict, ttl: int) -> None:
    _cache[key] = {"data": data, "expires": time.time() + ttl}


# ── Treasury ──────────────────────────────────────────────────────────────────

_TREASURY_SYMBOLS = {"3m": "^IRX", "5y": "^FVX", "10y": "^TNX", "30y": "^TYX"}


def _fetch_treasury(args: tuple[str, str]) -> tuple[str, dict | None]:
    key, sym = args
    try:
        hist = yf.Ticker(sym).history(period="1y", interval="1d")
        if hist.empty:
            return key, None
        close = hist["Close"].dropna()
        current = round(float(close.iloc[-1]), 3)
        prev = round(float(close.iloc[-2]), 3) if len(close) > 1 else current
        history = [
            {"date": str(d.date()), "value": round(float(v), 3)}
            for d, v in zip(close.index, close.values)
        ]
        return key, {
            "current": current,
            "change_bp": round((current - prev) * 100, 1),
            "history": history,
        }
    except Exception:
        return key, None


def get_treasury() -> dict:
    cached = _get_cache("treasury")
    if cached:
        return cached

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = dict(ex.map(_fetch_treasury, _TREASURY_SYMBOLS.items()))

    rates = {
        k: {"current": v["current"], "change_bp": v["change_bp"]}
        for k, v in results.items() if v
    }
    history = {k: v["history"] for k, v in results.items() if v and k in ("3m", "10y")}

    spread: list[dict] = []
    if results.get("10y") and results.get("3m"):
        h10 = {d["date"]: d["value"] for d in results["10y"]["history"]}
        h3m = {d["date"]: d["value"] for d in results["3m"]["history"]}
        spread = [
            {"date": dt, "value": round(h10[dt] - h3m[dt], 3)}
            for dt in sorted(set(h10) & set(h3m))
        ]

    data = {"rates": rates, "history": history, "spread": spread}
    _set_cache("treasury", data, ttl=3600)
    return data


# ── M7 Earnings ───────────────────────────────────────────────────────────────

M7 = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"]
_SP500_CACHE = os.path.join(_DATA_DIR, "sp500_tickers.json")


def _get_sp500_tickers() -> list[str]:
    if os.path.exists(_SP500_CACHE):
        if time.time() - os.path.getmtime(_SP500_CACHE) < 86400 * 7:
            with open(_SP500_CACHE) as f:
                return json.load(f)

    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    soup = BeautifulSoup(r.text, "html.parser")
    table = soup.find("table", {"id": "constituents"})
    tickers = [
        row.find_all("td")[0].text.strip().replace(".", "-")
        for row in table.find_all("tr")[1:]
        if row.find_all("td")
    ]

    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_SP500_CACHE, "w") as f:
        json.dump(tickers, f)
    return tickers


def _get_yf_quarterly_net_income(ticker: str) -> dict[str, float]:
    """Returns {quarter_label: net_income_billions} e.g. {'2025Q1': 25.3}"""
    try:
        fin = yf.Ticker(ticker).quarterly_financials
        if fin.empty or "Net Income" not in fin.index:
            return {}
        row = fin.loc["Net Income"]
        result: dict[str, float] = {}
        for col in row.index:
            val = row[col]
            if pd.notna(val):
                q = (col.month - 1) // 3 + 1
                result[f"{col.year}Q{q}"] = float(val) / 1e9
        return result
    except Exception:
        return {}


def _merge_quarters(results: list[dict[str, float]], n: int = 8) -> dict[str, float]:
    from collections import defaultdict
    total: dict[str, float] = defaultdict(float)
    for r in results:
        for q, v in r.items():
            total[q] += v
    quarters = sorted(total.keys())[-n:]
    return {q: round(total[q], 2) for q in quarters}


def get_m7_earnings() -> dict:
    cached = _get_cache("m7_earnings")
    if cached:
        return cached

    sp500 = _get_sp500_tickers()
    rest = [t for t in sp500 if t not in M7]

    with ThreadPoolExecutor(max_workers=20) as ex:
        m7_data = list(ex.map(_get_yf_quarterly_net_income, M7))
        rest_data = list(ex.map(_get_yf_quarterly_net_income, rest))

    m7_by_q = _merge_quarters(m7_data)
    rest_by_q = _merge_quarters(rest_data)
    quarters = sorted(set(m7_by_q) | set(rest_by_q))[-8:]

    data = {
        "quarters": [
            {"q": q, "m7": m7_by_q.get(q, 0), "rest": rest_by_q.get(q, 0)}
            for q in quarters
        ],
        "unit": "십억달러",
    }
    _set_cache("m7_earnings", data, ttl=86400)
    return data


# ── KR Top2 Earnings ──────────────────────────────────────────────────────────

KR_TOP2 = ["005930", "000660"]
_KOSPI200_CACHE = os.path.join(_DATA_DIR, "kospi200_tickers.json")


def _get_kospi200_tickers() -> list[str]:
    if os.path.exists(_KOSPI200_CACHE):
        if time.time() - os.path.getmtime(_KOSPI200_CACHE) < 86400 * 7:
            with open(_KOSPI200_CACHE) as f:
                return json.load(f)

    from datetime import date
    today = date.today().strftime("%Y%m%d")
    url = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
    headers = {
        "Referer": "http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd",
        "User-Agent": "Mozilla/5.0",
    }
    payload = {
        "bld": "dbms/MDC/STAT/standard/MDCSTAT00601",
        "mktId": "STK",
        "indTpCd": "2",
        "indTpCd2": "103",
        "strtDd": today,
        "endDd": today,
        "share": "1",
        "money": "1",
        "csvxls_isNo": "false",
    }
    r = requests.post(url, data=payload, headers=headers, timeout=15)
    tickers = [item["ISU_SRT_CD"] for item in r.json().get("output", []) if "ISU_SRT_CD" in item]

    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_KOSPI200_CACHE, "w") as f:
        json.dump(tickers, f)
    return tickers


def _get_naver_quarterly_net_income(ticker: str) -> dict[str, float]:
    """ticker: 6자리 KRX 코드. Returns {quarter_label: value_in_억원}"""
    try:
        r = requests.get(
            f"{_NAVER_BASE}/{ticker}/finance/quarter",
            headers=_NAVER_HEADERS,
            timeout=8,
        )
        r.raise_for_status()
        rows = r.json().get("financeInfo", {}).get("rowList", [])
        ni_row = next((row for row in rows if row.get("title") == "당기순이익"), None)
        if ni_row is None:
            return {}
        result: dict[str, float] = {}
        for col_key, col_data in ni_row.get("columns", {}).items():
            val = col_data.get("value", "")
            if val and val != "-":
                try:
                    v = float(val.replace(",", ""))
                    year, month = int(col_key[:4]), int(col_key[4:])
                    q = (month - 1) // 3 + 1
                    result[f"{year}Q{q}"] = v
                except (ValueError, IndexError):
                    pass
        return result
    except Exception:
        return {}


def get_kr_top2_earnings() -> dict:
    cached = _get_cache("kr_top2_earnings")
    if cached:
        return cached

    kospi200 = _get_kospi200_tickers()
    rest = [t for t in kospi200 if t not in KR_TOP2]

    with ThreadPoolExecutor(max_workers=20) as ex:
        top2_data = list(ex.map(_get_naver_quarterly_net_income, KR_TOP2))
        rest_data = list(ex.map(_get_naver_quarterly_net_income, rest))

    top2_by_q = _merge_quarters(top2_data)
    rest_by_q = _merge_quarters(rest_data)
    quarters = sorted(set(top2_by_q) | set(rest_by_q))[-8:]

    data = {
        "quarters": [
            {"q": q, "top2": top2_by_q.get(q, 0), "rest": rest_by_q.get(q, 0)}
            for q in quarters
        ],
        "unit": "억원",
    }
    _set_cache("kr_top2_earnings", data, ttl=86400)
    return data


# ── FX ────────────────────────────────────────────────────────────────────────

_FX_SYMBOLS = {"usdkrw": "USDKRW=X", "usdjpy": "USDJPY=X", "eurusd": "EURUSD=X"}


def _fetch_fx(args: tuple[str, str]) -> tuple[str, dict | None]:
    key, sym = args
    try:
        hist = yf.Ticker(sym).history(period="1y", interval="1d")
        if hist.empty:
            return key, None
        close = hist["Close"].dropna()
        current = round(float(close.iloc[-1]), 4)
        prev = round(float(close.iloc[-2]), 4) if len(close) > 1 else current
        change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
        history = [
            {"date": str(d.date()), "value": round(float(v), 4)}
            for d, v in zip(close.index, close.values)
        ]
        return key, {"current": current, "change_pct": change_pct, "history": history}
    except Exception:
        return key, None


def get_fx() -> dict:
    cached = _get_cache("fx")
    if cached:
        return cached

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = dict(ex.map(_fetch_fx, _FX_SYMBOLS.items()))

    rates = {
        k: {"current": v["current"], "change_pct": v["change_pct"]}
        for k, v in results.items()
        if v
    }
    history = {"usdkrw": results["usdkrw"]["history"]} if results.get("usdkrw") else {}

    if not rates:
        return {"rates": {}, "history": {}}
    data = {"rates": rates, "history": history}
    _set_cache("fx", data, ttl=3600)
    return data


# ── VIX ───────────────────────────────────────────────────────────────────────

def get_vix() -> dict:
    cached = _get_cache("vix")
    if cached:
        return cached

    try:
        hist = yf.Ticker("^VIX").history(period="1y", interval="1d")
        close = hist["Close"].dropna()
        current = round(float(close.iloc[-1]), 2)
        prev = round(float(close.iloc[-2]), 2) if len(close) > 1 else current
        change = round(current - prev, 2)
        history = [
            {"date": str(d.date()), "value": round(float(v), 2)}
            for d, v in zip(close.index, close.values)
        ]
        data = {"current": current, "change": change, "history": history}
        _set_cache("vix", data, ttl=3600)
        return data
    except Exception:
        return {"current": None, "change": None, "history": []}


# ── Commodities ───────────────────────────────────────────────────────────────

_COMMODITY_SYMBOLS: dict[str, tuple[str, str]] = {
    "gold":   ("GC=F", "USD/oz"),
    "oil":    ("CL=F", "USD/bbl"),
    "copper": ("HG=F", "USD/lb"),
}


def _fetch_commodity(args: tuple[str, tuple[str, str]]) -> tuple[str, dict | None]:
    key, (sym, unit) = args
    try:
        hist = yf.Ticker(sym).history(period="1y", interval="1d")
        if hist.empty:
            return key, None
        close = hist["Close"].dropna()
        current = round(float(close.iloc[-1]), 2)
        prev = round(float(close.iloc[-2]), 2) if len(close) > 1 else current
        change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
        history = [
            {"date": str(d.date()), "value": round(float(v), 2)}
            for d, v in zip(close.index, close.values)
        ]
        return key, {"current": current, "change_pct": change_pct, "unit": unit, "history": history}
    except Exception:
        return key, None


def get_commodities() -> dict:
    cached = _get_cache("commodities")
    if cached:
        return cached

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = dict(ex.map(_fetch_commodity, _COMMODITY_SYMBOLS.items()))

    prices = {
        k: {"current": v["current"], "change_pct": v["change_pct"], "unit": v["unit"]}
        for k, v in results.items()
        if v
    }
    history = {k: v["history"] for k, v in results.items() if v}

    if not prices:
        return {"prices": {}, "history": {}}
    data = {"prices": prices, "history": history}
    _set_cache("commodities", data, ttl=3600)
    return data


# ── Economic Indicators (FRED) ─────────────────────────────────────────────────

def get_econ_indicators() -> dict:
    cached = _get_cache("econ_indicators")
    if cached:
        return cached

    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return {"error": "FRED_API_KEY 환경변수가 필요합니다. https://fred.stlouisfed.org/docs/api/api_key.html 에서 무료 발급 후 설정하세요."}

    from datetime import date as _date
    start = _date(_date.today().year - 3, 1, 1).isoformat()

    def _fetch_series(series_id: str) -> list[dict]:
        r = requests.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params={
                "series_id": series_id,
                "api_key": api_key,
                "file_type": "json",
                "observation_start": start,
            },
            timeout=10,
        )
        r.raise_for_status()
        return [
            {"date": obs["date"], "value": float(obs["value"])}
            for obs in r.json().get("observations", [])
            if obs.get("value") not in (".", None, "")
        ]

    try:
        cpi = _fetch_series("CPIAUCSL")
        unemployment = _fetch_series("UNRATE")
    except Exception:
        return {"cpi": [], "unemployment": []}

    data = {"cpi": cpi, "unemployment": unemployment}
    _set_cache("econ_indicators", data, ttl=86400)
    return data


# ── Korean Export Data ────────────────────────────────────────────────────────

_EXPORTS_CACHE = os.path.join(_DATA_DIR, "kr_exports.json")


def _months_ago(n: int) -> str:
    from datetime import date
    today = date.today()
    month = today.month - n
    year = today.year + (month - 1) // 12
    month = ((month - 1) % 12) + 1
    return f"{year}{month:02d}"


def get_kr_exports() -> dict:
    # 파일 캐시 (30일)
    if os.path.exists(_EXPORTS_CACHE):
        if time.time() - os.path.getmtime(_EXPORTS_CACHE) < 86400 * 30:
            with open(_EXPORTS_CACHE) as f:
                return json.load(f)

    api_key = os.environ.get("KITA_API_KEY")
    if not api_key:
        # 만료된 캐시라도 있으면 반환
        if os.path.exists(_EXPORTS_CACHE):
            with open(_EXPORTS_CACHE) as f:
                return json.load(f)
        return {"months": [], "error": "KITA_API_KEY 환경변수가 필요합니다. https://www.kita.net 에서 발급 후 설정하세요."}

    # KITA Open API 조회
    url = "https://api.kita.net/openApi/service/ItemTradeService/getItemExpImpList"
    params = {
        "serviceKey": api_key,
        "startDate": _months_ago(12),
        "endDate": _months_ago(0),
        "type": "json",
    }
    r = requests.get(url, params=params, timeout=15)
    items = r.json().get("items", {}).get("item", [])

    months_semi: dict[str, float] = {}
    months_rest: dict[str, float] = {}
    for item in items:
        ym = item.get("period", "")
        amt = float(str(item.get("expAmt", "0")).replace(",", ""))
        if "반도체" in item.get("itmNm", ""):
            months_semi[ym] = months_semi.get(ym, 0) + amt
        else:
            months_rest[ym] = months_rest.get(ym, 0) + amt

    all_months = sorted(set(months_semi) | set(months_rest))
    data = {
        "months": [
            {
                "month": m,
                "semiconductor": round(months_semi.get(m, 0) / 1e8, 1),
                "non_semiconductor": round(months_rest.get(m, 0) / 1e8, 1),
            }
            for m in all_months
        ]
    }
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_EXPORTS_CACHE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data
