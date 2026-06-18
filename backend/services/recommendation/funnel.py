"""2단 깔때기 fetch + 점수 사전계산 배치 (.forge/adr/0015 §1 깔때기).

Stage-1(싼 시장 전체): 시총·구루 멤버십으로 후보 top-K(CANDIDATE_TOP_K) 선별.
Stage-2(후보 한정): OHLC 히스토리(market.get_history_df; KR 키움→yfinance) → 모멘텀,
  컨센서스(consensus.get_asof 목표가→상승여력), KR 후보 수급(investor_service)·지분공시
  (insider_trades, 기존 저장값 재사용, 없으면 결측), US 후보 구루 신규매수(멤버십).
  → scoring.score_stock → store.replace_recommendations.

외부 fetch 실패는 로깅(silent except 금지). 전부 None이면 save 생략(all-None 박제 금지).
요청·기동 경로 라이브 호출 0 — 이 함수는 배치(scheduler._recommendation_work)에서만 호출.

외부/DB I/O는 모듈 함수로 분리(테스트는 patch.object로 mock — universe.py와 동일 패턴).
"""
from __future__ import annotations

import math
import sys
from datetime import date

from .universe import build_universe, _fetch_guru_tickers
from .scoring import score_stock
from .store import replace_recommendations

# ── 깔때기 다이얼 (ADR-0015 §1) ────────────────────────────
# Stage-1 스크린 후 리치 enrich를 적용할 후보 상한 — 배치 비용의 주 손잡이.
CANDIDATE_TOP_K = 100

# 모멘텀 윈도 — 최근 N거래일 수익률·거래량 비교 기준.
_RETURN_WINDOW = 20

# 저유동성 필터(#68) — native 통화(USD/KRW) 일평균 거래대금 하한.
MIN_DOLLAR_VOLUME = {"US": 1_000_000, "KR": 1_000_000_000}
_LIQUIDITY_WINDOW = 20  # 거래대금 평균 윈도(거래일)


# ── Stage-1 스크린 (순수, 유닛 테스트 대상) ──────────────────

def _screen_candidates(universe: list[dict], top_k: int = CANDIDATE_TOP_K) -> list[dict]:
    """싼 시장 전체 신호(시총·구루 멤버십)로 후보 top-K 선별.

    시총 내림차순 상위 top_k + 구루 멤버(`guru_member` True)는 컷오프 밖이어도 포함.
    universe 행: {ticker, market, name, market_cap, guru_member}.
    """
    ranked = sorted(universe, key=lambda r: r.get("market_cap") or 0, reverse=True)
    top = ranked[:top_k]
    seen = {r["ticker"] for r in top}
    for r in ranked[top_k:]:
        if r.get("guru_member") and r["ticker"] not in seen:
            top.append(r)
            seen.add(r["ticker"])
    return top


# ── Stage-2 모멘텀 (순수, 유닛 테스트 대상) ──────────────────

def _momentum_factors(df) -> dict:
    """OHLCV DataFrame(과거→최신) → 모멘텀 팩터 dict.

    return_pct(최근 _RETURN_WINDOW일 종가 수익률 %), rsi(14), near_52w_high_pct
    (최근 종가/52주 고점 %), volume_surge_ratio(최근 거래량/직전 평균 배수).
    데이터 부족·결측은 해당 키 None(전부 결측이면 모두 None)."""
    out = {"return_pct": None, "rsi": None,
           "near_52w_high_pct": None, "volume_surge_ratio": None}
    try:
        if df is None or getattr(df, "empty", True) or "Close" not in df:
            return out
        closes = df["Close"].dropna()
        if len(closes) < 2:
            return out
        last = float(closes.iloc[-1])

        # 수익률 — 최근 윈도 시작가 대비
        w = min(_RETURN_WINDOW, len(closes) - 1)
        base = float(closes.iloc[-(w + 1)])
        if base:
            out["return_pct"] = round((last / base - 1.0) * 100.0, 2)

        # RSI(14)
        if len(closes) >= 15:
            from services.indicators import calc_rsi
            rsi = calc_rsi(closes)
            rv = rsi.iloc[-1]
            if rv == rv:  # NaN 제외
                out["rsi"] = round(float(rv), 2)

        # 52주 고점 근접도
        highs = df["High"].dropna() if "High" in df else closes
        hi = float(highs.tail(252).max()) if len(highs) else 0.0
        if hi:
            out["near_52w_high_pct"] = round(last / hi * 100.0, 2)

        # 거래량 급증 배수 — 최근 거래량 / 직전 20일 평균
        if "Volume" in df:
            vol = df["Volume"].dropna()
            if len(vol) >= 2:
                recent = float(vol.iloc[-1])
                prior = vol.iloc[-21:-1] if len(vol) > 1 else vol.iloc[:-1]
                avg = float(prior.mean()) if len(prior) else 0.0
                if avg:
                    out["volume_surge_ratio"] = round(recent / avg, 2)
    except Exception as e:
        print(f"recommendation.funnel: momentum compute failed: {e}", file=sys.stderr)
    return out


# ── 저유동성 측정·판정 (순수, #68) ──────────────────────────

def _avg_dollar_volume(df, window: int = _LIQUIDITY_WINDOW):
    """최근 window 행의 거래대금(Close*Volume) 평균 (native 통화).

    df None/빈/Close·Volume 결측/유효행 없음 → None.
    결과가 math.isfinite 아니면 None (NaN/Inf 가드, CLAUDE.md NaN 가토)."""
    if df is None or getattr(df, "empty", True):
        return None
    if "Close" not in df or "Volume" not in df:
        return None
    dollar = (df["Close"] * df["Volume"]).dropna()
    if not len(dollar):
        return None
    avg = float(dollar.tail(window).mean())
    return avg if math.isfinite(avg) else None


def _is_low_liquidity(df, market: str) -> bool:
    """거래대금 평균이 시장 하한 미만이면 저유동성(True).

    avg None(측정 불가) → True(discovery 제외, 'wrong<missing').
    market 미지정/미상은 US 경계 적용."""
    avg = _avg_dollar_volume(df)
    if avg is None:
        return True
    threshold = MIN_DOLLAR_VOLUME.get(market, MIN_DOLLAR_VOLUME["US"])
    return avg < threshold


# ── factors 조립 (순수) ──────────────────────────────────────

def _assemble_factors(cand: dict, *, momentum: dict, upside_pct,
                      foreign_net_5d, organ_net_5d, insider_buy, guru_new_buy) -> dict:
    """후보 + Stage-2 신호를 scoring.score_stock 입력 factors dict로 조립."""
    return {
        "value": {"upside_pct": upside_pct},
        "momentum": momentum or {"return_pct": None, "rsi": None,
                                 "near_52w_high_pct": None, "volume_surge_ratio": None},
        "smart_money": {
            "foreign_net_5d": foreign_net_5d,
            "organ_net_5d": organ_net_5d,
            "insider_buy": insider_buy,
            "guru_new_buy": guru_new_buy,
        },
    }


def _has_signal(factors: dict) -> bool:
    """점수 산출 근거가 하나라도 있는지(전부 결측이면 False — all-None 가드)."""
    v = factors.get("value") or {}
    if v.get("upside_pct") is not None:
        return True
    m = factors.get("momentum") or {}
    if any(m.get(k) is not None for k in
           ("return_pct", "rsi", "near_52w_high_pct", "volume_surge_ratio")):
        return True
    sm = factors.get("smart_money") or {}
    if any(sm.get(k) is not None for k in
           ("foreign_net_5d", "organ_net_5d", "insider_buy", "guru_new_buy")):
        return True
    return False


# ── Stage-2 외부 fetch (배치 경로 전용 — 테스트는 patch.object) ──

def _fetch_history(cand: dict):
    """후보 OHLCV 히스토리 DataFrame. KR=키움→yfinance 폴백(market.get_history_df)."""
    from services import market
    return market.get_history_df(cand["ticker"], cand.get("market") or "US")


def _consensus_upside(cand: dict, df):
    """컨센서스 목표가 대비 상승여력 % (저장 정본 daily_consensus_mart/consensus_history).

    목표가(target_mean)와 현재 종가(df 마지막 Close)로 (목표/현재-1)*100. 결측이면 None.
    df는 _fetch_history 결과 재사용(요청경로 라이브 시세 호출 없음)."""
    from services import consensus
    row = consensus.get_asof(cand["ticker"], date.today())
    if not row:
        return None
    target = row.get("target_mean")
    if target is None:
        return None
    try:
        if df is None or getattr(df, "empty", True) or "Close" not in df:
            return None
        closes = df["Close"].dropna()
        if not len(closes):
            return None
        last = float(closes.iloc[-1])
        target = float(target)
        if not last:
            return None
        return round((target / last - 1.0) * 100.0, 2)
    except (TypeError, ValueError):
        return None


def _kr_supply(cand: dict):
    """KR 후보 외인·기관 5일 순매수 (investor_service 저장 시계열, 라이브 호출 0).

    최근 5거래일 foreign_net·organ_net 합. 저장값 없으면 (None, None)."""
    from services import investor_service
    series = investor_service.read_series(cand["ticker"], days=10)
    if not series:
        return (None, None)
    recent = series[-5:]
    f = sum(int(r.get("foreign_net") or 0) for r in recent)
    o = sum(int(r.get("organ_net") or 0) for r in recent)
    return (f, o)


def _kr_insider(cand: dict):
    """KR 후보 지분공시 매수 여부 (insider_trades 저장 line item 순매수 방향).

    direction=='buy'면 True, 'sell'/'neutral'이면 False, 저장 없으면 None."""
    from services import insider_trades
    sig = insider_trades.compute_net_signal(cand["ticker"])
    if not sig or sig.get("count", 0) == 0:
        return None
    return sig.get("direction") == "buy"


# ── 배치 오케스트레이션 ──────────────────────────────────────

def _enrich_one(cand: dict, guru_set: set) -> dict | None:
    """후보 1개 Stage-2 enrich → {"factors", "low_liquidity"} dict (산출 근거 없으면 None).

    종목별 fetch 실패는 로깅 후 해당 팩터만 결측 처리(부분 결과 보존).
    low_liquidity는 fetch된 df 재사용(추가 호출 0)."""
    market = cand.get("market") or "US"

    df = None
    try:
        df = _fetch_history(cand)
    except Exception as e:
        print(f"recommendation.funnel: {cand['ticker']} history fetch failed: {e}",
              file=sys.stderr)

    momentum = _momentum_factors(df)

    upside = None
    try:
        upside = _consensus_upside(cand, df)
    except Exception as e:
        print(f"recommendation.funnel: {cand['ticker']} consensus fetch failed: {e}",
              file=sys.stderr)

    foreign_net_5d = organ_net_5d = insider_buy = None
    if market == "KR":
        try:
            foreign_net_5d, organ_net_5d = _kr_supply(cand)
        except Exception as e:
            print(f"recommendation.funnel: {cand['ticker']} supply fetch failed: {e}",
                  file=sys.stderr)
        try:
            insider_buy = _kr_insider(cand)
        except Exception as e:
            print(f"recommendation.funnel: {cand['ticker']} insider fetch failed: {e}",
                  file=sys.stderr)

    guru_new_buy = True if cand["ticker"] in guru_set else None

    factors = _assemble_factors(
        cand, momentum=momentum, upside_pct=upside,
        foreign_net_5d=foreign_net_5d, organ_net_5d=organ_net_5d,
        insider_buy=insider_buy, guru_new_buy=guru_new_buy,
    )
    if not _has_signal(factors):
        return None
    return {"factors": factors, "low_liquidity": _is_low_liquidity(df, market)}


def run_recommendation_batch(market: str) -> dict:
    """시장(KR|US) 발굴 배치 1회 실행 → 통계 dict.

    1) build_universe()에서 해당 market 종목만 추린다.
    2) Stage-1 싼 스크린으로 후보 top-K(CANDIDATE_TOP_K) 선별.
    3) Stage-2 후보 한정 리치 enrich → 팩터 dict 구성.
    4) scoring.score_stock으로 점수·플래그 산출.
    5) store.replace_recommendations(market, rows)로 통째 교체(전부 None이면 생략).

    반환 통계: {"market", "universe": int, "candidates": int, "scored": int}.
    종목별 fetch 실패는 로깅(부분 결과 저장), 전부 산출 불가면 replace 생략."""
    universe = [u for u in build_universe() if (u.get("market") or "US") == market]

    guru_set: set = set()
    if market != "KR":
        try:
            guru_set = {t for t in _fetch_guru_tickers()}
        except Exception as e:
            print(f"recommendation.funnel: guru membership fetch failed: {e}",
                  file=sys.stderr)
    for u in universe:
        u["guru_member"] = u["ticker"] in guru_set

    candidates = _screen_candidates(universe, top_k=CANDIDATE_TOP_K)

    today = date.today()
    scored: list[dict] = []
    for cand in candidates:
        res = _enrich_one(cand, guru_set)
        if res is None:
            continue
        factors = res["factors"]
        result = score_stock(factors)
        scored.append({
            "ticker": cand["ticker"],
            "market": market,
            "name": cand.get("name") or cand["ticker"],
            "score": result["score"],
            "factors": factors,
            "flags": result["flags"],
            "low_liquidity": res["low_liquidity"],
            "base_date": today,
        })

    # 점수 내림차순 rank 부여 (1-base)
    scored.sort(key=lambda r: r["score"], reverse=True)
    for i, r in enumerate(scored):
        r["rank"] = i + 1

    # 전부 산출 불가면 save 생략(all-None 박제 금지)
    if scored:
        replace_recommendations(market, scored)

    n_low = sum(1 for r in scored if r["low_liquidity"])
    print(f"recommendation.funnel: {market} scored={len(scored)} low_liquidity={n_low}",
          file=sys.stderr)

    return {
        "market": market,
        "universe": len(universe),
        "candidates": len(candidates),
        "scored": len(scored),
        "low_liquidity": n_low,
    }
