"""수급 종합 스코어 — per-종목 공매도 + 외인/기관 시계열을 합성해
우호/중립/경계 밴드와 근거 플래그를 산출하는 순수 계산 코어 (.forge/adr/0014).

- 입력은 short_sell_service.read_series / investor_service.read_series가 주는
  base_date 오름차순(과거→최신) 행 리스트.
- 판정은 "최근 5거래일 vs 직전 20거래일" 상대 비교(가중치 없음).
- 시장집계(신용/대차)는 점수에서 제외(ADR-0014).
- 저장·배치·API는 호출측(Part 1of2 S4/S5)이 담당. 여기는 DB·네트워크 무의존 순수함수.
"""
from __future__ import annotations
import json
from datetime import date
from services.db import execute, query

# ── 윈도 ─────────────────────────────────────────────
RECENT_DAYS = 5      # 최근 거래일
PRIOR_DAYS = 20      # 직전 거래일

# ── 임계 상수(상대비교) ───────────────────────────────
# 공매도 비중(short_ratio): 최근평균 / 직전평균 비율로 급증·둔화 판정
SHORT_RATIO_SURGE_RATIO = 1.5     # 급증(경계 후보): 최근이 직전의 1.5배 이상
SHORT_RATIO_STRONG_RATIO = 3.0    # 강한 단일 급증: 3배 이상 → 단독으로도 경계
SHORT_RATIO_EASE_RATIO = 0.7      # 둔화(우호 후보): 최근이 직전의 0.7배 이하
# 공매도 잔량(short_balance): 최근평균 / 직전평균 비율로 증가 판정
SHORT_BALANCE_INCREASE_RATIO = 1.2  # 증가(경계 후보): 최근이 직전의 1.2배 이상
# 외인+기관 동반 순매수/순매도: 최근 5일 vs 직전 20일 일평균 순매수의 변화(주식 수/일)
# 최근 일평균(외인+기관)이 직전 일평균보다 이 이상 변했을 때만 의미 있는 동반 흐름
INVESTOR_NET_SHIFT = 20_000         # |일평균 변화|가 이 이상이어야 의미 있는 동반 흐름(주/일)
# 외인보유율(foreign_hold_ratio): 최근평균 − 직전평균 (퍼센트포인트)
HOLD_RATIO_DROP_PP = 0.5            # 하락(경계 후보): 0.5%p 이상 하락


def _f(v) -> float | None:
    """Decimal/int/str/None → float|None (결측 graceful)."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _avg(vals) -> float | None:
    """None 제외 평균. 유효값 없으면 None."""
    nums = [x for x in (_f(v) for v in vals) if x is not None]
    if not nums:
        return None
    return sum(nums) / len(nums)


def _windows(series, field):
    """series(과거→최신)에서 (최근 RECENT_DAYS, 직전 PRIOR_DAYS) field 값 리스트 반환.
    가용 길이가 모자라면 가능한 만큼만 잘라 쓴다(짧은 시계열 graceful)."""
    vals = [row.get(field) for row in series]
    recent = vals[-RECENT_DAYS:]
    prior = vals[-(RECENT_DAYS + PRIOR_DAYS):-RECENT_DAYS]
    return recent, prior


def _last_date(series):
    """series 마지막(최신) 행의 base_date. 비면 None."""
    if not series:
        return None
    d = series[-1].get("base_date")
    return d if isinstance(d, date) else None


def compute_band(short_series, investor_series):
    """공매도 + 외인/기관 시계열 → {"band", "flags", "as_of"} 또는 None.

    short_series: short_sell_service.read_series 행 리스트(필드 short_ratio·short_balance·base_date 등).
    investor_series: investor_service.read_series 행 리스트(필드 foreign_net·organ_net·foreign_hold_ratio·base_date 등). 결측 가능.

    양쪽 다 결측이면 None(호출측이 저장 생략). 한쪽만 있으면 부분 산출 + 데이터 부족 플래그."""
    short_series = short_series or []
    investor_series = investor_series or []
    if not short_series and not investor_series:
        return None

    flags: list[str] = []
    caution_flags = 0
    favorable_flags = 0
    strong_caution = False

    # ── 공매도 신호 ──
    if short_series:
        r_ratio, p_ratio = _windows(short_series, "short_ratio")
        ra, pa = _avg(r_ratio), _avg(p_ratio)
        if ra is not None and pa is not None and pa > 0:
            if ra >= pa * SHORT_RATIO_STRONG_RATIO:
                flags.append("공매도 비중 급증")
                caution_flags += 1
                strong_caution = True
            elif ra >= pa * SHORT_RATIO_SURGE_RATIO:
                flags.append("공매도 비중 급증")
                caution_flags += 1
            elif ra <= pa * SHORT_RATIO_EASE_RATIO:
                flags.append("공매도 비중 둔화")
                favorable_flags += 1

        r_bal, p_bal = _windows(short_series, "short_balance")
        rb, pb = _avg(r_bal), _avg(p_bal)
        if rb is not None and pb is not None and pb > 0:
            if rb >= pb * SHORT_BALANCE_INCREASE_RATIO:
                flags.append("공매도 잔량 증가")
                caution_flags += 1

    # ── 외인/기관 신호 ──
    if investor_series:
        r_for, p_for = _windows(investor_series, "foreign_net")
        r_org, p_org = _windows(investor_series, "organ_net")
        # 최근/직전 윈도의 외인·기관 일평균 순매수(주식 수/일)
        r_for_a, p_for_a = _avg(r_for), _avg(p_for)
        r_org_a, p_org_a = _avg(r_org), _avg(p_org)
        if (r_for_a is not None and p_for_a is not None
                and r_org_a is not None and p_org_a is not None):
            r_combined = r_for_a + r_org_a    # 최근 일평균 합
            p_combined = p_for_a + p_org_a    # 직전 일평균 합
            shift = r_combined - p_combined   # 직전 대비 변화(상대 비교)
            # "동반": 최근 윈도에서 외인·기관이 같은 방향일 때만 동반 흐름으로 인정
            same_side_sell = r_for_a < 0 and r_org_a < 0
            same_side_buy = r_for_a > 0 and r_org_a > 0
            if same_side_sell and shift <= -INVESTOR_NET_SHIFT:
                flags.append("외인/기관 동반 순매도")
                caution_flags += 1
            elif same_side_buy and shift >= INVESTOR_NET_SHIFT:
                flags.append("외인/기관 동반 순매수")
                favorable_flags += 1

        r_hold, p_hold = _windows(investor_series, "foreign_hold_ratio")
        rh, ph = _avg(r_hold), _avg(p_hold)
        if rh is not None and ph is not None:
            if rh <= ph - HOLD_RATIO_DROP_PP:
                flags.append("외인보유율 하락")
                caution_flags += 1
    else:
        flags.append("외인/기관 데이터 부족")

    # ── 밴드 규칙(균형) ──
    if caution_flags >= 2 or strong_caution:
        band = "caution"
    elif favorable_flags >= 1 and caution_flags == 0:
        band = "favorable"
    else:
        band = "neutral"

    as_of = {
        "short_sell": _last_date(short_series),
        "investor": _last_date(investor_series),
    }
    return {"band": band, "flags": flags, "as_of": as_of}


# ── 저장·조회 (stock_supply_score, ADR-0014) ──────────────────
# 사전계산 저장, 소비처(대시보드·리포트 상세)는 저장값만 읽음(요청경로 라이브 호출 0).

def upsert_score(ticker: str, band: str, flags: list[str], as_of: dict | None) -> None:
    """수급 종합 스코어를 stock_supply_score에 멱등 upsert(ticker 충돌 시 갱신).

    computed_date는 산출 기준일(오늘). flags·as_of는 JSONB로 저장
    (as_of의 date 값은 str로 직렬화)."""
    execute(
        """
        INSERT INTO stock_supply_score (ticker, computed_date, band, flags, as_of)
        VALUES (%s, %s, %s, %s::jsonb, %s::jsonb)
        ON CONFLICT (ticker) DO UPDATE SET
            computed_date = EXCLUDED.computed_date,
            band          = EXCLUDED.band,
            flags         = EXCLUDED.flags,
            as_of         = EXCLUDED.as_of,
            created_at    = NOW()
        """,
        (
            ticker.upper(),
            date.today(),
            band,
            json.dumps(flags, ensure_ascii=False),
            json.dumps(as_of, ensure_ascii=False, default=str) if as_of is not None else None,
        ),
    )


def read_score(ticker: str) -> dict | None:
    """종목 수급 스코어 저장값 조회(저장값만 읽음). 없으면 None."""
    rows = query(
        "SELECT ticker, computed_date, band, flags, as_of FROM stock_supply_score WHERE ticker = %s",
        (ticker.upper(),),
    )
    return dict(rows[0]) if rows else None
