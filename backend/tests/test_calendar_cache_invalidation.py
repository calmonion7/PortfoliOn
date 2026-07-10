"""S1 — 종목 mutation 시 calendar_cache DB 테이블(실제 라이브 저장소)이 무효화되는지 검증.

_get_events()는 calendar_cache 테이블만 읽고/쓴다(파일 캐시는 dead store) — clear_cache()가
그 DB 테이블을 user_id로 지우고, invalidate_portfolio_caches()가 user_id를 그 체인까지
스레딩하는지 확인한다."""
from unittest.mock import patch

from routers import calendar as calendar_router
from services import cache as cache_svc


def test_clear_cache_deletes_user_scoped_calendar_cache_rows():
    with patch("routers.calendar.execute") as mock_execute:
        calendar_router.clear_cache("user-A")
    mock_execute.assert_called_once_with(
        "DELETE FROM calendar_cache WHERE user_id = %s", ("user-A",)
    )


def test_clear_cache_without_user_id_deletes_all_rows():
    with patch("routers.calendar.execute") as mock_execute:
        calendar_router.clear_cache()
    mock_execute.assert_called_once_with("DELETE FROM calendar_cache")


def test_invalidate_portfolio_caches_threads_user_id_to_calendar_clear():
    with patch("routers.calendar.clear_cache") as mock_clear:
        cache_svc.invalidate_portfolio_caches("user-B")
    mock_clear.assert_called_once_with("user-B")
