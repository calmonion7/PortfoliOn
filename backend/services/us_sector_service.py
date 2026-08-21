"""US 섹터 모멘텀 — yfinance ETF series로 1주/1개월/3개월 수익률 산출·저장.

KR 업종(kr_sector_service)과 동일 계산·동형 출력({name, etf, return_1w/1mo/3mo})으로,
us_sector_fetch 일배치가 사전계산해 market_cache에 저장한다.
analysis_service.get_sector_momentum(market="US") 요청경로는 후속 슬라이스 소관.
"""
from __future__ import annotations

import logging

from services.market_indicators.cache import _mc_load, _mc_load_strict, _mc_save
from services.parallel import parallel_map

logger = logging.getLogger(__name__)

CACHE_KEY = "us_sector_momentum"


def _is_all_none(s: dict) -> bool:
    return (s.get("return_1w") is None and s.get("return_1mo") is None
            and s.get("return_3mo") is None)


def save_was_skipped(sectors: list) -> bool:
    """`refresh()`의 반환값만 보고 「저장을 생략했는가」를 판정한다.

    `refresh()`는 반환 타입이 `list[dict]`라(호출부 3곳 탓에 바꾸지 않는다) 저장 여부를
    반환값에 실을 수 없다. 그래서 두 레인(`scheduler/jobs._fetch_us_sector` ·
    `routers/analysis.refresh_us_sector`)이 같은 판정을 해야 하는데, 각자 인라인으로 쓰면
    한쪽만 어긋난다 — 아래 `refresh()`의 조기 return 조건과 **글자 그대로 같은** 식을 여기 둔다
    (빈 리스트도 그 조건에 걸린다: `all(...)` over `[]`는 True다)."""
    return all(_is_all_none(s) for s in sectors)


def refresh() -> list[dict]:
    """배치 본문: 전 US 섹터 ETF 모멘텀 사전계산 → market_cache 저장.

    모든 섹터 모멘텀이 None이면(yfinance 장애 케이스) save를 생략해 직전 양호값을 보존한다.
    일부 ETF만 all-None인 경우(부분 페이로드 — _fetch_etf가 ETF별 독립 예외처리라 자연스러운
    결과 형태)는 그 ETF만 직전 저장값(같은 etf)의 수익률로 백필한다 — name은 이번 fetch 값을
    유지. 직전값에 그 etf가 없으면 all-None 그대로 둔다(없는 값을 지어내지 않는다).
    ETF 11종은 서로 합산되지 않는 **독립 항목**이라 완전성 요구·커버리지 임계가 아니라
    실패분 개별 백필이 맞는 처방이다(형제 kr_sector_service.refresh 미러 — 단 매칭 키는
    KR의 `code`가 아니라 `etf`).

    ⚠️ 전량실패 판정은 백필 **앞**이고 판정 대상은 백필 후 값이 아니라 raw fetch 결과다
    (BH7-L1). 뒤에 두면 정상 운영 중엔 직전값이 차 있어 백필이 전 심볼을 채우므로 이 분기가
    영영 발동하지 않고, 경고 없이 _mc_save가 돌아 fetched_at만 갱신된다.

    저장 페이로드는 `sectors` 단일 필드다 — 보유→섹터 매핑은 analysis_service가 요청 시
    holdings의 자기 sector 필드로 만들므로, KR의 `index`처럼 함께 저장되는 필드가 없다
    (KR이 sectors만 보고 같은 페이로드의 index를 지운 전례가 여기엔 해당하지 않는다)."""
    # eco: 지연 import — 후속 슬라이스에서 analysis_service가 us_sector_service를
    # import하게 되므로 여기서 top-level import하면 순환참조
    from services.analysis_service import SECTOR_ETFS, _fetch_etf

    sectors = parallel_map(_fetch_etf, SECTOR_ETFS, max_workers=11)
    if save_was_skipped(sectors):  # 이 조건이 곧 `save_was_skipped`의 정의다(두 레인이 공유)
        logger.warning("[UsSector] refresh: all-None momentum — skipping save (직전값 유지)")
        return sectors
    if any(_is_all_none(s) for s in sectors):
        # ⚠️ **엄격 로더**로 읽는다. 관용 `load_momentum()`은 조회 예외를 warning 후 []로 접어
        # 「직전값 없음」과 구별되지 않는데, 그 상태로 진행하면 백필이 0건이 되고 아래 `_mc_save`가
        # 실패한 ETF를 all-None으로 **저장**한다(fail-open destructive — 어제 수익률이 영구 소실).
        # 예외를 전파하면 `_mc_save`에 도달하지 못해 직전 양호값이 그대로 남고, 호출측
        # (`scheduler/jobs._fetch_us_sector`)이 job_runs에 failed를 기록한다.
        prev_by_etf = {p.get("etf"): p for p in _load_momentum_strict() if p.get("etf")}
        backfilled = 0
        filled = []
        for s in sectors:
            if _is_all_none(s):
                prev = prev_by_etf.get(s.get("etf"))
                if prev:
                    s = {**s, "return_1w": prev.get("return_1w"),
                         "return_1mo": prev.get("return_1mo"),
                         "return_3mo": prev.get("return_3mo")}
                    backfilled += 1
            filled.append(s)
        sectors = filled
        if backfilled:
            logger.info(f"[UsSector] refresh: 섹터 {backfilled}개 부분실패 → 직전값 백필")
    _mc_save(CACHE_KEY, {"sectors": sectors})
    return sectors


def load_momentum() -> list[dict]:
    """저장된 US 섹터 모멘텀(sectors). 없으면 [].

    요청경로(`analysis_service`)·기동 시드 판정용 **관용** read다. 저장을 판정하는 baseline으로
    쓰면 조회 실패가 「없음」으로 붕괴하므로, 그 용도에는 `_load_momentum_strict`를 쓸 것."""
    stored = _mc_load(CACHE_KEY)
    if not stored:
        return []
    return (stored.get("data") or {}).get("sectors") or []


def _load_momentum_strict() -> list[dict]:
    """`load_momentum`의 엄격판 — **조회 실패를 전파**한다(행 부재는 종래대로 []).

    부분실패 백필의 baseline 전용. 이 함수가 raise하면 `refresh()`가 `_mc_save`에 도달하지
    못해 직전 양호값이 보존된다."""
    stored = _mc_load_strict(CACHE_KEY)
    if not stored:
        return []
    return (stored.get("data") or {}).get("sectors") or []
