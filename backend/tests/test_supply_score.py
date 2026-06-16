import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date, timedelta
from decimal import Decimal


# ── 픽스처 빌더 ─────────────────────────────────────────────
# read_series는 base_date 오름차순(과거→최신) 행 리스트를 준다.
# compute_band은 "최근 5거래일 vs 직전 20거래일"을 비교하므로
# 최소 25거래일치 행이 있어야 양쪽 윈도가 채워진다.

def _dates(n):
    """과거→최신 순서의 연속 날짜 n개 (마지막이 가장 최신)."""
    base = date(2026, 6, 16)
    return [base - timedelta(days=(n - 1 - i)) for i in range(n)]


def _short_series(short_ratios, short_balances):
    """공매도 시계열 행 리스트. short_ratios/short_balances는 과거→최신 동일 길이."""
    ds = _dates(len(short_ratios))
    return [
        {"base_date": ds[i], "short_volume": 1000, "short_value": 100000,
         "short_ratio": short_ratios[i], "short_balance": short_balances[i],
         "close_price": 100}
        for i in range(len(short_ratios))
    ]


def _investor_series(foreign_nets, organ_nets, hold_ratios):
    """수급 시계열 행 리스트. 세 리스트 모두 과거→최신 동일 길이."""
    ds = _dates(len(foreign_nets))
    return [
        {"base_date": ds[i], "foreign_net": foreign_nets[i],
         "organ_net": organ_nets[i], "individual_net": 0,
         "foreign_hold_ratio": hold_ratios[i], "close_price": 100}
        for i in range(len(foreign_nets))
    ]


def _flat(value, n):
    return [value] * n


# ── (a) 명백한 경계: 공매도 비중 급증 + 외인/기관 동반 순매도 ──

def test_clear_caution():
    from services.supply_score import compute_band
    # 직전 20일 공매도 비중 ~5%, 최근 5일 ~12% (강한 급증)
    short_ratios = _flat(5.0, 20) + _flat(12.0, 5)
    short_balances = _flat(1_000_000, 20) + _flat(1_500_000, 5)  # 잔량도 증가
    short = _short_series(short_ratios, short_balances)
    # 직전 20일 순매수, 최근 5일 외인+기관 동반 대량 순매도 + 외인보유율 하락
    foreign = _flat(100_000, 20) + _flat(-500_000, 5)
    organ = _flat(50_000, 20) + _flat(-300_000, 5)
    hold = _flat(48.0, 20) + _flat(45.0, 5)
    investor = _investor_series(foreign, organ, hold)

    out = compute_band(short, investor)
    assert out["band"] == "caution"
    assert any("공매도" in f for f in out["flags"])
    assert any("순매도" in f for f in out["flags"])
    assert out["as_of"]["short_sell"] == date(2026, 6, 16)
    assert out["as_of"]["investor"] == date(2026, 6, 16)


# ── (b) 명백한 우호: 외인/기관 동반 순매수 + 공매도 비중 둔화 ──

def test_clear_favorable():
    from services.supply_score import compute_band
    # 직전 20일 공매도 비중 ~10%, 최근 5일 ~4% (둔화)
    short_ratios = _flat(10.0, 20) + _flat(4.0, 5)
    short_balances = _flat(1_000_000, 20) + _flat(950_000, 5)  # 잔량 안정/소폭감소
    short = _short_series(short_ratios, short_balances)
    # 외인+기관 동반 대량 순매수, 외인보유율 상승
    foreign = _flat(10_000, 20) + _flat(400_000, 5)
    organ = _flat(5_000, 20) + _flat(250_000, 5)
    hold = _flat(45.0, 20) + _flat(47.0, 5)
    investor = _investor_series(foreign, organ, hold)

    out = compute_band(short, investor)
    assert out["band"] == "favorable"
    assert any("순매수" in f for f in out["flags"])
    assert any("둔화" in f for f in out["flags"])


# ── (c) 중립: 의미 있는 변화 없음 ──

def test_neutral():
    from services.supply_score import compute_band
    short = _short_series(_flat(5.0, 25), _flat(1_000_000, 25))
    # 순매수/순매도 미미, 보유율 평탄
    foreign = _flat(1_000, 25)
    organ = _flat(1_000, 25)
    hold = _flat(46.0, 25)
    investor = _investor_series(foreign, organ, hold)

    out = compute_band(short, investor)
    assert out["band"] == "neutral"


# ── (d) investor 결측 — 공매도만으로 부분 산출 + 데이터 부족 플래그 ──

def test_graceful_degrade_no_investor():
    from services.supply_score import compute_band
    # 공매도 비중 급증(강한 단일, 직전의 3배 이상)만으로 경계 — 강한 단일 규칙
    short_ratios = _flat(4.0, 20) + _flat(13.0, 5)
    short = _short_series(short_ratios, _flat(1_000_000, 25))

    out = compute_band(short, [])
    assert out["band"] == "caution"
    assert any("외인/기관 데이터 부족" in f for f in out["flags"])
    assert out["as_of"]["short_sell"] == date(2026, 6, 16)
    assert out["as_of"]["investor"] is None


# ── 양쪽 결측 — 산출 불가(None) ──

def test_both_missing_returns_none():
    from services.supply_score import compute_band
    assert compute_band([], []) is None
    assert compute_band([], None) is None


# ── 단일 강한 급증만으로 경계 (잔량/수급 변화 없이도) ──

def test_strong_single_short_surge_alone_caution():
    from services.supply_score import compute_band
    short_ratios = _flat(4.0, 20) + _flat(14.0, 5)  # 3.5배 급증 = 강한 단일
    short = _short_series(short_ratios, _flat(1_000_000, 25))
    # 수급은 평탄(경계/우호 플래그 없음)
    investor = _investor_series(_flat(0, 25), _flat(0, 25), _flat(46.0, 25))

    out = compute_band(short, investor)
    assert out["band"] == "caution"


# ── Decimal 입력(DB NUMERIC) graceful ──

def test_decimal_inputs():
    from services.supply_score import compute_band
    short_ratios = [Decimal("5.0")] * 20 + [Decimal("12.0")] * 5
    short_balances = [Decimal("1000000")] * 25
    short = _short_series(short_ratios, short_balances)
    hold = [Decimal("48.0")] * 20 + [Decimal("45.0")] * 5
    investor = _investor_series(_flat(-500_000, 25), _flat(-300_000, 25), hold)

    out = compute_band(short, investor)
    assert out["band"] == "caution"


# ── 외인/기관 신호는 상대 비교(절대 합 아님) — 평탄한 꾸준 매수는 우호 아님 ──

def test_investor_flat_steady_buy_not_favorable():
    from services.supply_score import compute_band
    # 외인 50k + 기관 60k를 25일 내내 평탄하게 순매수: 최근의 '변화'가 없음.
    # 절대 합 판정이면 최근 5일 합 550k > 임계라 우호로 오판하지만,
    # 상대 비교(직전 대비 변화 0)면 동반 순매수 플래그가 켜지면 안 된다.
    short = _short_series(_flat(5.0, 25), _flat(1_000_000, 25))  # 공매도 평탄(신호 없음)
    investor = _investor_series(_flat(50_000, 25), _flat(60_000, 25), _flat(46.0, 25))

    out = compute_band(short, investor)
    assert not any("순매수" in f for f in out["flags"])
    assert out["band"] == "neutral"


# ── 외인/기관 신호는 상대 비교 — 직전 대비 매수 가속이면 우호 ──

def test_investor_accelerating_buy_favorable():
    from services.supply_score import compute_band
    # 직전 20일 소폭 순매수 → 최근 5일 대폭 가속(동반 순매수): 우호.
    short = _short_series(_flat(5.0, 25), _flat(1_000_000, 25))  # 공매도 평탄
    foreign = _flat(5_000, 20) + _flat(300_000, 5)
    organ = _flat(3_000, 20) + _flat(200_000, 5)
    investor = _investor_series(foreign, organ, _flat(46.0, 25))

    out = compute_band(short, investor)
    assert any("순매수" in f for f in out["flags"])
    assert out["band"] == "favorable"


# ── 짧은 시계열(윈도 미충족) — 가용 데이터만으로 graceful ──

def test_short_history_no_crash():
    from services.supply_score import compute_band
    # 3일치만 — 직전 20일 윈도 못 채움
    short = _short_series(_flat(5.0, 3), _flat(1_000_000, 3))
    out = compute_band(short, [])
    # 비교 불가하면 중립 + 데이터 부족 플래그(크래시 없음)
    assert out is not None
    assert out["band"] in ("neutral", "caution", "favorable")
