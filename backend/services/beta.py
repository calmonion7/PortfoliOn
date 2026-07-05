"""베타 트래킹 — 보유·관심 종목의 시장 민감도(베타) 수집·저장·조회.

소스(시장별 분기):
- US: yfinance `t.info` beta, 없으면 beta3Year 폴백(ETF 대응, 예 QQQ).
- KR: `indicators.calc_beta(종목 일수익률, ^KS11 일수익률)` — report_generator.generate_report의
      KR 베타 로직과 동일(^KS11은 yfinance, tz-strip 필수).

결측/예외는 None graceful(저장 안 함). 포트폴리오 노출 탭의 베타가중 노출은 이 저장값만 읽는다
(요청경로 라이브 계산 없음 — 배치-백킹 뷰 라이브금지 가토).
"""
from __future__ import annotations

import logging
import math

import yfinance as yf

from services import market as mkt, indicators
from services.db import execute, query

logger = logging.getLogger(__name__)


def _fin_num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


# ── US: yfinance ──────────────────────────────────────────────────────

def fetch_us_beta(ticker: str, exchange: str = "") -> "float | None":
    """US 종목 베타를 yfinance t.info에서 추출. beta 없으면 beta3Year 폴백(ETF 대응)."""
    yf_sym = mkt._yf_sym(ticker, "US", exchange)
    try:
        info = yf.Ticker(yf_sym).info or {}
    except Exception as e:
        logger.warning(f"[Beta] yfinance 조회 실패 ({ticker}): {e}")
        return None
    # beta가 정확히 0.0이면 falsy라 `or`로 대체하면 beta3Year로 조용히 치환됨(wrong<missing) → 명시적 None 체크
    b = _fin_num(info.get("beta"))
    return b if b is not None else _fin_num(info.get("beta3Year"))


# ── KR: calc_beta vs ^KS11 ────────────────────────────────────────────

def _ks11_returns():
    """^KS11 일수익률(tz-strip). 실패 시 None. fetch_all_betas가 루프 밖에서 1회만 호출해 재사용."""
    try:
        ks11_df = mkt.get_history_df("^KS11", "US", "")
        if ks11_df.empty:
            return None
        ret = ks11_df["Close"].pct_change().dropna()
        if ret.index.tz is not None:
            ret = ret.copy()
            ret.index = ret.index.tz_localize(None)
        return ret
    except Exception as e:
        logger.warning(f"[Beta] ^KS11 히스토리 조회 실패: {e}")
        return None


def fetch_kr_beta(ticker: str, exchange: str, ks11_ret) -> "float | None":
    """KR 종목 베타 = calc_beta(종목 일수익률, ^KS11 일수익률). ks11_ret 없으면 None."""
    if ks11_ret is None:
        return None
    try:
        daily_df = mkt.get_history_df(ticker, "KR", exchange, "daily", regular=True)
        if daily_df.empty:
            return None
        # 키움 실패→yfinance 폴백 시 daily_df가 tz-aware일 수 있어 ^KS11(tz-naive)과 concat TypeError→조용히 None → tz-strip
        if daily_df.index.tz is not None:
            daily_df = daily_df.copy()
            daily_df.index = daily_df.index.tz_localize(None)
        stock_ret = daily_df["Close"].pct_change().dropna()
        return indicators.calc_beta(stock_ret, ks11_ret)
    except Exception as e:
        logger.warning(f"[Beta] KR 베타 계산 실패 ({ticker}): {e}")
        return None


# ── 저장소 (stock_beta) ───────────────────────────────────────────────

def upsert_beta(ticker: str, beta: float, source: str) -> None:
    """베타 1종을 stock_beta에 ticker PK 기준 멱등 upsert."""
    execute(
        """
        INSERT INTO stock_beta (ticker, beta, source, fetched_at)
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT (ticker) DO UPDATE SET
            beta       = EXCLUDED.beta,
            source     = EXCLUDED.source,
            fetched_at = NOW()
        """,
        (ticker.upper(), beta, source),
    )


def get_beta(ticker: str) -> "float | None":
    """종목의 저장된 베타(없으면 None)."""
    rows = query("SELECT beta FROM stock_beta WHERE ticker = %s", (ticker.upper(),))
    if not rows or rows[0].get("beta") is None:
        return None
    return float(rows[0]["beta"])


# ── 배치 ──────────────────────────────────────────────────────────────

def fetch_all_betas() -> dict:
    """user_stocks ∩ tickers의 보유+관심 종목을 시장별로 분기 수집해 저장.

    KR=calc_beta vs ^KS11(1회 fetch 재사용), 그 외(US 등)=yfinance. 결측(None)은 저장 안 함."""
    rows = query(
        "SELECT DISTINCT us.ticker, t.market, t.exchange FROM user_stocks us "
        "JOIN tickers t ON us.ticker = t.ticker "
        "WHERE us.type IN ('holding', 'watchlist')"
    )
    ks11_ret = _ks11_returns() if any((r.get("market") or "US") == "KR" for r in rows) else None
    ok = 0
    failed = 0
    for r in rows:
        ticker = r["ticker"]
        market = r.get("market") or "US"
        exchange = r.get("exchange") or ""
        try:
            if market == "KR":
                beta = fetch_kr_beta(ticker, exchange, ks11_ret)
                source = "kiwoom"
            else:
                beta = fetch_us_beta(ticker, exchange)
                source = "yfinance"
            if beta is not None:
                upsert_beta(ticker, beta, source)
            ok += 1
        except Exception as e:
            failed += 1
            logger.warning(f"[Beta] fetch_all failed for {ticker}: {e}")
    logger.info(f"[Beta] fetch_all: {ok}/{len(rows)} ok, {failed} failed")
    return {"total": len(rows), "ok": ok, "failed": failed}
