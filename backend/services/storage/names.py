# backend/services/storage/names.py
import json
import logging
from services.db import query, execute

logger = logging.getLogger(__name__)


def _invalidate_name_caches(ticker: str) -> None:
    """이름 변경 후 리포트 목록(get_list 60s TTL)·스냅샷 상세 LRU를 비워 화면 즉시 반영.
    storage↔cache 순환참조 회피용 지연 import."""
    try:
        from services import cache as cache_svc
        cache_svc.invalidate(ticker)   # 스냅샷 LRU (리포트 상세)
        cache_svc.invalidate_list()    # 리포트 목록 캐시
    except Exception as e:
        logger.warning(f"[Names] 캐시 무효화 실패: {e}")
        pass


def refresh_snapshot_names(ticker: str, name: str) -> None:
    """종목 이름 변경 시 그 종목 스냅샷에 박제된 data.name도 동기 갱신 + 관련 캐시 무효화.
    리포트 목록/상세는 박제된 snapshot name을 읽으므로(전체 재생성 아님), 이게 없으면
    종목관리(live tickers.name)와 리서치(snapshot name)가 어긋난다(목록↔상세 desync)."""
    execute(
        "UPDATE snapshots SET data = jsonb_set(data, '{name}', to_jsonb(%s::text)) WHERE ticker = %s",
        (name, ticker.upper()),
    )
    _invalidate_name_caches(ticker)


def set_ticker_name(ticker: str, name: str) -> None:
    """tickers.name + 그 종목 스냅샷 name 동기 갱신 (이름 백필용)."""
    execute("UPDATE tickers SET name = %s WHERE ticker = %s", (name, ticker.upper()))
    refresh_snapshot_names(ticker, name)


def reconcile_snapshot_names() -> list[str]:
    """모든 스냅샷의 박제 name을 현재 tickers.name과 강제 동기화(다른 것만).
    tickers.name을 이미 고쳤지만(예: 수동교정) 스냅샷이 옛 이름인 종목까지 잡는다.
    변경된 ticker 목록 반환(중복 제거)."""
    rows = query(
        """
        UPDATE snapshots s
        SET data = jsonb_set(s.data, '{name}', to_jsonb(t.name))
        FROM tickers t
        WHERE s.ticker = t.ticker
          AND COALESCE(t.name, '') <> ''
          AND (s.data->>'name') IS DISTINCT FROM t.name
        RETURNING s.ticker
        """
    )
    return sorted({r["ticker"] for r in rows})


def tickers_missing_name() -> list[dict]:
    """name이 비었거나 티커와 같은(=실명 미채움) 종목 목록 (이름 백필 대상)."""
    return query("SELECT ticker, market, exchange FROM tickers WHERE name = '' OR name = ticker")


def update_ticker_meta(ticker: str, name: str, competitors: list) -> None:
    """수정 모달에서 편집 가능한 필드(name, competitors)만 갱신.
    구조화 분석(moat/growth_plan/risks/recent_disclosures)은 건드리지 않고 보존.
    이름은 스냅샷에도 전파해 리포트 목록/상세까지 동기화.
    name이 None/빈값/공백·티커와 동일(대소문자 무시)이면 name 갱신을 생략하고 competitors만 UPDATE."""
    _ticker = ticker.upper()
    name_valid = bool(name and name.strip() and name.strip().upper() != _ticker)
    if name_valid:
        execute(
            "UPDATE tickers SET name = %s, competitors = %s WHERE ticker = %s",
            (name, json.dumps(competitors or []), _ticker),
        )
        refresh_snapshot_names(ticker, name)
    else:
        execute(
            "UPDATE tickers SET competitors = %s WHERE ticker = %s",
            (json.dumps(competitors or []), _ticker),
        )
