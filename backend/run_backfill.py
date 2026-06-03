"""Standalone backfill script: runs on host, connects to Docker postgres."""
from __future__ import annotations
import os
import time
import requests
import psycopg2
import psycopg2.extras
from datetime import date, timedelta

# ── DB connection (Docker postgres exposed on localhost:5432) ──
DB_DSN = "host=localhost port=5432 dbname=portfolion user=portfolion password=portfolion"

_KOFIA_BASE = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService"
_INDEX_BASE  = "https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService"

_F_DATE        = "basDt"
_F_KOSPI_CRDT  = "crdTrFingScrs"
_F_KOSDAQ_CRDT = "crdTrFingKosdaq"
_F_DEPOSIT     = "invrDpsgAmt"
_F_MISU        = "brkTrdUcolMny"
_F_LQDT        = "brkTrdUcolMnyVsOppsTrdAmt"
_F_LQDT_RTO    = "ucolMnyVsOppsTrdRlImpt"
_F_IDX_NM      = "idxNm"
_F_MKT_CAP     = "lstgMrktTotAmt"

KOFIA_KEY = os.environ.get("KOFIA_API_KEY", "")


def _kofia_get(endpoint: str, extra_params: str = "") -> list[dict]:
    url = f"{endpoint}?serviceKey={KOFIA_KEY}&resultType=json&numOfRows=1000&pageNo=1{extra_params}"
    r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    body = r.json()["response"]["body"]
    raw = body["items"].get("item", [])
    return raw if isinstance(raw, list) else [raw]


def _fmt_date(yyyymmdd: str) -> str:
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


def _safe_float(val) -> float | None:
    try:
        v = str(val).replace(",", "").strip()
        return float(v) if v not in ("", "-", "N/A") else None
    except (ValueError, TypeError):
        return None


def _fetch_credit_balance(start_dt: str, end_dt: str) -> list[dict]:
    items = _kofia_get(f"{_KOFIA_BASE}/getGrantingOfCreditBalanceInfo",
                       f"&beginBasDt={start_dt}&endBasDt={end_dt}")
    result = []
    for item in items:
        d = item.get(_F_DATE, "")
        if len(d) != 8:
            continue
        result.append({
            "date": _fmt_date(d),
            "kospi_credit_balance": _safe_float(item.get(_F_KOSPI_CRDT)),
            "kosdaq_credit_balance": _safe_float(item.get(_F_KOSDAQ_CRDT)),
        })
    return result


def _fetch_market_fund(start_dt: str, end_dt: str) -> list[dict]:
    items = _kofia_get(f"{_KOFIA_BASE}/getSecuritiesMarketTotalCapitalInfo",
                       f"&beginBasDt={start_dt}&endBasDt={end_dt}")
    result = []
    for item in items:
        d = item.get(_F_DATE, "")
        if len(d) != 8:
            continue
        result.append({
            "date": _fmt_date(d),
            "customer_deposit": _safe_float(item.get(_F_DEPOSIT)),
            "total_misu_amt": _safe_float(item.get(_F_MISU)),
            "liquidated_amt": _safe_float(item.get(_F_LQDT)),
            "liquidation_ratio": _safe_float(item.get(_F_LQDT_RTO)),
        })
    return result


def _fetch_market_cap(start_dt: str, end_dt: str) -> list[dict]:
    items = _kofia_get(f"{_INDEX_BASE}/getStockMarketIndex",
                       f"&beginBasDt={start_dt}&endBasDt={end_dt}")
    by_date: dict[str, dict] = {}
    for item in items:
        d = item.get(_F_DATE, "")
        if len(d) != 8:
            continue
        fmt = _fmt_date(d)
        name = item.get(_F_IDX_NM, "")
        cap = _safe_float(item.get(_F_MKT_CAP))
        if fmt not in by_date:
            by_date[fmt] = {"date": fmt, "kospi_market_cap": None, "kosdaq_market_cap": None}
        if "코스피" in name and "200" not in name:
            by_date[fmt]["kospi_market_cap"] = cap
        elif "코스닥" in name and "150" not in name:
            by_date[fmt]["kosdaq_market_cap"] = cap
    return list(by_date.values())


def _upsert_rows(conn, rows: list[dict]) -> None:
    sql = """
        INSERT INTO market_leverage_indicators
            (base_date, kospi_credit_balance, kosdaq_credit_balance,
             kospi_market_cap, kosdaq_market_cap,
             total_misu_amt, liquidated_amt, liquidation_ratio, customer_deposit)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (base_date) DO UPDATE SET
            kospi_credit_balance  = EXCLUDED.kospi_credit_balance,
            kosdaq_credit_balance = EXCLUDED.kosdaq_credit_balance,
            kospi_market_cap      = EXCLUDED.kospi_market_cap,
            kosdaq_market_cap     = EXCLUDED.kosdaq_market_cap,
            total_misu_amt        = EXCLUDED.total_misu_amt,
            liquidated_amt        = EXCLUDED.liquidated_amt,
            liquidation_ratio     = EXCLUDED.liquidation_ratio,
            customer_deposit      = EXCLUDED.customer_deposit
    """
    with conn.cursor() as cur:
        for row in rows:
            cur.execute(sql, (
                row["date"],
                row.get("kospi_credit_balance"),
                row.get("kosdaq_credit_balance"),
                row.get("kospi_market_cap"),
                row.get("kosdaq_market_cap"),
                row.get("total_misu_amt"),
                row.get("liquidated_amt"),
                row.get("liquidation_ratio"),
                row.get("customer_deposit"),
            ))
    conn.commit()


def backfill(start: date | None = None, end: date | None = None, years: int = 5) -> None:
    conn = psycopg2.connect(DB_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT base_date FROM market_leverage_indicators")
            existing = {str(row[0]) for row in cur.fetchall()}

        if end is None:
            end = date.today() - timedelta(days=1)
        if start is None:
            start = end.replace(year=end.year - years)

        chunk_start = start
        while chunk_start <= end:
            chunk_end = min(chunk_start.replace(year=chunk_start.year + 1) - timedelta(days=1), end)
            s = chunk_start.strftime("%Y%m%d")
            e = chunk_end.strftime("%Y%m%d")

            try:
                print(f"[backfill] fetching credit balance {s}-{e} ...", flush=True)
                credit_rows = _fetch_credit_balance(s, e)
                time.sleep(2)
                print(f"[backfill] fetching market fund {s}-{e} ...", flush=True)
                fund_rows   = _fetch_market_fund(s, e)
                time.sleep(2)
                print(f"[backfill] fetching market cap {s}-{e} ...", flush=True)
                cap_rows    = _fetch_market_cap(s, e)
                time.sleep(2)
            except Exception as exc:
                print(f"[backfill] chunk {s}-{e} failed: {exc}")
                chunk_start = chunk_end + timedelta(days=1)
                continue

            by_date: dict[str, dict] = {}
            for row in credit_rows + fund_rows + cap_rows:
                by_date.setdefault(row["date"], {}).update(row)

            new_rows = [r for d_str, r in by_date.items() if d_str not in existing]
            if new_rows:
                _upsert_rows(conn, new_rows)
                existing.update(r["date"] for r in new_rows)
                print(f"[backfill] {s}-{e}: {len(new_rows)} rows inserted")
            else:
                print(f"[backfill] {s}-{e}: all already present, skipped")

            chunk_start = chunk_end + timedelta(days=1)

        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), MIN(base_date), MAX(base_date) FROM market_leverage_indicators")
            count, min_d, max_d = cur.fetchone()
        print(f"\n[backfill] COMPLETE: {count} rows, {min_d} to {max_d}")
    finally:
        conn.close()


if __name__ == "__main__":
    import argparse
    from datetime import date as _date

    parser = argparse.ArgumentParser(description="Backfill market_leverage_indicators")
    parser.add_argument("--from", dest="from_date", metavar="YYYY-MM-DD", help="Start date (inclusive)")
    parser.add_argument("--to",   dest="to_date",   metavar="YYYY-MM-DD", help="End date (inclusive, default: yesterday)")
    parser.add_argument("--years", type=int, default=5, help="Years to go back from --to (default 5, ignored if --from given)")
    args = parser.parse_args()

    if not KOFIA_KEY:
        print("ERROR: KOFIA_API_KEY not set")
        exit(1)

    start_d = _date.fromisoformat(args.from_date) if args.from_date else None
    end_d   = _date.fromisoformat(args.to_date)   if args.to_date   else None
    backfill(start=start_d, end=end_d, years=args.years)
