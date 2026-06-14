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
    svc.save_momentum(sectors)
    assert store[svc.CACHE_KEY] == {"sectors": sectors}

    loaded = svc.load_momentum()
    assert loaded == sectors


def test_load_momentum_empty_when_missing(monkeypatch):
    monkeypatch.setattr(svc, "_mc_load", lambda key: None)
    assert svc.load_momentum() == []
