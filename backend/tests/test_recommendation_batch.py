"""S5: recommendation_kr/us 배치 본문 + registry 확정 (.forge/adr/0015).

배치 id 4표면 일관: registry read·market 분류·job_runs.record(auto+manual)·테스트.
scheduler._recommendation_work는 funnel.run_recommendation_batch를 호출하는 얇은 래퍼
(silent except 금지 패턴). 요청·기동 경로 라이브 호출 0(배치만 외부 fetch).
"""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
import pytest

from unittest.mock import patch


# ── 저유동성 픽스처/배선 (#68) ─────────────────────────────────────────────────
# _enrich_one 반환 shape: 신호 있으면 {"factors", "low_liquidity"}, 없으면 None.
# run_recommendation_batch: scored row에 low_liquidity 실림 + 통계 dict 카운트.

def _u(ticker, market, name, cap, guru=False, exchange=""):
    return {"ticker": ticker, "market": market, "name": name,
            "market_cap": cap, "guru_member": guru, "exchange": exchange}


def _ohlc(closes, volumes):
    n = len(closes)
    idx = pd.date_range("2026-01-01", periods=n, freq="D")
    return pd.DataFrame(
        {"Open": closes, "High": [c * 1.0 for c in closes],
         "Low": [c * 0.9 for c in closes], "Close": closes, "Volume": volumes},
        index=idx,
    )


def test_enrich_one_returns_dict_with_low_liquidity_when_signal():
    from services.recommendation import funnel as F
    cand = _u("000660", "KR", "하이닉스", 300)
    # 거래대금 ≪ KR 1e9 → low_liquidity True, upside 신호로 _has_signal True
    df = _ohlc([10_000.0] * 30, volumes=[1000] * 30)
    with patch.object(F, "_fetch_history", return_value=df), \
         patch.object(F, "_consensus_upside", return_value=28.0), \
         patch.object(F, "_kr_supply", return_value=(None, None)), \
         patch.object(F, "_kr_insider", return_value=None):
        res = F._enrich_one(cand, set())
    assert isinstance(res, dict)
    assert set(res.keys()) == {"factors", "low_liquidity"}
    assert isinstance(res["factors"], dict)
    assert res["low_liquidity"] is True


def test_enrich_one_none_when_no_signal():
    from services.recommendation import funnel as F
    cand = _u("000660", "KR", "하이닉스", 300)
    # 히스토리 없음·컨센서스 없음·수급 없음·지분 없음 → 산출 근거 0 → None
    with patch.object(F, "_fetch_history", return_value=None), \
         patch.object(F, "_consensus_upside", return_value=None), \
         patch.object(F, "_kr_supply", return_value=(None, None)), \
         patch.object(F, "_kr_insider", return_value=None):
        res = F._enrich_one(cand, set())
    assert res is None


def test_run_batch_low_liquidity_count_mixed():
    from services.recommendation import funnel as F
    uni = [_u("LOWLIQ", "US", "Thin", 500), _u("BIGCAP", "US", "Liquid", 400)]
    # LOWLIQ: 거래대금 10*1000=10,000 < 1M → 저유동성
    # BIGCAP: 거래대금 10*500,000=5,000,000 ≥ 1M → 정상
    history = {"LOWLIQ": _ohlc([10.0] * 30, volumes=[1000] * 30),
               "BIGCAP": _ohlc([10.0] * 30, volumes=[500_000] * 30)}
    upside = {"LOWLIQ": 20.0, "BIGCAP": 15.0}

    captured = {}

    def _fake_replace(market, rows):
        captured["rows"] = rows

    with patch.object(F, "build_universe", return_value=uni), \
         patch.object(F, "_fetch_guru_tickers", return_value=[]), \
         patch.object(F, "replace_recommendations", side_effect=_fake_replace), \
         patch.object(F, "_fetch_history", side_effect=lambda c: history.get(c["ticker"])), \
         patch.object(F, "_consensus_upside", side_effect=lambda c, df: upside.get(c["ticker"])):
        stats = F.run_recommendation_batch("US")

    assert stats["scored"] == 2
    assert stats["low_liquidity"] == 1  # LOWLIQ만 저유동성
    by_ticker = {r["ticker"]: r for r in captured["rows"]}
    assert by_ticker["LOWLIQ"]["low_liquidity"] is True
    assert by_ticker["BIGCAP"]["low_liquidity"] is False


def test_run_batch_scored_rows_carry_exchange():
    """scored row가 유니버스 cand의 exchange를 담는다(KR=KS/KQ, US='')."""
    from services.recommendation import funnel as F
    uni = [_u("005930", "KR", "삼성", 500, exchange="KS"),
           _u("AAPL", "US", "Apple", 400, exchange="")]
    history = {"005930": _ohlc([10_000.0] * 30, volumes=[1_000_000] * 30),
               "AAPL": _ohlc([100.0] * 30, volumes=[1_000_000] * 30)}
    upside = {"005930": 20.0, "AAPL": 15.0}

    captured = {}

    with patch.object(F, "build_universe", return_value=uni), \
         patch.object(F, "_fetch_guru_tickers", return_value=[]), \
         patch.object(F, "replace_recommendations",
                      side_effect=lambda m, rows: captured.__setitem__("rows", rows)), \
         patch.object(F, "_fetch_history", side_effect=lambda c: history.get(c["ticker"])), \
         patch.object(F, "_consensus_upside", side_effect=lambda c, df: upside.get(c["ticker"])):
        # KR 유니버스만 통과(market 필터)하므로 KR 시장으로 돌린다
        F.run_recommendation_batch("KR")

    by_ticker = {r["ticker"]: r for r in captured["rows"]}
    assert by_ticker["005930"]["exchange"] == "KS"


# ── 배치 레지스트리 엔트리 (recommendation_kr/us) ──────────────────────────────

def test_registry_has_recommendation_kr():
    from services import batch_registry
    e = batch_registry.get_batch("recommendation_kr")
    assert e is not None
    assert e["market"] == "KR"
    assert e["editable"] is True
    assert e["trigger_kinds"] == ["auto", "manual"]
    assert e["scheduler_job_id"] == "recommendation_kr"
    assert e["timezone"] == "Asia/Seoul"
    assert e["manual_endpoint"] == "/api/recommendations/refresh?market=KR"
    assert e["default_schedule"] == {"enabled": True, "type": "daily", "time": "20:30"}


def test_registry_has_recommendation_us():
    from services import batch_registry
    e = batch_registry.get_batch("recommendation_us")
    assert e is not None
    assert e["market"] == "US"
    assert e["editable"] is True
    assert e["trigger_kinds"] == ["auto", "manual"]
    assert e["scheduler_job_id"] == "recommendation_us"
    assert e["timezone"] == "Asia/Seoul"
    assert e["manual_endpoint"] == "/api/recommendations/refresh?market=US"
    assert e["default_schedule"] == {"enabled": True, "type": "daily", "time": "07:00"}


def test_recommendation_entries_have_source_and_usage():
    from services import batch_registry
    for jid in ("recommendation_kr", "recommendation_us"):
        e = batch_registry.get_batch(jid)
        assert isinstance(e["source"], list) and len(e["source"]) > 0, jid
        assert all(isinstance(s, str) and s.strip() for s in e["source"]), jid
        assert isinstance(e["usage"], list) and len(e["usage"]) > 0, jid


# ── scheduler 잡 배선 (_JOB_FUNCS + auto record + funnel 호출) ──────────────────

@pytest.fixture
def spy(monkeypatch):
    calls = []

    @contextmanager
    def fake_record(job_id, trigger):
        calls.append((job_id, trigger))
        yield 1

    import services.job_runs as job_runs
    monkeypatch.setattr(job_runs, "record", fake_record)
    return calls


def test_job_funcs_wires_recommendation_ids():
    import scheduler
    assert "recommendation_kr" in scheduler._JOB_FUNCS
    assert "recommendation_us" in scheduler._JOB_FUNCS


def test_fetch_recommendation_kr_records_auto_and_calls_funnel(spy, monkeypatch):
    import scheduler
    from services import recommendation
    called = []
    monkeypatch.setattr(recommendation, "run_recommendation_batch",
                        lambda market: called.append(market) or {"market": market})
    scheduler._fetch_recommendation_kr()
    assert ("recommendation_kr", "auto") in spy
    assert called == ["KR"]


def test_fetch_recommendation_us_records_auto_and_calls_funnel(spy, monkeypatch):
    import scheduler
    from services import recommendation
    called = []
    monkeypatch.setattr(recommendation, "run_recommendation_batch",
                        lambda market: called.append(market) or {"market": market})
    scheduler._fetch_recommendation_us()
    assert ("recommendation_us", "auto") in spy
    assert called == ["US"]


def test_recommendation_work_swallows_funnel_errors(spy, monkeypatch):
    """funnel 예외는 본문에서 삼키고 로깅 — job_runs는 여전히 기록(래퍼가 깨지지 않음)."""
    import scheduler
    from services import recommendation

    def boom(market):
        raise RuntimeError("fetch failed")

    monkeypatch.setattr(recommendation, "run_recommendation_batch", boom)
    # 예외가 _recommendation_work 밖으로 전파되지 않아야 한다
    scheduler._fetch_recommendation_kr()
    assert ("recommendation_kr", "auto") in spy


# ── GET /api/batches 노출 (시장별 분류) ──────────────────────────────────────

def test_batches_endpoint_exposes_recommendation_markets(client):
    with patch("routers.batches.job_runs.recent", return_value=[]), \
         patch("routers.batches.storage.get_batch_schedule", return_value=None), \
         patch.object(__import__("scheduler"), "_scheduler") as mock_sched:
        mock_sched.get_job.return_value = None
        resp = client.get("/api/batches")
    assert resp.status_code == 200
    by_id = {b["id"]: b for b in resp.json()}
    assert by_id["recommendation_kr"]["market"] == "KR"
    assert by_id["recommendation_us"]["market"] == "US"
    assert by_id["recommendation_kr"]["schedule_desc"]
    assert by_id["recommendation_us"]["schedule_desc"]
