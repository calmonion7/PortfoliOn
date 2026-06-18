import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))


# ── 팩터 픽스처 빌더 ────────────────────────────────────────
# scaffold 계약(scoring.py docstring) 구조를 따른다. 모든 키 선택적.

def _value(upside_pct=None):
    return {"upside_pct": upside_pct}


def _momentum(return_pct=None, rsi=None, near_52w_high_pct=None, volume_surge_ratio=None):
    return {
        "return_pct": return_pct,
        "rsi": rsi,
        "near_52w_high_pct": near_52w_high_pct,
        "volume_surge_ratio": volume_surge_ratio,
    }


def _smart(foreign_net_5d=None, organ_net_5d=None, insider_buy=None, guru_new_buy=None):
    return {
        "foreign_net_5d": foreign_net_5d,
        "organ_net_5d": organ_net_5d,
        "insider_buy": insider_buy,
        "guru_new_buy": guru_new_buy,
    }


def _factors(value=None, momentum=None, smart_money=None):
    out = {}
    if value is not None:
        out["value"] = value
    if momentum is not None:
        out["momentum"] = momentum
    if smart_money is not None:
        out["smart_money"] = smart_money
    return out


# ── (1) 점수 범위: 항상 0~100 ───────────────────────────────

def test_score_in_range():
    from services.recommendation.scoring import score_stock
    strong = _factors(
        value=_value(upside_pct=50.0),
        momentum=_momentum(return_pct=40.0, rsi=65.0, near_52w_high_pct=98.0,
                           volume_surge_ratio=3.0),
        smart_money=_smart(foreign_net_5d=1e9, organ_net_5d=1e9, insider_buy=True),
    )
    out = score_stock(strong)
    assert 0.0 <= out["score"] <= 100.0
    assert isinstance(out["flags"], list)

    weak = _factors(
        value=_value(upside_pct=-30.0),
        momentum=_momentum(return_pct=-40.0, rsi=20.0, near_52w_high_pct=40.0,
                           volume_surge_ratio=0.5),
        smart_money=_smart(foreign_net_5d=-1e9, organ_net_5d=-1e9, insider_buy=False),
    )
    out_weak = score_stock(weak)
    assert 0.0 <= out_weak["score"] <= 100.0


# ── (2) 정렬: 더 좋은 팩터가 더 높은 점수 ──────────────────

def test_better_factors_higher_score():
    from services.recommendation.scoring import score_stock
    strong = _factors(
        value=_value(upside_pct=50.0),
        momentum=_momentum(return_pct=40.0, rsi=62.0, near_52w_high_pct=97.0,
                           volume_surge_ratio=3.0),
        smart_money=_smart(foreign_net_5d=1e9, organ_net_5d=1e9, insider_buy=True),
    )
    weak = _factors(
        value=_value(upside_pct=-20.0),
        momentum=_momentum(return_pct=-30.0, rsi=25.0, near_52w_high_pct=50.0,
                           volume_surge_ratio=0.8),
        smart_money=_smart(foreign_net_5d=-1e9, organ_net_5d=-1e9, insider_buy=False),
    )
    assert score_stock(strong)["score"] > score_stock(weak)["score"]


# ── (3) 플래그 도출: 기여 큰 정량 항목 ─────────────────────

def test_flags_derived_from_strong_factors():
    from services.recommendation.scoring import score_stock, derive_flags
    f = _factors(
        value=_value(upside_pct=28.0),
        momentum=_momentum(return_pct=15.0, rsi=58.0, near_52w_high_pct=96.0,
                           volume_surge_ratio=3.0),
        smart_money=_smart(foreign_net_5d=5e8, organ_net_5d=2e8, insider_buy=True),
    )
    flags = derive_flags(f)
    assert flags == score_stock(f)["flags"]
    # 각 플래그는 {label, kind} 페어, kind는 팩터군 식별자
    kinds = {fl["kind"] for fl in flags}
    assert kinds <= {"value", "momentum", "smart_money", "missing"}
    for fl in flags:
        assert isinstance(fl["label"], str) and fl["label"]
    # 밸류 상승여력은 정량 문구로 노출
    assert any(fl["kind"] == "value" and "28" in fl["label"] for fl in flags)
    # 거래량 급증은 모멘텀 플래그로 노출
    assert any(fl["kind"] == "momentum" for fl in flags)
    # 스마트머니 매수 신호 노출
    assert any(fl["kind"] == "smart_money" for fl in flags)


def test_flags_no_price_color_tokens():
    from services.recommendation.scoring import derive_flags
    f = _factors(
        value=_value(upside_pct=28.0),
        momentum=_momentum(return_pct=15.0, rsi=58.0),
    )
    flags = derive_flags(f)
    # KR 가격 토큰(success/danger) 금지 — kind는 팩터군만
    for fl in flags:
        assert fl["kind"] not in ("success", "danger", "positive", "caution", "neutral")


# ── (4) 결측 graceful: 가용 팩터만으로 점수 + 결측 표시 ─────

def test_missing_group_graceful():
    from services.recommendation.scoring import score_stock
    # 밸류만 있고 모멘텀·스마트머니 결측
    only_value = _factors(value=_value(upside_pct=30.0))
    out = score_stock(only_value)
    assert 0.0 <= out["score"] <= 100.0
    # 결측 군은 결측 플래그로 표시
    assert any(fl["kind"] == "missing" for fl in out["flags"])


def test_all_missing_returns_neutral_baseline():
    from services.recommendation.scoring import score_stock
    out = score_stock({})
    assert 0.0 <= out["score"] <= 100.0
    # 전부 결측이면 결측 플래그가 도출됨
    assert any(fl["kind"] == "missing" for fl in out["flags"])


def test_partial_factor_within_group_graceful():
    from services.recommendation.scoring import score_stock
    # 모멘텀 군 일부만(rsi 없음) — 크래시 없이 가용분만
    f = _factors(
        momentum=_momentum(return_pct=10.0, volume_surge_ratio=2.0),
    )
    out = score_stock(f)
    assert 0.0 <= out["score"] <= 100.0


# ── (5) 중립 채움: 결측군을 중립(0.5)으로 채워 단일축 만점·편향 차단 ──
# (ADR-0016) 결측군을 분모에서 제외(재정규화)하던 graceful-degrade를 supersede.
# 결측군을 _NEUTRAL(0.5)로 채워 denom이 항상 1.0 → 단일군만으로는 만점 불가,
# 근거 완전성(양으로 present인 군 수)이 점수에 단조 반영된다.

def test_single_group_capped():
    """한 군만 최대 강도여도 단일축 만점 불가(≤67.5); 전군 결측은 정확히 중립 50."""
    from services.recommendation.scoring import score_stock
    # 각 군 정규점수=1.0(최대 강도), 나머지 두 군 결측
    value_only = _factors(value=_value(upside_pct=50.0))
    momentum_only = _factors(
        momentum=_momentum(return_pct=40.0, rsi=70.0, near_52w_high_pct=100.0,
                           volume_surge_ratio=3.0),
    )
    smart_only = _factors(
        smart_money=_smart(foreign_net_5d=1e9, organ_net_5d=1e9,
                           insider_buy=True, guru_new_buy=True),
    )
    # 한 군 만점 + 나머지 두 군 중립(0.5) → 가중 상한 67.5(value/momentum)·65.0(smart_money)
    assert score_stock(value_only)["score"] <= 67.5
    assert score_stock(momentum_only)["score"] <= 67.5
    assert score_stock(smart_only)["score"] <= 67.5
    # 전군 결측 → 전부 중립 → 정확히 50.0(불변)
    assert score_stock({})["score"] == 50.0


def test_completeness_monotonic():
    """모멘텀이 동일할 때, value·smart_money까지 양(+)으로 present면 점수가 더 높다."""
    from services.recommendation.scoring import score_stock
    mom = _momentum(return_pct=40.0, rsi=70.0, near_52w_high_pct=100.0,
                    volume_surge_ratio=3.0)
    momentum_only = _factors(momentum=mom)
    complete = _factors(
        value=_value(upside_pct=29.0),            # value 정규>0.5(양)
        momentum=mom,                             # 동일 모멘텀
        smart_money=_smart(foreign_net_5d=1e9, organ_net_5d=1e9,
                           insider_buy=True),     # smart_money 정규>0.5(양)
    )
    # 근거가 더 완전한 종목이 결측 종목 이상 — 결측 재정규화 만점 편향이면 역전돼 실패
    assert score_stock(complete)["score"] >= score_stock(momentum_only)["score"]


def test_momentum_only_does_not_outrank_value_momentum():
    """회귀 가드(편향 소멸): 모멘텀-only 강세가 value+momentum 종목을 추월하지 못한다."""
    from services.recommendation.scoring import score_stock
    # 모멘텀만 만점인 발굴형 종목(구 재정규화에선 100점 → 발굴 상위 점령)
    momentum_only = _factors(
        momentum=_momentum(return_pct=40.0, rsi=70.0, near_52w_high_pct=100.0,
                           volume_surge_ratio=3.0),
    )
    # value+momentum 둘 다 양호(근거가 더 완전한 종목)
    value_momentum = _factors(
        value=_value(upside_pct=45.0),
        momentum=_momentum(return_pct=25.0, rsi=60.0, near_52w_high_pct=92.0,
                           volume_surge_ratio=2.0),
    )
    assert score_stock(momentum_only)["score"] <= score_stock(value_momentum)["score"]


# ── (6) 가중치 변경 시 순위 변화 ───────────────────────────

def test_weight_change_flips_ranking():
    from services.recommendation import scoring
    # A: 밸류 강·모멘텀 약 / B: 밸류 약·모멘텀 강
    a = _factors(
        value=_value(upside_pct=50.0),
        momentum=_momentum(return_pct=-10.0, rsi=40.0, near_52w_high_pct=60.0,
                           volume_surge_ratio=1.0),
    )
    b = _factors(
        value=_value(upside_pct=-10.0),
        momentum=_momentum(return_pct=40.0, rsi=62.0, near_52w_high_pct=97.0,
                           volume_surge_ratio=3.0),
    )
    orig = dict(scoring.FACTOR_WEIGHTS)
    try:
        scoring.FACTOR_WEIGHTS = {"value": 0.9, "momentum": 0.05, "smart_money": 0.05}
        assert scoring.score_stock(a)["score"] > scoring.score_stock(b)["score"]
        scoring.FACTOR_WEIGHTS = {"value": 0.05, "momentum": 0.9, "smart_money": 0.05}
        assert scoring.score_stock(b)["score"] > scoring.score_stock(a)["score"]
    finally:
        scoring.FACTOR_WEIGHTS = orig
