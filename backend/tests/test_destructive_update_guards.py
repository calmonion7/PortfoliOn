"""파괴적 갱신 2건의 가드 — B1(랭킹 delete-rewrite) · B40(`_mc_load` 실패 붕괴).

두 결함의 형태는 같다: **조회·fetch 실패를 「빈 결과」로 붕괴**시켜 직전 양호값을 파괴한다.
저장 생략이 아니라 소멸이라 화면에 토스트도 없다.

가드는 저장 직전 한 지점이 아니라 **소스 계층**에 둔다 — delete-rewrite 경로에는 담아둘
last-good이 없으므로, 소스-폴백의 대응물은 「실패를 전파해 호출측이 replace/save에
도달하지 못하게 하는 것」이다.

각 가드마다 **「정상 입력은 계속 값을 낸다」 대조군 축**을 쌍으로 둔다 — 그것이 없으면
「전부 스킵하기」가 통과한다(task#248→#249: 이상치 가드가 정상값을 결측시킨 실사고).
"""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


# ── 공용 fake ────────────────────────────────────────────────────────────

def _naver_resp(total, rows):
    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"totalCount": total, "stocks": rows}

    return _Resp()


def _kr_stock(code, value="100", volume="1"):
    return {
        "itemCode": code,
        "stockName": code,
        "closePriceRaw": "10000",
        "fluctuationsRatio": "1.0",
        "accumulatedTradingValueRaw": value,
        "accumulatedTradingVolumeRaw": volume,
        "marketValueRaw": "50000000000",
        "stockEndType": "stock",
        "stockExchangeType": {"code": "KS"},
    }


class _FakeCursor:
    def __init__(self, log):
        self._log = log

    def execute(self, sql, params=None):
        self._log.append((sql, params))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, log):
        self._cursor = _FakeCursor(log)

    def cursor(self):
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _fake_get_connection(log):
    @contextmanager
    def _cm():
        yield _FakeConn(log)

    return _cm


@pytest.fixture
def stub_job_runs(monkeypatch):
    """계측이 실 DB를 건드리지 않게 대체. yield는 실제 `Run` 핸들 — `yield 1`로 두면
    `as run:`으로 배선된 잡에서 AttributeError가 난다(전 저장소 20곳의 옛 관용구)."""
    import services.job_runs as job_runs

    @contextmanager
    def _rec(job_id, trigger):
        yield job_runs.Run(1)

    monkeypatch.setattr(job_runs, "record", _rec)


# ── B1: 랭킹 delete-rewrite ─────────────────────────────────────────────

def test_fetch_naver_market_raises_on_success_but_empty_response(monkeypatch):
    """실패 클래스 (b) 성공-but-빈응답 — 200 + `totalCount:0`은 예외 가드를 그냥 통과한다.

    ⓒ genuine-empty의 운명 결정: **clear하지 않는다.** KOSPI/KOSDAQ 전 종목 시가총액
    목록이 *진짜로* 0건인 시장 상태는 존재하지 않으므로(휴장일에도 목록은 반환된다),
    이 소스에서 genuine-empty와 장애는 원리적으로 구별 불가다. 비용도 비대칭이다 —
    잘못 보존하면 다음 크론(10분)까지 stale이고 `base_ts`가 나이를 노출하지만, 잘못
    지우면 랭킹 탭과 `investor_trend_fetch` 유니버스가 함께 소멸한다.
    """
    import services.ranking_service as svc
    monkeypatch.setattr(svc.requests, "get", lambda *a, **k: _naver_resp(0, []))
    with pytest.raises(RuntimeError, match="empty"):
        svc._fetch_naver_market("KOSPI")


def test_fetch_naver_market_raises_when_pages_return_empty(monkeypatch):
    """실패 클래스 (c) 부분 페이로드 — 뒷 페이지가 200에 빈 배열을 주면 예외도
    `failed` 집계도 없이 목록이 조용히 잘린다. `if not stocks:` all-or-nothing만
    두면 5페이지 중 4페이지 소실이 그대로 통과해 전 종목 목록이 top-100으로 축소된다."""
    import services.ranking_service as svc
    page1 = [_kr_stock(f"{i:06d}") for i in range(100)]
    monkeypatch.setattr(svc.requests, "get", lambda *a, **k: _naver_resp(500, page1))
    monkeypatch.setattr(svc, "_fetch_naver_page", lambda market, page: [])
    with pytest.raises(RuntimeError, match="coverage"):
        svc._fetch_naver_market("KOSPI")


def test_fetch_naver_market_returns_rows_on_normal_response(monkeypatch):
    """대조군 — 정상 단일 페이지는 예외 없이 그 리스트를 반환한다.
    (이 축이 없으면 「항상 raise하기」가 통과한다.)"""
    import services.ranking_service as svc
    rows = [_kr_stock("005930"), _kr_stock("035720")]
    monkeypatch.setattr(svc.requests, "get", lambda *a, **k: _naver_resp(2, rows))
    monkeypatch.setattr(svc, "_fetch_naver_page",
                        lambda market, page: pytest.fail("단일 페이지면 추가 fetch 없음"))
    assert svc._fetch_naver_market("KOSPI") == rows


def test_fetch_naver_market_tolerates_pagination_drift(monkeypatch):
    """대조군 — 페이지네이션 drift(마지막 페이지가 `totalCount`보다 적게 옴)는
    정상이다. 커버리지 임계가 이것을 죽이면 매 실행이 스킵된다."""
    import services.ranking_service as svc
    page1 = [_kr_stock(f"1{i:05d}") for i in range(100)]
    monkeypatch.setattr(svc.requests, "get", lambda *a, **k: _naver_resp(250, page1))
    monkeypatch.setattr(
        svc, "_fetch_naver_page",
        lambda market, page: [_kr_stock(f"{page}{i:05d}") for i in range(100 if page == 2 else 40)],
    )
    assert len(svc._fetch_naver_market("KOSPI")) == 240


def test_get_kr_rankings_propagates_when_one_market_is_empty(monkeypatch):
    """KOSPI+KOSDAQ 합집합 중 한쪽만 비어도 전체가 전파된다 — 잘린 합집합으로
    양쪽 랭킹을 덮는 것보다 통째 스킵이 옳다."""
    import services.ranking_service as svc

    def fake_market(market):
        if market == "KOSPI":
            return [_kr_stock("005930")]
        raise RuntimeError("ranking: KOSDAQ fetch returned empty stocks")

    monkeypatch.setattr(svc, "_fetch_naver_market", fake_market)
    with pytest.raises(RuntimeError):
        svc.get_kr_rankings()


def test_kr_ranking_job_issues_no_delete_on_empty_response(monkeypatch, stub_job_runs):
    """ⓐ 저장된 직전 행 보존 — DELETE 자체가 실행되지 않아야 한다.
    (`replace_market_rankings` 미호출을 DB 계층에서 직접 관찰한다.)"""
    import services.ranking_service as svc
    from scheduler.jobs import _fetch_kr_rankings

    log: list = []
    monkeypatch.setattr(svc, "get_connection", _fake_get_connection(log))
    monkeypatch.setattr(svc.requests, "get", lambda *a, **k: _naver_resp(0, []))

    _fetch_kr_rankings()   # 스케줄러가 예외를 삼킨다 — replace에 도달하지 않는 것이 가드다

    assert log == [], f"빈 응답에 DB 쓰기가 발생했다: {log}"


def test_kr_ranking_job_replaces_on_normal_response(monkeypatch, stub_job_runs):
    """ⓑ 대조군 — 정상 응답은 계속 DELETE + INSERT로 교체된다."""
    import services.ranking_service as svc
    from scheduler.jobs import _fetch_kr_rankings

    log: list = []
    monkeypatch.setattr(svc, "get_connection", _fake_get_connection(log))
    monkeypatch.setattr(svc, "_fetch_naver_market", lambda market: [_kr_stock(market)])

    _fetch_kr_rankings()

    assert "DELETE FROM market_rankings" in log[0][0]
    assert log[0][1] == ("KR",)
    inserts = [s for s in log[1:] if "INSERT INTO market_rankings" in s[0]]
    assert len(inserts) == 6   # 2종목 × value/volume/change


# ── B40: `_mc_load` 실패를 「저장값 없음」으로 읽는다 ────────────────────

def test_mc_load_strict_propagates_db_error(monkeypatch):
    """엄격판은 DB 예외를 전파한다 — 「조회 실패」와 「한 번도 저장 안 됨」을 가른다."""
    from services.market_indicators import cache as mc

    def boom(sql, params=None):
        raise RuntimeError("pool exhausted")

    monkeypatch.setattr(mc, "query", boom)
    with pytest.raises(RuntimeError, match="pool exhausted"):
        mc._mc_load_strict("kospi_signal")


def test_mc_load_strict_returns_none_when_row_missing(monkeypatch):
    """행 부재(정상 콜드 스타트)는 종래대로 None — 예외가 아니다."""
    from services.market_indicators import cache as mc
    monkeypatch.setattr(mc, "query", lambda sql, params=None: [])
    assert mc._mc_load_strict("kospi_signal") is None


def test_mc_load_still_swallows_db_error(monkeypatch):
    """additive 보존 핀 — 기존 `_mc_load`(앱 36곳·18모듈이 호출)의 계약은 불변이다.
    엄격판은 새 심볼로 추가하고 이 wave가 소유하지 않은 호출처는 건드리지 않는다."""
    from services.market_indicators import cache as mc

    def boom(sql, params=None):
        raise RuntimeError("pool exhausted")

    monkeypatch.setattr(mc, "query", boom)
    assert mc._mc_load("kospi_signal") is None


def _driver_pts(sym, stored_h, precision=4):
    return [{"date": "2026-07-01", "value": 100.0}, {"date": "2026-07-02", "value": 101.0}]


class _EmptyHist:
    empty = True


def test_refresh_kospi_signal_does_not_save_when_db_read_fails(monkeypatch):
    """ⓓ 조회 실패 시 누적 시계열(최대 180일 신호·적중률)이 1건으로 덮이지 않는다.

    `_mc_load`가 예외를 None으로 접으면 `series`가 []로 시작하고, 드라이버 fetch는
    성공하므로 `changed=True`가 되어 `_mc_save`가 **오늘 1건만** 쓴다. 신호·적중률은
    그날의 갭·종가 대사에서 파생되므로 재구성이 불가능하다.
    """
    from services.market_indicators import cache as mc
    from services.market_indicators import kospi_signal as ks

    def boom(sql, params=None):
        raise RuntimeError("pool exhausted")

    monkeypatch.setattr(mc, "query", boom)
    saved: list = []
    monkeypatch.setattr(ks, "_mc_save", lambda key, data: saved.append(data))
    monkeypatch.setattr(ks, "_yf_close_history", _driver_pts)

    from unittest.mock import patch
    with patch.object(ks.yf, "Ticker") as MockTicker:
        MockTicker.return_value.history.return_value = _EmptyHist()
        with pytest.raises(RuntimeError, match="pool exhausted"):
            ks.refresh_kospi_signal()

    assert saved == [], f"조회 실패인데 저장이 일어났다: {saved}"


def test_refresh_kospi_signal_saves_on_cold_start_with_no_row(monkeypatch):
    """ⓔ 대조군 — 「저장값이 진짜 없음」(첫 실행)은 계속 정상 저장한다.
    이 축이 없으면 「항상 스킵」이 통과해 첫 실행이 영구히 빈 상태가 된다."""
    from services.market_indicators import cache as mc
    from services.market_indicators import kospi_signal as ks

    monkeypatch.setattr(mc, "query", lambda sql, params=None: [])
    saved: list = []
    monkeypatch.setattr(ks, "_mc_save", lambda key, data: saved.append(data))
    monkeypatch.setattr(ks, "_yf_close_history", _driver_pts)

    from unittest.mock import patch
    with patch.object(ks.yf, "Ticker") as MockTicker:
        MockTicker.return_value.history.return_value = _EmptyHist()
        result = ks.refresh_kospi_signal()

    assert len(saved) == 1
    assert len(result["series"]) == 1
