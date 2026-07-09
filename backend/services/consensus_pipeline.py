from __future__ import annotations
from datetime import date, timedelta
import logging
from services.db import execute, query, get_connection
from services.utils import today_kst

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# opinion → 5점 표준화 점수
# ---------------------------------------------------------------------------
_SCORE_MAP: dict[str, float] = {
    # KR
    "강력매수": 5.0, "적극매수": 5.0,
    "매수":     4.0,
    "중립":     3.0, "시장수익률": 3.0, "유지": 3.0,
    "비중축소": 2.0,
    "매도":     1.0, "강력매도": 1.0,
    # US
    "Strong Buy": 5.0,
    "Buy": 4.0, "Outperform": 4.0, "Overweight": 4.0,
    "Add": 4.0, "Accumulate": 4.0, "Positive": 4.0, "Top Pick": 4.0,
    "Hold": 3.0, "Neutral": 3.0, "Market Perform": 3.0,
    "Equal Weight": 3.0, "In-Line": 3.0,
    "Underperform": 2.0, "Underweight": 2.0, "Reduce": 2.0,
    "Sell": 1.0, "Strong Sell": 1.0, "Negative": 1.0,
}


def _score(opinion: str) -> float:
    op = opinion.strip()
    if op in _SCORE_MAP:
        return _SCORE_MAP[op]
    # 부분 매칭 (예: "매수(유지)", "Trading BUY")
    op_upper = op.upper()
    if "매수" in op or "BUY" in op_upper or "OVERWEIGHT" in op_upper or "OUTPERFORM" in op_upper:
        return 4.0
    if "매도" in op or "SELL" in op_upper or "UNDERWEIGHT" in op_upper or "UNDERPERFORM" in op_upper:
        return 2.0
    return 3.0  # 기본: 중립


# ---------------------------------------------------------------------------
# 원천 수집: KR (FnGuide 우선, Naver Research fallback)
# ---------------------------------------------------------------------------
def _fetch_kr_raw(ticker: str, days: int = 7) -> list[dict]:
    import requests
    from concurrent.futures import ThreadPoolExecutor

    cutoff = (today_kst() - timedelta(days=days)).isoformat()

    # FnGuide 우선
    fg_results = _fetch_kr_fnguide(ticker)
    fg_filtered = [r for r in fg_results if r["report_date"] >= cutoff]
    if fg_filtered:
        return fg_filtered

    # fallback: Naver Research
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        r = requests.get(
            f"https://m.stock.naver.com/api/research/stock/{ticker}?pageSize=200",
            headers=headers, timeout=8,
        )
        r.raise_for_status()
        items = r.json()
    except Exception as e:
        logger.warning(f"[Consensus] _fetch_kr_raw Naver 요청 실패 {ticker}: {e}")
        return []

    recent = [i for i in items if i.get("writeDate", "") >= cutoff]
    if not recent:
        return []

    def fetch_detail(item):
        rid = item["researchId"]
        report_date = item["writeDate"][:10]
        brokerage = item.get("brokerName", "unknown")
        try:
            dr = requests.get(
                f"https://m.stock.naver.com/api/research/stock/{ticker}/{rid}",
                headers=headers, timeout=8,
            )
            dr.raise_for_status()
            content = dr.json().get("researchContent", {})
            opinion = content.get("opinion", "").strip()
            price_str = content.get("goalPrice", "")
            try:
                target_price = float(price_str.replace(",", "")) if price_str else None
            except ValueError:
                target_price = None
            return {
                "report_date": report_date,
                "brokerage_code": brokerage,
                "target_price": target_price,
                "raw_opinion": opinion,
            }
        except Exception as e:
            logger.warning(f"[Consensus] fetch_detail 실패 {ticker}/{rid}: {e}")
            return {
                "report_date": report_date,
                "brokerage_code": brokerage,
                "target_price": None,
                "raw_opinion": "",
            }

    with ThreadPoolExecutor(max_workers=5) as ex:
        return list(ex.map(fetch_detail, recent))


# ---------------------------------------------------------------------------
# 원천 수집: KR fallback (FnGuide — Naver 데이터 없을 때)
# ---------------------------------------------------------------------------
_RECOM_TO_OPINION = {
    5.0: "강력매수", 4.0: "매수", 3.0: "중립", 2.0: "비중축소", 1.0: "매도",
}

def _fetch_kr_fnguide(ticker: str) -> list[dict]:
    import requests, json as _json

    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://comp.fnguide.com/",
    }
    url = f"https://comp.fnguide.com/SVO2/json/data/01_06/03_A{ticker}.json"
    try:
        r = requests.get(url, headers=headers, timeout=10)
        r.raise_for_status()
        data = _json.loads(r.content.decode("utf-8-sig"))
    except Exception as e:
        logger.warning(f"[Consensus] _fetch_kr_fnguide FnGuide 요청 실패 {ticker}: {e}")
        return []

    results = []
    for row in data.get("comp", []):
        est_dt = row.get("EST_DT", "")
        if not est_dt:
            continue
        report_date = est_dt.replace("/", "-")  # "2026/06/01" → "2026-06-01"
        try:
            tp = float(row["TARGET_PRC"].replace(",", "")) if row.get("TARGET_PRC") else None
        except (ValueError, AttributeError):
            tp = None
        try:
            recom = round(float(row.get("RECOM_CD", 3)))
        except (ValueError, TypeError):
            recom = 3
        opinion = _RECOM_TO_OPINION.get(float(recom), "중립")
        results.append({
            "report_date": report_date,
            "brokerage_code": row.get("INST_NM", "unknown"),
            "target_price": tp,
            "raw_opinion": opinion,
        })
    return results


# ---------------------------------------------------------------------------
# 원천 수집: US (yfinance)
# ---------------------------------------------------------------------------
def _fetch_us_raw(ticker: str, days: int = 7) -> list[dict]:
    try:
        import yfinance as yf
        import pandas as pd

        t = yf.Ticker(ticker.replace(".", "-"))
        ud = t.upgrades_downgrades
        if ud is None or ud.empty:
            return []

        idx = pd.to_datetime(ud.index)
        if idx.tz is not None:
            idx = idx.tz_convert(None)
        ud = ud.copy()
        ud.index = idx.date

        cutoff = today_kst() - timedelta(days=days)
        results = []
        for d, row in ud.iterrows():
            if d < cutoff:
                continue
            opinion = row.get("ToGrade", "")
            try:
                tp = float(row.get("currentPriceTarget") or 0) or None
            except (TypeError, ValueError):
                tp = None
            results.append({
                "report_date": d.isoformat(),
                "brokerage_code": row.get("Firm", "unknown"),
                "target_price": tp,
                "raw_opinion": opinion,
            })

        if not results:
            # upgrades_downgrades 데이터 없을 때 analyst_price_targets로 오늘 컨센서스 1행 보완
            apt = t.analyst_price_targets
            if apt and apt.get("mean"):
                rec_key = (t.info.get("recommendationKey") or "hold")
                opinion = rec_key.replace("_", " ").title()
                results.append({
                    "report_date": today_kst().isoformat(),
                    "brokerage_code": "__consensus__",
                    "target_price": float(apt["mean"]),
                    "raw_opinion": opinion,
                })

        return results
    except Exception as e:
        logger.warning(f"[Consensus] _fetch_us_raw yfinance 파싱 실패 {ticker}: {e}")
        return []


# ---------------------------------------------------------------------------
# UPSERT raw_reports
# ---------------------------------------------------------------------------
def upsert_raw_reports(ticker: str, market: str, days: int = 7) -> int:
    upper = ticker.upper()
    rows = _fetch_kr_raw(upper, days) if market == "KR" else _fetch_us_raw(upper, days)
    # opinion 없는 실패 행 제외
    rows = [r for r in rows if r["raw_opinion"] or r["target_price"] is not None]

    inserted = 0
    for r in rows:
        n = execute(
            """
            INSERT INTO raw_reports
              (report_date, ticker, brokerage_code,
               target_price, raw_opinion, opinion_score, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (report_date, ticker, brokerage_code) DO UPDATE SET
              target_price  = EXCLUDED.target_price,
              raw_opinion   = EXCLUDED.raw_opinion,
              opinion_score = EXCLUDED.opinion_score,
              created_at    = NOW()
            """,
            (r["report_date"], upper, r["brokerage_code"],
             r["target_price"], r["raw_opinion"], _score(r["raw_opinion"])),
        )
        inserted += n
    return inserted


# ---------------------------------------------------------------------------
# 마트 스냅샷 재계산 (특정 base_date 1행)
# ---------------------------------------------------------------------------
_MART_SQL = """
INSERT INTO daily_consensus_mart
  (base_date, ticker,
   avg_target_price, avg_target_high, avg_target_low,
   avg_opinion_score, analyst_count,
   buy_count, hold_count, sell_count,
   updated_at)
WITH latest_per_brokerage AS (
  SELECT DISTINCT ON (ticker, brokerage_code)
    ticker, brokerage_code, target_price, opinion_score
  FROM raw_reports
  WHERE ticker      = %s
    AND report_date BETWEEN %s::date - INTERVAL '90 days' AND %s::date
  ORDER BY ticker, brokerage_code, report_date DESC
)
SELECT
  %s,
  %s,
  ROUND(AVG(target_price),             0),
  ROUND(MAX(target_price),             0),
  ROUND(MIN(target_price),             0),
  ROUND(AVG(opinion_score),            2),
  COUNT(DISTINCT brokerage_code),
  SUM(CASE WHEN opinion_score >= 4.0 THEN 1 ELSE 0 END),
  SUM(CASE WHEN opinion_score >= 2.5 AND opinion_score < 4.0 THEN 1 ELSE 0 END),
  SUM(CASE WHEN opinion_score <  2.5 THEN 1 ELSE 0 END),
  NOW()
FROM latest_per_brokerage
HAVING COUNT(*) > 0
ON CONFLICT (base_date, ticker) DO UPDATE SET
  avg_target_price  = EXCLUDED.avg_target_price,
  avg_target_high   = EXCLUDED.avg_target_high,
  avg_target_low    = EXCLUDED.avg_target_low,
  avg_opinion_score = EXCLUDED.avg_opinion_score,
  analyst_count     = EXCLUDED.analyst_count,
  buy_count         = EXCLUDED.buy_count,
  hold_count        = EXCLUDED.hold_count,
  sell_count        = EXCLUDED.sell_count,
  updated_at        = NOW()
"""


def refresh_mart(ticker: str, base_date: date) -> None:
    upper = ticker.upper()
    execute(_MART_SQL, (upper, base_date, base_date, base_date, upper))


# ---------------------------------------------------------------------------
# 일별 파이프라인 (스케줄러 호출용)
# ---------------------------------------------------------------------------
def run_daily(stocks: list) -> None:
    today = today_kst()
    for stock in stocks:
        ticker = stock["ticker"]
        market = stock.get("market", "US")
        try:
            upsert_raw_reports(ticker, market, days=7)
        except Exception as e:
            logger.warning(f"[Pipeline] raw upsert failed {ticker}: {e}")
        try:
            refresh_mart(ticker, today)
        except Exception as e:
            logger.warning(f"[Pipeline] mart refresh failed {ticker}: {e}")
        if market == "KR":
            try:
                from services.market import get_analyst_data_kr
                kr = get_analyst_data_kr(ticker)
                if kr.get("target_mean"):
                    execute(
                        "UPDATE daily_consensus_mart SET avg_target_price = %s "
                        "WHERE ticker = %s AND base_date = %s",
                        (kr["target_mean"], ticker.upper(), today),
                    )
            except Exception as e:
                logger.warning(f"[Pipeline] AVG_PRC override failed {ticker}: {e}")


# ---------------------------------------------------------------------------
# 백필 (최초 적재 or 재적재)
# ---------------------------------------------------------------------------
def backfill(stocks: list, days: int = 180, force: bool = False) -> int:
    today = today_kst()
    total = 0

    for stock in stocks:
        ticker = stock["ticker"]
        market = stock.get("market", "US")

        # 1단계: raw UPSERT
        try:
            n = upsert_raw_reports(ticker, market, days=days)
            total += n
        except Exception as e:
            logger.warning(f"[Pipeline] backfill raw failed {ticker}: {e}")
            continue

        # 2단계: 마트 재계산 (raw가 있는 가장 이른 날짜부터 오늘까지)
        try:
            rows = query(
                "SELECT MIN(report_date) AS earliest FROM raw_reports WHERE ticker = %s",
                (ticker.upper(),),
            )
            earliest = rows[0]["earliest"] if rows and rows[0]["earliest"] else today - timedelta(days=days)
            if force:
                # force: DELETE + 전체 재적재를 한 트랜잭션으로 묶어 원자화(#28) — 루프 중단(예외·킬)
                # 시 get_connection이 롤백해 기존 mart가 통째 보존된다(비원자 DELETE→부분 소실 방지).
                upper = ticker.upper()
                cutoff = today - timedelta(days=days)
                with get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "DELETE FROM daily_consensus_mart WHERE ticker = %s AND base_date >= %s",
                            (upper, cutoff),
                        )
                        d = earliest
                        while d <= today:
                            cur.execute(_MART_SQL, (upper, d, d, d, upper))
                            d += timedelta(days=1)
            else:
                # non-force: DELETE 없는 멱등 재적재 — 파괴적 삭제가 없어 per-date 회복 루프 유지
                d = earliest
                while d <= today:
                    try:
                        refresh_mart(ticker, d)
                    except Exception as e:
                        logger.warning(f"[Pipeline] mart refresh failed {ticker} {d}: {e}")
                    d += timedelta(days=1)
        except Exception as e:
            logger.warning(f"[Pipeline] backfill mart failed {ticker}: {e}")

    return total


# ---------------------------------------------------------------------------
# 차트용 히스토리 조회 (daily_consensus_mart → get_history 대체)
# ---------------------------------------------------------------------------
def get_mart_history(ticker: str) -> list[dict]:
    rows = query(
        """
        SELECT base_date, avg_target_price, avg_target_high, avg_target_low,
               avg_opinion_score, analyst_count,
               buy_count, hold_count, sell_count
        FROM daily_consensus_mart
        WHERE ticker = %s
        ORDER BY base_date DESC
        """,
        (ticker.upper(),),
    )
    return [
        {
            "date":         str(r["base_date"]),
            "target_mean":  r["avg_target_price"],
            "target_high":  r["avg_target_high"],
            "target_low":   r["avg_target_low"],
            "opinion_score": r["avg_opinion_score"],
            "analyst_count": r["analyst_count"],
            "buy":          r["buy_count"],
            "hold":         r["hold_count"],
            "sell":         r["sell_count"],
        }
        for r in rows
    ]
