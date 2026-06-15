"""배당 트래킹 — 보유·관심 종목의 연 주당배당·배당수익률 수집·저장·조회.

소스(시장별 분기):
- US: yfinance `t.info` dividendRate(연 주당배당, $)·dividendYield(%). 무배당/예외는 None graceful.
- KR: DART alotMatter.json(corp_code별, 최근 사업연도 reprt_code=11011 사업보고서).
      se '주당 현금배당금(원)'·'현금배당수익률(%)'의 보통주 thstrm(당기) 값. status≠000/'-'은 None.

정규화: {annual_dividend_per_share, dividend_yield, currency('USD'|'KRW'), source('yfinance'|'dart')}.
income(연 예상배당·매수가 대비 수익률)은 대시보드가 보유의 quantity·avg_cost로 읽기 시 계산한다.

corp_code 매핑은 backlog._get_corp_code_map 재사용(중복 다운로드 회피).
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime

import requests
import yfinance as yf

from services.backlog import _get_corp_code_map
from services.db import execute, query

logger = logging.getLogger(__name__)

_DART_BASE = "https://opendart.fss.or.kr/api"
# 사업보고서(연간) — 배당은 연 1회 확정이므로 사업보고서 당기값을 쓴다.
_REPRT_ANNUAL = "11011"

# corp_code 매핑은 backlog 캐시를 재사용(disclosures.py와 동일 패턴).
_get_corp_code_map = _get_corp_code_map


def _dart_key() -> str:
    return os.environ.get("DART_API_KEY", "")


# ── US: yfinance ──────────────────────────────────────────────────────

def fetch_us_dividend(ticker: str, exchange: str = "") -> "dict | None":
    """US 종목 연 주당배당·배당수익률을 yfinance t.info에서 추출. 무배당/예외는 None.

    dividendRate = 연 주당배당($), dividendYield = 배당수익률(%, 현 yfinance는 퍼센트 스케일).
    배당이 없으면(dividendRate 결측) None을 반환해 저장하지 않는다(빈 박제 방지)."""
    yf_sym = ticker.replace(".", "-")
    try:
        info = yf.Ticker(yf_sym).info or {}
    except Exception as e:
        logger.warning(f"[Dividends] yfinance 조회 실패 ({ticker}): {e}")
        return None
    rate = info.get("dividendRate")
    if rate is None:
        return None
    try:
        rate = float(rate)
    except (TypeError, ValueError):
        return None
    if rate <= 0:
        return None
    yld = info.get("dividendYield")
    try:
        yld = round(float(yld), 4) if yld is not None else None
    except (TypeError, ValueError):
        yld = None
    return {
        "annual_dividend_per_share": rate,
        "dividend_yield": yld,
        "currency": "USD",
        "source": "yfinance",
    }


# ── KR: DART alotMatter ───────────────────────────────────────────────

_SE_DPS = "주당 현금배당금(원)"
_SE_YIELD = "현금배당수익률(%)"


def _num(s: str) -> "float | None":
    """alotMatter thstrm 셀 → 숫자. 콤마 제거, '-'/빈칸/비수치는 None."""
    s = (s or "").strip().replace(",", "")
    if not s or s in ("-", "—", "–"):
        return None
    if not re.fullmatch(r"-?\d+(\.\d+)?", s):
        return None
    return float(s)


def _corp_code(ticker: str) -> "str | None":
    code = ticker.upper().replace(".KS", "").replace(".KQ", "")
    return _get_corp_code_map().get(code)


def _recent_business_year() -> str:
    """최근 사업연도. 사업보고서는 보통 3월 공시되므로 1Q 동안은 전년도가 안전.

    현재 월이 4월 이전이면 전전년도, 그 외엔 전년도(작년 확정 배당)를 쓴다."""
    now = datetime.now()
    return str(now.year - (2 if now.month < 4 else 1))


def fetch_kr_dividend(ticker: str) -> "dict | None":
    """KR 종목 연 주당배당·시가배당률을 DART alotMatter에서 추출. 결측/예외는 None.

    보통주(stock_knd='보통주') '주당 현금배당금(원)'·'현금배당수익률(%)'의 당기(thstrm)값.
    corp_code 미매핑·status≠000·주당배당 결측('-')은 모두 None graceful."""
    corp_code = _corp_code(ticker)
    if not corp_code:
        return None
    try:
        resp = requests.get(
            f"{_DART_BASE}/alotMatter.json",
            params={
                "crtfc_key": _dart_key(),
                "corp_code": corp_code,
                "bsns_year": _recent_business_year(),
                "reprt_code": _REPRT_ANNUAL,
            },
            timeout=15,
        )
        data = resp.json()
    except Exception as e:
        logger.warning(f"[Dividends] alotMatter 조회 실패 ({ticker}): {e}")
        return None
    if data.get("status") != "000":
        return None

    def _common(se_name: str) -> "float | None":
        # 보통주 우선, 없으면 첫 매칭 행(우선주만 있는 종목 대비).
        rows = [it for it in data.get("list", []) if (it.get("se") or "").strip() == se_name]
        common = next((it for it in rows if (it.get("stock_knd") or "").strip() == "보통주"), None)
        chosen = common or (rows[0] if rows else None)
        return _num(chosen.get("thstrm")) if chosen else None

    dps = _common(_SE_DPS)
    if dps is None or dps <= 0:
        return None
    return {
        "annual_dividend_per_share": dps,
        "dividend_yield": _common(_SE_YIELD),
        "currency": "KRW",
        "source": "dart",
    }


# ── 저장소 (stock_dividends) ──────────────────────────────────────────

def upsert_dividend(ticker: str, d: dict) -> None:
    """배당 1종을 stock_dividends에 ticker PK 기준 멱등 upsert."""
    execute(
        """
        INSERT INTO stock_dividends
            (ticker, annual_dividend_per_share, dividend_yield, currency, source, fetched_at)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (ticker) DO UPDATE SET
            annual_dividend_per_share = EXCLUDED.annual_dividend_per_share,
            dividend_yield            = EXCLUDED.dividend_yield,
            currency                  = EXCLUDED.currency,
            source                    = EXCLUDED.source,
            fetched_at                = NOW()
        """,
        (
            ticker.upper(),
            d.get("annual_dividend_per_share"),
            d.get("dividend_yield"),
            d.get("currency"),
            d.get("source"),
        ),
    )


def get_dividend(ticker: str) -> "dict | None":
    """종목의 저장된 배당(없으면 None)."""
    rows = query(
        "SELECT annual_dividend_per_share, dividend_yield, currency, source "
        "FROM stock_dividends WHERE ticker = %s",
        (ticker.upper(),),
    )
    if not rows:
        return None
    r = dict(rows[0])
    for k in ("annual_dividend_per_share", "dividend_yield"):
        if r.get(k) is not None:
            r[k] = float(r[k])
    return r


# ── 배치 ──────────────────────────────────────────────────────────────

def fetch_all_dividends() -> dict:
    """user_stocks ∩ tickers의 보유+관심 종목을 시장별로 분기 수집해 저장.

    KR=DART alotMatter, 그 외(US 등)=yfinance. 무배당/결측(None)은 저장 안 함."""
    rows = query(
        "SELECT DISTINCT us.ticker, t.market FROM user_stocks us "
        "JOIN tickers t ON us.ticker = t.ticker "
        "WHERE us.type IN ('holding', 'watchlist')"
    )
    ok = 0
    failed = 0
    for r in rows:
        ticker = r["ticker"]
        market = r.get("market") or "US"
        try:
            d = fetch_kr_dividend(ticker) if market == "KR" else fetch_us_dividend(ticker)
            if d is not None:
                upsert_dividend(ticker, d)
            ok += 1
        except Exception as e:
            failed += 1
            logger.warning(f"[Dividends] fetch_all failed for {ticker}: {e}")
    logger.info(f"[Dividends] fetch_all: {ok}/{len(rows)} ok, {failed} failed")
    return {"total": len(rows), "ok": ok, "failed": failed}
