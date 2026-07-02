from __future__ import annotations
import os
import re
import json
import time
import requests
import pandas as pd
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor
from .cache import _mc_save, _cache, get_or_refresh, _BASE_DIR, _DATA_DIR
import logging

logger = logging.getLogger(__name__)

_NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json, text/plain, */*",
}
_NAVER_BASE = "https://m.stock.naver.com/api/stock"

M7 = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"]
KR_TOP2 = ["005930", "000660"]
_SP500_CACHE = os.path.join(_DATA_DIR, "sp500_tickers.json")
_KOSPI_CACHE = os.path.join(_DATA_DIR, "kospi_tickers.json")


def _quarter_ended(q: str) -> bool:
    import calendar as _cal
    from datetime import date as _date
    year, qn = int(q[:4]), int(q[5])
    end_month = qn * 3
    last_day = _cal.monthrange(year, end_month)[1]
    return _date(year, end_month, last_day) <= _date.today()


def _merge_quarters(results: list[dict[str, float]], n: int = 8, ended_only: bool = True) -> dict[str, float]:
    from collections import defaultdict
    total: dict[str, float] = defaultdict(float)
    for r in results:
        for q, v in r.items():
            if not ended_only or _quarter_ended(q):
                total[q] += v
    quarters = sorted(total.keys())[-n:]
    return {q: round(total[q], 2) for q in quarters}


def _get_sp500_tickers() -> list[str]:
    if os.path.exists(_SP500_CACHE):
        if time.time() - os.path.getmtime(_SP500_CACHE) < 86400 * 7:
            with open(_SP500_CACHE) as f:
                return json.load(f)
    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    from bs4 import BeautifulSoup
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


def _get_kospi_tickers() -> list[str]:
    if os.path.exists(_KOSPI_CACHE):
        if time.time() - os.path.getmtime(_KOSPI_CACHE) < 86400 * 7:
            with open(_KOSPI_CACHE) as f:
                return json.load(f)
    tickers: list[str] = []
    for page in range(1, 50):
        r = requests.get(
            "https://finance.naver.com/sise/sise_market_sum.naver",
            params={"sosok": "0", "page": page},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        codes = list(dict.fromkeys(
            re.findall(r"code=([0-9]{6})", r.content.decode("euc-kr", errors="ignore"))
        ))
        if not codes:
            break
        tickers.extend(c for c in codes if c not in tickers)
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_KOSPI_CACHE, "w") as f:
        json.dump(tickers, f)
    return tickers


def _get_yf_quarterly_net_income(ticker: str) -> dict[str, float]:
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
    except Exception as e:
        logger.warning(f"[Earnings] yf 분기 순이익 조회 실패 ticker={ticker}: {e}")
        return {}


def _get_naver_quarterly_net_income(ticker: str) -> dict[str, float]:
    try:
        r = requests.get(f"{_NAVER_BASE}/{ticker}/finance/quarter",
                         headers=_NAVER_HEADERS, timeout=8)
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
    except Exception as e:
        logger.warning(f"[Earnings] Naver 분기 순이익 조회 실패 ticker={ticker}: {e}")
        return {}


def _fetch_and_save_m7_earnings() -> dict:
    sp500 = _get_sp500_tickers()
    rest = [t for t in sp500 if t not in M7]
    with ThreadPoolExecutor(max_workers=20) as ex:
        m7_data = list(ex.map(_get_yf_quarterly_net_income, M7))
        rest_data = list(ex.map(_get_yf_quarterly_net_income, rest))
    m7_by_q = _merge_quarters(m7_data)
    rest_by_q = _merge_quarters(rest_data)
    quarters = sorted(set(m7_by_q) | set(rest_by_q))[-8:]
    data = {
        "quarters": [{"q": q, "m7": m7_by_q.get(q, 0), "rest": rest_by_q.get(q, 0)} for q in quarters],
        "unit": "십억달러",
    }
    _mc_save("m7_earnings", data)
    _cache.pop("m7_earnings", None)
    return data


def get_m7_earnings(force: bool = False) -> dict:
    return get_or_refresh("m7_earnings", _fetch_and_save_m7_earnings, 86400, force)


def _fetch_and_save_kr_top2_earnings() -> dict:
    kospi = _get_kospi_tickers()
    rest = [t for t in kospi if t not in KR_TOP2]
    with ThreadPoolExecutor(max_workers=20) as ex:
        top2_data = list(ex.map(_get_naver_quarterly_net_income, KR_TOP2))
        rest_data = list(ex.map(_get_naver_quarterly_net_income, rest))
    top2_by_q = _merge_quarters(top2_data, ended_only=False)
    rest_by_q = _merge_quarters(rest_data, ended_only=True)
    ended_qs = sorted(q for q in (set(top2_by_q) | set(rest_by_q)) if _quarter_ended(q))[-8:]
    est_qs = sorted(q for q in top2_by_q if not _quarter_ended(q))
    all_qs = ended_qs + est_qs
    data = {
        "quarters": [
            {"q": q, "top2": top2_by_q.get(q, 0),
             "rest": rest_by_q.get(q, 0) if _quarter_ended(q) else None,
             "estimated": not _quarter_ended(q)}
            for q in all_qs
        ],
        "unit": "억원",
    }
    _mc_save("kr_top2_earnings", data)
    _cache.pop("kr_top2_earnings", None)
    return data


def get_kr_top2_earnings() -> dict:
    return get_or_refresh("kr_top2_earnings", _fetch_and_save_kr_top2_earnings, 86400)
