# backend/services/storage/portfolio.py
import json
import logging

from services.db import get_connection, query, execute

logger = logging.getLogger(__name__)

_ANALYST_KEYS = frozenset({"name", "competitors", "moat", "growth_plan", "risks", "recent_disclosures", "insights", "key_resource", "competitor_edge", "market_outlook"})
_JSON_TEXT_FIELDS = frozenset({"moat", "growth_plan", "risks", "recent_disclosures", "insights", "key_resource", "competitor_edge", "market_outlook"})

# enrich_history에 담는 필드 — 내용은 _JSON_TEXT_FIELDS와 같고 **순서만** 고정한다
# (row_to_json 키 순서를 결정적으로 만들어 이력 행끼리 비교 가능하게). 두 상수의 동치는
# test_enrich_history가 단언하므로 한쪽만 늘어나면 테스트가 잡는다.
_HISTORY_FIELDS = (
    "moat", "growth_plan", "risks", "recent_disclosures",
    "insights", "key_resource", "competitor_edge", "market_outlook",
)


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
               t.competitors, t.moat, t.growth_plan, t.risks, t.recent_disclosures, t.insights, t.key_resource, t.competitor_edge, t.market_outlook
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
                        name=CASE WHEN EXCLUDED.name IS NULL OR EXCLUDED.name = EXCLUDED.ticker THEN tickers.name ELSE EXCLUDED.name END,
                        market=EXCLUDED.market, exchange=EXCLUDED.exchange,
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
        SELECT us.ticker, us.quantity, us.avg_cost, us.target_price, us.stop_price, us.target_weight,
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
                    "UPDATE user_stocks SET type='watchlist', quantity=NULL, avg_cost=NULL, target_price=NULL, stop_price=NULL, target_weight=NULL WHERE user_id=%s AND ticker=%s",
                    (user_id, t),
                )

            for h in holdings:
                ticker = h["ticker"].upper()
                cur.execute(
                    """
                    INSERT INTO tickers (ticker, name, market, exchange)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (ticker) DO UPDATE SET
                        name=CASE WHEN EXCLUDED.name IS NULL OR EXCLUDED.name = EXCLUDED.ticker THEN tickers.name ELSE EXCLUDED.name END,
                        market=EXCLUDED.market, exchange=EXCLUDED.exchange
                    """,
                    (ticker, h.get("name") or ticker, h.get("market") or "US", h.get("exchange") or ""),
                )
                # eco: target_weight만 COALESCE 보존(target_price/stop_price는 덮어쓰기와 비대칭) —
                # 일반 보유종목 수정 폼(Stock 모델)엔 target_weight 필드가 없어 단순 덮어쓰기면
                # 종목 편집 때마다 목표비중이 null로 리셋됨(데이터 손실). "패턴 통일"로 되돌리지 말 것.
                cur.execute(
                    """
                    INSERT INTO user_stocks (user_id, ticker, type, quantity, avg_cost, target_price, stop_price, target_weight)
                    VALUES (%s, %s, 'holding', %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id, ticker) DO UPDATE SET
                        type='holding', quantity=EXCLUDED.quantity, avg_cost=EXCLUDED.avg_cost,
                        target_price=EXCLUDED.target_price, stop_price=EXCLUDED.stop_price,
                        target_weight=COALESCE(EXCLUDED.target_weight, user_stocks.target_weight)
                    """,
                    (user_id, ticker, h["quantity"], h["avg_cost"], h.get("target_price"), h.get("stop_price"), h.get("target_weight")),
                )


def set_target_weights(user_id: str, weights: dict) -> None:
    """보유 종목의 target_weight만 배치 UPDATE. weights={ticker: weight}. weight=None이면 NULL(타겟 삭제)."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            for ticker, weight in weights.items():
                cur.execute(
                    "UPDATE user_stocks SET target_weight=%s WHERE user_id=%s AND ticker=%s AND type='holding'",
                    (weight, user_id, ticker.upper()),
                )


def set_pinned(user_id: str, ticker: str, pinned: bool) -> bool:
    """단일 종목 고정핀 토글. 갱신된 행이 있으면 True, 그 유저 소유가 아니면 False(404)."""
    rowcount = execute(
        "UPDATE user_stocks SET pinned=%s WHERE user_id=%s AND ticker=%s",
        (pinned, user_id, ticker.upper()),
    )
    return rowcount > 0


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
        SELECT us.ticker, us.type, us.quantity, us.avg_cost, us.target_price, us.stop_price, us.target_weight, us.pinned,
               t.name, t.market, t.exchange, t.is_etf,
               t.competitors, t.moat, t.growth_plan, t.risks, t.recent_disclosures, t.insights, t.key_resource, t.competitor_edge, t.market_outlook
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
            "key_resource": _parse_json_field(r.get("key_resource")),
            "competitor_edge": _parse_json_field(r.get("competitor_edge")),
            "market_outlook": _parse_json_field(r.get("market_outlook")),
            "is_etf": bool(r.get("is_etf")),
            "pinned": bool(r.get("pinned")),
        }
        if r["type"] == "holding":
            entry.update({"quantity": r["quantity"], "avg_cost": r["avg_cost"],
                          "target_price": r.get("target_price"), "stop_price": r.get("stop_price"),
                          "target_weight": r.get("target_weight")})
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
               t.competitors, t.moat, t.growth_plan, t.risks, t.recent_disclosures, t.insights, t.key_resource, t.competitor_edge, t.market_outlook
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
            "key_resource": _parse_json_field(r.get("key_resource")),
            "competitor_edge": _parse_json_field(r.get("competitor_edge")),
            "market_outlook": _parse_json_field(r.get("market_outlook")),
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
    _record_enrich_history(upper, sorted(fields.keys()))
    return True


def _record_enrich_history(ticker: str, changed: list) -> None:
    """쓰기 직후의 enrich 8필드를 이력 1행으로 남긴다 (task#345).

    왜 「보낸 필드」가 아니라 「쓰기 직후 전체」인가 — 단건 PUT은 일부 필드만 보낼 수 있는데
    보낸 것만 기록하면 그 행 하나로는 복원이 안 된다. 전체를 담으면 어느 행이든 그 자체로
    완전한 한 판이라 **어느 시점으로든 되돌릴 수 있다**. `changed`는 그 판에서 이번 요청이
    실제로 건드린 키 목록이다(전량 재작성인지 이름 한 줄 수정인지 구별).

    왜 이 이력이 필요한가 — `tickers`는 UPDATE로 덮어써 종목당 **최신 1판만** 남는다.
    그래서 야간 전량 갱신이 직전 판을 지워, 모델·프롬프트 세대를 나중에 대조할 방법이
    없었다(task#345 계획 S1이 「런 전에 수동 스냅샷」을 요구한 이유). 이력이 있으면 덮어쓰기가
    파괴적이지 않게 되고 대조는 이력 두 행을 읽는 일이 된다.

    실패는 warning으로 삼킨다 — **이력 부재보다 enrich 저장 실패가 나쁘다**. 마커가 grep 앵커다.
    """
    cols = ", ".join(_HISTORY_FIELDS)
    try:
        rows = query(
            f"SELECT row_to_json(t) AS f FROM (SELECT {cols} FROM tickers WHERE ticker = %s) t",
            (ticker,),
        )
        if not rows:
            return
        execute(
            "INSERT INTO enrich_history (ticker, fields, changed) VALUES (%s, %s::jsonb, %s::jsonb)",
            (ticker, json.dumps(rows[0]["f"]), json.dumps(changed)),
        )
    except Exception as e:
        logger.warning(f"[EnrichHistory] 이력 기록 실패 ({ticker}): {e}")
