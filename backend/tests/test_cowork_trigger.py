"""이벤트 구동 루틴 fire (ADR-0028, task#213) — 서비스·스케줄러 훅·admin 수동 fire·enriched_at 노출."""
from unittest.mock import patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import cowork_trigger


# ── fire 서비스 ───────────────────────────────────────────────────────

def test_fire_dormant_without_env(monkeypatch):
    monkeypatch.delenv("COWORK_ROUTINE_FIRE_URL", raising=False)
    monkeypatch.delenv("COWORK_ROUTINE_FIRE_TOKEN", raising=False)
    with patch("services.cowork_trigger.requests.post") as mock_post:
        assert cowork_trigger.fire("t") is False
    mock_post.assert_not_called()


def test_fire_posts_with_token(monkeypatch):
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.requests.post", return_value=MagicMock(status_code=200)) as mock_post:
        assert cowork_trigger.fire("KR 배치 완료") is True
    kwargs = mock_post.call_args.kwargs
    assert kwargs["headers"]["Authorization"] == "Bearer tok"
    assert kwargs["json"] == {"text": "KR 배치 완료"}


def test_fire_swallows_failures(monkeypatch):
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.requests.post", side_effect=Exception("boom")):
        assert cowork_trigger.fire("t") is False  # 예외 전파 없음(배치 본문 보호)
    with patch("services.cowork_trigger.requests.post", return_value=MagicMock(status_code=500, text="err")):
        assert cowork_trigger.fire("t") is False


# ── 스케줄러 훅 — 배치 말미 fire, 실패해도 배치 안 깨짐 ─────────────────

def test_generate_all_fires_after_batch(monkeypatch):
    from scheduler import jobs
    with patch("services.db.query", return_value=[]), \
         patch("scheduler.jobs.job_runs.record"), \
         patch("services.cowork_trigger.fire") as mock_fire:
        # job_runs.record는 컨텍스트 매니저 — MagicMock이 대체
        jobs._generate_all("KR", "daily_report_kr")
    assert mock_fire.call_count == 1
    assert "KR" in mock_fire.call_args.args[0]


# ── admin 수동 fire ──────────────────────────────────────────────────

from routers.admin import router as admin_router
from auth import require_admin, require_admin_or_api_key

app = FastAPI()
app.include_router(admin_router)
# cowork/fire·analyst-targets 쓰기는 require_admin_or_api_key (Cowork-facing 쓰기 게이트 컨벤션),
# analyst-targets 조회(task#224)는 화면 전용이라 require_admin
app.dependency_overrides[require_admin_or_api_key] = lambda: "admin-id"
app.dependency_overrides[require_admin] = lambda: "admin-id"
client = TestClient(app)


def test_admin_fire_unconfigured_503(monkeypatch):
    monkeypatch.delenv("COWORK_ROUTINE_FIRE_URL", raising=False)
    monkeypatch.delenv("COWORK_ROUTINE_FIRE_TOKEN", raising=False)
    assert client.post("/api/admin/cowork/fire", json={"text": ""}).status_code == 503


def test_admin_fire_ok(monkeypatch):
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.fire", return_value=True) as mock_fire:
        resp = client.post("/api/admin/cowork/fire", json={"text": "005930 enrich"})
    assert resp.status_code == 200
    assert mock_fire.call_args.args[0] == "005930 enrich"


def test_admin_fire_default_text(monkeypatch):
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.fire", return_value=True) as mock_fire:
        resp = client.post("/api/admin/cowork/fire", json={})
    assert resp.status_code == 200
    assert "enrich" in mock_fire.call_args.args[0]


def test_admin_fire_unauthenticated_401():
    fresh = FastAPI()
    fresh.include_router(admin_router)
    assert TestClient(fresh).post("/api/admin/cowork/fire", json={}).status_code == 401


# ── GET /api/stocks enriched_at additive (S2) ────────────────────────

from routers.stocks import router as stocks_router
from auth import get_current_user_or_api_key

sapp = FastAPI()
sapp.include_router(stocks_router)
sapp.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
sclient = TestClient(sapp)

PORTFOLIO = {
    "stocks": [{"ticker": "LLY", "name": "일라이 릴리"}],
    "watchlist": [{"ticker": "005930", "name": "삼성전자"}],
}


def test_get_stocks_includes_enriched_at_and_target():
    import datetime
    rows = [{"ticker": "LLY", "enriched_at": datetime.datetime(2026, 7, 20, 1, 0), "analyst_target": True}]
    with patch("routers.stocks.storage.get_full_portfolio", return_value=PORTFOLIO), \
         patch("routers.stocks.query", return_value=rows):
        data = sclient.get("/api/stocks").json()
    by = {d["ticker"]: d for d in data}
    assert by["LLY"]["enriched_at"].startswith("2026-07-20")
    assert by["LLY"]["analyst_target"] is True
    assert by["005930"]["enriched_at"] is None  # 미enrich → null
    assert by["005930"]["analyst_target"] is False  # 미지정 기본 False


def test_admin_analyst_target_toggle():
    with patch("routers.admin.execute", return_value=1) as mock_exec:
        resp = client.put("/api/admin/analyst-targets/tst", json={"enabled": True})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "ticker": "TST", "analyst_target": True}
    assert mock_exec.call_args.args[1] == (True, "TST")
    with patch("routers.admin.execute", return_value=0):
        assert client.put("/api/admin/analyst-targets/NONE", json={"enabled": True}).status_code == 404


def test_admin_analyst_target_unauthenticated_401():
    fresh = FastAPI()
    fresh.include_router(admin_router)
    assert TestClient(fresh).put("/api/admin/analyst-targets/TST", json={"enabled": True}).status_code == 401


# ── GET /api/admin/analyst-targets — 전역 지정 목록 (task#224) ────────

def test_admin_analyst_targets_list_is_global():
    rows = [
        {"ticker": "035420", "name": "NAVER", "market": "KR"},
        {"ticker": "GOOGL", "name": "Alphabet Inc.", "market": "US"},
        {"ticker": "TST", "name": None, "market": None},  # 이름·시장 결측 → 폴백
    ]
    with patch("routers.admin.query", return_value=rows) as mock_q:
        data = client.get("/api/admin/analyst-targets").json()
    assert [d["ticker"] for d in data] == ["035420", "GOOGL", "TST"]
    # 소유자 무관 전역 조회 — user_id 조건 없이 analyst_target 플래그만 본다
    sql = mock_q.call_args.args[0]
    assert "analyst_target = true" in sql and "user_id" not in sql
    assert data[0]["market"] == "KR"
    assert data[2] == {"ticker": "TST", "name": "TST", "market": "US"}  # 결측 폴백


def test_admin_analyst_targets_list_unauthenticated_401():
    fresh = FastAPI()
    fresh.include_router(admin_router)
    assert TestClient(fresh).get("/api/admin/analyst-targets").status_code == 401


def test_get_stocks_enriched_at_query_failure_graceful():
    with patch("routers.stocks.storage.get_full_portfolio", return_value=PORTFOLIO), \
         patch("routers.stocks.query", side_effect=Exception("db down")):
        resp = sclient.get("/api/stocks")
    assert resp.status_code == 200
    assert all(d["enriched_at"] is None for d in resp.json())
