"""US 공매도 비중 + 기관 보유 수집·저장·조회.

배치: us_supply_fetch (주 1회, 보유·관심 US 종목 대상)
저장: us_supply_snapshot 테이블 (ticker PK upsert)
읽기: get_us_supply(ticker) — 요청경로 라이브 yfinance 0

KR 종목은 비대상(yfinance US-only), KR ticker 호출 시 graceful None.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, date

import yfinance as yf

from services.db import execute, query
from services.market.format import _yf_sym


# ── fetch ─────────────────────────────────────────────────────────────────────

def _finite(val):
    """float inf/nan → None; 유한하면 그대로."""
    if val is None:
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def fetch_us_supply(ticker: str, exchange: str = "") -> dict | None:
    """yf.Ticker 1패스로 공매도 + 기관 보유 파싱.

    반환: {"short": {...}, "institutional": [...]}
    yfinance 예외 → None (caller가 skip 처리).
    missing/NaN 필드는 None graceful.
    """
    sym = _yf_sym(ticker, "US", exchange)
    try:
        t = yf.Ticker(sym)
        info = t.info or {}
        holders_df = t.institutional_holders
    except Exception as e:
        print(f"[us_supply] yfinance 오류 {ticker}: {e}")
        return None

    # short stats
    date_ts = info.get("dateShortInterest")
    date_si: str | None = None
    if date_ts:
        try:
            date_si = datetime.fromtimestamp(int(date_ts)).strftime("%Y-%m-%d")
        except Exception:
            pass

    short = {
        "short_pct_float": _finite(info.get("shortPercentOfFloat")),
        "short_ratio": _finite(info.get("shortRatio")),
        "shares_short": int(info["sharesShort"]) if info.get("sharesShort") is not None else None,
        "date_short_interest": date_si,
    }

    # institutional holders
    inst: list[dict] = []
    if holders_df is not None and len(holders_df) > 0:
        for _, row in holders_df.iterrows():
            pct = _finite(row.get("pctHeld"))
            shares_val = row.get("Shares")
            pc = _finite(row.get("pctChange"))
            holder = row.get("Holder") or ""
            if not holder:
                continue
            inst.append({
                "holder": str(holder),
                "pct_held": pct,
                "shares": int(shares_val) if shares_val is not None and not (isinstance(shares_val, float) and not math.isfinite(shares_val)) else None,
                "pct_change": pc,
            })

    return {"short": short, "institutional": inst}


# ── upsert / read ─────────────────────────────────────────────────────────────

def upsert_us_supply(ticker: str, data: dict) -> None:
    """us_supply_snapshot 테이블에 ticker PK upsert."""
    short = data.get("short") or {}
    inst = data.get("institutional") or []
    execute(
        """INSERT INTO us_supply_snapshot
               (ticker, short_pct_float, short_ratio, shares_short,
                date_short_interest, institutional_holders, fetched_at)
           VALUES (%s, %s, %s, %s, %s, %s, NOW())
           ON CONFLICT (ticker) DO UPDATE SET
               short_pct_float      = EXCLUDED.short_pct_float,
               short_ratio          = EXCLUDED.short_ratio,
               shares_short         = EXCLUDED.shares_short,
               date_short_interest  = EXCLUDED.date_short_interest,
               institutional_holders = EXCLUDED.institutional_holders,
               fetched_at           = EXCLUDED.fetched_at""",
        (
            ticker.upper(),
            short.get("short_pct_float"),
            short.get("short_ratio"),
            short.get("shares_short"),
            short.get("date_short_interest"),
            json.dumps(inst),
        ),
    )


def get_us_supply(ticker: str) -> dict | None:
    """us_supply_snapshot에서 읽기 (라이브 yfinance 0).

    저장 행 없으면 None.
    """
    rows = query(
        "SELECT short_pct_float, short_ratio, shares_short, date_short_interest, "
        "institutional_holders, fetched_at FROM us_supply_snapshot WHERE ticker = %s",
        (ticker.upper(),),
    )
    if not rows:
        return None
    row = rows[0]
    date_si = row.get("date_short_interest")
    return {
        "short_pct_float": row.get("short_pct_float"),
        "short_ratio": row.get("short_ratio"),
        "shares_short": row.get("shares_short"),
        "date_short_interest": date_si.isoformat() if isinstance(date_si, date) else date_si,
        "institutional_holders": row.get("institutional_holders") or [],
        "fetched_at": row.get("fetched_at").isoformat() if row.get("fetched_at") else None,
    }


# ── batch ─────────────────────────────────────────────────────────────────────

def fetch_all_us_supply() -> dict:
    """보유·관심 US 종목 전부 fetch → upsert. 배치 진입점."""
    from services.db import query as db_query
    rows = db_query(
        "SELECT DISTINCT t.ticker, t.exchange FROM tickers t "
        "JOIN user_stocks us ON us.ticker = t.ticker WHERE t.market != 'KR'"
    )
    ok = failed = 0
    for row in rows:
        ticker = row["ticker"]
        try:
            result = fetch_us_supply(ticker, row.get("exchange") or "")
            if result is None:
                failed += 1
                continue
            upsert_us_supply(ticker, result)
            ok += 1
        except Exception as e:
            print(f"[us_supply] {ticker} 실패: {e}")
            failed += 1
    return {"ok": ok, "failed": failed, "total": ok + failed}
