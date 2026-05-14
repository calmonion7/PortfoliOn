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
            counts[ticker]["count"] += 1
    return sorted(counts.values(), key=lambda x: -x["count"])


def compute_manager_top3(managers: list[dict]) -> list[dict]:
    global_counts: dict[str, int] = {}
    for m in managers:
        for h in m.get("top10", []):
            ticker = h["ticker"]
            global_counts[ticker] = global_counts.get(ticker, 0) + 1

    result = []
    for m in managers:
        sorted_holdings = sorted(m.get("top10", []), key=lambda h: h["rank"])[:3]
        result.append({
            "manager_name": m["name"],
            "firm": m.get("firm", ""),
            "top3": [
                {
                    "rank": h["rank"],
                    "ticker": h["ticker"],
                    "name_kr": h.get("name_kr", ""),
                    "count": global_counts.get(h["ticker"], 1),
                }
                for h in sorted_holdings
            ],
        })
    return result


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
            scores[ticker]["score"] += score
    for v in scores.values():
        v["score"] = round(v["score"], 3)
    return sorted(scores.values(), key=lambda x: -x["score"])
