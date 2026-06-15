"""S4: GET /api/report/{ticker}/disclosures + 다이제스트/텔레그램 공시 섹션."""
import sys
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.report import router
from auth import get_current_user, require_admin, get_current_user_or_api_key, require_admin_or_api_key


@pytest.fixture(autouse=True)
def _stub_job_runs(monkeypatch):
    import services.job_runs as job_runs

    @contextmanager
    def _noop(job_id, trigger):
        yield 1

    monkeypatch.setattr(job_runs, "record", _noop)


app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
app.dependency_overrides[require_admin] = lambda: "test-user-id"
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
app.dependency_overrides[require_admin_or_api_key] = lambda: "test-user-id"
client = TestClient(app)


def test_get_disclosures_returns_stored(monkeypatch):
    stored = [{
        "rcept_no": "20260515000001", "rcept_dt": "20260515",
        "report_nm": "분기보고서 (2026.03)", "pblntf_ty": "A", "corp_name": "삼성전자",
        "dart_url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260515000001",
    }]
    with patch("services.disclosures.get_disclosures", return_value=stored) as gd:
        resp = client.get("/api/report/005930.KS/disclosures")
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["rcept_no"] == "20260515000001"
    assert data[0]["dart_url"].endswith("20260515000001")
    # 라우트가 catch-all에 가려지지 않고 disclosures로 도달
    assert gd.called


def test_get_disclosures_not_shadowed_by_catchall(monkeypatch):
    """'disclosures'가 date_str로 매칭돼 get_report로 가지 않아야 한다."""
    with patch("services.disclosures.get_disclosures", return_value=[]) as gd, \
         patch("routers.report.cache_svc.get_snapshot") as gs:
        resp = client.get("/api/report/AAPL/disclosures")
    assert resp.status_code == 200
    assert gd.called
    assert not gs.called  # get_report 경로로 새지 않음


# ── 다이제스트 공시 통합 ──

SAMPLE_PORTFOLIO = {
    "stocks": [
        {"ticker": "005930.KS", "name": "삼성전자", "quantity": 10, "avg_cost": 70000.0, "market": "KR", "exchange": ""},
    ],
    "watchlist": [],
}


def _normal_ticker(symbol):
    m = MagicMock()
    m.history.return_value = pd.DataFrame(
        {"Close": [100.0, 102.0]},
        index=pd.DatetimeIndex(["2026-05-22", "2026-05-23"]),
    )
    return m


def test_generate_includes_recent_disclosures(tmp_path):
    import services.digest_service as ds
    disc = [{
        "rcept_no": "20260522000001", "rcept_dt": "20260522",
        "report_nm": "주요사항보고서(유상증자결정)", "pblntf_ty": "B", "corp_name": "삼성전자",
        "dart_url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260522000001",
    }]
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.yf.Ticker", side_effect=_normal_ticker), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.disclosures.get_disclosures", return_value=disc), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    assert "disclosures" in result
    assert len(result["disclosures"]) == 1
    d = result["disclosures"][0]
    assert d["ticker"] == "005930.KS"
    assert d["report_nm"] == "주요사항보고서(유상증자결정)"
    assert d["dart_url"].endswith("20260522000001")


def test_generate_disclosures_only_recent(tmp_path):
    """오래된 공시(윈도우 밖)는 제외한다."""
    import services.digest_service as ds
    disc = [
        {"rcept_no": "1", "rcept_dt": "20260522", "report_nm": "최근", "pblntf_ty": "A",
         "corp_name": "삼성전자", "dart_url": "u1"},
        {"rcept_no": "2", "rcept_dt": "20260401", "report_nm": "오래됨", "pblntf_ty": "A",
         "corp_name": "삼성전자", "dart_url": "u2"},
    ]
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.yf.Ticker", side_effect=_normal_ticker), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.disclosures.get_disclosures", return_value=disc), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    rmts = [d["report_nm"] for d in result["disclosures"]]
    assert "최근" in rmts
    assert "오래됨" not in rmts


def test_send_telegram_includes_disclosures(monkeypatch):
    import services.digest_service as ds
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "1")
    digest = {
        "date": "2026-05-23",
        "portfolio_summary": {"total_value_krw": 1000.0, "daily_change_pct": 1.0, "daily_change_krw": 10.0},
        "stocks": [],
        "events_7d": [],
        "anomalies": [],
        "disclosures": [
            {"ticker": "005930.KS", "rcept_dt": "20260522", "report_nm": "주요사항보고서(유상증자결정)",
             "pblntf_ty": "B", "corp_name": "삼성전자", "dart_url": "u1"},
        ],
    }
    with patch("services.digest_service.requests.post") as mock_post:
        mock_post.return_value.status_code = 200
        ds.send_telegram(digest)
    _, kwargs = mock_post.call_args
    text = kwargs["json"]["text"]
    assert "📑 최신 공시" in text
    assert "주요사항보고서(유상증자결정)" in text


def test_send_telegram_no_disclosures_section_when_empty(monkeypatch):
    import services.digest_service as ds
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "1")
    digest = {
        "date": "2026-05-23",
        "portfolio_summary": {"total_value_krw": 1000.0, "daily_change_pct": 1.0, "daily_change_krw": 10.0},
        "stocks": [], "events_7d": [], "anomalies": [], "disclosures": [],
    }
    with patch("services.digest_service.requests.post") as mock_post:
        mock_post.return_value.status_code = 200
        ds.send_telegram(digest)
    _, kwargs = mock_post.call_args
    assert "📑 최신 공시" not in kwargs["json"]["text"]
