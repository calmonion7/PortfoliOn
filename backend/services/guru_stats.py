def compute_popularity(managers: list[dict]) -> list[dict]:
    counts: dict[str, dict] = {}
    for m in managers:
        for h in m.get("top10", []):
            ticker = h["ticker"]
            if ticker not in counts:
                counts[ticker] = {
                    "ticker": ticker,
                    "name": h.get("name", ""),
                    "name_kr": h.get("name_kr", ""),
                    "count": 0,
                }
            elif h.get("name_kr") and not counts[ticker]["name_kr"]:
                counts[ticker]["name_kr"] = h["name_kr"]
            counts[ticker]["count"] += 1
    return sorted(counts.values(), key=lambda x: -x["count"])


def compute_allocation(managers: list[dict]) -> dict:
    """전 매니저의 **전 종목 층**을 티커별로 합산한다 — [[구루 자산 배분]].

    투자금 정본은 dataroma 신고 금액(`value`)이고, 그게 없을 때만
    `weight_pct/100 × portfolio_value`로 **추정**한다(크롤 직후엔 전자, 신규 필드가
    아직 안 채워진 동안엔 후자). 비율의 분모는 특정 매니저가 아니라 전 종목
    투자금의 총합이라 rows의 ratio를 다 더하면 100이 된다.

    듀얼클래스(GOOGL/GOOG 등)는 **합치지 않는다** — 13F가 티커 단위 신고다.
    """
    # 전 종목 층엔 name_kr이 없다 — top10 층이 유일한 한글명 출처라 거기서 사전을 만든다.
    name_kr: dict[str, str] = {}
    for m in managers:
        for h in m.get("top10", []):
            if h.get("name_kr") and h["ticker"] not in name_kr:
                name_kr[h["ticker"]] = h["name_kr"]

    rows: dict[str, dict] = {}
    for m in managers:
        pv = m.get("portfolio_value") or 0
        for h in m.get("holdings", []):
            ticker = h["ticker"]
            value = h.get("value") or (h.get("weight_pct") or 0) / 100 * pv
            row = rows.get(ticker)
            if row is None:
                row = rows[ticker] = {
                    "ticker": ticker,
                    "name": h.get("name", ""),
                    "name_kr": name_kr.get(ticker, ""),
                    "value": 0.0,
                    "holder_count": 0,
                }
            row["value"] += value
            # 금액이 0이어도(포트폴리오 가치 미상 매니저) 보유 사실은 센다.
            row["holder_count"] += 1

    total = sum(r["value"] for r in rows.values())
    for r in rows.values():
        r["ratio"] = round(r["value"] / total * 100, 4) if total else 0.0
        r["value"] = round(r["value"])
    return {
        "total_value": round(total),
        "manager_count": len(managers),
        "ticker_count": len(rows),
        "rows": sorted(rows.values(), key=lambda x: -x["value"]),
    }


def compute_weighted(managers: list[dict]) -> list[dict]:
    scores: dict[str, dict] = {}
    for m in managers:
        for h in m.get("top10", []):
            ticker = h["ticker"]
            score = 1.0 / h["rank"]
            if ticker not in scores:
                scores[ticker] = {
                    "ticker": ticker,
                    "name": h.get("name", ""),
                    "name_kr": h.get("name_kr", ""),
                    "score": 0.0,
                }
            elif h.get("name_kr") and not scores[ticker]["name_kr"]:
                scores[ticker]["name_kr"] = h["name_kr"]
            scores[ticker]["score"] += score
    for v in scores.values():
        v["score"] = round(v["score"], 3)
    return sorted(scores.values(), key=lambda x: -x["score"])
