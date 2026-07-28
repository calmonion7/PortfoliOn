from __future__ import annotations
import os
import re
import json
import requests
import pandas as pd
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from .cache import _mc_load, _mc_save, _cache, get_or_refresh, _BASE_DIR, _DATA_DIR
from services.utils import today_kst
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
# `backend/data/*.json`은 **read-only 정적 시드**다(CLAUDE.md "정적 참조 데이터만").
# 7일 티커 캐시는 `market_cache` 테이블에 있다 — 시드 파일에 write하지 않는다.
_SP500_SEED = os.path.join(_DATA_DIR, "sp500_tickers.json")
_KOSPI_SEED = os.path.join(_DATA_DIR, "kospi_tickers.json")
_SP500_KEY = "sp500_tickers"
_KOSPI_KEY = "kospi_tickers"
_TICKER_TTL_SEC = 86400 * 7


def _quarter_ended(q: str) -> bool:
    import calendar as _cal
    from datetime import date as _date
    year, qn = int(q[:4]), int(q[5])
    end_month = qn * 3
    last_day = _cal.monthrange(year, end_month)[1]
    return _date(year, end_month, last_day) <= today_kst()


def _merge_quarters(results: list[dict[str, float]], n: int = 8, ended_only: bool = True) -> dict[str, float]:
    from collections import defaultdict
    total: dict[str, float] = defaultdict(float)
    for r in results:
        for q, v in r.items():
            if not ended_only or _quarter_ended(q):
                total[q] += v
    quarters = sorted(total.keys())[-n:]
    return {q: round(total[q], 2) for q in quarters}


def _stored_tickers(stored: dict | None) -> list[str]:
    """`_mc_load` 결과에서 티커 목록만 꺼낸다(형태가 어긋나면 빈 목록)."""
    data = (stored or {}).get("data") or {}
    tickers = data.get("tickers") if isinstance(data, dict) else None
    return tickers if isinstance(tickers, list) else []


def _is_fresh(stored: dict | None) -> bool:
    """저장값이 TTL(7일) 내인가 — 판정 기준은 `fetched_at`(timestamptz)이지 파일 mtime이 아니다.

    파일 mtime 기준이던 옛 구현은 캐시를 덮어쓴 직후 mtime이 신선해져 7일간 조용해졌고,
    그래서 시드 오염이 간헐 발생으로 보였다.
    """
    fetched_at = (stored or {}).get("fetched_at")
    if fetched_at is None:
        return False
    try:
        age = (datetime.now(timezone.utc) - fetched_at).total_seconds()
    except TypeError:
        # tz-naive·문자열 등 예상 밖 형태 → 신선하지 않은 것으로 취급해 재조회.
        logger.warning(f"[Earnings] 티커 캐시 fetched_at 형태 이상: {fetched_at!r}")
        return False
    return 0 <= age < _TICKER_TTL_SEC


def _read_seed(path: str) -> list[str]:
    """저장소의 정적 시드를 **read-only**로 읽는다 — 이 경로에 write하는 코드는 없다."""
    try:
        with open(path) as f:
            tickers = json.load(f)
        return tickers if isinstance(tickers, list) else []
    except (OSError, ValueError) as e:
        logger.warning(f"[Earnings] 티커 시드 읽기 실패 path={path}: {e}")
        return []


def _tickers_with_cache(key: str, seed_path: str, scrape) -> list[str]:
    """티커 목록 = market_cache(7일) → 스크레이프 → 만료된 저장값 → 정적 시드.

    스크레이프 실패 시 `_mc_save`를 호출하지 않는다 — 빈/부분 목록을 박제하면 이후 7일간
    그 목록으로 실적을 계산한다(CLAUDE.md "빈/실패 결과 캐시 박제 금지", wrong < missing).
    """
    stored = _mc_load(key)
    if _is_fresh(stored):
        fresh = _stored_tickers(stored)
        if fresh:
            return fresh
    try:
        tickers = scrape()
    except Exception as e:
        logger.warning(f"[Earnings] 티커 스크레이프 실패 key={key}: {e}")
        tickers = []
    if tickers:
        _mc_save(key, {"tickers": tickers})
        return tickers
    stale = _stored_tickers(stored)
    if stale:
        logger.warning(f"[Earnings] 티커 스크레이프 실패 — 만료된 저장값 사용 key={key}")
        return stale
    return _read_seed(seed_path)


def _scrape_sp500() -> list[str]:
    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(r.text, "html.parser")
    table = soup.find("table", {"id": "constituents"})
    return [
        row.find_all("td")[0].text.strip().replace(".", "-")
        for row in table.find_all("tr")[1:]
        if row.find_all("td")
    ]


def _get_sp500_tickers() -> list[str]:
    return _tickers_with_cache(_SP500_KEY, _SP500_SEED, _scrape_sp500)


def _scrape_kospi() -> list[str]:
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
    return tickers


def _get_kospi_tickers() -> list[str]:
    return _tickers_with_cache(_KOSPI_KEY, _KOSPI_SEED, _scrape_kospi)


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
