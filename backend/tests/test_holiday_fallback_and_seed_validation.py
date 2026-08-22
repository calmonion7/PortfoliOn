"""B70(다일 연휴 폴백) · B71(기동 스펙 검증) 회귀 테스트.

B70 — `services/kiwoom/sector.py`: 빈 종가 재조회가 **1회뿐**이라 평일 공휴일 3연속의
마지막 날엔 두 콜이 모두 휴일에 떨어져 24개 업종이 통째로 빈 배열이 된다
(`kr_sector_service._fetch_one_sector`가 24개 전부를 base_dt 미지정으로 호출한다).
유계 루프로 교체하되 **무계 루프는 금지** — 외부 장애 시 무한 재조회가 이 결함보다 나쁘다.

B71 — `backend/scheduler/schedule.py`: 저장 스펙이 깨져 있으면(레거시 verbatim 승계·수기 편집)
`build_trigger_kwargs`가 예외를 전파해 기동 경로가 통째로 죽는다.
`scheduler.start()`는 `_reschedule_job` 루프 **뒤에** `_scheduler.start()`를 호출하므로,
행 하나가 깨지면 앱이 뜨지 않고 어떤 배치도 등록되지 않는다.
`validate_schedule_spec`의 유일한 호출자는 `routers/batches.py`의 PUT 경계뿐이었다.
"""
import datetime as _dt
import logging
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import scheduler
from scheduler import schedule as sched_mod
from services import batch_registry, storage
from services.kiwoom import sector
from services.schedule_spec import validate_schedule_spec


# ── B70: 다일 연휴 폴백 ────────────────────────────────────────────────────────
# 2026-06 캘린더: 12(금) · 13(토) · 14(일) · 15(월) · 16(화) · 17(수).
# 15·16·17을 평일 공휴일 3연속(설·추석 연휴 형태)으로 가정하면 마지막 완성 거래일은 12(금)이다.
_HOLIDAY_3DAY = {"20260615", "20260616", "20260617"}


def _paged_factory(calls: list, closed: set):
    """base_dt가 휴장일이면 빈 LIST, 아니면 종가 2건을 주는 ka20006 스텁."""

    def fake_paged(api_id, body, *a, **k):
        bd = body["base_dt"]
        calls.append(bd)
        if bd in closed:
            return []
        return [{"dt": bd, "cur_prc": "100"}, {"dt": "20260611", "cur_prc": "99"}]

    return fake_paged


def test_multi_day_holiday_keeps_all_24_sectors_non_empty(monkeypatch):
    """평일 공휴일 3연속의 마지막 날에도 24개 업종이 전부 종가를 받는다."""
    monkeypatch.setattr(sector, "today_kst", lambda: _dt.date(2026, 6, 17))
    calls: list = []
    monkeypatch.setattr(sector.client, "request_paged", _paged_factory(calls, _HOLIDAY_3DAY))

    empty = [s["code"] for s in sector.KOSPI_SECTORS if not sector.fetch_sector_closes(s["code"])]

    assert len(sector.KOSPI_SECTORS) == 24
    assert empty == []


def test_multi_day_holiday_walks_back_to_last_trading_day(monkeypatch):
    """재조회 경로: 17(수)→16(화)→15(월)→[14 일·13 토 건너뜀]→12(금)."""
    monkeypatch.setattr(sector, "today_kst", lambda: _dt.date(2026, 6, 17))
    calls: list = []
    monkeypatch.setattr(sector.client, "request_paged", _paged_factory(calls, _HOLIDAY_3DAY))

    closes = sector.fetch_sector_closes("008")

    assert closes == [99.0, 100.0]
    assert calls == ["20260617", "20260616", "20260615", "20260612"]


def test_fallback_is_bounded_when_every_day_is_empty(monkeypatch, caplog):
    """전 구간이 비어도 유계로 멈추고 경고를 남긴다(무계 루프 금지)."""
    monkeypatch.setattr(sector, "today_kst", lambda: _dt.date(2026, 6, 17))
    calls: list = []
    monkeypatch.setattr(
        sector.client, "request_paged",
        _paged_factory(calls, {f"202606{d:02d}" for d in range(1, 31)}),
    )

    with caplog.at_level(logging.WARNING):
        closes = sector.fetch_sector_closes("008")

    assert closes == []
    assert len(calls) == sector._MAX_FETCH_ATTEMPTS
    assert any("008" in r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)


def test_normal_trading_day_still_single_call(monkeypatch):
    """대조군 — 정상 영업일은 이전과 같이 1콜로 끝난다."""
    monkeypatch.setattr(sector, "today_kst", lambda: _dt.date(2026, 6, 16))
    calls: list = []
    monkeypatch.setattr(sector.client, "request_paged", _paged_factory(calls, set()))

    closes = sector.fetch_sector_closes("008")

    assert closes == [99.0, 100.0]
    assert calls == ["20260616"]


def test_explicit_base_dt_never_walks_back(monkeypatch):
    """대조군 — base_dt 명시는 빈 결과여도 폴백하지 않는다(기존 계약 보존)."""
    calls: list = []
    monkeypatch.setattr(
        sector.client, "request_paged",
        _paged_factory(calls, {"20260617"}),
    )

    assert sector.fetch_sector_closes("008", base_dt="20260617") == []
    assert calls == ["20260617"]


# ── B71: 기동 스펙 검증 ────────────────────────────────────────────────────────
# 빈 time — build_trigger_kwargs가 int('')로 ValueError를 던진다(로컬 실측).
_BROKEN_SPEC = {"enabled": True, "type": "weekly", "days": ["sun"], "time": ""}
# 통합 스펙 이전 형태(type 키 없음) — build_trigger_kwargs가 KeyError를 던진다.
_LEGACY_NO_TYPE = {"enabled": True, "days": ["sun"], "time": "03:00"}


class _FakeScheduler:
    """BackgroundScheduler 대역 — 실제 스케줄러를 start하지 않는다."""

    def __init__(self):
        self.jobs: dict = {}
        self.started = False

    def get_job(self, job_id):
        return self.jobs.get(job_id)

    def remove_job(self, job_id):
        self.jobs.pop(job_id, None)

    def add_job(self, func, trigger, **kwargs):
        self.jobs[kwargs["id"]] = trigger

    def start(self):
        self.started = True


def _install_store(monkeypatch, store: dict):
    monkeypatch.setattr(storage, "get_batch_schedule", lambda jid: store.get(jid))
    monkeypatch.setattr(storage, "save_batch_schedule",
                        lambda jid, spec: store.__setitem__(jid, spec))
    monkeypatch.setattr(storage, "get_schedule",
                        lambda: {"enabled": False, "time": "08:00", "days": []})
    monkeypatch.setattr(storage, "get_guru_schedule",
                        lambda: {"enabled": False, "day": "sun", "time": "03:00"})


def _install_fake_scheduler(monkeypatch) -> _FakeScheduler:
    fake = _FakeScheduler()
    monkeypatch.setattr(sched_mod, "_scheduler", fake)
    monkeypatch.setattr(scheduler, "_scheduler", fake)
    return fake


def _editable_ids() -> list:
    return [b["id"] for b in batch_registry.BATCHES if b.get("editable")]


def test_startup_completes_when_one_stored_spec_is_broken(monkeypatch, caplog):
    """깨진 행 하나가 기동을 막지 않는다 + 나머지 배치는 전부 등록된다(대조군 겸용)."""
    editable = _editable_ids()
    store = {jid: dict(batch_registry.get_batch(jid)["default_schedule"], enabled=True)
             for jid in editable}
    store["leverage_fetch"] = dict(_BROKEN_SPEC)
    _install_store(monkeypatch, store)
    fake = _install_fake_scheduler(monkeypatch)
    for name in ("_check_missed_report", "_seed_rankings_if_empty",
                 "_seed_kr_sector_if_empty", "_seed_us_sector_if_empty"):
        monkeypatch.setattr(scheduler, name, lambda: None)

    with caplog.at_level(logging.ERROR):
        scheduler.start()

    assert fake.started is True
    assert set(fake.jobs) == set(editable) - {"leverage_fetch"}
    assert any("leverage_fetch" in r.getMessage()
               for r in caplog.records if r.levelno == logging.ERROR)


def test_reschedule_keeps_existing_job_when_spec_broken(monkeypatch, caplog):
    """깨진 스펙은 이미 도는 잡을 죽이지 않는다(remove 전에 판정)."""
    fake = _install_fake_scheduler(monkeypatch)
    fake.jobs["leverage_fetch"] = "PREV"
    monkeypatch.setattr(storage, "get_batch_schedule", lambda jid: dict(_BROKEN_SPEC))

    with caplog.at_level(logging.ERROR):
        sched_mod._reschedule_job("leverage_fetch")

    assert fake.jobs["leverage_fetch"] == "PREV"
    assert any("leverage_fetch" in r.getMessage()
               for r in caplog.records if r.levelno == logging.ERROR)


def test_reschedule_disabled_spec_still_removes_job(monkeypatch):
    """대조군 — disabled는 종전대로 잡 제거."""
    fake = _install_fake_scheduler(monkeypatch)
    fake.jobs["leverage_fetch"] = "PREV"
    monkeypatch.setattr(storage, "get_batch_schedule",
                        lambda jid: {"enabled": False, "type": "daily", "time": "07:00"})

    sched_mod._reschedule_job("leverage_fetch")

    assert "leverage_fetch" not in fake.jobs


def test_reschedule_valid_spec_still_registers(monkeypatch):
    """대조군 — 정상 스펙은 종전대로 등록된다."""
    fake = _install_fake_scheduler(monkeypatch)
    monkeypatch.setattr(storage, "get_batch_schedule",
                        lambda jid: {"enabled": True, "type": "daily", "time": "07:00"})

    sched_mod._reschedule_job("leverage_fetch")

    assert "leverage_fetch" in fake.jobs


def test_seed_falls_back_to_default_when_legacy_row_is_invalid(monkeypatch):
    """은퇴한 earnings_refresh 행이 통합 스펙 이전 형태면 verbatim 시드하지 않는다."""
    store = {"earnings_refresh": dict(_LEGACY_NO_TYPE)}
    _install_store(monkeypatch, store)

    sched_mod._seed_batch_schedules()

    for job_id in ("earnings_kr", "earnings_us"):
        assert store[job_id] == batch_registry.get_batch(job_id)["default_schedule"]


def test_seed_still_inherits_valid_legacy_row(monkeypatch):
    """대조군 — 유효한 레거시 행은 종전대로 그대로 승계된다."""
    legacy = {"enabled": False, "type": "weekly", "days": ["sun"], "time": "04:30"}
    store = {"monthly_refresh": dict(legacy)}
    _install_store(monkeypatch, store)

    sched_mod._seed_batch_schedules()

    assert store["monthly_kr"] == legacy
    assert store["monthly_us"] == legacy


def test_every_seeded_spec_validates(monkeypatch):
    """대조군 — 시드된 스펙 전부가 validate_schedule_spec을 통과한다."""
    store: dict = {}
    _install_store(monkeypatch, store)

    sched_mod._seed_batch_schedules()

    assert store
    for spec in store.values():
        validate_schedule_spec(spec)


# ══════════════════════════════════════════════════════════════════════════════
# 적대 검토 수복 (task#330 review) — B70·B71 가드의 구멍
# ══════════════════════════════════════════════════════════════════════════════

# ── B70 후속: 휴일 되짚기를 업종 간 공유한다 ────────────────────────────────────
# 24개 업종이 **같은 휴일 날짜들을 각각 독립적으로** 되짚으면 재조회가 통째로 중복된다.
# 키움 client는 `_MIN_INTERVAL=0.25s` 전역 직렬 throttle이고, 소비처
# (`kr_sector_service.compute_momentum`)는 `scheduler.start()`가 **동기로** 호출하는
# 기동 경로다 → 중복이 그대로 기동 지연이 된다(장기 휴장 144콜=36초+, 외부 장애 240콜=60초+).

def test_holiday_walk_back_is_shared_across_sectors(monkeypatch):
    """휴일 3일은 **첫 업종이 한 번만** 확인하고 나머지 23업종은 콜 없이 건너뛴다."""
    monkeypatch.setattr(sector, "today_kst", lambda: _dt.date(2026, 6, 17))
    calls: list = []
    monkeypatch.setattr(sector.client, "request_paged", _paged_factory(calls, _HOLIDAY_3DAY))

    memo: set = set()
    for s in sector.KOSPI_SECTORS:
        assert sector.fetch_sector_closes(s["code"], empty_dts=memo) == [99.0, 100.0]

    for holiday in sorted(_HOLIDAY_3DAY):
        assert calls.count(holiday) == 1, f"{holiday}를 {calls.count(holiday)}회 재조회했다"
    # 휴일 확인 3콜 + 업종별 실거래일 1콜 = 27 (공유 없이는 24×4 = 96)
    assert len(calls) == 3 + len(sector.KOSPI_SECTORS)


def test_shared_memo_bounds_total_calls_during_outage(monkeypatch):
    """외부 장애로 전 구간이 비어도 **전체** 콜이 업종당 상한이 아니라 상한 1회로 수렴한다."""
    monkeypatch.setattr(sector, "today_kst", lambda: _dt.date(2026, 6, 17))
    calls: list = []
    monkeypatch.setattr(
        sector.client, "request_paged",
        _paged_factory(calls, {f"202606{d:02d}" for d in range(1, 31)}),
    )

    memo: set = set()
    for s in sector.KOSPI_SECTORS:
        assert sector.fetch_sector_closes(s["code"], empty_dts=memo) == []

    assert len(calls) == sector._MAX_FETCH_ATTEMPTS, (
        f"업종 24개가 {len(calls)}콜을 태웠다 — 공유 메모가 안 걸렸다"
    )


def test_memo_default_none_keeps_per_call_behavior(monkeypatch):
    """대조군 — memo를 안 넘기면 호출마다 독립적으로 되짚는다(기존 계약 보존)."""
    monkeypatch.setattr(sector, "today_kst", lambda: _dt.date(2026, 6, 17))
    calls: list = []
    monkeypatch.setattr(sector.client, "request_paged", _paged_factory(calls, _HOLIDAY_3DAY))

    sector.fetch_sector_closes("008")
    sector.fetch_sector_closes("013")

    assert calls == ["20260617", "20260616", "20260615", "20260612"] * 2


def test_compute_momentum_shares_one_memo_across_sectors(monkeypatch):
    """배선 축 — `compute_momentum`이 refresh 1회당 memo 하나를 24업종에 공유한다."""
    from services import kr_sector_service

    monkeypatch.setattr(sector, "today_kst", lambda: _dt.date(2026, 6, 17))
    calls: list = []
    monkeypatch.setattr(sector.client, "request_paged", _paged_factory(calls, _HOLIDAY_3DAY))

    out = kr_sector_service.compute_momentum()

    assert len(out) == len(sector.KOSPI_SECTORS)
    for holiday in sorted(_HOLIDAY_3DAY):
        assert calls.count(holiday) == 1, f"{holiday}를 {calls.count(holiday)}회 재조회했다"


# ── B71 후속 ⓐ: 기동은 `_reschedule_job` 뒤에도 죽지 않는다 ─────────────────────
_ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
# `_check_missed_report_for`가 읽는 배치를 깨뜨린다. days에 7요일을 전부 넣어
# 「오늘 요일이 아니라 조기 return」으로 우연히 통과하는 날짜 의존을 제거한다.
_BROKEN_REPORT_SPEC = {"enabled": True, "type": "weekly", "days": _ALL_DAYS, "time": ""}


def test_startup_completes_when_missed_report_spec_is_broken(monkeypatch, caplog):
    """`daily_report_kr` 스펙이 깨져도 기동이 완주한다.

    `_reschedule_job` 가드만으로는 부족하다 — `scheduler.start()`는 그 루프 **뒤에**
    `_check_missed_report()`를 호출하고, `_check_missed_report_for`가 같은 저장 스펙을
    무가드로 읽는다(`int(cfg["time"].split(":")[0])` → ValueError). 그러면
    `_scheduler.start()`에 도달하지 못해 lifespan이 실패하고 **앱이 뜨지 않는다**
    (= B71이 없애려던 바로 그 결과).
    """
    import services.db as db_mod

    editable = _editable_ids()
    store = {jid: dict(batch_registry.get_batch(jid)["default_schedule"], enabled=True)
             for jid in editable}
    store["daily_report_kr"] = dict(_BROKEN_REPORT_SPEC)
    _install_store(monkeypatch, store)
    fake = _install_fake_scheduler(monkeypatch)
    monkeypatch.setattr(db_mod, "query", lambda *a, **k: [])
    for name in ("_seed_rankings_if_empty", "_seed_kr_sector_if_empty", "_seed_us_sector_if_empty"):
        monkeypatch.setattr(scheduler, name, lambda: None)

    with caplog.at_level(logging.ERROR):
        scheduler.start()

    assert fake.started is True, "깨진 daily_report 스펙이 기동을 죽였다"
    assert any("daily_report_kr" in r.getMessage()
               for r in caplog.records if r.levelno == logging.ERROR)


def test_missed_report_skips_broken_spec_without_raising(monkeypatch, caplog):
    """단위 축 — `_check_missed_report_for`가 깨진 스펙에서 예외 없이 스킵한다."""
    import services.db as db_mod

    monkeypatch.setattr(storage, "get_batch_schedule", lambda jid: dict(_BROKEN_REPORT_SPEC))
    monkeypatch.setattr(db_mod, "query", lambda *a, **k: [])

    with caplog.at_level(logging.ERROR):
        sched_mod._check_missed_report_for("daily_report_kr", "KR")

    assert any("daily_report_kr" in r.getMessage()
               for r in caplog.records if r.levelno == logging.ERROR)


def test_missed_report_valid_spec_still_queries(monkeypatch):
    """대조군 — 정상 스펙은 종전대로 스냅샷 조회까지 진행한다."""
    import services.db as db_mod

    monkeypatch.setattr(
        storage, "get_batch_schedule",
        lambda jid: {"enabled": True, "type": "weekly", "days": _ALL_DAYS, "time": "00:00"},
    )
    seen: list = []

    def fake_query(sql, params=None):
        seen.append(sql)
        return []

    monkeypatch.setattr(db_mod, "query", fake_query)

    sched_mod._check_missed_report_for("daily_report_kr", "KR")

    assert seen and "user_stocks" in seen[0]


# ── B71 후속 ⓑ: validator가 CronTrigger보다 좁다 ───────────────────────────────
# 로컬 실측 build-OK / validate-FAIL 4형태 — 변경 전에는 **정상 등록·실행되던** 스펙이다.
_BUILDABLE_BUT_INVALID = [
    {"enabled": True, "type": "daily", "time": "7:00"},                    # zero-pad 없음
    {"enabled": 1, "type": "daily", "time": "03:00"},                       # 비-bool 참
    {"enabled": True, "type": "monthly", "day_of_month": "15", "time": "03:00"},   # 문자열 dom
    {"enabled": True, "type": "interval", "every_minutes": 3,
     "start_hour": 9, "end_hour": 15},                                      # every < 5
]


@pytest.mark.parametrize("spec", _BUILDABLE_BUT_INVALID)
def test_reschedule_registers_spec_that_cron_accepts(monkeypatch, caplog, spec):
    """CronTrigger가 받아들이는 스펙은 validator가 거절해도 **계속 등록된다**.

    가드가 「깨진 스펙」만 막아야 하는데 validator를 게이트로 쓰면 돌던 배치까지 멈춘다 —
    그러면 그 배치는 ERROR 한 줄만 남기고 **영구히 실행되지 않고**, `GET /api/batches`의
    `enabled=true` + `next_run=null` 조합은 disabled 잡과 구별되지 않는다(무음 미동작).
    """
    fake = _install_fake_scheduler(monkeypatch)
    monkeypatch.setattr(storage, "get_batch_schedule", lambda jid: dict(spec))

    with caplog.at_level(logging.WARNING):
        sched_mod._reschedule_job("leverage_fetch")

    assert "leverage_fetch" in fake.jobs, f"돌던 스펙이 미등록됐다: {spec!r}"
    # 관측: 레거시 형태라는 사실 자체는 loud하게 남는다(운영자가 수리할 단서).
    assert any("leverage_fetch" in r.getMessage()
               for r in caplog.records if r.levelno == logging.WARNING)


def test_reschedule_skips_spec_that_cron_rejects(monkeypatch, caplog):
    """대조군 — build는 통과하지만 CronTrigger가 거절하는 스펙은 스킵한다(기동 보호)."""
    fake = _install_fake_scheduler(monkeypatch)
    fake.jobs["leverage_fetch"] = "PREV"
    monkeypatch.setattr(storage, "get_batch_schedule",
                        lambda jid: {"enabled": True, "type": "daily", "time": "25:00"})

    with caplog.at_level(logging.ERROR):
        sched_mod._reschedule_job("leverage_fetch")

    assert fake.jobs["leverage_fetch"] == "PREV"
    assert any("leverage_fetch" in r.getMessage()
               for r in caplog.records if r.levelno == logging.ERROR)


# ── B71 후속 ⓒ: 시드 폴백이 `enabled`를 버리지 않는다 ──────────────────────────
def test_seed_fallback_preserves_disabled_flag(monkeypatch):
    """옛 UI에서 **꺼 둔** 레거시 행이 통합 스펙 이전 형태여도 조용히 켜지지 않는다.

    `_seed_spec_for`의 verbatim 승계 목적은 「enabled·spec을 그대로 승계」인데,
    validate 실패 시 `default_schedule`로 통째 교체하면 그 기본값이 전부 `enabled: True`라
    사용자가 끈 배치 4종(earnings_kr/us·monthly_kr/us)이 조용히 켜져 외부 API를 호출한다.
    """
    store = {"earnings_refresh": {"enabled": False, "days": ["sun"], "time": "03:00"}}
    _install_store(monkeypatch, store)

    sched_mod._seed_batch_schedules()

    for job_id in ("earnings_kr", "earnings_us"):
        assert store[job_id]["enabled"] is False, f"{job_id}가 조용히 켜졌다: {store[job_id]!r}"
        # 나머지 필드는 레지스트리 기본값을 따른다.
        default = batch_registry.get_batch(job_id)["default_schedule"]
        assert {k: v for k, v in store[job_id].items() if k != "enabled"} == \
               {k: v for k, v in default.items() if k != "enabled"}


def test_seed_fallback_keeps_enabled_true_when_legacy_row_was_on(monkeypatch):
    """대조군 — 켜져 있던 레거시 행은 켜진 채로 폴백한다."""
    store = {"monthly_refresh": dict(_LEGACY_NO_TYPE)}   # enabled: True
    _install_store(monkeypatch, store)

    sched_mod._seed_batch_schedules()

    assert store["monthly_kr"] == batch_registry.get_batch("monthly_kr")["default_schedule"]


# ── B71 후속 ⓓ: 시드 가드의 예외 폭 ────────────────────────────────────────────
def test_seed_survives_non_value_error_from_validator(monkeypatch):
    """`validate_schedule_spec`은 ValueError만 내는 게 아니다 — `set(days)`가 TypeError를 낸다.

    `_seed_batch_schedules()`는 `scheduler.start()`의 **1단계**라 이 예외가 새면
    잡 단위 가드에 닿지도 못하고 앱이 뜨지 않는다.
    """
    nested = {"enabled": True, "type": "weekly", "days": [["mon"]], "time": "03:00"}
    with pytest.raises(TypeError):
        validate_schedule_spec(nested)                 # 전제 확인(이빨)

    store = {"monthly_refresh": dict(nested)}
    _install_store(monkeypatch, store)

    sched_mod._seed_batch_schedules()                  # raise하면 red

    assert store["monthly_kr"] == batch_registry.get_batch("monthly_kr")["default_schedule"]
