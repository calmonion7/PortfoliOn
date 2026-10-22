"""parse_dramexchange — 라이브 홈 + Wayback 스냅샷 픽스처로 대조."""
import math
from datetime import date
from pathlib import Path

from services.market_indicators.semiconductor import parse_dramexchange

FIX = Path(__file__).parent / "fixtures"
KEYS = ["dram_spot", "module", "flash", "gddr", "wafer", "memory_card"]


def _read(name):
    return (FIX / name).read_text(encoding="utf-8", errors="ignore")


def test_today_fixture_6_categories_23_items():
    r = parse_dramexchange(_read("dramexchange_home_20261022.html"), ref_date=date(2026, 10, 22))
    cats = r["categories"]
    assert [c["key"] for c in cats] == KEYS
    assert [len(c["items"]) for c in cats] == [7, 3, 4, 2, 3, 4]
    assert sum(len(c["items"]) for c in cats) == 23
    dram = cats[0]
    assert dram["label"] == "DRAM 현물" and dram["updated_at"] == "2026-10-22"
    assert all(c["updated_at"] == "2026-10-12" for c in cats[1:])
    first = dram["items"][0]
    assert first["id"] == "dram:475"
    assert (first["high"], first["low"], first["avg"], first["change_pct"]) == (71.0, 47.0, 61.1, 0.38)
    ids = [i["id"] for c in cats for i in c["items"]]
    assert len(set(ids)) == 23
    assert "wafer:1" in ids and "GDDR:1" in ids
    # 음수 등락 부호 보존
    assert dram["items"][3]["change_pct"] == -0.36


def test_wayback_dram_ids_match_today():
    today = parse_dramexchange(_read("dramexchange_home_20261022.html"), ref_date=date(2026, 10, 22))
    old = parse_dramexchange(_read("dramexchange_wayback_20260116.html"), ref_date=date(2026, 1, 16))
    t = [i["id"] for i in today["categories"][0]["items"]]
    o = [i["id"] for i in old["categories"][0]["items"]]
    assert len(o) == 7 and o == t
    assert old["categories"][0]["updated_at"] == "2026-01-16"
    assert old["categories"][1]["updated_at"] == "2026-01-05"
    assert old["categories"][0]["items"][0]["avg"] == 35.0


def test_empty_and_broken_html():
    for h in ("", "<html", "<div class='left_tab'><td>x</td>", None):
        assert parse_dramexchange(h) == {"categories": []}


def test_year_inference_across_boundary():
    # 1월 초 스냅샷이 12월 갱신일을 담으면 전년도
    html = _read("dramexchange_home_20261022.html").replace("Oct.12 2026", "Dec.30").replace("Oct.22 2026", "Jan.2")
    r = parse_dramexchange(html, ref_date=date(2027, 1, 3))
    cats = r["categories"]
    assert cats[0]["updated_at"] == "2027-01-02"
    assert cats[1]["updated_at"] == "2026-12-30"


def test_no_nonfinite_numbers():
    html = _read("dramexchange_home_20261022.html").replace("61.100", "nan")
    r = parse_dramexchange(html, ref_date=date(2026, 10, 22))
    assert r["categories"][0]["items"][0]["avg"] is None
    for c in r["categories"]:
        for i in c["items"]:
            for k in ("avg", "high", "low", "change_pct"):
                assert i[k] is None or math.isfinite(i[k])


# ── S2: 저장·일 배치·조회 ─────────────────────────────────────────────────────
import copy
from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import services.market_indicators.semiconductor as sc


def _item(id_, avg, hist=None):
    return {"id": id_, "name": id_, "avg": avg, "high": avg + 1, "low": avg - 1, "change_pct": 0.1,
            "history": hist if hist is not None else []}


def _cat(key, day, items):
    return {"key": key, "label": key, "updated_at": day, "items": items}


def _seed():
    return {"categories": [
        _cat("dram_spot", "2026-10-21", [_item("dram:1", 10.0, [{"date": "2026-10-20", "value": 9.0},
                                                               {"date": "2026-10-21", "value": 10.0}])]),
        _cat("module", "2026-10-12", [_item("mod:1", 5.0, [{"date": "2026-10-12", "value": 5.0}])]),
    ]}


def _parsed(day_dram="2026-10-22", avg=12.0, with_module=True):
    cats = [_cat("dram_spot", day_dram, [{"id": "dram:1", "name": "n", "avg": avg, "high": 13.0,
                                          "low": 11.0, "change_pct": 1.0}])]
    if with_module:
        cats.append(_cat("module", "2026-10-12", [{"id": "mod:1", "name": "n", "avg": 5.0, "high": 6.0,
                                                   "low": 4.0, "change_pct": 0.0}]))
    return {"categories": cats}


@pytest.fixture
def store(monkeypatch):
    """_mc_load_strict/_mc_save를 인메모리로 대체. 저장 호출을 saves에 기록."""
    state = {"data": _seed(), "saves": []}
    load = (lambda key: {"data": copy.deepcopy(state["data"]), "fetched_at": "2026-10-21T00:00:00+00:00"}
            if state["data"] else None)
    monkeypatch.setattr(sc, "_mc_load_strict", load)
    monkeypatch.setattr(sc, "_mc_load", load)

    def save(key, data):
        state["saves"].append(copy.deepcopy(data))
        state["data"] = copy.deepcopy(data)

    monkeypatch.setattr(sc, "_mc_save", save)
    return state


def _fetch_returns(monkeypatch, parsed):
    monkeypatch.setattr(sc, "_fetch_home_html", lambda: "<html/>")
    monkeypatch.setattr(sc, "parse_dramexchange", lambda html, ref_date=None: parsed)


def _full(parsed):
    """6분류 전부 담은 페이로드(누락 없음 = success)."""
    have = {c["key"] for c in parsed["categories"]}
    extra = [_cat(k, "2026-10-12", [{"id": f"{k}:1", "name": k, "avg": 1.0, "high": 2.0, "low": 0.5,
                                     "change_pct": 0.0}]) for k in KEYS if k not in have]
    return {"categories": parsed["categories"] + extra}


def test_success_merges_history_and_dedupes(monkeypatch, store):
    _fetch_returns(monkeypatch, _full(_parsed(day_dram="2026-10-22", avg=12.0)))
    out = sc.fetch_and_save_memory_spot()
    assert out["_status"] == "success"
    dram = next(c for c in out["categories"] if c["key"] == "dram_spot")["items"][0]
    assert dram["avg"] == 12.0
    assert [p["date"] for p in dram["history"]] == ["2026-10-20", "2026-10-21", "2026-10-22"]
    # 같은 날짜 재실행은 덮어쓰기(중복 없음)
    _fetch_returns(monkeypatch, _full(_parsed(day_dram="2026-10-22", avg=12.5)))
    out = sc.fetch_and_save_memory_spot()
    hist = next(c for c in out["categories"] if c["key"] == "dram_spot")["items"][0]["history"]
    assert [p["date"] for p in hist] == ["2026-10-20", "2026-10-21", "2026-10-22"]
    assert hist[-1]["value"] == 12.5
    assert "_status" not in store["saves"][-1]  # 저장 캐시에는 메타가 섞이지 않는다


def test_fetch_raises_preserves_previous(monkeypatch, store):
    def boom():
        raise RuntimeError("dramexchange down")
    monkeypatch.setattr(sc, "_fetch_home_html", boom)
    before = copy.deepcopy(store["data"])
    out = sc.fetch_and_save_memory_spot()
    assert out["_status"] == "skipped"
    assert store["saves"] == []
    assert out["categories"] == before["categories"]


def test_empty_parse_preserves_previous(monkeypatch, store):
    _fetch_returns(monkeypatch, {"categories": []})
    out = sc.fetch_and_save_memory_spot()
    assert out["_status"] == "skipped"
    assert store["saves"] == []
    assert out["categories"] == store["data"]["categories"]


def test_missing_category_keeps_previous_category(monkeypatch, store):
    _fetch_returns(monkeypatch, _parsed(with_module=False))
    out = sc.fetch_and_save_memory_spot()
    assert out["_status"] == "partial"
    cats = {c["key"]: c for c in out["categories"]}
    assert cats["dram_spot"]["items"][0]["avg"] == 12.0
    assert cats["module"]["items"][0]["avg"] == 5.0  # 직전값 보존
    assert cats["module"]["items"][0]["history"] == [{"date": "2026-10-12", "value": 5.0}]
    assert len(store["saves"]) == 1


def test_older_snapshot_only_adds_history(monkeypatch, store):
    """백필(S3)용: 저장값보다 오래된 스냅샷은 history만 채우고 현재 필드는 덮지 않는다."""
    sc.merge_and_save_memory_spot(_parsed(day_dram="2026-10-01", avg=7.0))
    dram = next(c for c in store["data"]["categories"] if c["key"] == "dram_spot")
    assert dram["updated_at"] == "2026-10-21" and dram["items"][0]["avg"] == 10.0
    assert [p["date"] for p in dram["items"][0]["history"]] == ["2026-10-01", "2026-10-20", "2026-10-21"]


def test_none_avg_does_not_clobber(monkeypatch, store):
    p = _parsed()
    p["categories"][0]["items"][0]["avg"] = None
    _fetch_returns(monkeypatch, p)
    out = sc.fetch_and_save_memory_spot()
    dram = next(c for c in out["categories"] if c["key"] == "dram_spot")["items"][0]
    assert dram["avg"] == 10.0 and len(dram["history"]) == 2


def test_load_failure_propagates_without_saving(monkeypatch, store):
    def bad(key):
        raise RuntimeError("db down")
    monkeypatch.setattr(sc, "_mc_load_strict", bad)
    _fetch_returns(monkeypatch, _parsed())
    with pytest.raises(RuntimeError):
        sc.fetch_and_save_memory_spot()
    assert store["saves"] == []


def _no_network(monkeypatch):
    def fail(*a, **k):
        raise AssertionError("요청경로 외부 호출 금지")
    monkeypatch.setattr(sc.requests, "get", fail)


def test_get_returns_stored_without_network(monkeypatch):
    _no_network(monkeypatch)
    monkeypatch.setattr(sc, "_mc_load_strict", lambda key: {"data": _seed(), "fetched_at": "2026-10-21T00:00:00+00:00"})
    out = sc.get_memory_spot()
    assert out["fetched_at"] == "2026-10-21T00:00:00+00:00"
    assert out["categories"][0]["items"][0]["history"][-1]["value"] == 10.0


def test_get_nothing_stored(monkeypatch):
    _no_network(monkeypatch)
    monkeypatch.setattr(sc, "_mc_load_strict", lambda key: None)
    assert sc.get_memory_spot() == {"categories": [], "fetched_at": None}


def test_get_load_failure_propagates_not_empty(monkeypatch):
    """조회 실패는 '없음'(200+빈 목록)으로 접히지 않고 전파된다(라우터가 500)."""
    _no_network(monkeypatch)
    def bad(key):
        raise RuntimeError("db down")
    monkeypatch.setattr(sc, "_mc_load_strict", bad)
    monkeypatch.setattr(sc, "_mc_load", lambda key: None)  # graceful 경로가 쓰이면 빈 결과로 접힌다
    with pytest.raises(RuntimeError):
        sc.get_memory_spot()


def _client(dep):
    from routers.market_indicators import router
    from auth import get_current_user, require_admin
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin if dep == "admin" else get_current_user] = lambda: "u"
    return TestClient(app)


def test_routes_require_auth():
    from routers.market_indicators import router
    app = FastAPI()
    app.include_router(router)
    c = TestClient(app)
    assert c.get("/api/market/semiconductor").status_code == 401
    assert c.post("/api/market/refresh-memory-spot").status_code in (401, 403)


def test_get_route_reads_stored(monkeypatch):
    import routers.market_indicators as mi
    monkeypatch.setattr(mi, "get_memory_spot", lambda: {"categories": [], "fetched_at": None})
    r = _client("user").get("/api/market/semiconductor")
    assert r.status_code == 200 and r.json() == {"categories": [], "fetched_at": None}


@pytest.mark.parametrize("status,expected", [("success", "updated"), ("partial", "updated"), ("skipped", "skipped")])
def test_refresh_route_distinguishes_updated_and_skipped(monkeypatch, status, expected):
    import routers.market_indicators as mi
    run = MagicMock()

    @contextmanager
    def rec(job_id, trigger):
        assert (job_id, trigger) == ("memory_spot_fetch", "manual")
        yield run

    monkeypatch.setattr(mi.job_runs, "record", rec)
    monkeypatch.setattr(mi, "fetch_and_save_memory_spot",
                        lambda: {"categories": [{"items": [1, 2]}], "_status": status})
    r = _client("admin").post("/api/market/refresh-memory-spot")
    assert r.status_code == 200
    assert r.json()["status"] == expected
    if status == "success":
        run.set_status.assert_not_called()
    else:
        run.set_status.assert_called_once()


def test_scheduler_job_wired(monkeypatch):
    import scheduler.jobs as jobs
    from services import batch_registry
    assert jobs._JOB_FUNCS["memory_spot_fetch"] is jobs._refresh_memory_spot
    b = batch_registry.get_batch("memory_spot_fetch")
    assert b["market"] == "공통" and b["source"] == ["DRAMeXchange"] and b["usage"] == ["시장지표 탭"]
    assert b["default_schedule"] == {"enabled": True, "type": "daily", "time": "19:40"}
    assert b["manual_endpoint"] == "/api/market/refresh-memory-spot"

    run = MagicMock()

    @contextmanager
    def rec(job_id, trigger):
        assert (job_id, trigger) == ("memory_spot_fetch", "auto")
        yield run

    monkeypatch.setattr(jobs.job_runs, "record", rec)
    monkeypatch.setattr(sc, "fetch_and_save_memory_spot", lambda: {"categories": [], "_status": "skipped"})
    jobs._refresh_memory_spot()
    run.set_status.assert_called_once()
    assert run.set_status.call_args[0][0] == "skipped"


# ── S3: 아카이브 백필 ─────────────────────────────────────────────────────────
class _Resp:
    def __init__(self, text="", js=None, status=200):
        self.text, self._js, self.status_code = text, js, status

    def json(self):
        return self._js

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def _cdx(*tss):
    return [["timestamp"]] + [[t] for t in tss]


@pytest.fixture
def wayback(monkeypatch, store):
    """CDX·스냅샷 응답 모킹 + sleep 기록. snaps: ts -> parse 결과(또는 예외)."""
    st = {"cdx": _cdx(), "snaps": {}, "urls": [], "sleeps": []}

    def get(url, **kw):
        st["urls"].append(url)
        if "/cdx/search/cdx" in url:
            if isinstance(st["cdx"], Exception):
                raise st["cdx"]
            return _Resp(js=st["cdx"])
        ts = url.split("/web/")[1].split("id_/")[0]
        v = st["snaps"][ts]
        if isinstance(v, Exception):
            raise v
        return _Resp(text=ts)

    monkeypatch.setattr(sc.requests, "get", get)
    monkeypatch.setattr(sc.time, "sleep", lambda s: st["sleeps"].append(s))
    monkeypatch.setattr(sc, "parse_dramexchange",
                        lambda html, ref_date=None: st["snaps"][html])
    return st


def _snap(day, avg):
    return {"categories": [_cat("dram_spot", day, [{"id": "dram:1", "name": "n", "avg": avg,
                                                    "high": avg + 1, "low": avg - 1, "change_pct": 0.0}])]}


def test_backfill_merges_sorted_unique_and_idempotent(wayback, store):
    wayback["cdx"] = _cdx("20260103000000", "20260102000000", "20260102120000")
    wayback["snaps"] = {"20260103000000": _snap("2026-01-03", 3.0),
                        "20260102000000": _snap("2026-01-02", 2.0),
                        "20260102120000": _snap("2026-01-02", 2.5)}
    r = sc.run_backfill()
    assert r["status"] == "success" and r["snapshots"] == 3 and r["skipped"] == 0
    dram = next(c for c in store["data"]["categories"] if c["key"] == "dram_spot")["items"][0]
    dates = [p["date"] for p in dram["history"]]
    assert dates == sorted(dates) and len(dates) == len(set(dates))
    assert {"2026-01-02", "2026-01-03", "2026-10-20", "2026-10-21"} <= set(dates)
    n = len(dates)
    sc.run_backfill()
    dram = next(c for c in store["data"]["categories"] if c["key"] == "dram_spot")["items"][0]
    assert len(dram["history"]) == n
    # 저장 현재값은 더 최신인 저장값(10-21)이 유지된다
    assert dram["avg"] == 10.0


def test_backfill_cdx_query_and_pacing(wayback):
    wayback["cdx"] = _cdx("20260102000000", "20260103000000")
    wayback["snaps"] = {t: _snap("2026-01-02", 1.0) for t in ("20260102000000", "20260103000000")}
    sc.run_backfill()
    cdx = wayback["urls"][0]
    assert "url=dramexchange.com/" in cdx and "collapse=timestamp:8" in cdx
    assert "filter=statuscode:200" in cdx and "output=json" in cdx and "from=" in cdx
    assert wayback["urls"][1] == "https://web.archive.org/web/20260102000000id_/https://www.dramexchange.com/"
    assert wayback["sleeps"] and all(s >= 1 for s in wayback["sleeps"])
    assert len(wayback["sleeps"]) == 1  # 요청 사이에만(2건 -> 1회)


def test_backfill_failing_snapshot_skipped_and_counted(wayback, store):
    wayback["cdx"] = _cdx("20260102000000", "20260103000000", "20260104000000")
    wayback["snaps"] = {"20260102000000": _snap("2026-01-02", 2.0),
                        "20260103000000": RuntimeError("503"),
                        "20260104000000": {"categories": []}}
    r = sc.run_backfill()
    assert r["status"] == "partial" and r["snapshots"] == 1 and r["skipped"] == 2
    dram = next(c for c in store["data"]["categories"] if c["key"] == "dram_spot")["items"][0]
    assert "2026-01-02" in [p["date"] for p in dram["history"]]


def test_backfill_all_fail_or_cdx_fail_is_failed_and_no_save(wayback, store):
    wayback["cdx"] = RuntimeError("cdx down")
    assert sc.run_backfill()["status"] == "failed"
    wayback["cdx"] = _cdx("20260102000000")
    wayback["snaps"] = {"20260102000000": RuntimeError("x")}
    assert sc.run_backfill()["status"] == "failed"
    wayback["cdx"] = _cdx()
    assert sc.run_backfill()["status"] == "failed"
    assert store["saves"] == []


def test_backfill_flag_released_and_single_flight(wayback):
    assert sc.try_start_backfill() is True
    assert sc.try_start_backfill() is False
    wayback["cdx"] = RuntimeError("down")
    sc.run_backfill()  # finally에서 플래그 해제
    assert sc.try_start_backfill() is True
    sc.run_backfill()


def test_backfill_route_starts_background_and_rejects_concurrent(monkeypatch):
    import routers.market_indicators as mi
    ran = []
    run = MagicMock()

    @contextmanager
    def rec(job_id, trigger):
        assert (job_id, trigger) == ("memory_spot_fetch", "manual")
        yield run

    monkeypatch.setattr(mi.job_runs, "record", rec)
    monkeypatch.setattr(mi, "run_backfill",
                        lambda: ran.append(1) or {"status": "partial", "snapshots": 1, "skipped": 1})
    c = _client("admin")
    assert c.post("/api/market/backfill-memory-spot").json() == {"status": "started"}
    assert ran == [1]  # TestClient는 응답 후 BackgroundTasks를 실행한다
    run.set_status.assert_called_once()
    assert run.set_status.call_args[0][0] == "partial"
    assert sc.try_start_backfill() is True
    try:
        assert c.post("/api/market/backfill-memory-spot").json() == {"status": "already_running"}
    finally:
        sc._set_backfill_idle()


def test_backfill_route_requires_admin():
    from routers.market_indicators import router
    app = FastAPI()
    app.include_router(router)
    assert TestClient(app).post("/api/market/backfill-memory-spot").status_code in (401, 403)
