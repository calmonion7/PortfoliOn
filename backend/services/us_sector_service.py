"""US 섹터 모멘텀 — yfinance ETF series로 1주/1개월/3개월 수익률 산출·저장.

KR 업종(kr_sector_service)과 동일 계산·동형 출력({name, etf, return_1w/1mo/3mo})으로,
us_sector_fetch 일배치가 사전계산해 market_cache에 저장한다.
analysis_service.get_sector_momentum(market="US") 요청경로는 후속 슬라이스 소관.
"""
from __future__ import annotations

from services.market_indicators.cache import _mc_load, _mc_save
from services.parallel import parallel_map

CACHE_KEY = "us_sector_momentum"


def refresh() -> list[dict]:
    """배치 본문: 전 US 섹터 ETF 모멘텀 사전계산 → market_cache 저장.

    모든 섹터 모멘텀이 None이면(yfinance 장애 케이스) save를 생략해
    직전 양호값을 보존한다."""
    # eco: 지연 import — 후속 슬라이스에서 analysis_service가 us_sector_service를
    # import하게 되므로 여기서 top-level import하면 순환참조
    from services.analysis_service import SECTOR_ETFS, _fetch_etf

    sectors = parallel_map(_fetch_etf, SECTOR_ETFS, max_workers=11)
    if all(s.get("return_1w") is None and s.get("return_1mo") is None
           and s.get("return_3mo") is None for s in sectors):
        print("[us_sector] refresh: all-None momentum — skipping save (직전값 유지)")
        return sectors
    _mc_save(CACHE_KEY, {"sectors": sectors})
    return sectors


def load_momentum() -> list[dict]:
    """저장된 US 섹터 모멘텀(sectors). 없으면 []."""
    stored = _mc_load(CACHE_KEY)
    if not stored:
        return []
    return (stored.get("data") or {}).get("sectors") or []
