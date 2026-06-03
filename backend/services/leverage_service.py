from __future__ import annotations
import os
import requests
from datetime import date, timedelta
from services.db import execute, query

_KOFIA_BASE = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService"
_INDEX_BASE  = "https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService"

# ── 실제 API 필드명 상수 (프로브 결과 기준) ──
_F_DATE        = "basDt"
_F_KOSPI_CRDT  = "crdTrFingScrs"
_F_KOSDAQ_CRDT = "crdTrFingKosdaq"
_F_DEPOSIT     = "invrDpsgAmt"
_F_MISU        = "brkTrdUcolMny"
_F_LQDT        = "brkTrdUcolMnyVsOppsTrdAmt"
_F_LQDT_RTO    = "ucolMnyVsOppsTrdRlImpt"
_F_IDX_NM      = "idxNm"
_F_MKT_CAP     = "lstgMrktTotAmt"


def _kofia_get(endpoint: str, extra_params: str = "") -> list[dict]:
    """KOFIA 공공데이터포털 API 조회. URL에 직접 serviceKey 삽입 (이중인코딩 방지)."""
    key = os.environ.get("KOFIA_API_KEY", "")
    url = f"{endpoint}?serviceKey={key}&resultType=json&numOfRows=1000&pageNo=1{extra_params}"
    r = requests.get(url, timeout=15)
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
    items = _kofia_get(
        f"{_KOFIA_BASE}/getGrantingOfCreditBalanceInfo",
        f"&beginBasDt={start_dt}&endBasDt={end_dt}",
    )
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
    items = _kofia_get(
        f"{_KOFIA_BASE}/getSecuritiesMarketTotalCapitalInfo",
        f"&beginBasDt={start_dt}&endBasDt={end_dt}",
    )
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
    items = _kofia_get(
        f"{_INDEX_BASE}/getStockMarketIndex",
        f"&beginBasDt={start_dt}&endBasDt={end_dt}",
    )
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


def _upsert_rows(rows: list[dict]) -> None:
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
    for row in rows:
        execute(sql, (
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


def _query_rows() -> list[dict]:
    return query("SELECT * FROM market_leverage_indicators ORDER BY base_date ASC")


def fetch_and_store(target_date: str | None = None) -> None:
    """전일(또는 지정일) 데이터를 KOFIA API에서 가져와 DB에 저장."""
    if target_date is None:
        d = date.today() - timedelta(days=1)
        target_date = d.strftime("%Y-%m-%d")
    dt_compact = target_date.replace("-", "")  # YYYYMMDD

    credit_rows = _fetch_credit_balance(dt_compact, dt_compact)
    fund_rows   = _fetch_market_fund(dt_compact, dt_compact)
    cap_rows    = _fetch_market_cap(dt_compact, dt_compact)

    by_date: dict[str, dict] = {}
    for row in credit_rows:
        by_date.setdefault(row["date"], {}).update(row)
    for row in fund_rows:
        by_date.setdefault(row["date"], {}).update(row)
    for row in cap_rows:
        by_date.setdefault(row["date"], {}).update(row)

    if by_date:
        _upsert_rows(list(by_date.values()))


def backfill(years: int = 5) -> None:
    """과거 데이터 적재. 이미 DB에 있는 날짜는 건너뜀."""
    existing = {str(r["base_date"]) for r in query(
        "SELECT base_date FROM market_leverage_indicators"
    )}
    end = date.today() - timedelta(days=1)
    start = end.replace(year=end.year - years)

    chunk_start = start
    while chunk_start <= end:
        chunk_end = min(chunk_start.replace(year=chunk_start.year + 1) - timedelta(days=1), end)
        s = chunk_start.strftime("%Y%m%d")
        e = chunk_end.strftime("%Y%m%d")

        try:
            credit_rows = _fetch_credit_balance(s, e)
            fund_rows   = _fetch_market_fund(s, e)
            cap_rows    = _fetch_market_cap(s, e)
        except Exception as exc:
            print(f"[leverage_service] backfill chunk {s}-{e} failed: {exc}")
            chunk_start = chunk_end + timedelta(days=1)
            continue

        by_date: dict[str, dict] = {}
        for row in credit_rows + fund_rows + cap_rows:
            by_date.setdefault(row["date"], {}).update(row)

        new_rows = [r for d_str, r in by_date.items() if d_str not in existing]
        if new_rows:
            _upsert_rows(new_rows)
            existing.update(r["date"] for r in new_rows)
            print(f"[leverage_service] backfill {s}-{e}: {len(new_rows)} rows inserted")

        chunk_start = chunk_end + timedelta(days=1)
