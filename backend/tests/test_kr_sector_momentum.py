"""KR 업종 모멘텀 계산 + market_cache 저장/로드 라운드트립 (task 48, S2)."""
import services.kr_sector_service as svc


def _ascending_closes(n=70, start=100.0, step=1.0):
    return [start + i * step for i in range(n)]


def test_momentum_from_closes_reuses_calc_return():
    # analysis_service._calc_return과 동일 계산(5d/21d/63d) 재사용 검증.
    from services.analysis_service import _calc_return
    import pandas as pd
    closes = _ascending_closes()
    series = pd.Series(closes)
    m = svc.momentum_from_closes("전기/전자", "013", closes)
    assert m["name"] == "전기/전자"
    assert m["code"] == "013"
    assert m["return_1w"] == _calc_return(series, 5)
    assert m["return_1mo"] == _calc_return(series, 21)
    assert m["return_3mo"] == _calc_return(series, 63)


def test_momentum_short_series_returns_none():
    m = svc.momentum_from_closes("화학", "008", [100.0, 101.0, 102.0])
    assert m["return_1w"] is None
    assert m["return_1mo"] is None
    assert m["return_3mo"] is None


def test_save_and_load_roundtrip(monkeypatch):
    store = {}

    def fake_save(key, data):
        store[key] = data

    def fake_load(key):
        return {"data": store[key], "fetched_at": "2026-06-14T00:00:00Z"} if key in store else None

    monkeypatch.setattr(svc, "_mc_save", fake_save)
    monkeypatch.setattr(svc, "_mc_load", fake_load)

    sectors = [
        {"name": "화학", "code": "008", "return_1w": 1.0, "return_1mo": 2.0, "return_3mo": 3.0},
        {"name": "금융", "code": "021", "return_1w": -0.5, "return_1mo": 0.5, "return_3mo": 1.5},
    ]
    svc.save(sectors, {})
    assert store[svc.CACHE_KEY] == {"sectors": sectors, "index": {}}

    loaded = svc.load_momentum()
    assert loaded == sectors


def test_load_momentum_empty_when_missing(monkeypatch):
    monkeypatch.setattr(svc, "_mc_load", lambda key: None)
    assert svc.load_momentum() == []


# ── task 50 S1: {sectors, index} 저장 페이로드 + all-None 박제 방지 + 로깅 ──────
def test_save_stores_sectors_and_index(monkeypatch):
    store = {}
    monkeypatch.setattr(svc, "_mc_save", lambda key, data: store.__setitem__(key, data))

    sectors = [{"name": "화학", "code": "008", "return_1w": 1.0, "return_1mo": 2.0, "return_3mo": 3.0}]
    index = {"051910": "화학"}
    svc.save(sectors, index)
    assert store[svc.CACHE_KEY] == {"sectors": sectors, "index": index}


def test_load_sector_index_roundtrip(monkeypatch):
    store = {}
    monkeypatch.setattr(svc, "_mc_save", lambda key, data: store.__setitem__(key, data))
    monkeypatch.setattr(svc, "_mc_load",
                        lambda key: {"data": store[key], "fetched_at": "x"} if key in store else None)

    sectors = [{"name": "화학", "code": "008", "return_1w": 1.0, "return_1mo": 2.0, "return_3mo": 3.0}]
    index = {"051910": "화학", "005930": "전기/전자"}
    svc.save(sectors, index)
    assert svc.load_sector_index() == index
    # load_momentum도 동일 페이로드에서 sectors를 읽는다(공존)
    assert svc.load_momentum() == sectors


def test_load_sector_index_empty_when_missing(monkeypatch):
    monkeypatch.setattr(svc, "_mc_load", lambda key: None)
    assert svc.load_sector_index() == {}


def _all_none_sectors():
    return [
        {"name": "화학", "code": "008", "return_1w": None, "return_1mo": None, "return_3mo": None},
        {"name": "금융", "code": "021", "return_1w": None, "return_1mo": None, "return_3mo": None},
    ]


def test_refresh_skips_save_when_all_none(monkeypatch, capsys):
    """모든 sector의 모멘텀이 None이면(빈 종가 박제 케이스) save를 생략해 직전 양호값을 보존한다."""
    saved = []
    monkeypatch.setattr(svc, "compute_momentum", lambda: _all_none_sectors())
    monkeypatch.setattr(svc, "build_sector_index", lambda: {"051910": "화학"})
    monkeypatch.setattr(svc, "save", lambda sectors, index: saved.append((sectors, index)))

    out = svc.refresh()
    assert saved == []                      # 미저장 → 직전값 유지
    assert out == _all_none_sectors()       # 계산값은 그대로 반환
    assert "all-None" in capsys.readouterr().out  # 사실 로깅


def test_refresh_saves_when_partial_success(monkeypatch):
    """일부 sector라도 모멘텀이 있으면 {sectors, index}로 저장한다."""
    saved = []
    sectors = [
        {"name": "화학", "code": "008", "return_1w": 1.0, "return_1mo": None, "return_3mo": None},
        {"name": "금융", "code": "021", "return_1w": None, "return_1mo": None, "return_3mo": None},
    ]
    index = {"051910": "화학"}
    monkeypatch.setattr(svc, "compute_momentum", lambda: sectors)
    monkeypatch.setattr(svc, "build_sector_index", lambda: index)
    monkeypatch.setattr(svc, "save", lambda s, i: saved.append((s, i)))

    out = svc.refresh()
    assert saved == [(sectors, index)]
    assert out == sectors


def test_fetch_one_sector_logs_on_empty_closes(monkeypatch, capsys):
    """ka20006이 빈 종가를 주면 조용히 삼키지 않고 로깅한다(all-None 진단 가능)."""
    monkeypatch.setattr(svc.kw_sector, "fetch_sector_closes", lambda code, max_items=100: [])
    out = svc._fetch_one_sector({"code": "008", "name": "화학"})
    assert out["return_1w"] is None and out["return_1mo"] is None and out["return_3mo"] is None
    log = capsys.readouterr().out
    assert "008" in log and ("empty" in log.lower() or "빈" in log)


def test_fetch_one_sector_logs_on_exception(monkeypatch, capsys):
    """fetch 예외도 조용히 삼키지 않고 로깅한다(조용한 삼킴 제거)."""
    def boom(code, max_items=100):
        raise RuntimeError("kiwoom timeout")
    monkeypatch.setattr(svc.kw_sector, "fetch_sector_closes", boom)
    out = svc._fetch_one_sector({"code": "008", "name": "화학"})
    assert out["return_1w"] is None
    log = capsys.readouterr().out
    assert "008" in log and ("timeout" in log.lower() or "fail" in log.lower() or "실패" in log)
