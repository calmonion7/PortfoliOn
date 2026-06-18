"""멀티팩터 합성 점수 + 정량 플래그 도출 (.forge/adr/0015 §3, 순수 로직).

밸류(목표가 상승여력)·모멘텀(수익률/RSI/52주고점근접/거래량급증)·스마트머니
(KR 외인·기관 순매수·지분공시 매수 / US 구루 신규매수)를 투명 가중으로 0~100 합성.
결측 팩터는 가용분만으로 점수(graceful degrade) + 결측 표시.
백엔드 LLM 호출 0 — 정량만.

플래그 색은 백엔드에서 결정하지 않는다(KR 가격 토큰 success/danger 금지) —
플래그는 {label, kind} 문자열 페어로만 내보내고 색 매핑은 프론트(part2) 담당.
DB·네트워크 무의존 순수함수.
"""
from __future__ import annotations

# ── 투명 가중치 (ADR-0015 §3) ──────────────────────────────
# 세 팩터군 합성 가중(합 1.0). 가중치 변경 시 순위가 바뀐다(테스트가 단언).
FACTOR_WEIGHTS = {
    "value": 0.35,
    "momentum": 0.35,
    "smart_money": 0.30,
}

# 전부 결측이거나 군 내부 신호가 없을 때의 중립 기준(0~1).
_NEUTRAL = 0.5


def _isnum(x) -> bool:
    """None/비숫자/NaN 거름."""
    if x is None or isinstance(x, bool):
        return False
    try:
        v = float(x)
    except (TypeError, ValueError):
        return False
    return v == v  # NaN 제외


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)


def _norm_linear(x: float, lo: float, hi: float) -> float:
    """[lo, hi] 구간을 [0, 1]로 선형 정규화(범위 밖은 클램프)."""
    if hi == lo:
        return _NEUTRAL
    return _clamp01((x - lo) / (hi - lo))


# ── 팩터군별 정규 점수(0~1) — 가용 신호만 평균, 신호 없으면 None ──

def _value_score(g: dict):
    """밸류: 목표가 상승여력. -20% → 0, +50% → 1."""
    up = g.get("upside_pct")
    if not _isnum(up):
        return None
    return _norm_linear(float(up), -20.0, 50.0)


def _momentum_score(g: dict):
    """모멘텀: 수익률·RSI·52주고점근접·거래량급증의 가용 평균(0~1)."""
    parts = []
    rp = g.get("return_pct")
    if _isnum(rp):
        parts.append(_norm_linear(float(rp), -30.0, 40.0))
    rsi = g.get("rsi")
    if _isnum(rsi):
        # 과열(>80)·침체(<30)는 감점, 50~70 구간이 양호.
        r = float(rsi)
        if r <= 50.0:
            parts.append(_norm_linear(r, 30.0, 50.0) * 0.6)
        elif r <= 70.0:
            parts.append(0.6 + _norm_linear(r, 50.0, 70.0) * 0.4)
        else:
            parts.append(_clamp01(1.0 - _norm_linear(r, 70.0, 90.0)))
    near = g.get("near_52w_high_pct")
    if _isnum(near):
        parts.append(_norm_linear(float(near), 60.0, 100.0))
    vol = g.get("volume_surge_ratio")
    if _isnum(vol):
        parts.append(_norm_linear(float(vol), 1.0, 3.0))
    if not parts:
        return None
    return sum(parts) / len(parts)


def _smart_money_score(g: dict):
    """스마트머니: KR 외인/기관 5일 순매수·지분공시 매수 / US 구루 신규매수.

    순매수 부호(+1 매수/-1 매도)와 불리언 매수 신호를 0~1로 합성.
    """
    parts = []
    for key in ("foreign_net_5d", "organ_net_5d"):
        v = g.get(key)
        if _isnum(v):
            fv = float(v)
            parts.append(1.0 if fv > 0 else (0.0 if fv < 0 else _NEUTRAL))
    for key in ("insider_buy", "guru_new_buy"):
        b = g.get(key)
        if isinstance(b, bool):
            parts.append(1.0 if b else 0.0)
    if not parts:
        return None
    return sum(parts) / len(parts)


_GROUP_SCORERS = {
    "value": _value_score,
    "momentum": _momentum_score,
    "smart_money": _smart_money_score,
}


def score_stock(factors: dict) -> dict:
    """팩터 dict → {"score": 0~100 float, "flags": list[{"label", "kind"}]}.

    factors 구조(모든 키 선택적 — 결측 graceful):
        {
          "value":       {"upside_pct": float|None},                 # 목표가 상승여력 %
          "momentum":    {"return_pct": float|None, "rsi": float|None,
                          "near_52w_high_pct": float|None,            # 52주 고점 근접도 %
                          "volume_surge_ratio": float|None},          # 평소 대비 거래량 배수
          "smart_money": {"foreign_net_5d": float|None,               # KR 외인 5일 순매수
                          "organ_net_5d": float|None,                 # KR 기관 5일 순매수
                          "insider_buy": bool|None,                   # KR 지분공시 매수
                          "guru_new_buy": bool|None},                 # US 구루 신규매수
        }

    가용 팩터군만으로 가중 합성(결측군은 가중에서 제외·재정규화)하고, 기여 큰 항목을
    derive_flags로 정량 플래그(예: {"label": "목표가 대비 +28%", "kind": "value"})로 낸다.
    """
    factors = factors or {}
    num, denom = 0.0, 0.0
    for group, scorer in _GROUP_SCORERS.items():
        g = factors.get(group)
        s = scorer(g) if isinstance(g, dict) else None
        if s is None:
            # 결측군은 중립(0.5)으로 채운다(ADR-0016) — 재정규화로 분모에서 빼면
            # 단일 가용군만으로 만점에 도달해 모멘텀-only 발굴 종목이 상위를 점령한다.
            # 중립 채움이면 denom이 항상 전 가중치 합(1.0)이라 근거 완전성이 점수에 반영.
            s = _NEUTRAL
        w = FACTOR_WEIGHTS.get(group, 0.0)
        num += s * w
        denom += w
    # denom은 항상 1.0(가중치 전합)이라 else 분기는 dead지만 무해하게 잔존.
    composite = (num / denom) if denom > 0 else _NEUTRAL
    return {
        "score": round(_clamp01(composite) * 100.0, 1),
        "flags": derive_flags(factors),
    }


def derive_flags(factors: dict) -> list[dict]:
    """팩터 dict에서 기여 큰 항목을 정량 플래그 리스트로 도출.

    각 플래그: {"label": str(정량 문구), "kind": str(팩터군 식별자)}.
    kind는 색이 아니라 팩터 분류("value"|"momentum"|"smart_money"|"missing" 등) —
    가격 토큰(success/danger) 미사용. 결측은 결측 플래그로 표시(graceful degrade).
    """
    factors = factors or {}
    flags: list[dict] = []

    # ── 밸류: 목표가 상승여력 ──
    v = factors.get("value")
    if isinstance(v, dict) and _isnum(v.get("upside_pct")):
        up = float(v["upside_pct"])
        if up >= 10.0:
            flags.append({"label": f"목표가 대비 {up:+.0f}%", "kind": "value"})
    else:
        flags.append({"label": "목표가 데이터 부족", "kind": "missing"})

    # ── 모멘텀: 수익률·52주고점근접·거래량급증 ──
    m = factors.get("momentum")
    if isinstance(m, dict) and _momentum_score(m) is not None:
        rp = m.get("return_pct")
        if _isnum(rp) and float(rp) >= 15.0:
            flags.append({"label": f"수익률 {float(rp):+.0f}%", "kind": "momentum"})
        near = m.get("near_52w_high_pct")
        if _isnum(near) and float(near) >= 95.0:
            flags.append({"label": "52주 고점 근접", "kind": "momentum"})
        vol = m.get("volume_surge_ratio")
        if _isnum(vol) and float(vol) >= 2.0:
            flags.append({"label": f"거래량 {float(vol):.1f}배", "kind": "momentum"})
    else:
        flags.append({"label": "모멘텀 데이터 부족", "kind": "missing"})

    # ── 스마트머니: 외인/기관 순매수·지분공시·구루 매수 ──
    sm = factors.get("smart_money")
    if isinstance(sm, dict) and _smart_money_score(sm) is not None:
        if _isnum(sm.get("foreign_net_5d")) and float(sm["foreign_net_5d"]) > 0:
            flags.append({"label": "외인 5일 순매수", "kind": "smart_money"})
        if _isnum(sm.get("organ_net_5d")) and float(sm["organ_net_5d"]) > 0:
            flags.append({"label": "기관 5일 순매수", "kind": "smart_money"})
        if sm.get("insider_buy") is True:
            flags.append({"label": "내부자 지분 매수", "kind": "smart_money"})
        if sm.get("guru_new_buy") is True:
            flags.append({"label": "구루 신규 매수", "kind": "smart_money"})
    else:
        flags.append({"label": "수급 데이터 부족", "kind": "missing"})

    return flags
