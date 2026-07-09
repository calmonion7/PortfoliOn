"""US 공매도 비중 + 기관 보유 수집·저장·조회.

배치: us_supply_fetch (주 1회, 보유·관심 US 종목 대상)
저장: us_supply_snapshot 테이블 (ticker PK upsert)
읽기: get_us_supply(ticker) — 요청경로 라이브 yfinance 0

KR 종목은 비대상(yfinance US-only), KR ticker 호출 시 graceful None.
"""
from __future__ import annotations

import json
import logging
import math
from datetime import datetime, date

logger = logging.getLogger(__name__)

import pandas as pd
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


def _parse_insider_transactions(df) -> list[dict]:
    """insider_transactions DataFrame → compact list. NaN/inf 가드."""
    if df is None or len(df) == 0:
        return []
    out = []
    for _, row in df.iterrows():
        sd = row.get("Start Date")
        try:
            start_date = pd.Timestamp(sd).strftime("%Y-%m-%d") if pd.notna(sd) else None
        except Exception as e:
            logger.warning(f"[UsSupply] 내부자거래 날짜 파싱 실패: {e}")
            start_date = None
        shares_raw = row.get("Shares")
        value_raw = row.get("Value")
        out.append({
            "insider": str(row.get("Insider") or ""),
            "position": str(row.get("Position") or ""),
            "transaction": str(row.get("Transaction") or ""),
            "shares": _finite(shares_raw),
            "value": _finite(value_raw),
            "start_date": start_date,
            "ownership": str(row.get("Ownership") or ""),
        })
    return out


def _parse_insider_net(df) -> dict:
    """insider_purchases DataFrame → 6mo net summary dict."""
    if df is None or len(df) == 0:
        return {}
    # eco: key column is first col regardless of name — index into it
    label_col = df.columns[0]
    val_col = "Shares" if "Shares" in df.columns else df.columns[1] if len(df.columns) > 1 else None
    if val_col is None:
        return {}
    rows = {str(r[label_col]).strip(): r[val_col] for _, r in df.iterrows()}
    result = {}
    ns = _finite(rows.get("Net Shares Purchased (Sold)"))
    if ns is not None:
        result["net_shares"] = int(ns)
    pb = _finite(rows.get("% Buy Shares"))
    if pb is not None:
        result["pct_buy"] = pb
    ps = _finite(rows.get("% Sell Shares"))
    if ps is not None:
        result["pct_sell"] = ps
    th = _finite(rows.get("Total Insider Shares Held"))
    if th is not None:
        result["total_held"] = int(th)
    return result


def fetch_us_supply(ticker: str, exchange: str = "") -> dict | None:
    """yf.Ticker 1패스로 공매도 + 기관 보유 + 내부자 거래 파싱.

    반환: {"short": {...}, "institutional": [...], "insider": {"transactions": [...], "net": {...}}}
    yfinance 예외 → None (caller가 skip 처리).
    missing/NaN 필드는 None graceful.
    """
    sym = _yf_sym(ticker, "US", exchange)
    try:
        t = yf.Ticker(sym)
        info = t.info or {}
        holders_df = t.institutional_holders
        txn_df = t.insider_transactions
        purch_df = t.insider_purchases
    except Exception as e:
        logger.warning(f"[UsSupply] yfinance 오류 {ticker}: {e}")
        return None

    # short stats
    date_ts = info.get("dateShortInterest")
    date_si: str | None = None
    if date_ts:
        try:
            date_si = datetime.fromtimestamp(int(date_ts)).strftime("%Y-%m-%d")
        except Exception as e:
            logger.warning(f"[UsSupply] dateShortInterest 타임스탬프 파싱 실패: {e}")
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

    insider = {
        "transactions": _parse_insider_transactions(txn_df),
        "net": _parse_insider_net(purch_df),
    }

    return {"short": short, "institutional": inst, "insider": insider}


# ── upsert / read ─────────────────────────────────────────────────────────────

def upsert_us_supply(ticker: str, data: dict) -> None:
    """us_supply_snapshot 테이블에 ticker PK upsert (insider 컬럼 포함)."""
    short = data.get("short") or {}
    inst = data.get("institutional") or []
    insider = data.get("insider") or {}
    execute(
        """INSERT INTO us_supply_snapshot
               (ticker, short_pct_float, short_ratio, shares_short,
                date_short_interest, institutional_holders,
                insider_transactions, insider_net, fetched_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
           ON CONFLICT (ticker) DO UPDATE SET
               short_pct_float       = EXCLUDED.short_pct_float,
               short_ratio           = EXCLUDED.short_ratio,
               shares_short          = EXCLUDED.shares_short,
               date_short_interest   = EXCLUDED.date_short_interest,
               institutional_holders = EXCLUDED.institutional_holders,
               insider_transactions  = EXCLUDED.insider_transactions,
               insider_net           = EXCLUDED.insider_net,
               fetched_at            = EXCLUDED.fetched_at""",
        (
            ticker.upper(),
            short.get("short_pct_float"),
            short.get("short_ratio"),
            short.get("shares_short"),
            short.get("date_short_interest"),
            json.dumps(inst),
            json.dumps(insider.get("transactions") or []),
            json.dumps(insider.get("net") or {}),
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


def get_us_insider(ticker: str) -> dict | None:
    """us_supply_snapshot에서 insider 컬럼만 읽기 (라이브 yfinance 0).

    저장 행 없으면 None.
    """
    rows = query(
        "SELECT insider_transactions, insider_net, fetched_at "
        "FROM us_supply_snapshot WHERE ticker = %s",
        (ticker.upper(),),
    )
    if not rows:
        return None
    row = rows[0]
    return {
        "insider_transactions": row.get("insider_transactions") or [],
        "insider_net": row.get("insider_net") or {},
        "fetched_at": row.get("fetched_at").isoformat() if row.get("fetched_at") else None,
    }


# ── batch ─────────────────────────────────────────────────────────────────────

def _is_all_empty(result: dict) -> bool:
    """yfinance가 예외 없이 '성공'했지만 전 필드가 빈 결과(t.info=={} 등)인지 판정.

    short 3필드 all-None AND institutional 빈 리스트 AND insider(transactions·net) 빈값이면
    genuine 빈 응답으로 보고 저장을 스킵(직전 양호 스냅샷 클로버 방지, wrong<missing)."""
    short = result.get("short") or {}
    short_empty = all(short.get(k) is None for k in ("short_pct_float", "short_ratio", "shares_short"))
    inst_empty = not (result.get("institutional") or [])
    insider = result.get("insider") or {}
    insider_empty = not (insider.get("transactions") or []) and not (insider.get("net") or {})
    return short_empty and inst_empty and insider_empty


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
            if _is_all_empty(result):
                logger.warning(f"[UsSupply] {ticker} 전 필드 빈 응답 — 저장 스킵(직전값 유지)")
                failed += 1
                continue
            upsert_us_supply(ticker, result)
            ok += 1
        except Exception as e:
            logger.warning(f"[UsSupply] {ticker} 실패: {e}")
            failed += 1
    return {"ok": ok, "failed": failed, "total": ok + failed}
