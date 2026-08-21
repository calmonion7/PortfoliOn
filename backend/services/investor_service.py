from __future__ import annotations
import logging
import math
import requests
from datetime import date
from services.market import _NAVER_HEADERS, _NAVER_BASE
from services.db import execute_many, query

logger = logging.getLogger(__name__)


def _parse_signed_int(val) -> int:
    """순매수 3필드 전용 — '+5,414,215'->5414215, '-4,240,844'->-4240844, 'N/A'/'-'/''->0.

    0 폴백은 의도적이다(순매수 0은 '순매수 없음'이라는 유효값).
    ⚠️ 시세(close_price)에는 쓰지 말 것: 가격 필드는 _parse_close_price(실패 → None)."""
    if val is None:
        return 0
    s = str(val).replace(",", "").strip()
    if s in ("", "-", "N/A"):
        return 0
    try:
        return int(s)
    except ValueError:
        return 0


def _parse_close_price(val) -> int | None:
    """종가 전용 엄격 파서 — 파싱 실패는 0이 아니라 None('wrong < missing').

    ⚠️ 같은 `market_investor_trend.close_price` 컬럼에 쓰는 **형제 writer가 셋**이다:
    `services.kiwoom.investor._close_price` · `services.kiwoom.shortsell._close_price` ·
    이 함수. 이 규약(센티널 목록·0 판정·비유한 처리)을 바꾸면 **셋을 함께** 고칠 것 —
    소스별로 0과 None이 섞이면 어느 쪽이 결함인지 코드로 판정할 수 없게 된다.
    비유한값도 None — float("nan")/float("Infinity")는 ValueError를 던지지 않는다.
    리터럴 0도 None이다(소스가 결측을 "0"으로 채우는 경우 — 0원 종가는 존재하지 않는다)."""
    if val is None:
        return None
    s = str(val).replace(",", "").strip()
    if s in ("", "-", "+", "N/A"):
        return None
    try:
        f = float(s)
    except ValueError:
        logger.warning(f"[InvestorTrend] close_price 파싱 실패 (closePrice={val!r})")
        return None
    if not math.isfinite(f):
        logger.warning(f"[InvestorTrend] close_price 비유한값 (closePrice={val!r})")
        return None
    iv = abs(int(f))
    if iv == 0:
        # 리터럴 0은 유효 시세가 아니다(싱크층 `tm > 0`과 같은 판정). 형제 2곳 동일.
        logger.warning(f"[InvestorTrend] close_price 0원 — 결측 처리 (closePrice={val!r})")
        return None
    return iv


def _parse_percent(val) -> float | None:
    """퍼센트 파싱: '47.74%'->47.74, 'N/A'/'-'/''->None."""
    if val is None:
        return None
    s = str(val).replace("%", "").replace(",", "").strip()
    if s in ("", "-", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_bizdate(val) -> date | None:
    """bizdate 'YYYYMMDD'->date. 형식이 다르면 None."""
    s = str(val or "").strip()
    if len(s) != 8 or not s.isdigit():
        return None
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def _map_row(raw: dict) -> dict | None:
    base_date = _parse_bizdate(raw.get("bizdate"))
    if base_date is None:
        return None
    return {
        "base_date": base_date,
        "foreign_net": _parse_signed_int(raw.get("foreignerPureBuyQuant")),
        "organ_net": _parse_signed_int(raw.get("organPureBuyQuant")),
        "individual_net": _parse_signed_int(raw.get("individualPureBuyQuant")),
        "foreign_hold_ratio": _parse_percent(raw.get("foreignerHoldRatio")),
        "close_price": _parse_close_price(raw.get("closePrice")),
    }


def _fetch_trend_naver(ticker: str, bizdate: str | None = None) -> list[dict]:
    """Naver /trend 폴백 (기존 로직)."""
    url = f"{_NAVER_BASE}/{ticker}/trend"
    params = {"bizdate": bizdate} if bizdate else None
    r = requests.get(url, headers=_NAVER_HEADERS, params=params, timeout=8)
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, list):
        return []
    rows = [_map_row(item) for item in data]
    return [row for row in rows if row is not None]


def fetch_trend(ticker: str, bizdate: str | None = None) -> list[dict]:
    """일별 수급 행 리스트 반환 (KR 전용). 키움 우선(ka10059 순매수+ka10008 보유율),
    미설정/실패/빈 결과 시 Naver /trend 폴백 (.forge/adr/0009).

    bizdate=None  -> 최신.
    bizdate='YYYYMMDD' -> 그 날짜 이전 (후진 백필용).
    각 행: base_date(date), foreign_net/organ_net/individual_net(int, 주식 수량 —
    실패·센티널은 0, 순매수 0이 유효값), foreign_hold_ratio(float|None, %),
    close_price(int|None — 파싱 실패는 0이 아니라 None, 'wrong < missing').
    키움·Naver 두 경로 모두 같은 close_price 규약을 지킨다."""
    try:
        from services.kiwoom import investor as kinv, client as kclient
        if kclient.configured():
            rows = kinv.fetch_trend_rows(ticker, dt=bizdate)
            if rows:
                return rows
    except Exception as e:
        logger.warning(f"[InvestorTrend] 키움 fetch_trend 실패, Naver 폴백: {e}")
        pass
    return _fetch_trend_naver(ticker, bizdate)


def upsert_trend(ticker: str, rows: list[dict]) -> None:
    """파싱된 일별 행을 market_investor_trend에 멱등 적립.

    같은 (ticker, base_date) 재실행 시 DO UPDATE — 같은 날/과거일 재실행 안전."""
    sql = """
        INSERT INTO market_investor_trend
            (ticker, base_date, foreign_net, organ_net, individual_net,
             foreign_hold_ratio, close_price)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (ticker, base_date) DO UPDATE SET
            foreign_net        = EXCLUDED.foreign_net,
            organ_net          = EXCLUDED.organ_net,
            individual_net     = EXCLUDED.individual_net,
            foreign_hold_ratio = EXCLUDED.foreign_hold_ratio,
            close_price        = EXCLUDED.close_price
    """
    execute_many(sql, [
        (ticker, row["base_date"], row.get("foreign_net"), row.get("organ_net"),
         row.get("individual_net"), row.get("foreign_hold_ratio"), row.get("close_price"))
        for row in rows
    ])


def read_series(ticker: str, days: int = 252) -> list[dict]:
    """종목 수급 시계열 (추이 차트용, base_date 오름차순 최신 days일)."""
    return query("""
        SELECT base_date, foreign_net, organ_net, individual_net,
               foreign_hold_ratio, close_price
        FROM (
            SELECT base_date, foreign_net, organ_net, individual_net,
                   foreign_hold_ratio, close_price
            FROM market_investor_trend
            WHERE ticker = %s
            ORDER BY base_date DESC
            LIMIT %s
        ) t
        ORDER BY base_date ASC
    """, (ticker, days))


def read_screening(limit: int = 50, offset: int = 0) -> list[dict]:
    """KR 랭킹 universe 종목 ⨝ 각 종목 최신 base_date 행 (외국인 보유율 내림차순).

    최신일 외국인/기관/개인 순매수 + 외국인 보유율 포함. 무한스크롤용 limit/offset."""
    return query("""
        SELECT r.ticker, r.name, t.base_date,
               t.foreign_net, t.organ_net, t.individual_net,
               t.foreign_hold_ratio, t.close_price
        FROM (SELECT DISTINCT ticker, name FROM market_rankings WHERE market = 'KR') r
        JOIN LATERAL (
            SELECT base_date, foreign_net, organ_net, individual_net,
                   foreign_hold_ratio, close_price
            FROM market_investor_trend
            WHERE ticker = r.ticker
            ORDER BY base_date DESC
            LIMIT 1
        ) t ON TRUE
        ORDER BY t.foreign_hold_ratio DESC NULLS LAST, r.ticker ASC
        LIMIT %s OFFSET %s
    """, (limit, offset))


def oldest_date(ticker: str) -> date | None:
    """종목의 가장 오래된 base_date (후진 백필 커서). 데이터 없으면 None."""
    rows = query(
        "SELECT MIN(base_date) AS oldest FROM market_investor_trend WHERE ticker = %s",
        (ticker,),
    )
    return rows[0]["oldest"] if rows else None
