"""KR 업종 모멘텀 — 키움 업종 series로 1주/1개월/3개월 수익률 산출·저장(task 48).

US 섹터(analysis_service.get_sector_momentum)와 동일 계산(_calc_return 재사용)·동형 출력
({name, return_1w/1mo/3mo})으로, kr_sector_fetch 일배치가 사전계산해 market_cache에 저장한다.
키움은 KR 읽기전용 시세 소스(경계: .forge/adr/0009 — 조회 TR만).
"""
from __future__ import annotations

import logging

import pandas as pd

from services.analysis_service import _calc_return
from services.kiwoom import sector as kw_sector
from services.market_indicators.cache import _mc_load, _mc_save
from services.parallel import parallel_map

logger = logging.getLogger(__name__)

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


def save(sectors: list[dict], index: dict[str, str]) -> None:
    """모멘텀(sectors)과 보유→업종 역인덱스(index)를 한 페이로드로 저장."""
    _mc_save(CACHE_KEY, {"sectors": sectors, "index": index})


def load_momentum() -> list[dict]:
    """저장된 KR 업종 모멘텀(sectors). 없으면 []."""
    stored = _mc_load(CACHE_KEY)
    if not stored:
        return []
    return (stored.get("data") or {}).get("sectors") or []


def load_sector_index() -> dict[str, str]:
    """저장된 보유→업종 역인덱스({종목코드: 업종명}). 없으면 {}."""
    stored = _mc_load(CACHE_KEY)
    if not stored:
        return {}
    return (stored.get("data") or {}).get("index") or {}


def _fetch_one_sector(entry: dict, empty_dts: set = None) -> dict:
    try:
        closes = kw_sector.fetch_sector_closes(entry["code"], max_items=100,
                                               empty_dts=empty_dts)
        if not closes:
            logger.warning(f"[KrSector] {entry['code']} {entry['name']}: empty closes (ka20006 빈 종가)")
        return momentum_from_closes(entry["name"], entry["code"], closes)
    except Exception as e:
        logger.warning(f"[KrSector] {entry['code']} {entry['name']}: fetch failed: {e}")
        return {"name": entry["name"], "code": entry["code"],
                "return_1w": None, "return_1mo": None, "return_3mo": None}


def compute_momentum() -> list[dict]:
    """전 KOSPI 업종 series fetch → 모멘텀 계산. 키움 client는 직렬 throttle이라
    과도한 동시성은 무의미·max_workers는 보수적으로 4(DB 풀 압박 회피).

    `empty_dts`는 **이 refresh 1회 안에서만** 공유되는 휴장 메모다 — 24개 업종이 같은
    휴일을 각각 되짚으면 재조회가 24배 중복되고, 이 함수는 `scheduler.start()`가
    **동기로** 호출하는 기동 경로라 그 중복이 그대로 기동 지연이 된다(상세는
    `kw_sector.fetch_sector_closes` docstring). 모듈 전역이 아니라 지역 변수라 날짜가
    바뀌면 자연히 사라지고 테스트 간 오염도 없다."""
    empty_dts: set = set()
    return parallel_map(lambda e: _fetch_one_sector(e, empty_dts),
                        kw_sector.KOSPI_SECTORS, max_workers=4)


def _is_all_none(s: dict) -> bool:
    return (s.get("return_1w") is None and s.get("return_1mo") is None
            and s.get("return_3mo") is None)


def refresh() -> list[dict]:
    """배치 본문: 전 업종 모멘텀 + 보유→업종 역인덱스 사전계산 → market_cache 저장.

    모든 sector 모멘텀이 None이면(ka20006 빈 종가 박제 케이스) save를 생략해
    직전 양호값을 보존한다. 일부 업종만 None인 경우(부분 페이로드 — _fetch_one_sector가
    업종별 독립 예외처리라 자연스러운 결과 형태)는 그 업종만 직전 저장값(같은 code)의
    수익률로 백필한다 — name은 이번 fetch 값을 유지. 직전값에 그 code가 없으면
    all-None 그대로 둔다(없는 값을 지어내지 않는다).

    역인덱스가 빈 경우(ka20002 전부 실패)엔 직전 index를 보존하고 sectors만 갱신한다 —
    sectors/index는 한 페이로드라 빈 index를 그대로 저장하면 보유→업종 매핑이 소멸한다."""
    sectors = compute_momentum()
    if all(_is_all_none(s) for s in sectors):
        logger.warning("[KrSector] refresh: all-None momentum — skipping save (직전값 유지)")
        return sectors
    if any(_is_all_none(s) for s in sectors):
        prev_by_code = {p.get("code"): p for p in load_momentum() if p.get("code")}
        backfilled = 0
        filled = []
        for s in sectors:
            if _is_all_none(s):
                prev = prev_by_code.get(s.get("code"))
                if prev:
                    s = {**s, "return_1w": prev.get("return_1w"),
                         "return_1mo": prev.get("return_1mo"),
                         "return_3mo": prev.get("return_3mo")}
                    backfilled += 1
            filled.append(s)
        sectors = filled
        if backfilled:
            logger.info(f"[KrSector] refresh: 업종 {backfilled}개 부분실패 → 직전값 백필")
    index = build_sector_index()
    if not index:
        index = load_sector_index()
        logger.warning("[KrSector] 역인덱스 빈 결과 — 직전 index 보존 (sectors만 갱신)")
    save(sectors, index)
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
        except Exception as e:
            logger.warning(f"[KrSector] build_sector_index {entry['code']} {entry['name']}: fetch failed: {e}")
            continue
    return idx


def map_holdings_to_sectors(holdings: list[dict]) -> dict[str, str]:
    """보유 KR 종목 → {ticker: 업종명}. 업종 미상은 키 누락(graceful, 예외 아님).

    티커가 KR 코드(접미사 제거 6자리)인 항목만 매핑 — US 등 비-KR은 무시."""
    kr = [h for h in holdings if (h.get("market") or "US") == "KR"]
    if not kr:
        return {}
    idx = load_sector_index()  # 저장 인덱스만 읽음 — 요청 경로에서 키움(ka20002) 라이브 호출 없음
    if not idx:
        return {}              # 첫 배치 전이면 graceful 빈 매핑(라이브로 메우지 않음)
    out: dict[str, str] = {}
    for h in kr:
        ticker = (h.get("ticker") or "").strip()
        code = ticker.split("_")[0].split(".")[0]  # SOR 접미사/거래소 접미사 제거
        name = idx.get(code)
        if name:
            out[ticker] = name
    return out
