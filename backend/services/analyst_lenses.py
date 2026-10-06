"""심층 리포트 v2 계산 렌즈 — 렌즈 3·4·5·8의 고정 공식·신호 규칙·바뀜 조건 (ADR 261006-232406).

루틴은 공시에서 읽은 **원자료**만 보내고, 파생 숫자·신호 색·바뀜 조건은 여기 공식이 계산해
발행 순간 박제한다(같은 상황이면 같은 색 — 신호가 판단 근거가 되려면 출처가 하나여야 한다).
변형은 [[구조 축]]이 고른다: 렌즈 3·4 = 비용 성격, 렌즈 5 = 자금 원천, 렌즈 8 민감도 표 = 수익 엔진.

계산 불가(분모 0·비유한 결과·필수 재료 부재)는 추측으로 채우지 않고 `na` + 사유(wrong < missing).
문턱은 초기값이다 — 이 파일의 상수 한 곳에서만 고치고, 테스트가 양쪽 경계를 쌍으로 묶는다.
"""
from __future__ import annotations

import logging
import math
from typing import Optional

logger = logging.getLogger(__name__)

SIGNALS = ("go", "wait", "stop", "na")
COLOR = {"go": "초록", "wait": "노랑", "stop": "빨강"}

# ── 신호 문턱 (초기값 — task#370에서 10종목 분포를 보고 조정) ───────────────
LENS3_GO = 1.0            # 기여몫(매출) 증가율 ÷ 비용 증가율 ≥ 1.0 초록
LENS3_WAIT = 0.8          # 0.8 이상 노랑, 미만 빨강
LENS4_LINKED_BAND_PP = 5.0    # 한계 분배율이 평균 분배율 ±5%p 안이면 노랑
LENS4_FIXED_GO = 1.0      # 약정 증가 배수 ÷ 매출 증가 배수 ≤ 1.0 초록
LENS4_FIXED_WAIT = 1.2    # 1.2 이하 노랑, 초과 빨강
RUNWAY_GO_YEARS = 3.0
RUNWAY_WAIT_YEARS = 1.5
BREAKEVEN_GO_PP = 2.0     # 현재 수익률 − 손익분기 금리 여유
BREAKEVEN_WAIT_PP = 1.0
COVERAGE_GO = 5.0
COVERAGE_WAIT = 2.0
LENS8_WAIT_BELOW_RF_PP = 1.5  # 이익수익률이 무위험 금리 −1.5%p 이상이면 노랑

# ── 원자료 키 (변형별 필수·선택) — 스키마 검증과 계산이 같은 표를 본다 ─────────
# kind: money = 같은 렌즈 안에서 단위가 하나여야 하는 금액, pct = 단위 "%"
_DEPOSIT_BASE = {
    "current_yield_pct": "pct", "avg_share_pct": "pct",
    "rate_sens_revenue": "money", "rate_sens_cost": "money",
    "other_revenue": "money", "operating_expense": "money",
}
INPUT_SPEC = {
    (3, "fixed"): {"revenue_prev": "money", "revenue_curr": "money",
                   "opex_prev": "money", "opex_curr": "money"},
    (3, "revenue_linked"): {"contribution_prev": "money", "contribution_curr": "money",
                            "fixed_cost_prev": "money", "fixed_cost_curr": "money"},
    (4, "fixed"): {"commitment_prev": "money", "commitment_curr": "money",
                   "revenue_prev": "money", "revenue_curr": "money"},
    (4, "revenue_linked"): {"revenue_prev": "money", "revenue_curr": "money",
                            "linked_cost_prev": "money", "linked_cost_curr": "money"},
    (5, "equity"): {"cash": "money", "annual_burn": "money"},
    (5, "deposit"): {"balance": "money", **_DEPOSIT_BASE},
    (5, "debt"): {"operating_income": "money", "interest_expense": "money"},
    (8, "base"): {"forward_earnings": "money"},
    (8, "balance_rate"): dict(_DEPOSIT_BASE),
    (8, "price_exogenous"): {"unit_cost": "money", "fixed_cost": "money"},
}
OPTIONAL_SPEC = {8: {"risk_free_pct": "pct"}}
TABLE_ENGINES = ("balance_rate", "price_exogenous")
COMPUTED_LENSES = (3, 4, 5, 8)
JUDGMENT_LENSES = (1, 2, 6, 7, 9)

# 렌즈 8 금액 단위 → 통화·배수 (시총은 스냅샷의 원 단위 금액이라 환산이 필요하다)
UNIT_SCALE = {
    "USD": ("USD", 1.0), "USD K": ("USD", 1e3), "USD M": ("USD", 1e6), "USD B": ("USD", 1e9),
    "KRW": ("KRW", 1.0), "KRW 백만": ("KRW", 1e6), "KRW 억": ("KRW", 1e8), "KRW 조": ("KRW", 1e12),
}


def variant_for(lens_id: int, structure: dict) -> str:
    """구조 축 → 렌즈 변형. structure = {축: 값} (값만)."""
    if lens_id in (3, 4):
        return structure["cost_nature"]
    if lens_id == 5:
        return structure["funding_source"]
    return structure["revenue_engine"]


def required_inputs(lens_id: int, variant: str) -> dict:
    if lens_id == 8:
        spec = dict(INPUT_SPEC[(8, "base")])
        if variant in TABLE_ENGINES:
            spec.update(INPUT_SPEC[(8, variant)])
        return spec
    return dict(INPUT_SPEC[(lens_id, variant)])


# ── 공통 ────────────────────────────────────────────────────────────────

def _finite(v) -> bool:
    return isinstance(v, (int, float)) and math.isfinite(v)


def _na(variant: str, reason: str, values: Optional[dict] = None) -> dict:
    return {"variant": variant, "values": values or {}, "signal": "na",
            "flip": None, "flip_value": None, "na_reason": reason}


def _result(variant: str, values: dict, signal: str, flip: Optional[str], flip_value) -> dict:
    vals = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in values.items()}
    if any(isinstance(v, float) and not math.isfinite(v) for v in values.values()) or \
            (flip_value is not None and not _finite(flip_value)):
        return _na(variant, "계산 결과가 유한하지 않음", {k: v for k, v in vals.items()
                                                    if not (isinstance(v, float) and not math.isfinite(v))})
    return {"variant": variant, "values": vals, "signal": signal, "flip": flip,
            "flip_value": round(flip_value, 4) if flip_value is not None else None}


def _growth_pct(prev: float, curr: float) -> Optional[float]:
    if prev <= 0:
        return None
    return (curr / prev - 1) * 100


def _fmt(v: float, nd: int = 2) -> str:
    return f"{v:,.{nd}f}"


# ── 렌즈 3: 영업 레버리지 ────────────────────────────────────────────────

def classify_lens3(ratio: float) -> str:
    if ratio >= LENS3_GO:
        return "go"
    if ratio >= LENS3_WAIT:
        return "wait"
    return "stop"


def lens3(variant: str, inp: dict) -> dict:
    """fixed: 매출 증가율 ÷ 영업비용 증가율 · revenue_linked: 기여몫 증가율 ÷ 고정비 증가율."""
    if variant == "fixed":
        num_g = _growth_pct(inp["revenue_prev"], inp["revenue_curr"])
        den_g = _growth_pct(inp["opex_prev"], inp["opex_curr"])
        num_name = "매출"
    else:
        num_g = _growth_pct(inp["contribution_prev"], inp["contribution_curr"])
        den_g = _growth_pct(inp["fixed_cost_prev"], inp["fixed_cost_curr"])
        num_name = "기여몫"
    if num_g is None or den_g is None:
        return _na(variant, "직전 기간 값이 0 이하 — 증가율 정의 불가")
    values = {"numerator_growth_pct": num_g, "cost_growth_pct": den_g, "ratio": None}
    if den_g <= 0:
        # 비용이 줄거나 그대로 — 비율은 정의되지 않고, 이익 쪽이 비용보다 덜 줄었는지만 본다
        signal = "go" if num_g >= den_g else "stop"
        text = (f"{num_name} 증가율이 비용 증가율({_fmt(den_g, 1)}%) 아래면 빨강" if signal == "go"
                else f"{num_name} 증가율이 비용 증가율({_fmt(den_g, 1)}%) 이상이면 초록")
        return _result(variant, values, signal, text, den_g)
    ratio = num_g / den_g
    values["ratio"] = ratio
    signal = classify_lens3(ratio)
    if signal == "go":
        fv = LENS3_GO * den_g
        flip = f"{num_name} 증가율이 {_fmt(fv, 1)}% 아래면 노랑"
    elif signal == "wait":
        fv = LENS3_WAIT * den_g
        flip = f"{num_name} 증가율이 {_fmt(fv, 1)}% 아래면 빨강"
    else:
        fv = LENS3_WAIT * den_g
        flip = f"{num_name} 증가율이 {_fmt(fv, 1)}% 이상이면 노랑"
    return _result(variant, values, signal, flip, fv)


# ── 렌즈 4: 비용의 매출 연동 ─────────────────────────────────────────────

def classify_lens4_linked(marginal_pct: float, average_pct: float) -> str:
    if marginal_pct < average_pct - LENS4_LINKED_BAND_PP:
        return "go"
    if marginal_pct <= average_pct + LENS4_LINKED_BAND_PP:
        return "wait"
    return "stop"


def classify_lens4_fixed(ratio: float) -> str:
    if ratio <= LENS4_FIXED_GO:
        return "go"
    if ratio <= LENS4_FIXED_WAIT:
        return "wait"
    return "stop"


def lens4(variant: str, inp: dict) -> dict:
    """fixed: 약정(연 환산) 증가 배수 ÷ 매출 증가 배수 · revenue_linked: 한계 분배율 Δ연동비용 ÷ Δ매출."""
    if variant == "fixed":
        if inp["commitment_prev"] <= 0 or inp["revenue_prev"] <= 0:
            return _na(variant, "직전 기간 값이 0 이하 — 배수 정의 불가")
        cm = inp["commitment_curr"] / inp["commitment_prev"]
        rm = inp["revenue_curr"] / inp["revenue_prev"]
        if rm <= 0:
            return _na(variant, "매출 증가 배수가 0 이하")
        ratio = cm / rm
        signal = classify_lens4_fixed(ratio)
        if signal == "go":
            fv = LENS4_FIXED_GO * rm
            text = f"약정 증가 배수가 {_fmt(fv)}배를 넘으면 노랑"
        elif signal == "wait":
            fv = LENS4_FIXED_WAIT * rm
            text = f"약정 증가 배수가 {_fmt(fv)}배를 넘으면 빨강"
        else:
            fv = LENS4_FIXED_WAIT * rm
            text = f"약정 증가 배수가 {_fmt(fv)}배 이하로 내려오면 노랑"
        return _result(variant, {"commitment_multiple": cm, "revenue_multiple": rm, "ratio": ratio},
                       signal, text, fv)
    d_rev = inp["revenue_curr"] - inp["revenue_prev"]
    d_cost = inp["linked_cost_curr"] - inp["linked_cost_prev"]
    if d_rev <= 0 or inp["revenue_curr"] <= 0:
        return _na(variant, "매출이 늘지 않은 구간 — 한계 분배율 정의 불가")
    marginal = d_cost / d_rev * 100
    average = inp["linked_cost_curr"] / inp["revenue_curr"] * 100
    signal = classify_lens4_linked(marginal, average)
    if signal == "go":
        fv = average - LENS4_LINKED_BAND_PP
        text = f"한계 분배율이 {_fmt(fv, 1)}% 이상이면 노랑"
    elif signal == "wait":
        fv = average + LENS4_LINKED_BAND_PP
        text = f"한계 분배율이 {_fmt(fv, 1)}%를 넘으면 빨강"
    else:
        fv = average + LENS4_LINKED_BAND_PP
        text = f"한계 분배율이 {_fmt(fv, 1)}% 이하로 내려오면 노랑"
    return _result(variant, {"marginal_pct": marginal, "average_pct": average}, signal, text, fv)


# ── 렌즈 5: 자금 원천 ────────────────────────────────────────────────────

def classify_runway(years: float) -> str:
    if years >= RUNWAY_GO_YEARS:
        return "go"
    if years >= RUNWAY_WAIT_YEARS:
        return "wait"
    return "stop"


def classify_breakeven_margin(pp: float) -> str:
    if pp >= BREAKEVEN_GO_PP:
        return "go"
    if pp >= BREAKEVEN_WAIT_PP:
        return "wait"
    return "stop"


def classify_coverage(x: float) -> str:
    if x >= COVERAGE_GO:
        return "go"
    if x >= COVERAGE_WAIT:
        return "wait"
    return "stop"


def deposit_profit(inp: dict, rate_pct: float, balance: float) -> float:
    """예치금형 이익 모형: 잔고×[현재수익률×평균몫 + (금리−현재수익률)×한계몫] + 기타 매출 − 영업비용.

    한계 몫 = 1 − 금리 1%p당 비용 변화 ÷ 금리 1%p당 수익 변화(Item 7A 등 공시 민감도).
    task#367 교훈: 금리 변화분에 **평균** 몫을 쓰면 손익분기가 틀린다 — 그래서 두 몫을 따로 받는다."""
    marginal = 1 - inp["rate_sens_cost"] / inp["rate_sens_revenue"]
    y = inp["current_yield_pct"]
    return (balance * (y * inp["avg_share_pct"] / 1e4 + (rate_pct - y) / 100 * marginal)
            + inp["other_revenue"] - inp["operating_expense"])


def lens5(variant: str, inp: dict) -> dict:
    """equity: 런웨이 · deposit: 손익분기 금리 여유 · debt: 이자보상."""
    if variant == "equity":
        cash, burn = inp["cash"], inp["annual_burn"]
        if burn <= 0:
            fv = cash / RUNWAY_GO_YEARS
            return _result(variant, {"runway_years": None, "profitable": True}, "go",
                           f"연 소진이 {_fmt(fv)}를 넘으면 노랑", fv)
        if cash <= 0:
            # 현금 없이 소진 중 — 런웨이는 0이고, 노랑으로 가려면 현금이 연 소진 × 1.5년치가 돼야 한다
            fv = burn * RUNWAY_WAIT_YEARS
            return _result(variant, {"runway_years": 0.0, "profitable": False}, "stop",
                           f"현금이 {_fmt(fv)} 이상이면 노랑", fv)
        runway = cash / burn
        signal = classify_runway(runway)
        if signal == "go":
            fv = cash / RUNWAY_GO_YEARS
            text = f"연 소진이 {_fmt(fv)}를 넘으면 노랑"
        else:
            fv = cash / RUNWAY_WAIT_YEARS
            text = (f"연 소진이 {_fmt(fv)}를 넘으면 빨강" if signal == "wait"
                    else f"연 소진이 {_fmt(fv)} 이하로 줄면 노랑")
        return _result(variant, {"runway_years": runway, "profitable": False}, signal, text, fv)
    if variant == "deposit":
        if inp["rate_sens_revenue"] <= 0 or inp["balance"] <= 0:
            return _na(variant, "금리 민감도 또는 잔고가 0 이하 — 손익분기 정의 불가")
        marginal = 1 - inp["rate_sens_cost"] / inp["rate_sens_revenue"]
        slope = inp["balance"] * marginal / 100          # 금리 1%p당 이익 변화
        if slope <= 0:
            return _na(variant, "금리가 올라도 이익이 늘지 않는 구조 — 손익분기 정의 불가")
        y = inp["current_yield_pct"]
        profit = deposit_profit(inp, y, inp["balance"])
        breakeven = y - profit / slope
        margin = y - breakeven
        signal = classify_breakeven_margin(margin)
        if signal == "go":
            fv = breakeven + BREAKEVEN_GO_PP
            text = f"준비금 수익률 {_fmt(fv)}% 아래면 노랑"
        elif signal == "wait":
            fv = breakeven + BREAKEVEN_WAIT_PP
            text = f"준비금 수익률 {_fmt(fv)}% 아래면 빨강"
        else:
            fv = breakeven + BREAKEVEN_WAIT_PP
            text = f"준비금 수익률 {_fmt(fv)}% 이상이면 노랑"
        return _result(variant, {"breakeven_pct": breakeven, "margin_pp": margin,
                                 "current_profit": profit, "marginal_share_pct": marginal * 100,
                                 "profit_per_pp": slope}, signal, text, fv)
    # debt
    oi, interest = inp["operating_income"], inp["interest_expense"]
    if interest <= 0:
        return _result(variant, {"coverage": None}, "go",
                       "이자비용이 생기면 이자보상 판정으로 돌아간다", None)
    coverage = oi / interest
    signal = classify_coverage(coverage)
    if signal == "go":
        fv = COVERAGE_GO * interest
        text = f"영업이익 {_fmt(fv)} 아래면 노랑"
    else:
        fv = COVERAGE_WAIT * interest
        text = (f"영업이익 {_fmt(fv)} 아래면 빨강" if signal == "wait"
                else f"영업이익 {_fmt(fv)} 이상이면 노랑")
    return _result(variant, {"coverage": coverage}, signal, text, fv)


# ── 렌즈 8: 밸류에이션 ───────────────────────────────────────────────────

def classify_lens8(earnings_yield_pct: float, risk_free_pct: float) -> str:
    if earnings_yield_pct >= risk_free_pct:
        return "go"
    if earnings_yield_pct >= risk_free_pct - LENS8_WAIT_BELOW_RF_PP:
        return "wait"
    return "stop"


def _table_earnings(engine: str, inp: dict, exo: float, endo: float) -> float:
    if engine == "balance_rate":
        return deposit_profit(inp, exo, endo)        # 외생 = 금리, 내생 = 잔고
    return endo * (exo - inp["unit_cost"]) - inp["fixed_cost"]   # 외생 = 가격, 내생 = 판매량


def lens8(engine: str, inp: dict, unit_scale: float, market_cap: float,
          risk_free_pct: Optional[float], sensitivity: Optional[dict] = None) -> dict:
    """시총 ÷ forward 이익 · 이익수익률 vs 무위험 금리. 외생 가격형은 3×3 민감도 표.

    시총은 원 단위(스냅샷), 이익은 입력 단위 → unit_scale로 환산한다."""
    fe = inp["forward_earnings"] * unit_scale
    values = {"market_cap": market_cap, "forward_earnings": inp["forward_earnings"],
              "multiple": None, "earnings_yield_pct": None, "risk_free_pct": risk_free_pct}
    if market_cap <= 0:
        return _na(engine, "시총이 0 이하")
    ey = fe / market_cap * 100
    values["earnings_yield_pct"] = ey
    if fe > 0:
        values["multiple"] = market_cap / fe
    if engine == "balance_rate" and sensitivity and inp.get("rate_sens_revenue", 0) <= 0:
        return _na(engine, "금리 1%p당 수익 변화가 0 이하 — 민감도 표 정의 불가")
    if sensitivity and engine in TABLE_ENGINES:
        rows = []
        for x in sensitivity["exogenous"]:
            row = []
            for y in sensitivity["endogenous"]:
                e = _table_earnings(engine, inp, x, y) * unit_scale
                row.append(round(market_cap / e, 2) if e > 0 and math.isfinite(market_cap / e) else None)
            rows.append(row)
        values["sensitivity"] = {"exogenous": list(sensitivity["exogenous"]),
                                 "endogenous": list(sensitivity["endogenous"]), "multiples": rows}
    if risk_free_pct is None:
        out = _na(engine, "무위험 금리 없음 — 이익수익률 비교 불가", values)
        out["values"] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in values.items()}
        return out
    signal = classify_lens8(ey, risk_free_pct)
    if signal == "go":
        pct = risk_free_pct
        text_tail = "아래면 노랑"
    elif signal == "wait":
        pct = risk_free_pct - LENS8_WAIT_BELOW_RF_PP
        text_tail = "아래면 빨강"
    else:
        pct = risk_free_pct - LENS8_WAIT_BELOW_RF_PP
        text_tail = "이상이면 노랑"
    fv = market_cap * pct / 100 / unit_scale
    return _result(engine, values, signal, f"forward 이익 {_fmt(fv)} {text_tail}", fv)


# ── 발행 조립 ────────────────────────────────────────────────────────────

def cached_risk_free_pct() -> Optional[float]:
    """서버 캐시의 미 10년 국채 금리(market_cache `treasury`). 없거나 못 읽으면 None."""
    try:
        from services.market_indicators.cache import _mc_load
        t = _mc_load("treasury") or {}
        v = ((t.get("rates") or {}).get("10y") or {}).get("current")
        v = float(v) if v is not None else None
        return v if v is not None and math.isfinite(v) else None
    except Exception as e:
        logger.warning(f"[AnalystLens] 무위험 금리 캐시 read 실패: {e}")
        return None


def self_market_cap(snapshot: dict) -> Optional[float]:
    for c in snapshot.get("competitors_data") or []:
        if c.get("is_self"):
            try:
                v = float(c.get("market_cap"))
            except (TypeError, ValueError):
                return None
            return v if math.isfinite(v) and v > 0 else None
    return None


def compute_lens(lens: dict, structure: dict, market_cap: Optional[float],
                 risk_free: Optional[tuple]) -> dict:
    """계산 렌즈 하나(본문 dict) → computed 블록. risk_free = (값, 출처) 또는 None."""
    lid = lens["id"]
    variant = variant_for(lid, structure)
    raw = lens.get("inputs") or {}
    inp = {k: v["value"] for k, v in raw.items()}
    estimate_based = any(v.get("source") == "estimate" for v in raw.values())
    if lid == 3:
        out = lens3(variant, inp)
    elif lid == 4:
        out = lens4(variant, inp)
    elif lid == 5:
        out = lens5(variant, inp)
    else:
        sens = lens.get("sensitivity")
        if sens:
            estimate_based = estimate_based or any(
                sens[a].get("source") == "estimate" for a in ("exogenous", "endogenous"))
            sens = {a: sens[a]["values"] for a in ("exogenous", "endogenous")}
        if market_cap is None:
            out = _na(variant, "스냅샷 시총 없음 — 배수 계산 불가")
        else:
            unit = raw["forward_earnings"]["unit"]
            out = lens8(variant, inp, UNIT_SCALE[unit][1], market_cap,
                        risk_free[0] if risk_free else None, sens)
            out["risk_free_source"] = risk_free[1] if risk_free else None
    out["estimate_based"] = estimate_based
    return out


def build_lens_report(structure: dict, lenses: list, snapshot: dict) -> dict:
    """검증된 v2 본문(dict) + 스냅샷 → 박제할 lens_report (lenses는 id 순, 서버 신호 포함)."""
    axes = {k: v["value"] for k, v in structure.items()}
    mcap = self_market_cap(snapshot)
    out_lenses = []
    risk_free = None
    l8 = next((l for l in lenses if l["id"] == 8), None)
    if l8 and l8.get("inputs"):
        rf_in = l8["inputs"].get("risk_free_pct")
        if rf_in is not None:
            risk_free = (rf_in["value"], "input")
        else:
            cached = cached_risk_free_pct()
            risk_free = (cached, "server_cache") if cached is not None else None
    for lens in sorted(lenses, key=lambda l: l["id"]):
        item = {k: lens.get(k) for k in ("id", "summary", "body", "metrics")}
        item["metrics"] = item["metrics"] or []
        if lens["id"] in COMPUTED_LENSES:
            item["inputs"] = lens.get("inputs")
            item["sensitivity"] = lens.get("sensitivity")
            if lens.get("na_reason"):
                item.update(signal="na", flip=None, na_reason=lens["na_reason"], computed=None)
            else:
                c = compute_lens(lens, axes, mcap, risk_free)
                item.update(signal=c["signal"], flip=c["flip"], na_reason=c.get("na_reason"),
                            computed=c)
        else:
            item.update(signal=lens["signal"], flip=lens.get("flip"), na_reason=lens.get("na_reason"))
        out_lenses.append(item)
    tally = {s: sum(1 for l in out_lenses if l["signal"] == s) for s in SIGNALS}
    return {"structure": structure, "lenses": out_lenses, "tally": tally}
