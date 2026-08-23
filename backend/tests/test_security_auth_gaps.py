"""task#108 보안: 무인증 mutation 엔드포인트가 인증을 강제하는지 + refresh token 1회용 회귀 검증.
task#230(ADR-0029): 구루·랭킹·수급·공매도 read 9개도 인증을 강제하는지.

각 테스트는 dependency override 없는 fresh app으로 실제 auth 의존성을 태운다
(conftest override는 main.app 한정이라 여기 fresh app엔 안 걸린다)."""
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.report import router as report_router
from routers.stocks import router as stocks_router
from routers.market_indicators import router as mi_router
from routers.guru import router as guru_router
from routers.rankings import router as rankings_router
from routers.investor import router as investor_router
from routers.short_sell import router as short_sell_router


def _client(*routers):
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    return TestClient(app)


def test_refresh_analyst_requires_auth():
    assert _client(report_router).post("/api/report/AAPL/refresh-analyst").status_code == 401


def test_consensus_backfill_requires_auth():
    assert _client(report_router).post("/api/consensus/AAPL/backfill").status_code == 401


def test_dashboard_cache_delete_requires_auth():
    assert _client(stocks_router).delete("/api/stocks/dashboard/cache").status_code == 401


def test_refresh_market_requires_auth():
    assert _client(mi_router).post("/api/market/refresh-market").status_code == 401


def test_enrich_single_requires_auth():
    r = _client(stocks_router).put("/api/stocks/AAPL/enrich", json={"moat": "x"})
    assert r.status_code == 401


def test_enrich_batch_requires_auth():
    r = _client(stocks_router).put("/api/stocks/enrich/batch", json=[{"ticker": "AAPL", "moat": "x"}])
    assert r.status_code == 401


# task#230(ADR-0029) — 구루·랭킹·수급·공매도 read 9개는 무인증 접근이 401이어야 한다.
_READ_GATES_230 = [
    ("guru", "/api/guru/managers"),
    ("guru", "/api/guru/managers/m1"),
    ("guru", "/api/guru/stats/popularity"),
    ("guru", "/api/guru/stats/weighted"),
    ("guru", "/api/guru/crawl/progress"),
    ("rankings", "/api/rankings"),
    ("investor", "/api/investor/screening"),
    ("investor", "/api/stocks/AAPL/investor-trend"),
    ("short_sell", "/api/stocks/AAPL/short-sell"),
]

_ROUTERS_230 = {
    "guru": guru_router,
    "rankings": rankings_router,
    "investor": investor_router,
    "short_sell": short_sell_router,
}


@pytest.mark.parametrize("group,path", _READ_GATES_230, ids=[p for _, p in _READ_GATES_230])
def test_read_endpoint_requires_auth_230(group, path):
    assert _client(_ROUTERS_230[group]).get(path).status_code == 401


# task#231(ADR-0029) — 시장지표 read 17개는 무인증 접근이 401이어야 한다.
# 경로는 전부 단일 prefix `/api/market` 아래다(라우터 열거로 확정 — `/api/market-indicators`는 존재하지 않는다).
_READ_GATES_231 = [
    "/api/market/treasury",
    "/api/market/m7-earnings",
    "/api/market/kr-top2-earnings",
    "/api/market/kr-exports",
    "/api/market/fx",
    "/api/market/vix",
    "/api/market/commodities",
    "/api/market/econ-indicators",
    "/api/market/indices",
    "/api/market/kospi-futures",
    "/api/market/fear-greed",
    "/api/market/macro-signals",
    "/api/market/kospi-signal",
    "/api/market/leverage",
    "/api/market/leverage/coverage",
    "/api/market/leverage/backfill/progress",
    "/api/market/lending",
]


@pytest.mark.parametrize("path", _READ_GATES_231)
def test_market_read_requires_auth_231(path):
    r = _client(mi_router).get(path)
    # 404를 401로 오인하지 않도록 경로 존재를 함께 못박는다(오타·prefix 혼동 방어).
    assert r.status_code != 404, f"경로가 존재하지 않는다: {path}"
    assert r.status_code == 401


# task#232(ADR-0029) — 리포트 read 9개 + 검색·뉴스 2개는 무인증 접근이 401이어야 한다.
# 이 11개를 닫으면 무인증 엔드포인트는 auth.py 공개 9개만 남는다(scripts/audit_unauth_endpoints.py가 게이트).
_READ_GATES_232 = [
    ("report", "/api/report/progress"),
    ("report", "/api/report/backfill/progress"),
    ("report", "/api/report/AAPL/history"),
    ("report", "/api/report/AAPL/backlog"),
    ("report", "/api/report/AAPL/disclosures"),
    ("report", "/api/report/AAPL/insider-trades"),
    ("report", "/api/report/AAPL/2026-07-28"),
    ("report", "/api/consensus/batch/progress"),
    ("report", "/api/consensus/AAPL"),
    ("stocks", "/api/stocks/search?q=AA"),
    ("stocks", "/api/stocks/AAPL/news"),
]

_ROUTERS_232 = {"report": report_router, "stocks": stocks_router}


@pytest.mark.parametrize("group,path", _READ_GATES_232, ids=[p for _, p in _READ_GATES_232])
def test_report_read_requires_auth_232(group, path):
    r = _client(_ROUTERS_232[group]).get(path)
    assert r.status_code != 404, f"경로가 존재하지 않는다: {path}"
    assert r.status_code == 401


def test_report_detail_accepts_api_key_232():
    """GET /api/report/{ticker}/{date_str}는 Cowork가 X-API-Key로 읽는다 — 키 인증도 200이어야 한다.

    `get_current_user`만 걸면 Cowork enrich 워크플로우가 조용히 깨지므로 positive 검증이 필수다."""
    from routers import report as report_mod

    snap = {"name": "Apple Inc.", "price": 100.0}
    with patch.dict("os.environ", {"COWORK_API_KEY": "test-cowork-key"}), \
         patch.object(report_mod.cache_svc, "get_snapshot", return_value=snap), \
         patch.object(report_mod.consensus_svc, "apply_asof", side_effect=lambda s, *a, **k: s), \
         patch.object(report_mod, "query", return_value=[]):
        r = _client(report_router).get(
            "/api/report/AAPL/2026-07-28", headers={"X-API-Key": "test-cowork-key"}
        )
    assert r.status_code == 200, r.text
    assert r.json()["ticker"] == "AAPL"


def test_report_detail_rejects_bad_api_key_232():
    """잘못된 API 키는 401 — 키 경로가 무조건 통과하는 구멍이 아님을 못박는다."""
    with patch.dict("os.environ", {"COWORK_API_KEY": "test-cowork-key"}):
        r = _client(report_router).get(
            "/api/report/AAPL/2026-07-28", headers={"X-API-Key": "wrong-key"}
        )
    assert r.status_code == 401


def test_consume_refresh_token_is_one_time():
    """refresh token은 사용 즉시 폐기(회전)되어 재사용 시 거부된다.

    구현이 SELECT+별도 execute(DELETE) 2문(TOCTOU)에서 `DELETE ... RETURNING` 단일
    원자문(query 경로)으로 바뀌었다 — 동시 로그아웃/중복 refresh가 그 틈에서 같은 토큰을
    지워도 SELECT 스냅샷만 보고 성공을 반환하던 결함을 닫기 위한 뒤집기(검토 지적 HIGH,
    이 태스크의 plan.md·retro는 "회전 시 옛 토큰 row 삭제"만 결정했지 SELECT/DELETE를
    별도 문으로 두라는 결정은 없었다). `execute` 미호출이 새 계약이다.
    """
    from services import auth_service
    future = datetime.now(timezone.utc) + timedelta(days=1)
    state = {"n": 0, "sql": []}

    def fake_query(sql, params):
        state["n"] += 1
        state["sql"].append(sql)
        return [{"user_id": "u1", "expires_at": future}] if state["n"] == 1 else []

    with patch.object(auth_service, "query", side_effect=fake_query), \
         patch.object(auth_service, "execute") as mock_exec:
        assert auth_service.consume_refresh_token("tok") == "u1"
        mock_exec.assert_not_called()  # 폐기가 DELETE ... RETURNING 단일문 — execute 경로 없음
        assert auth_service.consume_refresh_token("tok") is None  # 재사용 거부
    # ⚠️ 이빨 — 위 세 단언만으로는 「1회용」이 검증되지 않는다. fake_query가 호출 횟수만 보고
    # 2번째에 []를 주므로, 구현이 삭제를 전혀 하지 않는 평범한 SELECT로 되돌아가도 전부 통과한다
    # (`assert_called_once()`를 뒤집으면서 「DELETE가 발행됨」의 유일한 증거가 사라졌다).
    # 그래서 폐기가 *그 문장 안에서* 일어남을 SQL로 못박는다 — 이것이 원자성의 계약이다.
    assert "DELETE" in state["sql"][0].upper(), state["sql"][0]
    assert "RETURNING" in state["sql"][0].upper(), state["sql"][0]
