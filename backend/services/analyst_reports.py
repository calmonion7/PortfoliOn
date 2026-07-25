"""애널리스트 리포트 — 발행물 누적형 판단 문서 (ADR-0027, task#211).

판단·서사(rating·title·적정주가 밴드·산정방식·points·risks)는 Cowork가 제출하고,
숫자 데이터 블록(발행 시점 시세·forward 추정·피어 멀티플·PER 밴드·컨센서스 목표가)은
서버가 그 종목의 최신 스냅샷에서 발행 순간 발췌·계산해 자기완결적으로 박제한다.
요청 경로 외부 API 라이브 fetch 없음(스냅샷 발췌만 — 배치-백킹 원칙).

문서는 발행 후 불변이 기본 — 같은 날 재발행만 upsert(그날 판 교체), 다른 날은 누적.
"""
from __future__ import annotations

import json
import math
from typing import Optional

from services.db import query, execute

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


def list_reports(ticker: Optional[str] = None) -> list:
    """발행물 목록(요약, 최신순). ticker 지정 시 그 종목의 판 목록."""
    if ticker:
        rows = query(
            "SELECT ticker, published_date, rating, title, fair_value_low, fair_value_high, data"
            " FROM analyst_reports WHERE ticker = %s ORDER BY published_date DESC",
            (ticker.upper(),),
        )
    else:
        rows = query(
            "SELECT ticker, published_date, rating, title, fair_value_low, fair_value_high, data"
            " FROM analyst_reports ORDER BY published_date DESC, ticker",
        )
    return [_summary(r) for r in rows]


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
