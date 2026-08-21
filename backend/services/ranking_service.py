from __future__ import annotations
import logging
import math
import requests
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from services.db import query, get_connection

logger = logging.getLogger(__name__)

_NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json, text/plain, */*",
}
_NAVER_MARKETVALUE = "https://m.stock.naver.com/api/stocks/marketValue"
_PAGE_SIZE = 100
_TOP_N = 200

# stockEndType: "stock" = 보통주, "etf"/"etn" = ETF/ETN (둘 다 ETF로 취급)
_ETF_END_TYPES = {"etf", "etn"}


# ── 순수 변환 (유닛 테스트 대상) ──

def _parse_int(val) -> int:
    """**수량·금액 필드 전용** 정수 파싱(거래대금·거래량·시총). 실패·비유한은 0.

    0 폴백은 의도적이다(거래량 0은 '거래 없음'이라는 유효값). ⚠️ **시세(price)에는 쓰지
    말 것** — 0원 현재가는 실패를 유효 시세로 위장해 화면에 「0원」으로 렌더된다.
    가격 필드는 `_parse_price`(실패 → None)를 쓴다.

    `OverflowError`가 except에 있는 이유: `int(float("Infinity"))`는 ValueError가 아니라
    **OverflowError**를 내므로 옛 `except (ValueError, TypeError)`를 그냥 통과해 전파됐다.
    `math.isfinite`는 그 앞단에서 `nan`·`inf`를 정상 실패로 접는다."""
    try:
        v = str(val).replace(",", "").strip()
        if v in ("", "-", "N/A"):
            return 0
        f = float(v)
        return int(f) if math.isfinite(f) else 0
    except (ValueError, TypeError, OverflowError):
        return 0


def _parse_float(val) -> Optional[float]:
    """콤마/공백 제거 후 실수 파싱. 빈값·N/A·비유한은 None (등락률 등).

    비유한값을 통과시키면 `market_rankings.change_pct`(numeric)에 NaN이 영구 저장되고
    응답 직렬화에서 500이 된다(starlette `allow_nan=False`)."""
    try:
        v = str(val).replace(",", "").strip()
        if v in ("", "-", "N/A"):
            return None
        f = float(v)
        return f if math.isfinite(f) else None
    except (ValueError, TypeError):
        return None


def _parse_price(val) -> Optional[float]:
    """**시세 전용 엄격 파서** — 파싱 실패·비유한은 0이 아니라 None('wrong < missing').

    `market_investor_trend.close_price`(키움 2경로 + Naver)와 같은 규약이다. 이쪽이 더
    중요한 이유: `price`는 랭킹 카드·상세 행에 **그대로 렌더**되고(`Ranking.jsx`), 저장이
    전량 DELETE+INSERT라 직전 양호값 폴백이 없다 — 「0원」/「$0.00」이 사용자에게
    현재가로 보인다. 표시측 `fmtPrice`는 null·비유한을 '—'로 처리한다(utils.js).

    US 경로의 옛 `quote.get("regularMarketPrice") or 0`은 **`bool(nan) is True`**라 NaN을
    통과시켜 뒤이은 `int(price * volume)`가 ValueError로 US 랭킹 배치를 통째로 죽였다."""
    if val is None:
        return None
    try:
        v = str(val).replace(",", "").strip()
        if v in ("", "-", "+", "N/A"):
            return None
        f = float(v)
    except (ValueError, TypeError):
        logger.warning(f"[Ranking] 현재가 파싱 실패 (price={val!r})")
        return None
    if not math.isfinite(f):
        logger.warning(f"[Ranking] 현재가 비유한값 (price={val!r})")
        return None
    if f == 0:
        # 리터럴 0은 유효 시세가 아니다 — 파싱은 성공하므로 위 가드를 모두 통과한다.
        # **라이브 실측(probe327b, 2026-08-22)**: KOSPI 2478행 중 **54행**이
        # `closePriceRaw='0'`으로 온다(전부 거래 0인 채권형 ETF·ETN이고 같은 응답의
        # `fluctuationsRatio`도 그 0에서 파생된 `-100.00`이다). 이것을 통과시키면
        # 랭킹 카드 현재가가 「0원」으로 렌더된다. 로그는 내지 않는다 — 54행/일이면
        # 배치 로그가 오염되고, 이 값은 결측이 정상 상태이기 때문이다.
        return None
    return f


def _is_etf(stock_end_type: str) -> bool:
    return (stock_end_type or "").lower() in _ETF_END_TYPES


def _kr_row(stock: dict) -> dict:
    exch = (stock.get("stockExchangeType") or {}).get("code", "")
    _kr_price = _parse_price(stock.get("closePriceRaw"))
    return {
        "ticker": stock.get("itemCode", ""),
        "name": stock.get("stockName", ""),
        # KR 시세는 원 단위 정수. 실패는 0이 아니라 None(_parse_price 규약).
        "price": None if _kr_price is None else int(_kr_price),
        "change_pct": _parse_float(stock.get("fluctuationsRatio")),
        "trading_value": _parse_int(stock.get("accumulatedTradingValueRaw")),
        "trading_volume": _parse_int(stock.get("accumulatedTradingVolumeRaw")),
        "market_cap": _parse_int(stock.get("marketValueRaw")),
        "is_etf": _is_etf(stock.get("stockEndType")),
        "exchange": exch,
    }


def _us_row(quote: dict) -> dict:
    price = _parse_price(quote.get("regularMarketPrice"))
    volume = _parse_int(quote.get("regularMarketVolume"))
    return {
        "ticker": quote.get("symbol", ""),
        "name": quote.get("shortName") or quote.get("longName") or quote.get("symbol", ""),
        "price": price,
        "change_pct": _parse_float(quote.get("regularMarketChangePercent")),
        # 시세를 모르면 거래대금도 모른다 — 0으로 접으면 랭킹에서 「거래대금 0」이 된다.
        "trading_value": None if price is None else int(price * volume),
        "trading_volume": volume,
        "market_cap": _parse_int(quote.get("marketCap")),
        "is_etf": False,
        "exchange": "US",
    }


def _top_n_by(rows: list[dict], metric_key: str, n: int = _TOP_N) -> list[dict]:
    """metric_key 내림차순 정렬 후 상위 n개에 rank(1-base) 부여한 복사본 반환."""
    ranked = sorted(rows, key=lambda r: r.get(metric_key) or 0, reverse=True)[:n]
    return [{**r, "rank": i + 1} for i, r in enumerate(ranked)]


# ── 네트워크 fetch ──

def _fetch_naver_page(market: str, page: int) -> list[dict]:
    url = f"{_NAVER_MARKETVALUE}/{market}?page={page}&pageSize={_PAGE_SIZE}"
    r = requests.get(url, headers=_NAVER_HEADERS, timeout=15)
    r.raise_for_status()
    return r.json().get("stocks", [])


def _fetch_naver_market(market: str) -> list[dict]:
    """단일 시장(KOSPI|KOSDAQ) 전체 페이지를 병렬 fetch 후 raw stock 리스트 반환.
    한 페이지라도 실패하면 RuntimeError를 던진다 — 잘린 데이터가 정상 스냅샷을
    DELETE-덮어쓰는 것을 막기 위함(호출부 스케줄러가 catch해 replace를 건너뜀)."""
    first = requests.get(
        f"{_NAVER_MARKETVALUE}/{market}?page=1&pageSize={_PAGE_SIZE}",
        headers=_NAVER_HEADERS,
        timeout=15,
    )
    first.raise_for_status()
    body = first.json()
    total = int(body.get("totalCount", 0))
    stocks = list(body.get("stocks", []))
    pages = math.ceil(total / _PAGE_SIZE)
    if pages <= 1:
        return stocks
    failed: list[int] = []
    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = {executor.submit(_fetch_naver_page, market, p): p for p in range(2, pages + 1)}
        for future in as_completed(futures):
            try:
                stocks.extend(future.result())
            except Exception as e:
                failed.append(futures[future])
                logger.warning(f"[Ranking] {market} page {futures[future]} failed: {e}")
    if failed:
        raise RuntimeError(
            f"ranking: {market} fetch incomplete — {len(failed)} page(s) failed: {sorted(failed)}"
        )
    return stocks


# ── 공개 API ──

def get_kr_rankings(n: int = _TOP_N) -> dict:
    """KOSPI+KOSDAQ 전체를 한 번 fetch해 거래대금·거래량 상위 N 리스트 반환."""
    raw = _fetch_naver_market("KOSPI") + _fetch_naver_market("KOSDAQ")
    rows = [_kr_row(s) for s in raw]
    return {
        "value": _top_n_by(rows, "trading_value", n),
        "volume": _top_n_by(rows, "trading_volume", n),
        "change": _top_n_by(rows, "change_pct", n),
    }


def get_us_rankings(n: int = _TOP_N) -> dict:
    """yfinance most_actives 스크린에서 거래대금·거래량 상위 N 리스트 반환 (EQUITY 전용)."""
    res = yf.screen("most_actives", count=250)
    quotes = res.get("quotes", []) if isinstance(res, dict) else []
    if not quotes:
        raise RuntimeError("ranking: US fetch returned empty quotes — skipping replace")
    rows = [_us_row(q) for q in quotes]
    return {
        "value": _top_n_by(rows, "trading_value", n),
        "volume": _top_n_by(rows, "trading_volume", n),
        "change": _top_n_by(rows, "change_pct", n),
    }


# ── DB 저장/조회 (market_rankings) ──

def replace_market_rankings(market: str, rankings: dict) -> None:
    """한 시장(KR|US)의 랭킹 스냅샷을 통째 교체.
    하나의 트랜잭션에서 기존 행 삭제 후 value/volume 두 메트릭의 신규 행을 일괄 insert.
    base_ts는 write 시점으로 통일 stamp."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM market_rankings WHERE market = %s", (market,))
            for metric in ("value", "volume", "change"):
                for row in rankings.get(metric, []):
                    cur.execute(
                        """
                        INSERT INTO market_rankings
                            (market, metric, rank, ticker, name, price, change_pct,
                             trading_value, trading_volume, market_cap, is_etf, exchange, base_ts)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                        """,
                        (
                            market, metric, row["rank"], row["ticker"], row.get("name"),
                            row.get("price"), row.get("change_pct"),
                            row.get("trading_value"), row.get("trading_volume"),
                            row.get("market_cap"), row.get("is_etf"), row.get("exchange"),
                        ),
                    )


def read_rankings(
    market: str, metric: str, type_filter: str = "all",
    limit: int = 50, offset: int = 0,
) -> dict:
    """랭킹 페이지 조회. type_filter: all|stock|etf (is_etf 기준).
    반환: {"rows": [...], "base_ts": str|None}."""
    where = ["market = %s", "metric = %s"]
    params: list = [market, metric]
    if type_filter == "stock":
        where.append("is_etf = FALSE")
    elif type_filter == "etf":
        where.append("is_etf = TRUE")
    rows = query(
        f"""
        SELECT rank, ticker, name, price, change_pct, trading_value,
               trading_volume, market_cap, is_etf, exchange, base_ts
        FROM market_rankings
        WHERE {' AND '.join(where)}
        ORDER BY rank ASC
        LIMIT %s OFFSET %s
        """,
        (*params, limit, offset),
    )
    base_ts = rows[0]["base_ts"] if rows else None
    if base_ts is None:
        head = query(
            "SELECT base_ts FROM market_rankings WHERE market = %s AND metric = %s LIMIT 1",
            (market, metric),
        )
        base_ts = head[0]["base_ts"] if head else None
    return {
        "rows": rows,
        "base_ts": base_ts.isoformat() if base_ts else None,
    }
