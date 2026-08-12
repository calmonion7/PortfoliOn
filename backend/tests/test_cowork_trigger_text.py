"""루틴 트리거 본문 단일 소스화 + 정책 열거 제거 (task#279).

trigger 본문이 정책(enrich·애널리스트·주요기술)을 열거하면, 루틴 프롬프트가 실제로
지정한 정책과 드리프트해 프롬프트 정본을 트리거 문구가 이겨버리는 결함이 있었다
(주요기술 리포트 0건 발행의 근본원인). daily_text/manual_text가 유일한 산지이고
정책명을 담지 않음을 못박는다.
"""
from unittest.mock import patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import cowork_trigger

_POLICY_WORDS = ("enrich", "애널리스트", "주요기술")


# ── (b) 반환 문자열에 정책명이 없다 ──────────────────────────────────

def test_daily_text_has_no_policy_names():
    for market in ("KR", "US"):
        text = cowork_trigger.daily_text(market)
        for word in _POLICY_WORDS:
            assert word not in text, f"{market}: '{word}' leaked into daily_text"


def test_manual_text_has_no_policy_names():
    text = cowork_trigger.manual_text()
    for word in _POLICY_WORDS:
        assert word not in text, f"'{word}' leaked into manual_text"


# ── (c) 프롬프트 정본 지시 + market 컨텍스트 ─────────────────────────

def test_daily_text_references_prompt_and_market_context():
    kr = cowork_trigger.daily_text("KR")
    us = cowork_trigger.daily_text("US")
    assert "프롬프트" in kr
    assert "프롬프트" in us
    assert "KR" in kr
    assert "US" in us


def test_manual_text_references_prompt():
    assert "프롬프트" in cowork_trigger.manual_text()


# ── (a) 빌더가 유일한 산지 — scheduler 훅 ───────────────────────────

def test_generate_all_fires_daily_text_verbatim(monkeypatch):
    from scheduler import jobs
    with patch("services.db.query", return_value=[]), \
         patch("scheduler.jobs.job_runs.record"), \
         patch("services.cowork_trigger.fire") as mock_fire:
        jobs._generate_all("KR", "daily_report_kr")
    assert mock_fire.call_count == 1
    assert mock_fire.call_args.args[0] == cowork_trigger.daily_text("KR")


def test_generate_all_fires_daily_text_verbatim_us(monkeypatch):
    from scheduler import jobs
    with patch("services.db.query", return_value=[]), \
         patch("scheduler.jobs.job_runs.record"), \
         patch("services.cowork_trigger.fire") as mock_fire:
        jobs._generate_all("US", "daily_report_us")
    assert mock_fire.call_args.args[0] == cowork_trigger.daily_text("US")


# ── (a)/(d) 빌더가 유일한 산지 — admin 수동 fire ────────────────────

from routers.admin import router as admin_router
from auth import require_admin, require_admin_or_api_key

app = FastAPI()
app.include_router(admin_router)
app.dependency_overrides[require_admin_or_api_key] = lambda: "admin-id"
app.dependency_overrides[require_admin] = lambda: "admin-id"
client = TestClient(app)


def test_admin_fire_default_matches_manual_text(monkeypatch):
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.fire", return_value=True) as mock_fire:
        resp = client.post("/api/admin/cowork/fire", json={})
    assert resp.status_code == 200
    assert mock_fire.call_args.args[0] == cowork_trigger.manual_text()


def test_admin_fire_custom_text_passthrough(monkeypatch):
    """(d) 재지정 경로 보존 핀 — body.text가 있으면 빌더를 거치지 않고 그대로 발사."""
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.fire", return_value=True) as mock_fire:
        resp = client.post("/api/admin/cowork/fire", json={"text": "005930 enrich만"})
    assert resp.status_code == 200
    assert mock_fire.call_args.args[0] == "005930 enrich만"
