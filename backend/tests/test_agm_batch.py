"""S3: agm_fetch 배치 — registry · scheduler 잡 · 배치 함수 단위.

CLAUDE.md "배치 id 4표면"(read·표시·job_runs record·테스트) 일관 배선 검증.
"""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import batch_registry


# ── registry 엔트리 ──

def test_agm_fetch_registry_entry():
    e = batch_registry.get_batch("agm_fetch")
    assert e is not None
    assert e["market"] == "KR"
    assert e["category"] == "report"
    assert e["editable"] is True
    assert e["trigger_kinds"] == ["auto", "manual"]
    assert e["scheduler_job_id"] == "agm_fetch"
    assert "DART" in e["source"]
    assert "캘린더" in e["usage"]


# ── scheduler 잡 배선 ──

def test_scheduler_wires_agm_fetch():
    import scheduler
    assert "agm_fetch" in scheduler._JOB_FUNCS


def test_fetch_agm_job_records_auto(monkeypatch):
    import scheduler
    calls = []

    @contextmanager
    def fake_record(job_id, trigger):
        calls.append((job_id, trigger))
        yield 1

    import services.job_runs as job_runs
    monkeypatch.setattr(job_runs, "record", fake_record)
    monkeypatch.setattr("services.agm.fetch_agm_meeting_dates",
                        lambda: {"total": 2, "updated": 1, "failed": 0})
    scheduler._fetch_agm()
    assert ("agm_fetch", "auto") in calls


# ── fetch_agm_meeting_dates: no key → graceful skip ──

def test_fetch_agm_no_key_returns_zeros(monkeypatch):
    from services import agm
    monkeypatch.setattr(agm, "_dart_key", lambda: "")
    result = agm.fetch_agm_meeting_dates()
    assert result == {"total": 0, "updated": 0, "failed": 0}


def test_fetch_agm_skips_doc_when_latest_resolved(monkeypatch):
    """매년 갱신 안전: 최신 주총 rcept_no가 이미 해결되면 비싼 document fetch 스킵,
    미해결(신규 연도 rcept_no)이면 fetch."""
    import datetime
    from services import agm
    import services.db as db
    import services.backlog as backlog

    monkeypatch.setattr(agm, "_dart_key", lambda: "k")
    monkeypatch.setattr(agm.time, "sleep", lambda *_: None)
    monkeypatch.setattr(backlog, "_get_corp_code_map", lambda: {"005930": "00126380"})
    monkeypatch.setattr(agm, "_fetch_agm_list",
                        lambda cc: [{"report_nm": "주주총회소집결의", "rcept_no": "NEW1", "rcept_dt": "20270225"}])
    monkeypatch.setattr(agm, "parse_agm_meeting_date", lambda t: datetime.date(2027, 3, 20))

    resolved = {"val": True}

    def fake_query(sql, params=None):
        if "DISTINCT us.ticker" in sql:
            return [{"ticker": "005930.KS"}]
        if "meeting_date IS NOT NULL" in sql:
            return [{"x": 1}] if resolved["val"] else []
        return []

    monkeypatch.setattr(db, "query", fake_query)
    monkeypatch.setattr(db, "execute", lambda *a, **k: None)
    doc_calls = []
    monkeypatch.setattr(backlog, "_get_document_text", lambda rno: doc_calls.append(rno) or "텍스트")

    agm.fetch_agm_meeting_dates()        # 최신 rcept_no 이미 해결 → 문서 fetch 스킵
    assert doc_calls == []

    resolved["val"] = False
    agm.fetch_agm_meeting_dates()        # 신규(미해결) rcept_no → fetch
    assert doc_calls == ["NEW1"]


# ── _fetch_agm_list: filters on '주주총회' ──

def test_fetch_agm_list_filters_agm_items(monkeypatch):
    from services import agm

    class _Resp:
        def json(self):
            return {"status": "000", "list": [
                {"report_nm": "주주총회소집결의", "rcept_no": "001"},
                {"report_nm": "사업보고서 (2025.12)", "rcept_no": "002"},
                {"report_nm": "주주총회소집공고", "rcept_no": "003"},
            ]}

    import requests
    monkeypatch.setattr(requests, "get", lambda *a, **k: _Resp())
    monkeypatch.setattr(agm, "_dart_key", lambda: "testkey")
    items = agm._fetch_agm_list("00126380")
    assert len(items) == 2
    assert all("주주총회" in i["report_nm"] for i in items)


# ── _select_best: prefers 소집결의 over 소집공고 ──

def test_select_best_prefers_sozip_gyeolui():
    from services.agm import _select_best
    items = [
        {"report_nm": "주주총회소집공고", "rcept_no": "001"},
        {"report_nm": "주주총회소집결의", "rcept_no": "002"},
    ]
    best = _select_best(items)
    assert best["report_nm"] == "주주총회소집결의"


def test_select_best_falls_back_to_sozip_gongggo():
    from services.agm import _select_best
    items = [{"report_nm": "주주총회소집공고", "rcept_no": "001"}]
    best = _select_best(items)
    assert best is not None
    assert "소집공고" in best["report_nm"]


def test_select_best_none_on_empty():
    from services.agm import _select_best
    assert _select_best([]) is None


# ── manual endpoint exists in the router ──

def test_agm_refresh_manual_endpoint_registered():
    """batch_registry manual_endpoint /api/report/agm/refresh must resolve to a real route."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.report import router
    from auth import require_admin

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/report/agm/refresh")
    assert resp.status_code == 202
