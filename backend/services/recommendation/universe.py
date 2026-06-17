"""발굴 유니버스 빌더 (.forge/adr/0015 §2 점진 유니버스).

v1 = KR 시총 상위 N(Naver 시장 스냅샷 재사용) + US S&P500(sp500_tickers.json)
   + 전 유저 추적종목(user_stocks 합집합) + US 구루 보유(dataroma) 합집합·dedup·ETF 제외.
추적종목은 항상 포함(시총 컷오프 밖이어도).

성장 다이얼(시총 상위 종목수)은 모듈 상수 KR_MARKET_CAP_TOP_N — 전체 시장으로 단계 확장.
외부 호출(Naver/dataroma)은 배치 경로에서만 — 요청·기동 경로에서 호출 금지.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# ── 성장 다이얼 (ADR-0015 §2) ──────────────────────────────
# KR 시총 상위 N — 유니버스 크기를 키우는 단일 손잡이. 후속 단계 확장.
KR_MARKET_CAP_TOP_N = 200

_SP500_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "sp500_tickers.json"


# ── 소스 fetch (배치 경로에서만 호출 — 테스트에선 mock) ──────────

def _fetch_kr_rows() -> list[dict]:
    """KOSPI+KOSDAQ 전체 종목을 ranking_service Naver 스냅샷으로 fetch해
    _kr_row 형태(ticker,name,market_cap,is_etf,...) 리스트 반환. 라이브 재호출이 아니라
    배치 경로 전용. 페이지 일부 실패 시 _fetch_naver_market가 RuntimeError를 던진다."""
    from services.ranking_service import _fetch_naver_market, _kr_row

    raw = _fetch_naver_market("KOSPI") + _fetch_naver_market("KOSDAQ")
    return [_kr_row(s) for s in raw]


def _load_sp500() -> list[str]:
    """data/sp500_tickers.json 티커 리스트."""
    with open(_SP500_PATH, encoding="utf-8") as f:
        return json.load(f)


def _fetch_tracked() -> list[dict]:
    """전 유저 보유+관심 합집합 (storage.get_global_portfolio).
    각 dict: {ticker,name,market,is_etf}."""
    from services import storage

    p = storage.get_global_portfolio()
    return p.get("stocks", []) + p.get("watchlist", [])


def _fetch_guru_tickers() -> list[str]:
    """US 구루(dataroma) 보유 티커 — 캐시된 guru_managers의 top10에서 추출."""
    from services import storage

    data = storage.get_guru_managers()
    tickers: list[str] = []
    for m in data.get("managers", []):
        for h in m.get("top10", []):
            t = (h.get("ticker") or "").strip().upper()
            if t:
                tickers.append(t)
    return tickers


# ── 순수 합집합 (유닛 테스트 대상) ──────────────────────────────

def _merge_universe(
    kr_rows: list[dict],
    sp500: list[str],
    tracked: list[dict],
    guru: list[str],
    kr_top_n: int = KR_MARKET_CAP_TOP_N,
) -> list[dict]:
    """이미 fetch된 소스들을 합집합·dedup·ETF 제외해 유니버스 리스트 반환.

    - KR: 시총 내림차순 상위 kr_top_n, ETF 제외.
    - US: sp500 + guru 티커 (market=US).
    - tracked(추적종목): ETF·시총 컷오프와 무관하게 항상 포함.
    - ticker로 dedup, 첫 출처 우선(KR→US sp500→guru→tracked 순; tracked는 누락분만 추가).
    """
    seen: dict[str, dict] = {}

    def _add(ticker: str, market: str, name: str, market_cap):
        t = (ticker or "").strip()
        if not t or t in seen:
            return
        seen[t] = {"ticker": t, "market": market, "name": name or t, "market_cap": market_cap}

    # KR 시총 상위 N (ETF 제외)
    kr_stocks = [r for r in kr_rows if not r.get("is_etf")]
    kr_stocks.sort(key=lambda r: r.get("market_cap") or 0, reverse=True)
    for r in kr_stocks[:kr_top_n]:
        _add(r.get("ticker", ""), "KR", r.get("name", ""), r.get("market_cap"))

    # US S&P500
    for t in sp500:
        _add(t, "US", "", None)

    # US 구루 보유
    for t in guru:
        _add(t, "US", "", None)

    # 추적종목 — 항상 포함(ETF·컷오프 무관, 누락분만 추가)
    for s in tracked:
        _add(s.get("ticker", ""), s.get("market") or "US", s.get("name", ""), None)

    return list(seen.values())


def build_universe() -> list[dict]:
    """발굴 유니버스를 빌드해 종목 dict 리스트로 반환.

    각 dict: {"ticker", "market", "name", "market_cap"} (market_cap은 결측 가능).
    KR 시총 상위 KR_MARKET_CAP_TOP_N + US S&P500 + 전 유저 추적종목 + US 구루 보유의
    합집합. ETF 제외. ticker로 dedup(첫 출처 우선). 추적종목은 항상 포함.

    외부 fetch(Naver/dataroma) 실패는 로깅(silent except 금지). 일부 소스가 비어도
    가용 소스만으로 유니버스를 구성한다(graceful degrade).
    """
    kr_rows: list[dict] = []
    try:
        kr_rows = _fetch_kr_rows()
    except Exception as e:
        print(f"recommendation.universe: KR fetch failed: {e}", file=sys.stderr)

    sp500: list[str] = []
    try:
        sp500 = _load_sp500()
    except Exception as e:
        print(f"recommendation.universe: sp500 load failed: {e}", file=sys.stderr)

    tracked: list[dict] = []
    try:
        tracked = _fetch_tracked()
    except Exception as e:
        print(f"recommendation.universe: tracked fetch failed: {e}", file=sys.stderr)

    guru: list[str] = []
    try:
        guru = _fetch_guru_tickers()
    except Exception as e:
        print(f"recommendation.universe: guru fetch failed: {e}", file=sys.stderr)

    return _merge_universe(kr_rows, sp500, tracked, guru)
