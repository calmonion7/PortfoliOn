"""포트폴리오 리밸런싱 계산 — 순수 함수 (DB/외부 API 호출 없음).

보유 종목별 목표 비중(targets) 대비 현재 비중 드리프트 + 목표 도달 조정금액을 계산한다.
주문 실행은 범위 밖 — 읽기전용 계산기.
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

    holdings: [{ticker, market('KR'|'US'), current_price, quantity}, ...]
    usdkrw: 저장 FX(float|None) — KR은 fx=1.0 취급
    targets: {ticker: target_weight} — 사용자가 설정한 종목만 키 존재(정규화 전 raw 값)
    """
    fx = _finite_float(usdkrw)
    raw_target_sum = sum(float(w) for w in targets.values()) if targets else 0.0
    norm_targets = (
        {t: float(w) / raw_target_sum * 100.0 for t, w in targets.items()}
        if raw_target_sum > 0
        else {}
    )

    rows = []
    for h in holdings:
        price = _finite_float(h.get("current_price"))
        qty = _finite_float(h.get("quantity"))
        if price is None or qty is None:
            continue  # 가격/수량 무효 — 계산 불가, 결과에서 제외
        ticker = h.get("ticker")
        market = h.get("market")
        no_fx = market == "US" and fx is None
        if market == "KR":
            value_krw = price * qty
        elif no_fx:
            value_krw = None
        else:
            value_krw = price * qty * fx
        rows.append({
            "ticker": ticker,
            "market": market,
            "price": price,
            "value_krw": value_krw,
            "untargeted": ticker not in targets,
            "no_fx": no_fx,
        })

    eligible = [r for r in rows if not r["untargeted"] and not r["no_fx"]]
    total_value_krw = sum(r["value_krw"] for r in eligible)

    holdings_out = []
    for r in rows:
        entry = {
            "ticker": r["ticker"],
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
        is_eligible = not r["untargeted"] and not r["no_fx"]
        if is_eligible and total_value_krw > 0:
            current_weight = r["value_krw"] / total_value_krw * 100.0
            target_weight = norm_targets.get(r["ticker"])
            entry["current_weight"] = current_weight
            if target_weight is not None:
                entry["target_weight"] = target_weight
                entry["drift_pp"] = current_weight - target_weight
                target_value_krw = total_value_krw * target_weight / 100.0
                suggested_trade_krw = target_value_krw - r["value_krw"]
                entry["suggested_trade_krw"] = suggested_trade_krw
                trade_local = (
                    suggested_trade_krw if r["market"] == "KR" else suggested_trade_krw / fx
                )
                if r["price"]:
                    entry["suggested_shares"] = round(trade_local / r["price"])
        holdings_out.append(entry)

    summary = {
        "total_value_krw": total_value_krw,
        "raw_target_sum": raw_target_sum,
        "has_untargeted": any(r["untargeted"] for r in rows),
        "has_no_fx": any(r["no_fx"] for r in rows),
    }
    return {"holdings": holdings_out, "summary": summary}
