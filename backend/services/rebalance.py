"""포트폴리오 리밸런싱 계산 — 순수 함수 (DB/외부 API 호출 없음).

보유 종목별 목표 비중(targets) 대비 현재 비중 드리프트 + 목표 도달 조정금액을 계산한다.
주문 실행은 범위 밖 — 읽기전용 계산기.

기준(task#147): 현재 비중은 **전체 포트폴리오** 기준(KRW 환산 가능한 모든 보유의 합이 분모).
타겟 설정 종목만 드리프트/제안을 계산하고, 미설정 종목은 실제 비중만 표시하며 hold로 둔다
(제안 없음 — sell-all 함정 회피). 타겟은 전체 포트 대비 %라 정규화하지 않는다.
"""
from __future__ import annotations
import math
from typing import Dict, List, Optional


def _finite_float(value) -> Optional[float]:
    """None/Decimal/float 등을 float로 정규화. None이거나 비유한이면 None."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def compute_rebalance(holdings: List[dict], usdkrw, targets: Dict[str, float]) -> dict:
    """보유 종목 리스트 + 저장 FX + 사용자 목표비중으로 리밸런싱 드리프트/제안금액 계산.

    holdings: [{ticker, name, market('KR'|'US'), current_price, quantity}, ...]
    usdkrw: 저장 FX(float|None) — KR은 fx=1.0 취급
    targets: {ticker: target_weight} — 사용자가 설정한 종목만 키 존재(전체 포트 대비 %, 정규화 안 함)
    """
    fx = _finite_float(usdkrw)
    if fx is not None and fx <= 0:
        fx = None  # 0/음수 FX는 무효 — US를 no_fx로 처리(0으로 나누기 방지)
    raw_target_sum = sum(float(w) for w in targets.values()) if targets else 0.0

    rows = []
    for h in holdings:
        price = _finite_float(h.get("current_price"))
        qty = _finite_float(h.get("quantity"))
        if price is None or qty is None:
            continue  # 가격/수량 무효 — 계산 불가, 결과에서 제외
        ticker = h.get("ticker")
        market = h.get("market")
        no_fx = market == "US" and fx is None
        if no_fx:
            value_krw = None  # FX 없이 KRW 환산 불가 — 총계·비중서 제외
        elif market == "KR":
            value_krw = price * qty
        else:
            value_krw = price * qty * fx
        rows.append({
            "ticker": ticker,
            "name": h.get("name"),
            "market": market,
            "price": price,
            "value_krw": value_krw,
            "untargeted": ticker not in targets,
            "no_fx": no_fx,
        })

    # 전체 포트폴리오 총액 = KRW 환산 가능한 모든 보유(타겟·미설정 무관, no_fx 제외)
    full_total = sum(r["value_krw"] for r in rows if r["value_krw"] is not None)

    holdings_out = []
    for r in rows:
        entry = {
            "ticker": r["ticker"],
            "name": r["name"],
            "market": r["market"],
            "current_value_krw": r["value_krw"],
            "current_weight": None,
            "target_weight": None,
            "drift_pp": None,
            "suggested_trade_krw": None,
            "suggested_shares": None,
            "untargeted": r["untargeted"],
            "no_fx": r["no_fx"],
        }
        if r["value_krw"] is not None and full_total > 0:
            current_weight = r["value_krw"] / full_total * 100.0
            entry["current_weight"] = current_weight
            if not r["untargeted"]:  # 미설정 종목은 hold — 실제 비중만 표시, 제안 없음
                target_weight = float(targets[r["ticker"]])
                entry["target_weight"] = target_weight
                entry["drift_pp"] = current_weight - target_weight
                target_value_krw = full_total * target_weight / 100.0
                suggested_trade_krw = target_value_krw - r["value_krw"]
                entry["suggested_trade_krw"] = suggested_trade_krw
                trade_local = (
                    suggested_trade_krw if r["market"] == "KR" else suggested_trade_krw / fx
                )
                if r["price"]:
                    entry["suggested_shares"] = round(trade_local / r["price"])
        holdings_out.append(entry)

    untargeted_weight_sum = sum(
        e["current_weight"] for e in holdings_out
        if e["untargeted"] and e["current_weight"] is not None
    )
    summary = {
        "total_value_krw": full_total,
        "raw_target_sum": raw_target_sum,
        "untargeted_weight_sum": untargeted_weight_sum,
        # 합계 = 설정 타겟 + 미설정 종목 현재비중. 100%면 포트 전액 배분(no_fx 제외)
        "allocation_sum": raw_target_sum + untargeted_weight_sum,
        "has_untargeted": any(r["untargeted"] for r in rows),
        "has_no_fx": any(r["no_fx"] for r in rows),
    }
    return {"holdings": holdings_out, "summary": summary}
