"""배당 트래킹 — 보유·관심 종목의 연 주당배당·배당수익률 수집·저장·조회.

소스(시장별 분기):
- US: yfinance `t.info` dividendRate(연 주당배당, $)·dividendYield(%). 무배당/예외는 None graceful.
- KR: DART alotMatter.json(corp_code별, 최근 사업연도 reprt_code=11011 사업보고서).
      se '주당 현금배당금(원)'·'현금배당수익률(%)'의 보통주 thstrm(당기) 값. status≠000/'-'은 None.

정규화: {annual_dividend_per_share, dividend_yield, currency('USD'|'KRW'), source('yfinance'|'dart')}.
income(연 예상배당·매수가 대비 수익률)은 대시보드가 보유의 quantity·avg_cost로 읽기 시 계산한다.

corp_code 매핑은 backlog._get_corp_code_map 재사용(중복 다운로드 회피).
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo

import requests
import yfinance as yf

from services.backlog import _get_corp_code_map
from services.db import execute, query, get_connection

logger = logging.getLogger(__name__)

_DART_BASE = "https://opendart.fss.or.kr/api"
# 사업보고서(연간) — 배당은 연 1회 확정이므로 사업보고서 당기값을 쓴다.
_REPRT_ANNUAL = "11011"

# corp_code 매핑은 backlog 캐시를 재사용(disclosures.py와 동일 패턴).
_get_corp_code_map = _get_corp_code_map


def _dart_key() -> str:
    return os.environ.get("DART_API_KEY", "")


# ── US: yfinance ──────────────────────────────────────────────────────

def fetch_us_dividend(ticker: str, exchange: str = "") -> "dict | None":
    """US 종목 연 주당배당·배당수익률을 yfinance t.info에서 추출. 무배당/예외는 None.

    dividendRate = 연 주당배당($), dividendYield = 배당수익률(%, 현 yfinance는 퍼센트 스케일).
    배당이 없으면(dividendRate 결측) None을 반환해 저장하지 않는다(빈 박제 방지)."""
    yf_sym = ticker.replace(".", "-")
    try:
        info = yf.Ticker(yf_sym).info or {}
    except Exception as e:
        logger.warning(f"[Dividends] yfinance 조회 실패 ({ticker}): {e}")
        return None
    rate = info.get("dividendRate")
    if rate is None:
        return None
    try:
        rate = float(rate)
    except (TypeError, ValueError):
        return None
    if rate <= 0:
        return None
    yld = info.get("dividendYield")
    try:
        yld = round(float(yld), 4) if yld is not None else None
    except (TypeError, ValueError):
        yld = None
    return {
        "annual_dividend_per_share": rate,
        "dividend_yield": yld,
        "currency": "USD",
        "source": "yfinance",
    }


# ── KR: DART alotMatter ───────────────────────────────────────────────

_SE_DPS = "주당 현금배당금(원)"
_SE_YIELD = "현금배당수익률(%)"


def _num(s: str) -> "float | None":
    """alotMatter thstrm 셀 → 숫자. 콤마 제거, '-'/빈칸/비수치는 None."""
    s = (s or "").strip().replace(",", "")
    if not s or s in ("-", "—", "–"):
        return None
    if not re.fullmatch(r"-?\d+(\.\d+)?", s):
        return None
    return float(s)


def _corp_code(ticker: str) -> "str | None":
    code = ticker.upper().replace(".KS", "").replace(".KQ", "")
    return _get_corp_code_map().get(code)


def _recent_business_year() -> str:
    """최근 사업연도. 사업보고서는 보통 3월 공시되므로 1Q 동안은 전년도가 안전.

    현재 월이 4월 이전이면 전전년도, 그 외엔 전년도(작년 확정 배당)를 쓴다."""
    now = datetime.now()
    return str(now.year - (2 if now.month < 4 else 1))


def fetch_kr_dividend(ticker: str) -> "dict | None":
    """KR 종목 연 주당배당·시가배당률을 DART alotMatter에서 추출. 결측/예외는 None.

    보통주(stock_knd='보통주') '주당 현금배당금(원)'·'현금배당수익률(%)'의 당기(thstrm)값.
    corp_code 미매핑·status≠000·주당배당 결측('-')은 모두 None graceful."""
    corp_code = _corp_code(ticker)
    if not corp_code:
        return None
    try:
        resp = requests.get(
            f"{_DART_BASE}/alotMatter.json",
            params={
                "crtfc_key": _dart_key(),
                "corp_code": corp_code,
                "bsns_year": _recent_business_year(),
                "reprt_code": _REPRT_ANNUAL,
            },
            timeout=15,
        )
        data = resp.json()
    except Exception as e:
        logger.warning(f"[Dividends] alotMatter 조회 실패 ({ticker}): {e}")
        return None
    if data.get("status") != "000":
        return None

    def _common(se_name: str) -> "float | None":
        # 보통주 우선, 없으면 첫 매칭 행(우선주만 있는 종목 대비).
        rows = [it for it in data.get("list", []) if (it.get("se") or "").strip() == se_name]
        common = next((it for it in rows if (it.get("stock_knd") or "").strip() == "보통주"), None)
        chosen = common or (rows[0] if rows else None)
        return _num(chosen.get("thstrm")) if chosen else None

    dps = _common(_SE_DPS)
    if dps is None or dps <= 0:
        return None
    return {
        "annual_dividend_per_share": dps,
        "dividend_yield": _common(_SE_YIELD),
        "currency": "KRW",
        "source": "dart",
    }


# ── 저장소 (stock_dividends) ──────────────────────────────────────────

def upsert_dividend(ticker: str, d: dict) -> None:
    """배당 1종을 stock_dividends에 ticker PK 기준 멱등 upsert."""
    execute(
        """
        INSERT INTO stock_dividends
            (ticker, annual_dividend_per_share, dividend_yield, currency, source, fetched_at)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (ticker) DO UPDATE SET
            annual_dividend_per_share = EXCLUDED.annual_dividend_per_share,
            dividend_yield            = EXCLUDED.dividend_yield,
            currency                  = EXCLUDED.currency,
            source                    = EXCLUDED.source,
            fetched_at                = NOW()
        """,
        (
            ticker.upper(),
            d.get("annual_dividend_per_share"),
            d.get("dividend_yield"),
            d.get("currency"),
            d.get("source"),
        ),
    )


def get_dividend(ticker: str) -> "dict | None":
    """종목의 저장된 배당(없으면 None)."""
    rows = query(
        "SELECT annual_dividend_per_share, dividend_yield, currency, source "
        "FROM stock_dividends WHERE ticker = %s",
        (ticker.upper(),),
    )
    if not rows:
        return None
    r = dict(rows[0])
    for k in ("annual_dividend_per_share", "dividend_yield"):
        if r.get(k) is not None:
            r[k] = float(r[k])
    return r


# ── 배당 스케줄 (다가오는 배당락 예상, stock_dividend_schedule) ─────────
# t.dividends 이력에서 주기를 추론해 향후 N개월 배당락을 투영(예상). US는 t.calendar로
# 최근접 건을 확정(confirmed)+지급일 보강. KR/그 외는 전부 예상(projected). ADR-0023.

_KST = ZoneInfo("Asia/Seoul")


def _today_kst() -> date:
    """KR 시장-날짜 판정용 오늘 (컨테이너 UTC라 bare date.today() 금지 — CLAUDE.md)."""
    return datetime.now(_KST).date()


def _as_date(v) -> "date | None":
    """yfinance calendar 값(Timestamp·date·list·None)을 date로 정규화."""
    if isinstance(v, list):
        v = v[0] if v else None
    if v is None:
        return None
    if hasattr(v, "date"):
        try:
            return v.date()
        except Exception:
            return None
    return v if isinstance(v, date) else None


def _snap_interval(median_gap: int) -> int:
    """관측 중앙 간격(일)을 표준 배당주기로 스냅 — 분기91/반기182/연365, 그 외 원값."""
    if 60 <= median_gap <= 120:
        return 91
    if 150 <= median_gap <= 210:
        return 182
    if 300 <= median_gap <= 420:
        return 365
    return median_gap


def _dividend_history(sym: str) -> "list[tuple]":
    """yfinance t.dividends → [(ex_date, amount), ...] 오름차순. genuine 무배당은 [].

    ⚠️ fetch 예외는 **전파**한다(swallow 금지) — 그래야 호출측(fetch_all_dividends)이
    실패를 감지해 replace_schedule을 스킵하고 직전 양호 스케줄을 보존한다. 예외를 []로
    삼키면 replace_schedule([])가 저장 스케줄을 파괴한다(wrong<missing, task#160 #2)."""
    s = yf.Ticker(sym).dividends
    if s is None or len(s) == 0:
        return []
    out = []
    for ts, amt in s.items():
        d = _as_date(ts)
        try:
            a = float(amt)
        except (TypeError, ValueError):
            continue
        if d is not None and a > 0:
            out.append((d, a))
    out.sort(key=lambda x: x[0])
    return out


def fetch_dividend_schedule(ticker: str, market: str = "US", exchange: str = "",
                            horizon_months: int = 12) -> "list[dict]":
    """종목의 향후 배당락 스케줄(예상+US 확정)을 산출. 주기 추론 불가·무배당은 [].

    - 이력에서 최근 간격 중앙값→표준주기 스냅→마지막 배당락(또는 US 확정건) 기준 투영.
    - 예상금액 = 직전 실금액(last_amt). status: KR/그 외=projected, US 최근접=confirmed(+지급일).
    """
    from services.market.format import _yf_sym
    sym = _yf_sym(ticker, market, exchange)
    hist = _dividend_history(sym)
    if len(hist) < 2:
        return []  # 주기 추론 불가(신규 배당·무배당)

    recent = hist[-8:]
    gaps = sorted((recent[i][0] - recent[i - 1][0]).days for i in range(1, len(recent)))
    median_gap = gaps[len(gaps) // 2]
    if median_gap <= 0:
        return []
    interval = _snap_interval(median_gap)
    last_date, last_amt = recent[-1]
    currency = "KRW" if market == "KR" else "USD"
    today = _today_kst()
    horizon_end = today + timedelta(days=int(horizon_months * 30.44) + 20)

    rows: list[dict] = []
    seen: set = set()

    # US: t.calendar 확정 배당락 + 지급일 (미래·horizon 내일 때만)
    confirmed_ex = None
    if market != "KR":
        try:
            cal = yf.Ticker(sym).calendar or {}
        except Exception:
            cal = {}
        ex = _as_date(cal.get("Ex-Dividend Date"))
        pay = _as_date(cal.get("Dividend Date"))
        if ex and today <= ex <= horizon_end:
            rows.append({"ex_date": ex, "pay_date": pay, "amount_per_share": last_amt,
                         "currency": currency, "status": "confirmed", "source": "yfinance"})
            seen.add(ex)
            confirmed_ex = ex

    # 투영: anchor(확정건 또는 마지막 실제 배당락)에서 interval씩 전진, 오늘~horizon 범위만.
    d = confirmed_ex or last_date
    for _ in range(40):  # 무한루프 가드
        d = d + timedelta(days=interval)
        if d > horizon_end:
            break
        if d < today or d in seen:
            continue
        rows.append({"ex_date": d, "pay_date": None, "amount_per_share": last_amt,
                     "currency": currency, "status": "projected", "source": "yfinance"})
        seen.add(d)

    rows.sort(key=lambda r: r["ex_date"])
    return rows


def replace_schedule(ticker: str, rows: "list[dict]") -> None:
    """티커 스케줄을 **단일 트랜잭션**으로 통째 교체(delete+insert 한 커넥션 — 중단 시 전체
    rollback해 부분/빈 상태를 남기지 않음, task#160 #4). rows 비면 삭제만(genuine 무배당 정리)."""
    tk = ticker.upper()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM stock_dividend_schedule WHERE ticker = %s", (tk,))
            for r in rows:
                cur.execute(
                    """
                    INSERT INTO stock_dividend_schedule
                        (ticker, ex_date, pay_date, amount_per_share, currency, status, source, fetched_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (ticker, ex_date) DO UPDATE SET
                        pay_date         = EXCLUDED.pay_date,
                        amount_per_share = EXCLUDED.amount_per_share,
                        currency         = EXCLUDED.currency,
                        status           = EXCLUDED.status,
                        source           = EXCLUDED.source,
                        fetched_at       = NOW()
                    """,
                    (tk, r["ex_date"], r.get("pay_date"), r.get("amount_per_share"),
                     r.get("currency"), r["status"], r.get("source")),
                )


def get_schedule_batch(tickers: "list[str]") -> "list[dict]":
    """여러 티커의 오늘(KST) 이후 배당 스케줄을 ex_date 오름차순으로 반환(저장값만)."""
    if not tickers:
        return []
    ph = ",".join(["%s"] * len(tickers))
    rows = query(
        f"""
        SELECT ticker, ex_date, pay_date, amount_per_share, currency, status, source
        FROM stock_dividend_schedule
        WHERE ticker IN ({ph}) AND ex_date >= %s
        ORDER BY ex_date ASC
        """,
        (*[t.upper() for t in tickers], _today_kst()),
    )
    out = []
    for r in rows:
        d = dict(r)
        if d.get("amount_per_share") is not None:
            d["amount_per_share"] = float(d["amount_per_share"])
        for k in ("ex_date", "pay_date"):
            if d.get(k) is not None:
                d[k] = d[k].isoformat()
        out.append(d)
    return out


# ── 배치 ──────────────────────────────────────────────────────────────

def fetch_all_dividends() -> dict:
    """user_stocks ∩ tickers의 보유+관심 종목을 시장별로 분기 수집해 저장.

    연 DPS: KR=DART alotMatter, 그 외(US 등)=yfinance. 무배당/결측(None)은 저장 안 함.
    배당 스케줄(stock_dividend_schedule): 시장 불문 yfinance t.dividends 이력으로 산출·교체."""
    rows = query(
        "SELECT DISTINCT us.ticker, t.market, t.exchange FROM user_stocks us "
        "JOIN tickers t ON us.ticker = t.ticker "
        "WHERE us.type IN ('holding', 'watchlist')"
    )
    ok = 0
    failed = 0
    sched_ok = 0
    for r in rows:
        ticker = r["ticker"]
        market = r.get("market") or "US"
        exchange = r.get("exchange") or ""
        try:
            d = fetch_kr_dividend(ticker) if market == "KR" else fetch_us_dividend(ticker)
            if d is not None:
                upsert_dividend(ticker, d)
            ok += 1
        except Exception as e:
            failed += 1
            logger.warning(f"[Dividends] fetch_all failed for {ticker}: {e}")
        # 스케줄은 연 DPS와 독립 — 한쪽 실패가 다른 쪽을 막지 않게 별도 try.
        try:
            replace_schedule(ticker, fetch_dividend_schedule(ticker, market, exchange))
            sched_ok += 1
        except Exception as e:
            logger.warning(f"[Dividends] schedule failed for {ticker}: {e}")
    logger.info(f"[Dividends] fetch_all: {ok}/{len(rows)} ok, {failed} failed; schedule {sched_ok}/{len(rows)}")
    return {"total": len(rows), "ok": ok, "failed": failed, "schedule_ok": sched_ok}
