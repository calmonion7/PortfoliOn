"""KR 업종 모멘텀 — 키움 업종 series로 1주/1개월/3개월 수익률 산출·저장(task 48).

US 섹터(analysis_service.get_sector_momentum)와 동일 계산(_calc_return 재사용)·동형 출력
({name, return_1w/1mo/3mo})으로, kr_sector_fetch 일배치가 사전계산해 market_cache에 저장한다.
키움은 KR 읽기전용 시세 소스(경계: .forge/adr/0009 — 조회 TR만).
"""
from __future__ import annotations

import pandas as pd

from services.analysis_service import _calc_return
from services.kiwoom import sector as kw_sector
from services.market_indicators.cache import _mc_load, _mc_save
from services.parallel import parallel_map

CACHE_KEY = "kr_sector_momentum"


def momentum_from_closes(name: str, code: str, closes: list[float]) -> dict:
    """업종 종가 series(과거→현재) → US와 동일 계산의 모멘텀 dict."""
    series = pd.Series(closes)
    return {
        "name": name,
        "code": code,
        "return_1w": _calc_return(series, 5),
        "return_1mo": _calc_return(series, 21),
        "return_3mo": _calc_return(series, 63),
    }


def save_momentum(sectors: list[dict]) -> None:
    _mc_save(CACHE_KEY, {"sectors": sectors})


def load_momentum() -> list[dict]:
    """저장된 KR 업종 모멘텀(sectors). 없으면 []."""
    stored = _mc_load(CACHE_KEY)
    if not stored:
        return []
    return (stored.get("data") or {}).get("sectors") or []


def _fetch_one_sector(entry: dict) -> dict:
    try:
        closes = kw_sector.fetch_sector_closes(entry["code"], max_items=100)
        return momentum_from_closes(entry["name"], entry["code"], closes)
    except Exception:
        return {"name": entry["name"], "code": entry["code"],
                "return_1w": None, "return_1mo": None, "return_3mo": None}


def compute_momentum() -> list[dict]:
    """전 KOSPI 업종 series fetch → 모멘텀 계산. 키움 client는 직렬 throttle이라
    과도한 동시성은 무의미·max_workers는 보수적으로 4(DB 풀 압박 회피)."""
    return parallel_map(_fetch_one_sector, kw_sector.KOSPI_SECTORS, max_workers=4)


def refresh() -> list[dict]:
    """배치 본문: 전 업종 모멘텀 계산 → market_cache 저장. 저장한 sectors 반환."""
    sectors = compute_momentum()
    save_momentum(sectors)
    return sectors


# ── 보유종목 → KRX 업종 매핑 ──────────────────────────────────────────────────
# ka10001엔 업종 필드가 없어(라이브 프로브 확인), ka20002(업종별주가) 역인덱스로 매핑한다.
def build_sector_index() -> dict[str, str]:
    """{6자리 종목코드: KOSPI 업종명}. 업종별 종목 fetch가 일부 실패해도 나머지는 매핑(graceful)."""
    idx: dict[str, str] = {}
    for entry in kw_sector.KOSPI_SECTORS:
        try:
            for code in kw_sector.fetch_sector_stocks(entry["code"]):
                idx.setdefault(code, entry["name"])
        except Exception:
            continue
    return idx


def map_holdings_to_sectors(holdings: list[dict]) -> dict[str, str]:
    """보유 KR 종목 → {ticker: 업종명}. 업종 미상은 키 누락(graceful, 예외 아님).

    티커가 KR 코드(접미사 제거 6자리)인 항목만 매핑 — US 등 비-KR은 무시."""
    kr = [h for h in holdings if (h.get("market") or "US") == "KR"]
    if not kr:
        return {}
    try:
        idx = build_sector_index()
    except Exception:
        return {}
    out: dict[str, str] = {}
    for h in kr:
        ticker = (h.get("ticker") or "").strip()
        code = ticker.split("_")[0].split(".")[0]  # SOR 접미사/거래소 접미사 제거
        name = idx.get(code)
        if name:
            out[ticker] = name
    return out
