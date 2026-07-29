"""task#243: 빈 결과 덮어쓰기 가드 잔존 2곳 (KR 수출 G2 · KR 업종 역인덱스 G3).

task#242가 닫은 5곳과 같은 클래스인데 실패 클래스를 하나씩 놓친 곳:
- G2 `exports.py` — **예외만** 가드해 "성공-but-빈응답"이 통과(두 fetch 경로 공통)
- G3 `kr_sector_service.py` — **sectors만** 가드해 같은 페이로드의 `index`가 빠짐

red 조건: 옛 구현이 *실제로* 빈 값을 저장한다를 관측한다(회고 #234 ④) —
저장 함수 mock의 call_count/call_args로 단언하고, 파일 저장은 tmp 경로 실존으로 본다.
"""
import os
from unittest.mock import patch
import logging
import pytest


# ─────────────────── S1. KR 수출 (G2) ───────────────────

@pytest.fixture
def exports_mod(monkeypatch, tmp_path):
    """파일 캐시를 tmp로 돌려 backend/data/kr_exports.json 오염을 막는다."""
    from services.market_indicators import exports as mod
    monkeypatch.setattr(mod, "_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(mod, "_EXPORTS_CACHE", str(tmp_path / "kr_exports.json"))
    monkeypatch.delenv("KITA_API_KEY", raising=False)  # → Comtrade 경로 사용
    return mod


_STORED = {"months": [{"month": "202606", "semiconductor": 120.0, "non_semiconductor": 400.0}]}
_FRESH = {"months": [{"month": "202607", "semiconductor": 130.0, "non_semiconductor": 410.0}]}


def test_exports_empty_skips_both_saves_and_returns_stored(exports_mod, monkeypatch, caplog):
    mod = exports_mod
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": _STORED, "fetched_at": None})
    monkeypatch.setattr(mod, "_fetch_comtrade_exports", lambda: {"months": []})
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.WARNING):
            out = mod._fetch_and_save_kr_exports()
    mock_save.assert_not_called()
    assert not os.path.exists(mod._EXPORTS_CACHE)          # 파일캐시도 안 덮는다
    assert out["months"] == _STORED["months"]
    assert out.get("stale") is True                        # admin이 "생략"을 알 수 있게
    assert any("빈 결과" in r.message for r in caplog.records)


def test_exports_empty_without_stored_is_graceful(exports_mod, monkeypatch):
    mod = exports_mod
    monkeypatch.setattr(mod, "_mc_load", lambda key: None)
    monkeypatch.setattr(mod, "_fetch_comtrade_exports", lambda: {"months": []})
    with patch.object(mod, "_mc_save") as mock_save:
        out = mod._fetch_and_save_kr_exports()
    mock_save.assert_not_called()
    assert not os.path.exists(mod._EXPORTS_CACHE)
    assert out == {"months": []}


def test_exports_saves_on_success(exports_mod, monkeypatch):
    mod = exports_mod
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": _STORED, "fetched_at": None})
    monkeypatch.setattr(mod, "_fetch_comtrade_exports", lambda: _FRESH)
    with patch.object(mod, "_mc_save") as mock_save:
        out = mod._fetch_and_save_kr_exports()
    assert mock_save.call_count == 1
    assert mock_save.call_args[0][1]["months"] == _FRESH["months"]
    assert os.path.exists(mod._EXPORTS_CACHE)              # 정상 경로는 파일도 쓴다
    assert "stale" not in out


def test_exports_fetch_exception_with_stored_marks_stale(exports_mod, monkeypatch):
    """예외 경로도 저장값을 반환하므로 stale 마커가 있어야 admin 보고가 정직하다."""
    mod = exports_mod

    def _boom():
        raise RuntimeError("comtrade down")

    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": _STORED, "fetched_at": None})
    monkeypatch.setattr(mod, "_fetch_comtrade_exports", _boom)
    with patch.object(mod, "_mc_save") as mock_save:
        out = mod._fetch_and_save_kr_exports()
    mock_save.assert_not_called()
    assert out["months"] == _STORED["months"]
    assert out.get("stale") is True


# admin lane — export_points는 months 기준, saved는 stale의 역
def _admin_client(router):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from auth import require_admin
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    return TestClient(app)


def test_refresh_monthly_kr_reports_months_and_saved_true(monkeypatch):
    import routers.market_indicators as mi
    monkeypatch.setattr(mi, "_fetch_and_save_kr_exports", lambda: _FRESH)
    resp = _admin_client(mi.router).post("/api/market/refresh-monthly?market=KR")
    assert resp.status_code == 200
    assert resp.json()["export_points"] == 1      # 옛 코드는 'history' 키를 봐서 항상 0
    assert resp.json()["saved"] is True


def test_refresh_monthly_kr_reports_saved_false_when_skipped(monkeypatch):
    import routers.market_indicators as mi
    monkeypatch.setattr(mi, "_fetch_and_save_kr_exports", lambda: {**_STORED, "stale": True})
    resp = _admin_client(mi.router).post("/api/market/refresh-monthly?market=KR")
    assert resp.status_code == 200
    assert resp.json()["export_points"] == 1
    assert resp.json()["saved"] is False


# ─────────────────── S2. KR 업종 역인덱스 (G3) ───────────────────

_SECTORS_OK = [{"name": "반도체", "code": "013", "return_1w": 1.2, "return_1mo": 3.4, "return_3mo": 5.6}]
_SECTORS_ALL_NONE = [{"name": "반도체", "code": "013", "return_1w": None, "return_1mo": None, "return_3mo": None}]
_PREV_INDEX = {"005930": "반도체", "000660": "반도체"}


def test_kr_sector_empty_index_preserves_previous(monkeypatch, caplog):
    import services.kr_sector_service as mod
    monkeypatch.setattr(mod, "compute_momentum", lambda: _SECTORS_OK)
    monkeypatch.setattr(mod, "build_sector_index", lambda: {})
    monkeypatch.setattr(mod, "load_sector_index", lambda: _PREV_INDEX)
    with patch.object(mod, "save") as mock_save:
        with caplog.at_level(logging.WARNING):
            out = mod.refresh()
    assert mock_save.call_count == 1
    saved_sectors, saved_index = mock_save.call_args[0]
    assert saved_sectors == _SECTORS_OK          # 모멘텀은 새 값으로 갱신
    assert saved_index == _PREV_INDEX            # 역인덱스는 직전값 보존
    assert out == _SECTORS_OK
    assert any("역인덱스" in r.message for r in caplog.records)


def test_kr_sector_normal_index_is_saved(monkeypatch):
    import services.kr_sector_service as mod
    fresh_index = {"005930": "반도체"}
    monkeypatch.setattr(mod, "compute_momentum", lambda: _SECTORS_OK)
    monkeypatch.setattr(mod, "build_sector_index", lambda: fresh_index)
    monkeypatch.setattr(mod, "load_sector_index", lambda: _PREV_INDEX)
    with patch.object(mod, "save") as mock_save:
        mod.refresh()
    assert mock_save.call_count == 1
    assert mock_save.call_args[0][1] == fresh_index


def test_kr_sector_all_none_still_skips_save_entirely(monkeypatch):
    """회귀: index 폴백이 기존 all-None 가드를 우회하면 안 된다."""
    import services.kr_sector_service as mod
    monkeypatch.setattr(mod, "compute_momentum", lambda: _SECTORS_ALL_NONE)
    monkeypatch.setattr(mod, "build_sector_index", lambda: {})
    monkeypatch.setattr(mod, "load_sector_index", lambda: _PREV_INDEX)
    with patch.object(mod, "save") as mock_save:
        out = mod.refresh()
    mock_save.assert_not_called()
    assert out == _SECTORS_ALL_NONE


def test_refresh_kr_sector_reports_index_size(monkeypatch):
    import routers.analysis as an
    monkeypatch.setattr(an.kr_sector_service, "refresh", lambda: _SECTORS_OK)
    monkeypatch.setattr(an.kr_sector_service, "load_sector_index", lambda: _PREV_INDEX)
    resp = _admin_client(an.router).post("/api/analysis/sector/refresh-kr")
    assert resp.status_code == 200
    assert resp.json()["sectors"] == 1
    assert resp.json()["index"] == 2
