"""애널리스트 리포트 — 발행물 누적형 판단 문서 (ADR-0027, task#211).

판단·서사(rating·title·적정주가 밴드·산정방식·points·risks)는 Cowork가 제출하고,
숫자 데이터 블록(발행 시점 시세·forward 추정·피어 멀티플·PER 밴드·컨센서스 목표가)은
서버가 그 종목의 최신 스냅샷에서 발행 순간 발췌·계산해 자기완결적으로 박제한다.
요청 경로 외부 API 라이브 fetch 없음(스냅샷 발췌만 — 배치-백킹 원칙).

문서는 발행 후 불변이 기본 — 같은 날 재발행만 upsert(그날 판 교체), 다른 날은 누적.
"""
from __future__ import annotations

import json
import logging
import math
from typing import Optional

from services.db import query, execute

logger = logging.getLogger(__name__)

RATINGS = ("buy", "neutral", "sell")


def per_band(financials_annual: list, current_per=None, forward_per=None) -> Optional[dict]:
    """과거 연간 PER 시계열(비컨센서스 행, 최근 최대 6개)로 min/max/avg 밴드 산출.

    재료 부족(유효 연간 PER <2개)이면 None (wrong<missing)."""
    pers = []
    for f in financials_annual or []:
        if f.get("is_consensus"):
            continue
        v = f.get("per")
        try:
            v = float(v) if v is not None else None
        except (TypeError, ValueError):
            v = None
        if v is not None and math.isfinite(v) and v > 0:
            pers.append((str(f.get("period") or ""), v))
    pers = [v for _, v in sorted(pers, key=lambda x: x[0], reverse=True)[:6]]
    if len(pers) < 2:
        return None
    return {
        "min": round(min(pers), 1),
        "max": round(max(pers), 1),
        "avg": round(sum(pers) / len(pers), 1),
        "current": current_per,
        "forward": forward_per,
    }


def build_data_block(snapshot: dict, snapshot_date: str) -> dict:
    """최신 스냅샷에서 발행 시점 데이터 블록 발췌·계산 (ADR-0027 하이브리드 생산).

    financials_annual 발췌: 비컨센서스 최근 3개년 + 컨센서스(forward) 행 전부,
    period 오름차순. KR은 매출·영업이익·EPS, US는 영업이익이 null일 수 있음(graceful)."""
    annual = snapshot.get("financials_annual") or []
    actual = sorted(
        [f for f in annual if not f.get("is_consensus")],
        key=lambda f: str(f.get("period") or ""), reverse=True,
    )[:3]
    consensus_rows = [f for f in annual if f.get("is_consensus")]
    excerpt = sorted(actual + consensus_rows, key=lambda f: str(f.get("period") or ""))
    fields = ("period", "revenue", "operating_income", "eps", "per", "is_consensus")
    return {
        "snapshot_date": snapshot_date,
        "price": snapshot.get("price"),
        "market": snapshot.get("market"),
        "name": snapshot.get("name"),
        "consensus": {
            "target_mean": snapshot.get("target_mean"),
            "buy": snapshot.get("buy"),
            "hold": snapshot.get("hold"),
            "sell": snapshot.get("sell"),
        },
        "financials_annual": [{k: f.get(k) for k in fields} for f in excerpt],
        "competitors": [
            {k: c.get(k) for k in ("ticker", "name", "is_self", "per", "pbr", "psr", "ev_ebitda", "rd_intensity")}
            for c in snapshot.get("competitors_data") or []
        ],
        "per_band": per_band(annual, snapshot.get("per"), snapshot.get("forward_per")),
    }


def _fnum(v):
    """DB NUMERIC(Decimal)·문자열을 float로 정규화 — json.dumps TypeError·NaN/inf 직렬화 가드."""
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def consensus_basis(ticker: str) -> Optional[dict]:
    """발행 순간 컨센서스 근거 발췌 — 집계(mart 최신 행) + 증권사별 최신 의견 (task#260).

    raw_reports 창은 마트의 latest_per_brokerage CTE(_MART_SQL)와 **같은 계보** —
    mart 최신 행의 base_date를 앵커로 90일 창 `DISTINCT ON (brokerage_code)` 최신행.
    두 곳이 다른 창을 쓰면 박제된 집계와 증권사 행이 어긋난다.
    US sentinel `__consensus__`는 증권사가 아니라 집계 placeholder라 테이블에서 제외
    (consensus_pipeline이 US 집계를 그 코드로 넣는다).
    파이프라인 미커버 종목·read 실패는 None — 발행 자체를 막지 않는다(graceful).
    """
    upper = ticker.upper()
    try:
        mart = query(
            "SELECT base_date, avg_target_price, avg_target_high, avg_target_low,"
            "       avg_opinion_score, analyst_count, buy_count, hold_count, sell_count"
            " FROM daily_consensus_mart WHERE ticker = %s ORDER BY base_date DESC LIMIT 1",
            (upper,),
        )
        anchor = mart[0]["base_date"] if mart else None
        brokerages = query(
            "SELECT DISTINCT ON (brokerage_code)"
            "       brokerage_code, raw_opinion, target_price, opinion_score, report_date"
            " FROM raw_reports"
            " WHERE ticker = %s"
            "   AND report_date BETWEEN COALESCE(%s, CURRENT_DATE)::date - INTERVAL '90 days'"
            "                       AND COALESCE(%s, CURRENT_DATE)::date"
            "   AND brokerage_code <> '__consensus__'"
            " ORDER BY brokerage_code, report_date DESC",
            (upper, anchor, anchor),
        )
    except Exception as e:
        logger.warning(f"[AnalystReport] {upper} 컨센서스 근거 발췌 생략(read 실패): {e}")
        return None
    if not mart and not brokerages:
        return None
    out = {"consensus": {}, "consensus_detail": {"brokerages": []}}
    if mart:
        m = mart[0]
        out["consensus"] = {
            # target_mean은 스냅샷 값 우선 — 라우터가 스냅샷이 null일 때만 이 값으로 보충
            # (KR 스냅샷 target_mean이 비어도 mart 평균이 있으면 평균·델타가 성립, task#260 라이브 발견).
            "target_mean": _fnum(m.get("avg_target_price")),
            "target_high": _fnum(m.get("avg_target_high")),
            "target_low": _fnum(m.get("avg_target_low")),
            "opinion_score": _fnum(m.get("avg_opinion_score")),
            "analyst_count": int(m["analyst_count"]) if m.get("analyst_count") is not None else None,
            "base_date": str(m["base_date"]) if m.get("base_date") is not None else None,
            # 분포도 target_mean과 같은 보충 규칙 — 스냅샷 분포가 전부 0/None일 때만 라우터가 채택
            "buy": int(m["buy_count"]) if m.get("buy_count") is not None else None,
            "hold": int(m["hold_count"]) if m.get("hold_count") is not None else None,
            "sell": int(m["sell_count"]) if m.get("sell_count") is not None else None,
        }
    out["consensus_detail"]["brokerages"] = [
        {
            "brokerage": r.get("brokerage_code"),
            "opinion": r.get("raw_opinion"),
            "target_price": _fnum(r.get("target_price")),
            "opinion_score": _fnum(r.get("opinion_score")),
            "report_date": str(r["report_date"]) if r.get("report_date") is not None else None,
        }
        for r in sorted(brokerages, key=lambda r: str(r.get("report_date") or ""), reverse=True)
    ]
    return out


def latest_snapshot(ticker: str) -> Optional[tuple]:
    """(date_str, data dict) 또는 None."""
    rows = query(
        "SELECT date, data FROM snapshots WHERE ticker = %s ORDER BY date DESC LIMIT 1",
        (ticker.upper(),),
    )
    if not rows:
        return None
    row = rows[0]
    d = row["date"]
    return (d.isoformat() if hasattr(d, "isoformat") else str(d), row["data"])


def save_report(ticker: str, published_date: str, rating: str, title: str,
                fair_value_low, fair_value_high, valuation_method: str,
                points: list, risks: str, data: dict) -> None:
    """발행 저장 — 같은 (ticker, published_date)는 upsert(그날 판 교체), 다른 날은 누적."""
    execute(
        """INSERT INTO analyst_reports
               (ticker, published_date, rating, title, fair_value_low, fair_value_high,
                valuation_method, points, risks, data)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (ticker, published_date) DO UPDATE SET
               rating = EXCLUDED.rating, title = EXCLUDED.title,
               fair_value_low = EXCLUDED.fair_value_low, fair_value_high = EXCLUDED.fair_value_high,
               valuation_method = EXCLUDED.valuation_method, points = EXCLUDED.points,
               risks = EXCLUDED.risks, data = EXCLUDED.data, created_at = NOW()""",
        (ticker.upper(), published_date, rating, title, fair_value_low, fair_value_high,
         valuation_method, json.dumps(points, ensure_ascii=False), risks,
         json.dumps(data, ensure_ascii=False)),
    )


def _summary(row: dict) -> dict:
    d = row.get("published_date")
    return {
        "ticker": row.get("ticker"),
        "published_date": d.isoformat() if hasattr(d, "isoformat") else str(d),
        "rating": row.get("rating"),
        "title": row.get("title"),
        "fair_value_low": float(row["fair_value_low"]) if row.get("fair_value_low") is not None else None,
        "fair_value_high": float(row["fair_value_high"]) if row.get("fair_value_high") is not None else None,
        "name": (row.get("data") or {}).get("name"),
        "market": (row.get("data") or {}).get("market"),
    }


_COLS = "ticker, published_date, rating, title, fair_value_low, fair_value_high, data"


def list_reports(ticker: Optional[str] = None) -> list:
    """발행물 목록(요약, 최신순).

    ticker 지정 = 그 종목의 **전 판**(문서 상세의 이력 네비게이션용),
    미지정 = **종목당 최신 1건**(목록의 정체성 = 그 종목에 대한 현재 판단 — ADR-0027 개정).
    소비처가 정확히 이렇게 갈리므로 플래그 없이 분기별 동작으로 둔다.
    """
    if ticker:
        rows = query(
            f"SELECT {_COLS} FROM analyst_reports WHERE ticker = %s ORDER BY published_date DESC",
            (ticker.upper(),),
        )
    else:
        rows = query(
            f"SELECT * FROM (SELECT DISTINCT ON (ticker) {_COLS} FROM analyst_reports"
            " ORDER BY ticker, published_date DESC) t ORDER BY published_date DESC, ticker",
        )
    return [_summary(r) for r in rows]


def delete_reports(ticker: str) -> int:
    """그 종목의 발행물 전 판 삭제 → 삭제 건수. 판 단위 삭제는 없다(ADR-0027 개정)."""
    return execute("DELETE FROM analyst_reports WHERE ticker = %s", (ticker.upper(),))


def get_report(ticker: str, published_date: str) -> Optional[dict]:
    """발행물 상세(전체 필드) 또는 None."""
    rows = query(
        "SELECT * FROM analyst_reports WHERE ticker = %s AND published_date = %s",
        (ticker.upper(), published_date),
    )
    if not rows:
        return None
    row = rows[0]
    out = _summary(row)
    out.update({
        "valuation_method": row.get("valuation_method"),
        "points": row.get("points") or [],
        "risks": row.get("risks") or "",
        "data": row.get("data") or {},
    })
    return out
