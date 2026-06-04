from __future__ import annotations
import os
import time
import requests
from services.db import execute, query
from services.utils import sanitize

_BASE = "https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2"
_OP   = "getNatiAndForeLendAndBorrBalaCo_V2"


def _api_get(page: int = 1, page_size: int = 1000) -> list[dict]:
    key = os.environ.get("KOFIA_API_KEY", "")
    url = f"{_BASE}/{_OP}?serviceKey={key}&resultType=json&numOfRows={page_size}&pageNo={page}"
    r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    if not r.ok:
        raise Exception(f"HTTP {r.status_code}: {r.text[:200]}")
    body = r.json()["response"]["body"]
    raw = body["items"].get("item", [])
    return raw if isinstance(raw, list) else ([raw] if raw else [])


def _fetch_all() -> list[dict]:
    all_items: list[dict] = []
    page = 1
    page_size = 1000
    while True:
        items = _api_get(page, page_size)
        all_items.extend(items)
        if len(items) < page_size:
            break
        page += 1
        time.sleep(0.3)
    return all_items


def _safe_int(val) -> int | None:
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def _safe_float(val) -> float | None:
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def _fmt_date(yyyymmdd: str) -> str:
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


def _ensure_table() -> None:
    execute("""
        CREATE TABLE IF NOT EXISTS market_lending_balance (
            base_date            DATE PRIMARY KEY,
            domestic_borrow_bal  BIGINT,
            foreign_borrow_bal   BIGINT,
            domestic_lend_bal    BIGINT,
            foreign_lend_bal     BIGINT,
            borrow_foreign_ratio NUMERIC(5, 2),
            lend_foreign_ratio   NUMERIC(5, 2),
            created_at           TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    execute("CREATE INDEX IF NOT EXISTS idx_lending_base_date ON market_lending_balance(base_date DESC)")


_UPSERT_SQL = """
    INSERT INTO market_lending_balance
        (base_date, domestic_borrow_bal, foreign_borrow_bal,
         domestic_lend_bal, foreign_lend_bal,
         borrow_foreign_ratio, lend_foreign_ratio)
    VALUES (%s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (base_date) DO UPDATE SET
        domestic_borrow_bal  = EXCLUDED.domestic_borrow_bal,
        foreign_borrow_bal   = EXCLUDED.foreign_borrow_bal,
        domestic_lend_bal    = EXCLUDED.domestic_lend_bal,
        foreign_lend_bal     = EXCLUDED.foreign_lend_bal,
        borrow_foreign_ratio = EXCLUDED.borrow_foreign_ratio,
        lend_foreign_ratio   = EXCLUDED.lend_foreign_ratio
"""


def _upsert(rows: list[dict]) -> None:
    for row in rows:
        execute(_UPSERT_SQL, (
            row["base_date"],
            row.get("domestic_borrow_bal"),
            row.get("foreign_borrow_bal"),
            row.get("domestic_lend_bal"),
            row.get("foreign_lend_bal"),
            row.get("borrow_foreign_ratio"),
            row.get("lend_foreign_ratio"),
        ))


def fetch_and_store() -> int:
    _ensure_table()
    items = _fetch_all()
    rows = []
    for item in items:
        d = item.get("basDt", "")
        if len(d) != 8:
            continue
        rows.append({
            "base_date":            _fmt_date(d),
            "domestic_borrow_bal":  _safe_int(item.get("ntivBrwBal")),
            "foreign_borrow_bal":   _safe_int(item.get("forgBrwBal")),
            "domestic_lend_bal":    _safe_int(item.get("ntivLndnBal")),
            "foreign_lend_bal":     _safe_int(item.get("forgLndnBal")),
            "borrow_foreign_ratio": _safe_float(item.get("brwBalForgRto")),
            "lend_foreign_ratio":   _safe_float(item.get("lndnBalForgRto")),
        })
    _upsert(rows)
    return len(rows)


def get_lending_data(months: int = 36) -> dict:
    _ensure_table()
    rows = query("""
        SELECT base_date, domestic_borrow_bal, foreign_borrow_bal,
               domestic_lend_bal, foreign_lend_bal,
               borrow_foreign_ratio, lend_foreign_ratio
        FROM market_lending_balance
        ORDER BY base_date DESC
        LIMIT %(months)s
    """, {"months": months})

    if not rows:
        return {"history": [], "latest": None}

    rows = list(reversed(rows))
    history = []
    for row in rows:
        dom_borrow = int(row["domestic_borrow_bal"] or 0)
        for_borrow = int(row["foreign_borrow_bal"] or 0)
        dom_lend   = int(row["domestic_lend_bal"] or 0)
        for_lend   = int(row["foreign_lend_bal"] or 0)
        history.append({
            "date":           str(row["base_date"]),
            "domestic_borrow": round(dom_borrow / 1_000_000, 2),
            "foreign_borrow":  round(for_borrow / 1_000_000, 2),
            "domestic_lend":   round(dom_lend   / 1_000_000, 2),
            "foreign_lend":    round(for_lend   / 1_000_000, 2),
            "borrow_foreign_ratio": float(row["borrow_foreign_ratio"] or 0),
        })

    return sanitize({"history": history, "latest": history[-1] if history else None})
