from services.db import get_db

_ANALYST_KEYS = frozenset({"name", "competitors", "moat", "growth_plan", "risks", "recent_disclosures"})


# ── 종목 마스터 (user-specific) ──────────────────────────────────────────────

def get_stocks(user_id: str) -> list[dict]:
    db = get_db()
    user_rows = db.table("user_stocks").select("ticker").eq("user_id", user_id).execute().data
    if not user_rows:
        return []
    tickers = [r["ticker"] for r in user_rows]
    ticker_rows = db.table("tickers").select("*").in_("ticker", tickers).execute().data
    list_fields = frozenset({"competitors"})
    return [
        {k: (t.get(k) or ([] if k in list_fields else "")) for k in (*_ANALYST_KEYS, "ticker", "market", "exchange")}
        for t in ticker_rows
    ]


def save_stocks(user_id: str, stocks: list[dict]) -> None:
    db = get_db()
    for s in stocks:
        ticker = s["ticker"].upper()
        db.table("tickers").upsert(
            {
                "ticker": ticker,
                "name": s.get("name") or ticker,
                "market": s.get("market") or "US",
                "exchange": s.get("exchange") or "",
                **{k: (s.get(k) or "") for k in _ANALYST_KEYS if k != "name"},
            },
            on_conflict="ticker",
        ).execute()
        existing = (
            db.table("user_stocks")
            .select("ticker")
            .eq("user_id", user_id)
            .eq("ticker", ticker)
            .execute()
            .data
        )
        if not existing:
            db.table("user_stocks").insert(
                {"user_id": user_id, "ticker": ticker, "type": "watchlist"}
            ).execute()


def get_holdings(user_id: str) -> list[dict]:
    db = get_db()
    rows = (
        db.table("user_stocks")
        .select("ticker, quantity, avg_cost")
        .eq("user_id", user_id)
        .eq("type", "holding")
        .execute()
        .data
    )
    if not rows:
        return []
    tickers = [r["ticker"] for r in rows]
    ticker_info = {
        t["ticker"]: t
        for t in db.table("tickers").select("ticker, market, exchange, name").in_("ticker", tickers).execute().data
    }
    return [
        {
            "ticker": r["ticker"],
            "name": ticker_info.get(r["ticker"], {}).get("name", r["ticker"]),
            "quantity": r["quantity"],
            "avg_cost": r["avg_cost"],
            "market": ticker_info.get(r["ticker"], {}).get("market", "US"),
            "exchange": ticker_info.get(r["ticker"], {}).get("exchange", ""),
        }
        for r in rows
    ]


def save_holdings(user_id: str, holdings: list[dict]) -> None:
    db = get_db()
    current = (
        db.table("user_stocks")
        .select("ticker")
        .eq("user_id", user_id)
        .eq("type", "holding")
        .execute()
        .data
    )
    current_tickers = {r["ticker"] for r in current}
    new_tickers = {h["ticker"].upper() for h in holdings}

    for t in current_tickers - new_tickers:
        db.table("user_stocks").update(
            {"type": "watchlist", "quantity": None, "avg_cost": None}
        ).eq("user_id", user_id).eq("ticker", t).execute()

    for h in holdings:
        ticker = h["ticker"].upper()
        db.table("tickers").upsert(
            {
                "ticker": ticker,
                "name": h.get("name") or ticker,
                "market": h.get("market") or "US",
                "exchange": h.get("exchange") or "",
            },
            on_conflict="ticker",
        ).execute()
        db.table("user_stocks").upsert(
            {
                "user_id": user_id,
                "ticker": ticker,
                "type": "holding",
                "quantity": h["quantity"],
                "avg_cost": h["avg_cost"],
            },
            on_conflict="user_id,ticker",
        ).execute()


def get_watchlist_tickers(user_id: str) -> list[str]:
    db = get_db()
    rows = (
        db.table("user_stocks")
        .select("ticker")
        .eq("user_id", user_id)
        .eq("type", "watchlist")
        .execute()
        .data
    )
    return [r["ticker"] for r in rows]


def save_watchlist_tickers(user_id: str, tickers: list[str]) -> None:
    db = get_db()
    current = (
        db.table("user_stocks")
        .select("ticker")
        .eq("user_id", user_id)
        .eq("type", "watchlist")
        .execute()
        .data
    )
    current_set = {r["ticker"] for r in current}
    new_set = {t.upper() for t in tickers}

    for t in current_set - new_set:
        db.table("user_stocks").delete().eq("user_id", user_id).eq("ticker", t).eq("type", "watchlist").execute()

    for t in new_set - current_set:
        db.table("tickers").upsert(
            {"ticker": t, "name": t, "market": "US", "exchange": ""},
            on_conflict="ticker",
        ).execute()
        db.table("user_stocks").upsert(
            {"user_id": user_id, "ticker": t, "type": "watchlist"},
            on_conflict="user_id,ticker",
        ).execute()


def get_full_portfolio(user_id: str) -> dict:
    db = get_db()
    rows = (
        db.table("user_stocks")
        .select("*, tickers(*)")
        .eq("user_id", user_id)
        .execute()
        .data
    )
    holdings, watchlist = [], []
    for r in rows:
        t = r.get("tickers") or {}
        entry = {
            "ticker": r["ticker"],
            "name": t.get("name") or r["ticker"],
            "market": t.get("market") or "US",
            "exchange": t.get("exchange") or "",
            "competitors": t.get("competitors") or [],
            "moat": t.get("moat") or "",
            "growth_plan": t.get("growth_plan") or "",
            "risks": t.get("risks") or "",
            "recent_disclosures": t.get("recent_disclosures") or "",
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


def enrich_stock(ticker: str, fields: dict) -> bool:
    db = get_db()
    upper = ticker.upper()
    existing = db.table("tickers").select("ticker").eq("ticker", upper).execute().data
    if not existing:
        return False
    db.table("tickers").update(fields).eq("ticker", upper).execute()
    return True


# ── 전역 함수 (user_id 없음, 시그니처 유지) ───────────────────────────────────

def get_schedule() -> dict:
    db = get_db()
    rows = db.table("schedules").select("data").eq("id", 1).execute().data
    if rows:
        return rows[0]["data"]
    return {"enabled": False, "time": "08:00", "days": ["mon", "tue", "wed", "thu", "fri"]}


def save_schedule(schedule: dict) -> None:
    db = get_db()
    db.table("schedules").upsert({"id": 1, "data": schedule}, on_conflict="id").execute()


def get_guru_managers() -> dict:
    db = get_db()
    rows = db.table("guru_managers").select("data").eq("id", 1).execute().data
    if rows:
        return rows[0]["data"]
    return {"last_updated": None, "managers": []}


def save_guru_managers(data: dict) -> None:
    db = get_db()
    db.table("guru_managers").upsert({"id": 1, "data": data}, on_conflict="id").execute()


def get_guru_schedule() -> dict:
    db = get_db()
    rows = db.table("guru_schedules").select("data").eq("id", 1).execute().data
    if rows:
        return rows[0]["data"]
    return {"enabled": False, "day": "sun", "time": "03:00"}


def save_guru_schedule(schedule: dict) -> None:
    db = get_db()
    db.table("guru_schedules").upsert({"id": 1, "data": schedule}, on_conflict="id").execute()
