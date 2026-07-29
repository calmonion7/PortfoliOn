import logging

logger = logging.getLogger(__name__)

# 신고 투자금(`value`)을 추정치(`weight_pct × portfolio_value`)와 대조할 때 허용 배율.
# 라이브 3,927건 실측: 비율 median 0.9998 · max 1.488 · [1/2,2] 밖 0건(산포는 dataroma가
# 비중을 소수 2자리로만 주는 반올림 오차). 5배는 그 위로 3.4배 여유 (task#244).
_VALUE_EST_BAND = 5


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
            est = (h.get("weight_pct") or 0) / 100 * pv
            value = h.get("value") or est
            # dataroma 열이 밀리면 다른 *숫자* 열(예 Reported Price $185.06)이 파싱을
            # **성공**해 경고 없이 wrong 값이 되고 total(비율 분모)까지 오염된다. 신고값과
            # 추정값이 둘 다 있을 때 자릿수가 어긋나면 신고값을 버리고 추정치를 쓴다
            # (실패 클래스를 가드 — 열 삽입·헤더 개명 등 원인 불문).
            # 밴드 근거(라이브 3,927건): value/est의 median 0.9998·max 1.488·[1/2,2] 밖 0건
            # → [1/5,5]는 관측 최대 대비 3.4배 여유이면서 오정렬(자릿수 6~9개)은 확실히 잡는다.
            if h.get("value") and est and not (1 / _VALUE_EST_BAND <= value / est <= _VALUE_EST_BAND):
                logger.warning(
                    f"[GuruStats] value/추정 불일치 — 추정치 사용 "
                    f"({m.get('id')} {ticker}: value={value} est={est:.0f})"
                )
                value = est
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
