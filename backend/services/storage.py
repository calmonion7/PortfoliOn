# backend/services/storage.py
import json
from typing import Optional
from services.db import get_connection, query, execute

_ANALYST_KEYS = frozenset({"name", "competitors", "moat", "growth_plan", "risks", "recent_disclosures", "insights"})
_JSON_TEXT_FIELDS = frozenset({"moat", "growth_plan", "risks", "recent_disclosures", "insights"})


def _parse_json_field(val):
    """text 컬럼에서 JSON 객체로 저장된 값을 역파싱. 일반 문자열이면 그대로 반환."""
    if not val:
        return None
    if isinstance(val, (dict, list)):
        return val
    try:
        parsed = json.loads(val)
        if isinstance(parsed, (dict, list)):
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass
    return val


# ── 종목 마스터 (user-specific) ──────────────────────────────────────────────

def get_stocks(user_id: str) -> list[dict]:
    rows = query(
        """
        SELECT t.ticker, t.name, t.market, t.exchange,
               t.competitors, t.moat, t.growth_plan, t.risks, t.recent_disclosures, t.insights
        FROM user_stocks us
        JOIN tickers t ON t.ticker = us.ticker
        WHERE us.user_id = %s
        """,
        (user_id,),
    )
    list_fields = frozenset({"competitors"})
    def _fmt(k, v):
        if k in _JSON_TEXT_FIELDS:
            return _parse_json_field(v)
        return v or ([] if k in list_fields else "")
    return [
        {k: _fmt(k, r.get(k)) for k in (*_ANALYST_KEYS, "ticker", "market", "exchange")}
        for r in rows
    ]


def save_stocks(user_id: str, stocks: list[dict]) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            for s in stocks:
                ticker = s["ticker"].upper()
                cur.execute(
                    """
                    INSERT INTO tickers (ticker, name, market, exchange, competitors, moat, growth_plan, risks, recent_disclosures, is_etf)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (ticker) DO UPDATE SET
                        name=EXCLUDED.name, market=EXCLUDED.market, exchange=EXCLUDED.exchange,
                        competitors=EXCLUDED.competitors, moat=EXCLUDED.moat,
                        growth_plan=EXCLUDED.growth_plan, risks=EXCLUDED.risks,
                        recent_disclosures=EXCLUDED.recent_disclosures,
                        is_etf=tickers.is_etf OR EXCLUDED.is_etf
                    """,
                    (
                        ticker,
                        s.get("name") or ticker,
                        s.get("market") or "US",
                        s.get("exchange") or "",
                        json.dumps(s.get("competitors") or []),
                        s.get("moat") or "",
                        s.get("growth_plan") or "",
                        s.get("risks") or "",
                        s.get("recent_disclosures") or "",
                        s.get("security_type") == "ETF" or bool(s.get("is_etf")),
                    ),
                )
                cur.execute(
                    """
                    INSERT INTO user_stocks (user_id, ticker, type)
                    VALUES (%s, %s, 'watchlist')
                    ON CONFLICT (user_id, ticker) DO NOTHING
                    """,
                    (user_id, ticker),
                )


def get_holdings(user_id: str) -> list[dict]:
    return query(
        """
        SELECT us.ticker, us.quantity, us.avg_cost,
               t.name, t.market, t.exchange
        FROM user_stocks us
        JOIN tickers t ON t.ticker = us.ticker
        WHERE us.user_id = %s AND us.type = 'holding'
        """,
        (user_id,),
    )


def save_holdings(user_id: str, holdings: list[dict]) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ticker FROM user_stocks WHERE user_id = %s AND type = 'holding'",
                (user_id,),
            )
            current_tickers = {r[0] for r in cur.fetchall()}
            new_tickers = {h["ticker"].upper() for h in holdings}

            for t in current_tickers - new_tickers:
                cur.execute(
                    "UPDATE user_stocks SET type='watchlist', quantity=NULL, avg_cost=NULL WHERE user_id=%s AND ticker=%s",
                    (user_id, t),
                )

            for h in holdings:
                ticker = h["ticker"].upper()
                cur.execute(
                    """
                    INSERT INTO tickers (ticker, name, market, exchange)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (ticker) DO UPDATE SET
                        name=EXCLUDED.name, market=EXCLUDED.market, exchange=EXCLUDED.exchange
                    """,
                    (ticker, h.get("name") or ticker, h.get("market") or "US", h.get("exchange") or ""),
                )
                cur.execute(
                    """
                    INSERT INTO user_stocks (user_id, ticker, type, quantity, avg_cost)
                    VALUES (%s, %s, 'holding', %s, %s)
                    ON CONFLICT (user_id, ticker) DO UPDATE SET
                        type='holding', quantity=EXCLUDED.quantity, avg_cost=EXCLUDED.avg_cost
                    """,
                    (user_id, ticker, h["quantity"], h["avg_cost"]),
                )


def get_watchlist_tickers(user_id: str) -> list[str]:
    rows = query(
        "SELECT ticker FROM user_stocks WHERE user_id = %s AND type = 'watchlist'",
        (user_id,),
    )
    return [r["ticker"] for r in rows]


def save_watchlist_tickers(user_id: str, tickers: list[str]) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ticker FROM user_stocks WHERE user_id = %s AND type = 'watchlist'",
                (user_id,),
            )
            current_set = {r[0] for r in cur.fetchall()}
            new_set = {t.upper() for t in tickers}

            for t in current_set - new_set:
                cur.execute(
                    "DELETE FROM user_stocks WHERE user_id=%s AND ticker=%s AND type='watchlist'",
                    (user_id, t),
                )

            for t in new_set - current_set:
                cur.execute(
                    "INSERT INTO tickers (ticker, name, market, exchange) VALUES (%s, %s, 'US', '') ON CONFLICT (ticker) DO NOTHING",
                    (t, t),
                )
                cur.execute(
                    "INSERT INTO user_stocks (user_id, ticker, type) VALUES (%s, %s, 'watchlist') ON CONFLICT (user_id, ticker) DO NOTHING",
                    (user_id, t),
                )


def get_full_portfolio(user_id: str) -> dict:
    rows = query(
        """
        SELECT us.ticker, us.type, us.quantity, us.avg_cost,
               t.name, t.market, t.exchange, t.is_etf,
               t.competitors, t.moat, t.growth_plan, t.risks, t.recent_disclosures, t.insights
        FROM user_stocks us
        LEFT JOIN tickers t ON t.ticker = us.ticker
        WHERE us.user_id = %s
        """,
        (user_id,),
    )
    holdings, watchlist = [], []
    for r in rows:
        entry = {
            "ticker": r["ticker"],
            "name": r.get("name") or r["ticker"],
            "market": r.get("market") or "US",
            "exchange": r.get("exchange") or "",
            "competitors": r.get("competitors") or [],
            "moat": _parse_json_field(r.get("moat")),
            "growth_plan": _parse_json_field(r.get("growth_plan")),
            "risks": _parse_json_field(r.get("risks")),
            "recent_disclosures": _parse_json_field(r.get("recent_disclosures")),
            "insights": _parse_json_field(r.get("insights")),
            "is_etf": bool(r.get("is_etf")),
        }
        if r["type"] == "holding":
            entry.update({"quantity": r["quantity"], "avg_cost": r["avg_cost"]})
            holdings.append(entry)
        else:
            watchlist.append(entry)
    return {"stocks": holdings, "watchlist": watchlist}


def get_all_stocks(user_id: str) -> list[dict]:
    portfolio = get_full_portfolio(user_id)
    return portfolio.get("stocks", []) + portfolio.get("watchlist", [])


def get_global_portfolio() -> dict:
    """API key 인증용 — 전 유저 종목을 합산해 반환. holding 우선."""
    rows = query(
        """
        SELECT DISTINCT ON (us.ticker)
               us.ticker, us.type, t.name, t.market, t.exchange, t.is_etf,
               t.competitors, t.moat, t.growth_plan, t.risks, t.recent_disclosures, t.insights
        FROM user_stocks us
        LEFT JOIN tickers t ON t.ticker = us.ticker
        ORDER BY us.ticker, CASE us.type WHEN 'holding' THEN 0 ELSE 1 END
        """
    )
    holdings, watchlist = [], []
    for r in rows:
        entry = {
            "ticker": r["ticker"],
            "name": r.get("name") or r["ticker"],
            "market": r.get("market") or "US",
            "exchange": r.get("exchange") or "",
            "competitors": r.get("competitors") or [],
            "moat": _parse_json_field(r.get("moat")),
            "growth_plan": _parse_json_field(r.get("growth_plan")),
            "risks": _parse_json_field(r.get("risks")),
            "recent_disclosures": _parse_json_field(r.get("recent_disclosures")),
            "insights": _parse_json_field(r.get("insights")),
            "is_etf": bool(r.get("is_etf")),
        }
        if r["type"] == "holding":
            holdings.append(entry)
        else:
            watchlist.append(entry)
    return {"stocks": holdings, "watchlist": watchlist}


_ENRICH_KEYS = frozenset({"name", "market", "exchange"}) | _ANALYST_KEYS


def enrich_stock(ticker: str, fields: dict) -> bool:
    upper = ticker.upper()
    if not fields.keys() <= _ENRICH_KEYS:
        raise ValueError(f"invalid field(s): {fields.keys() - _ENRICH_KEYS}")
    exists = query("SELECT ticker FROM tickers WHERE ticker = %s", (upper,))
    if not exists:
        return False
    set_clause = ", ".join(f"{k}=%s" for k in fields) + ", enriched_at=NOW()"
    values = [json.dumps(v) if isinstance(v, (list, dict)) else v for v in fields.values()]
    execute(f"UPDATE tickers SET {set_clause} WHERE ticker=%s", (*values, upper))
    return True


def update_ticker_meta(ticker: str, name: str, competitors: list) -> None:
    """수정 모달에서 편집 가능한 필드(name, competitors)만 갱신.
    구조화 분석(moat/growth_plan/risks/recent_disclosures)은 건드리지 않고 보존."""
    execute(
        "UPDATE tickers SET name = %s, competitors = %s WHERE ticker = %s",
        (name, json.dumps(competitors or []), ticker.upper()),
    )


# ── 전역 함수 ─────────────────────────────────────────────────────────────────

def get_schedule() -> dict:
    rows = query("SELECT data FROM schedules WHERE id = 1")
    if rows:
        return rows[0]["data"]
    return {"enabled": False, "time": "08:00", "days": ["mon", "tue", "wed", "thu", "fri"]}


def save_schedule(schedule: dict) -> None:
    execute(
        "INSERT INTO schedules (id, data) VALUES (1, %s) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data",
        (json.dumps(schedule),),
    )


def get_guru_managers() -> dict:
    rows = query("SELECT data FROM guru_managers WHERE id = 1")
    if rows:
        return rows[0]["data"]
    return {"last_updated": None, "managers": []}


def save_guru_managers(data: dict) -> None:
    execute(
        "INSERT INTO guru_managers (id, data) VALUES (1, %s) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data",
        (json.dumps(data),),
    )


def get_guru_schedule() -> dict:
    rows = query("SELECT data FROM guru_schedules WHERE id = 1")
    if rows:
        return rows[0]["data"]
    return {"enabled": False, "day": "sun", "time": "03:00"}


def save_guru_schedule(schedule: dict) -> None:
    execute(
        "INSERT INTO guru_schedules (id, data) VALUES (1, %s) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data",
        (json.dumps(schedule),),
    )


def get_batch_schedule(job_id: str) -> Optional[dict]:
    rows = query("SELECT data FROM batch_schedules WHERE job_id = %s", (job_id,))
    if rows:
        return rows[0]["data"]
    return None


def save_batch_schedule(job_id: str, spec: dict) -> None:
    execute(
        "INSERT INTO batch_schedules (job_id, data) VALUES (%s, %s) ON CONFLICT (job_id) DO UPDATE SET data=EXCLUDED.data",
        (job_id, json.dumps(spec)),
    )


def get_all_batch_schedules() -> dict:
    rows = query("SELECT job_id, data FROM batch_schedules")
    return {r["job_id"]: r["data"] for r in rows}


def get_daily_report_schedule() -> dict:
    """daily_report 스케줄 정본 — 통합 batch_schedules에서 읽고, 미시드/테이블부재 시 레거시 schedules로 폴백.
    반환 dict는 enabled/days/time 키를 가져 _last_scheduled_date 계산에 그대로 쓰인다."""
    try:
        spec = get_batch_schedule("daily_report")
    except Exception:
        spec = None
    if spec:
        return spec
    return get_schedule()
