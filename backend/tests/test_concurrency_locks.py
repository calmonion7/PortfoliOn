"""B68·B69 — 읽기-계산-쓰기와 캐시 dict 조작의 동시성 가드.

`services/db.py`의 `query()`/`execute()`는 **각각 독립 커넥션·트랜잭션**을 연다.
그래서 그 사이를 다른 실행이 끼어들면 서로의 계산 결과를 덮는다(lost update).
`services/cache.py`는 락이 전혀 없어 dict 조작이 서로를 깨뜨린다.

이 파일의 동시성 축은 전부 **강제 인터리빙**이다 — `threading.Barrier`로 두 스레드를
임계구간에서 만나게 하거나, barrier를 두 번 써서 "상대가 끝난 뒤에야 재개"를 못박는다.
「운 좋게 안 겹쳤다」로 통과하는 축은 이빨이 없다(가드 있는 쪽에서 barrier가 timeout으로
깨지는 것 자체가 "인터리빙이 불가능해졌다"는 증거다).
"""
import json
import threading
import time
from collections import OrderedDict
from unittest.mock import patch


# ══════════════════════ B68 — save_guru_managers 읽기-병합-쓰기 ══════════════════════

def _mgr(mid, name):
    return {"id": mid, "name": name}


def test_concurrent_save_guru_managers_does_not_lose_updates():
    """동시 크롤 2회가 인터리빙해도 서로의 병합결과를 덮지 않는다.

    시나리오: 명부 83명. 크롤 A는 0~39만, 크롤 B는 40~82만 성공한다(각자 나머지는
    직전값으로 백필). 직렬화되면 나중 크롤이 앞선 크롤의 신선분을 저장분으로 읽어
    보존하므로 최종 83명이 모두 갱신된다. 인터리빙하면 둘 다 초기 저장분을 읽어
    나중 쓰기가 앞선 신선분 40여 명을 'OLD'로 되돌린다.
    """
    from services.storage import schedule as st

    roster = [{"id": str(i)} for i in range(83)]
    db = {"last_updated": "old", "managers": [_mgr(str(i), "OLD") for i in range(83)]}
    db_lock = threading.Lock()          # 가짜 저장소 자체의 원자성(테스트 하니스용)
    # 두 크롤이 **읽기를 모두 끝낸 뒤에야** 쓰기로 넘어가게 강제한다.
    gate = threading.Barrier(2, timeout=0.5)

    def fake_read():
        with db_lock:
            snap = json.loads(json.dumps(db))
        try:
            gate.wait()
        except threading.BrokenBarrierError:
            pass    # 가드가 있으면 상대가 임계구간에 들어오지 못해 여기서 깨진다
        return snap

    def fake_write(_sql, params):
        with db_lock:
            db.clear()
            db.update(json.loads(params[0]))
        return 1

    errors = []

    def crawl(ids, tag):
        try:
            st.save_guru_managers({
                "last_updated": tag,
                "managers": [_mgr(str(i), tag) for i in ids],
                "roster": roster,
            })
        except BaseException as e:       # noqa: BLE001 - 스레드 예외를 본체로 옮긴다
            errors.append(e)

    with patch.object(st, "get_guru_managers", side_effect=fake_read), \
         patch.object(st, "execute", side_effect=fake_write):
        threads = [
            threading.Thread(target=crawl, args=(range(0, 40), "A-NEW")),
            threading.Thread(target=crawl, args=(range(40, 83), "B-NEW")),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)
        assert not any(t.is_alive() for t in threads), "데드락 — 스레드가 끝나지 않았다"

    assert errors == [], f"동시 저장이 예외를 냈다: {errors!r}"
    names = {m["id"]: m["name"] for m in db["managers"]}
    assert len(names) == 83
    lost = sorted(int(i) for i, n in names.items() if n == "OLD")
    assert lost == [], f"lost update — 직전값으로 되돌아간 매니저 {len(lost)}명 {lost[:5]}"


def test_save_guru_managers_single_thread_contract_unchanged():
    """대조군 — 가드가 정상(단일 스레드) 경로의 결과를 바꾸지 않는다.

    연속 2회 호출로 락 미해제·재진입 데드락도 함께 배제한다(2회째가 멈추면 실패).
    """
    from services.storage import schedule as st

    roster = [{"id": str(i)} for i in range(10)]
    stored = {"last_updated": "old", "managers": [_mgr(str(i), "OLD") for i in range(10)]}
    fresh = [_mgr(str(i), "NEW") for i in range(4)]

    with patch.object(st, "get_guru_managers", return_value=stored), \
         patch.object(st, "execute") as mock_exec:
        stats1 = st.save_guru_managers({"last_updated": "n", "managers": fresh, "roster": roster})
        stats2 = st.save_guru_managers({"last_updated": "n", "managers": fresh, "roster": roster})

    assert stats1 == stats2 == {"saved": True, "fresh": 4, "stale": 6, "dropped": 0, "held": 0}
    assert mock_exec.call_count == 2
    payload = json.loads(mock_exec.call_args[0][1][0])
    assert [m["name"] for m in payload["managers"]] == ["NEW"] * 4 + ["OLD"] * 6
    assert "roster" not in payload

    # 빈 결과 경로는 DB에 닿지 않고 즉시 반환한다(직전값 유지, §1.3).
    with patch.object(st, "execute") as mock_exec2:
        assert st.save_guru_managers({"managers": []})["saved"] is False
        mock_exec2.assert_not_called()


# ══════════════════════ B69 — TTLCache / _snapshots dict 조작 ══════════════════════

def test_ttlcache_prune_does_not_rebind_store():
    """만료 정리는 in-place여야 한다 — dict를 재바인딩하면 그 창의 invalidate()가 유실된다."""
    from services.cache import TTLCache

    c = TTLCache(ttl=60.0, maxsize=2)
    c.get("a", lambda: 1)
    c.get("b", lambda: 2)
    c._store["a"] = (1, 0.0)                 # 만료로 위조
    store_before = c._store

    c.get("cc", lambda: 3)                   # len >= maxsize → 정리 경로 진입

    assert c._store is store_before, "정리가 _store를 재바인딩했다 — 동시 invalidate가 유실된다"
    assert "a" not in c._store               # 만료분은 정리됐다
    assert "b" in c._store and c._store["cc"][0] == 3


def test_ttlcache_invalidate_during_loader_is_not_lost():
    """loader 실행 중 들어온 invalidate가 유실되지 않는다(무효화가 조용히 no-op이 되면
    stale 값이 되살아난다)."""
    from services.cache import TTLCache

    c = TTLCache(ttl=60.0)
    # 재사용 가능한 barrier로 두 번 만난다: R1=loader 진입 확인, R2=invalidate 완료 확인.
    gate = threading.Barrier(2, timeout=5.0)

    def loader():
        gate.wait()      # R1
        gate.wait()      # R2 — 본체의 invalidate()가 끝난 뒤에만 통과한다
        return "v1"

    err = []

    def reader():
        try:
            c.get("k", loader)
        except BaseException as e:            # noqa: BLE001
            err.append(e)

    t = threading.Thread(target=reader)
    t.start()
    gate.wait()          # R1
    c.invalidate("k")
    gate.wait()          # R2
    t.join(timeout=5)
    assert not t.is_alive(), "데드락"
    assert err == [], f"{err!r}"
    assert "k" not in c._store, "loader 실행 중 무효화가 유실돼 stale 값이 캐시됐다"


def test_ttlcache_invalidate_during_prune_does_not_raise():
    """정리 순회 중 다른 스레드의 invalidate()가 get()을 깨뜨리지 않는다."""
    from services.cache import TTLCache

    gate = threading.Barrier(2, timeout=5.0)
    fired = []

    class _Hooked(tuple):
        """정리 comprehension이 `v[1]`을 읽는 순간(=임계구간 내부)에 상대를 끼워 넣는다."""

        def __getitem__(self, i):
            if i == 1 and not fired:
                fired.append(1)
                gate.wait()
                # 상대가 clear()를 끝낼 창. 가드가 있으면 상대는 락에서 대기하므로
                # 이 창이 얼마든 무해하다 — 즉 이 sleep은 운이 아니라 창의 하한이다.
                time.sleep(0.1)
            return tuple.__getitem__(self, i)

    c = TTLCache(ttl=60.0, maxsize=2)
    c._store["a"] = _Hooked((1, 0.0))
    c._store["b"] = _Hooked((2, 0.0))

    err = []

    def pruner():
        try:
            c.get("cc", lambda: 3)
        except BaseException as e:            # noqa: BLE001
            err.append(e)

    t = threading.Thread(target=pruner)
    t.start()
    gate.wait()
    c.invalidate()                            # 전체 clear
    t.join(timeout=5)
    assert not t.is_alive(), "데드락"
    assert err == [], f"동시 invalidate가 get()을 깨뜨렸다: {err!r}"


def test_concurrent_get_snapshot_eviction_does_not_raise(monkeypatch):
    """모듈 전역 `_snapshots` 축출(popitem)이 동시 호출에서 KeyError를 내지 않는다."""
    import services.cache as c

    gate = threading.Barrier(2, timeout=0.5)

    def _rendezvous():
        try:
            gate.wait()
        except threading.BrokenBarrierError:
            pass              # 가드가 있으면 상대가 여기 못 들어온다 → 그게 정상

    class _HookedDict(OrderedDict):
        """축출을 2단 랑데부로 감싸 "둘 다 popitem 안에 있는" 상태를 결정적으로 만든다.

        R1 = 상대도 popitem에 진입할 때까지 대기 · R2 = 상대가 pop을 끝내기 전에는
        popitem에서 반환하지 못하게 대기. 그래서 "한쪽이 pop+저장까지 끝내버려서
        우연히 안 겹치는" 경로가 원리적으로 생기지 않는다.
        """

        def popitem(self, last=True):
            _rendezvous()                                 # R1
            try:
                return OrderedDict.popitem(self, last)
            finally:
                _rendezvous()                             # R2

    store = _HookedDict()
    store["SEED/d"] = {"v": 0}
    monkeypatch.setattr(c, "_snapshots", store)
    monkeypatch.setattr(c, "_MAX", 1)

    err = []

    def fetch(tk):
        try:
            c.get_snapshot(tk, "d", lambda: {"v": tk})
        except BaseException as e:            # noqa: BLE001
            err.append(e)

    threads = [threading.Thread(target=fetch, args=(tk,)) for tk in ("AAA", "BBB")]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    assert not any(t.is_alive() for t in threads), "데드락"
    assert err == [], f"동시 축출이 예외를 냈다: {err!r}"
    assert len(store) == 1, f"_MAX=1인데 {len(store)}건 남았다"


def test_cache_single_thread_behavior_unchanged():
    """대조군 — 락이 단일 스레드 동작(hit/miss·TTL 만료·None 미캐시·LRU 축출)을 바꾸지 않는다."""
    import services.cache as c
    from services.cache import TTLCache

    cc = TTLCache(ttl=60.0)
    calls = []
    cc.get("u1", lambda: (calls.append(1), "v")[1])
    assert cc.get("u1", lambda: (calls.append(1), "v")[1]) == "v"
    assert len(calls) == 1                                   # TTL 내 hit
    cc._store["u1"] = (cc._store["u1"][0], 0.0)              # 만료 위조
    cc.get("u1", lambda: (calls.append(1), "v")[1])
    assert len(calls) == 2                                   # 만료 → 재적재
    cc.invalidate("u1")
    cc.get("u1", lambda: (calls.append(1), "v")[1])
    assert len(calls) == 3                                   # 무효화 → 재적재

    c._snapshots.clear()
    snap_calls = []
    c.get_snapshot("AAPL", "d", lambda: (snap_calls.append(1), {"v": 1})[1])
    c.get_snapshot("AAPL", "d", lambda: (snap_calls.append(1), {"v": 1})[1])
    assert len(snap_calls) == 1
    assert c.get_snapshot("MISS", "d", lambda: None) is None
    assert "MISS/d" not in c._snapshots                       # None은 캐시하지 않는다
    original_max = c._MAX
    c._MAX = 2
    try:
        c._snapshots.clear()
        for tk in ("A", "B", "C"):
            c.get_snapshot(tk, "d", lambda: {"v": tk})
        assert "A/d" not in c._snapshots and "C/d" in c._snapshots   # 가장 오래된 것 축출
    finally:
        c._MAX = original_max
        c._snapshots.clear()


# ══════════════════════════════════════════════════════════════════════════════
# 적대 검토 수복 (task#330 review) — `_snapshots` 세대 가드의 이빨
# ══════════════════════════════════════════════════════════════════════════════
# `get_snapshot`의 `_snap_gen` 가드는 전체 스위트에서 **이빨이 0**이었다
# (`if gen == _snap_gen:`을 `if True:`로 바꿔도 실패 0). 방어 중복이 아니다 — 그 줄을
# 지우면 무효화 직후 stale 스냅샷이 실제로 캐시에 되살아난다. 쌍둥이인 `TTLCache`엔
# `test_ttlcache_invalidate_during_loader_is_not_lost`가 있는데 이쪽엔 없었다
# (같은 규율을 두 캐시에 넣었으면 축도 두 개여야 한다 — task#315 「0 fail이 나오는 축이
# 곧 선언만 재는 테스트」의 반대편: 축이 아예 없었다).

def test_get_snapshot_invalidate_during_loader_is_not_lost(monkeypatch):
    """로더 실행 중 들어온 `invalidate(ticker)`가 유실되지 않는다.

    유실되면: 리포트 재생성이 끝나 `cache_svc.invalidate(ticker)`가 캐시를 지운 뒤
    진행 중이던 로더가 **옛 스냅샷을 되살려** 넣는다. `_snapshots`엔 TTL이 없으므로
    LRU 축출(50건) 또는 다음 무효화까지 그 stale이 계속 서빙된다.
    """
    import services.cache as c

    monkeypatch.setattr(c, "_snapshots", OrderedDict())
    gate = threading.Barrier(2, timeout=5.0)

    def loader():
        gate.wait()      # R1 — 로더 진입 확인
        gate.wait()      # R2 — 본체의 invalidate()가 끝난 뒤에만 통과
        return {"price": "STALE"}

    err = []

    def reader():
        try:
            c.get_snapshot("AAPL", "2026-08-22", loader)
        except BaseException as e:            # noqa: BLE001
            err.append(e)

    t = threading.Thread(target=reader)
    t.start()
    gate.wait()          # R1
    with patch.object(c, "invalidate_list"), patch.object(c, "invalidate_dashboard"), \
         patch.object(c, "invalidate_correlation"), patch.object(c, "invalidate_sector"), \
         patch.object(c, "invalidate_macro"):
        c.invalidate("AAPL")
    gate.wait()          # R2
    t.join(timeout=5)

    assert not t.is_alive(), "데드락"
    assert err == [], f"{err!r}"
    assert "AAPL/2026-08-22" not in c._snapshots, \
        "로더 실행 중 무효화가 유실돼 stale 스냅샷이 되살아났다"


def test_get_snapshot_caches_normally_without_invalidate(monkeypatch):
    """대조군 — 무효화가 없으면 종전대로 캐시에 적재된다(가드가 정상 경로를 막지 않는다)."""
    import services.cache as c

    monkeypatch.setattr(c, "_snapshots", OrderedDict())
    c.get_snapshot("MSFT", "2026-08-22", lambda: {"price": 1})
    assert c._snapshots["MSFT/2026-08-22"] == {"price": 1}
