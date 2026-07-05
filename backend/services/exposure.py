"""포트폴리오 노출·집중도 계산 — 순수 함수 (DB/외부 API 호출 없음).

보유 종목의 통화(시장)·섹터·단일종목 3축 쏠림을 전체-포트 KRW 환산 비중으로 계산한다.
KRW 환산·전체-포트 분모는 rebalance.value_holdings_krw를 재사용한다(eco: 중복 방지).
"""
from __future__ import annotations
from typing import Dict, List

from services.rebalance import value_holdings_krw

SINGLE_NAME_THRESHOLD = 25.0
SECTOR_THRESHOLD = 40.0


def compute_exposure(
    holdings: List[dict], quotes: dict, fx, sector_map: Dict[str, str], beta_map: Dict[str, float] = None
) -> dict:
    """holdings: get_holdings() 반환 형태 [{ticker, name, market, quantity, ...}, ...]
    quotes: get_quotes_batch() 반환 {TICKER: {"price": ...}, ...}
    fx: 저장 FX(float|Decimal|None)
    sector_map: {ticker: 섹터명} — 없으면 '기타'
    beta_map: {ticker: beta} — 없는 보유는 포트폴리오 베타 계산에서 제외
    """
    beta_map = beta_map or {}
    priced = [
        {**h, "current_price": (quotes.get((h.get("ticker") or "").upper()) or {}).get("price")}
        for h in holdings
    ]
    rows, full_total, _fx = value_holdings_krw(priced, fx)
    priced_rows = [r for r in rows if r["value_krw"] is not None]

    def _weight(value_krw: float) -> float:
        return value_krw / full_total * 100.0 if full_total > 0 else 0.0

    by_ticker = sorted(
        (
            {
                "ticker": r["ticker"],
                "name": r["name"],
                "market": r["market"],
                "value_krw": r["value_krw"],
                "weight": _weight(r["value_krw"]),
            }
            for r in priced_rows
        ),
        key=lambda e: e["weight"],
        reverse=True,
    )

    currency: Dict[str, dict] = {}
    for r in priced_rows:
        g = currency.setdefault(r["market"], {"value_krw": 0.0, "weight": 0.0})
        g["value_krw"] += r["value_krw"]
    for g in currency.values():
        g["weight"] = _weight(g["value_krw"])

    sector: Dict[str, dict] = {}
    for r in priced_rows:
        name = sector_map.get(r["ticker"]) or "기타"
        g = sector.setdefault(name, {"value_krw": 0.0, "weight": 0.0})
        g["value_krw"] += r["value_krw"]
    for g in sector.values():
        g["weight"] = _weight(g["value_krw"])

    max_single = (
        {"ticker": by_ticker[0]["ticker"], "weight": by_ticker[0]["weight"]}
        if by_ticker else None
    )

    total_weight = sum(e["weight"] for e in by_ticker)
    covered = [e for e in by_ticker if e["ticker"] in beta_map]
    covered_weight = sum(e["weight"] for e in covered)
    portfolio_beta = (
        sum(e["weight"] * beta_map[e["ticker"]] for e in covered) / covered_weight
        if covered_weight > 0 else None
    )
    beta_coverage_pct = covered_weight / total_weight * 100.0 if total_weight > 0 else 0.0

    return {
        "holdings": by_ticker,
        "currency": currency,
        "sector": sector,
        "concentration": {
            "top3_pct": sum(e["weight"] for e in by_ticker[:3]),
            "top5_pct": sum(e["weight"] for e in by_ticker[:5]),
            "max_single": max_single,
        },
        "warnings": {
            "single_name": any(e["weight"] > SINGLE_NAME_THRESHOLD for e in by_ticker),
            "sector": any(g["weight"] > SECTOR_THRESHOLD for g in sector.values()),
        },
        "portfolio_beta": portfolio_beta,
        "beta_coverage_pct": beta_coverage_pct,
        "beta_covered_count": len(covered),
        "beta_missing": [e["ticker"] for e in by_ticker if e["ticker"] not in beta_map],
        "no_fx": {
            "tickers": [r["ticker"] for r in rows if r["no_fx"]],
            "count": sum(1 for r in rows if r["no_fx"]),
        },
    }
