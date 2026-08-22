"""KST 달력일 경계 — 컨테이너 UTC가 만드는 「하루 어긋남」 회귀 가드 (B7·B8·B42).

배경: 백엔드 컨테이너에 TZ env가 없어 `datetime.now()`(naive)·`datetime.utcnow()`는 **UTC**다.
00:00~09:00 KST(=UTC 전일)에 「오늘이 며칠이냐」 판정이 하루 뒤처진다. 정본 헬퍼는
`services.utils.today_kst`(재구현 금지).

이 파일의 축은 전부 **한 순간(instant)을 고정**하고 「그 순간을 어느 시간대로 읽느냐」만
검증한다 — `_freeze`가 `services.utils.datetime`과 대상 모듈의 `datetime`을 같은 가짜로
바꾸므로, 수정 전/후가 **동일한 시각**을 보고 서로 다른 달력일을 낸다. 시계에 의존하지
않으므로 실행 시각과 무관하게 결정적이다(기존 test_disclosures.py·test_insider_trades.py의
「프로덕션과 같은 식으로 기대값을 재계산하는」 동어반복 축과 대비 — 그 축은 시간대 결함을
원리적으로 탐지할 수 없고 KST 전환 후에는 00~09시 KST에 실패하는 flaky가 된다).

⑷ 대조군: 09:00 이후 KST(=UTC와 같은 달력일) 시각에서는 수정 전과 **같은 값**이 나온다 —
시간대 수정이 정상 구간의 동작을 바꾸지 않았다는 증언.
"""
from datetime import datetime, date, timedelta, timezone

import pytest

from services import utils as utils_mod

_UTC = timezone.utc


# ── 시각 고정 하니스 ────────────────────────────────────────────────────

def _frozen_datetime(instant_utc: datetime):
    """고정된 한 순간을 반환하는 `datetime` 대체 클래스.

    `now(None)` = naive UTC(컨테이너의 실제 동작 재현) · `now(tz)` = 그 tz의 aware ·
    `utcnow()` = naive UTC. 세 경로가 모두 같은 순간을 가리키므로 관측되는 차이는
    오직 「어느 시간대로 읽었는가」다.
    """

    class _Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return instant_utc.astimezone(_UTC).replace(tzinfo=None)
            return instant_utc.astimezone(tz)

        @classmethod
        def utcnow(cls):
            return instant_utc.astimezone(_UTC).replace(tzinfo=None)

    return _Frozen


def _freeze(monkeypatch, instant_utc: datetime, *modules):
    """`services.utils`와 대상 모듈들의 `datetime`을 고정 시각으로 대체.

    대상 모듈에 `datetime` 심볼이 없을 수 있다(시간대 수정으로 bare `datetime.now()`가
    사라지면 그 import 자체가 고아가 되어 제거된다) → `hasattr` 가드. 정본 헬퍼
    `services.utils.today_kst`는 항상 이 고정 시각을 탄다.
    """
    fake = _frozen_datetime(instant_utc)
    monkeypatch.setattr(utils_mod, "datetime", fake)
    for m in modules:
        if hasattr(m, "datetime"):
            monkeypatch.setattr(m, "datetime", fake)
    return fake


def _kst(y, mo, d, h, mi=0):
    """KST 벽시계 시각을 UTC aware instant로."""
    from zoneinfo import ZoneInfo
    return datetime(y, mo, d, h, mi, tzinfo=ZoneInfo("Asia/Seoul")).astimezone(_UTC)


def test_freeze_harness_reproduces_container_utc(monkeypatch):
    """하니스 자체의 이빨 — 고정 시각에서 naive now()와 today_kst()가 실제로 갈린다.

    이 축이 통과하지 않으면 아래 red 축들이 「시간대 때문」이 아니라 다른 이유로
    빨간 것이므로, 판별력의 전제를 여기서 먼저 못박는다.
    """
    fake = _freeze(monkeypatch, _kst(2026, 8, 22, 0, 30))
    # 대상 모듈이 보는 것과 같은 가짜로 직접 확인한다(테스트 모듈의 real datetime이 아니라).
    assert fake.now().date() == date(2026, 8, 21), "naive now()가 UTC 전일이어야 한다"
    assert fake.utcnow().date() == date(2026, 8, 21)
    assert utils_mod.today_kst() == date(2026, 8, 22), "today_kst()는 KST 당일이어야 한다"


# ── B7: 배당 기준연도(DART bsns_year) ───────────────────────────────────

_ALOT_OK = {
    "status": "000",
    "list": [
        {"se": "주당 현금배당금(원)", "stock_knd": "보통주", "thstrm": "1,444"},
        {"se": "현금배당수익률(%)", "stock_knd": "보통주", "thstrm": "1.90"},
    ],
}


class _FakeJsonResp:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def _capture_bsns_year(monkeypatch, svc):
    cap = {}

    def fake_get(url, params=None, timeout=None):
        cap.update(params or {})
        return _FakeJsonResp(_ALOT_OK)

    monkeypatch.setattr(svc, "_get_corp_code_map", lambda: {"005930": "00126380"})
    monkeypatch.setattr(svc.requests, "get", fake_get)
    assert svc.fetch_kr_dividend("005930.KS") is not None, "fetch가 None — 하니스가 대상에 닿지 못했다"
    return cap["bsns_year"]


def test_b7_business_year_at_april_boundary_uses_kst(monkeypatch):
    """B7(red-first) — 4/1 00:30 KST(=3/31 15:30 UTC)에 기준연도가 1년 어긋나지 않는다.

    `_recent_business_year`는 「현재 월이 4월 이전이면 전전년도」로 갈린다. 같은 순간을
    UTC로 읽으면 month=3 → 2024, KST로 읽으면 month=4 → 2025. 계획서가 지목한 창이다.
    """
    from services import dividends as svc
    _freeze(monkeypatch, _kst(2026, 4, 1, 0, 30), svc)
    assert _capture_bsns_year(monkeypatch, svc) == "2025"


def test_b7_business_year_at_new_year_boundary_uses_kst(monkeypatch):
    """B7(red-first) — 1/1 00:30 KST(=12/31 15:30 UTC)에 연도가 한 해 뒤로 밀리지 않는다.

    4월 경계가 *월*을 어긋내는 창이라면 이쪽은 *연*을 어긋낸다: UTC로는 2025-12-31
    (month=12 → 2024), KST로는 2026-01-01(month=1 → 2024)… 연·월이 함께 움직여
    결과가 같아지는 것이 아니라, UTC year 2025 - 1 = 2024 vs KST year 2026 - 2 = 2024로
    **우연히 일치**한다. 그 우연을 고정해 두는 것이 이 축의 값이다(1/1~3/31 구간에서
    두 시간대의 산출이 같다는 사실이 4월 경계 축의 대조군이 된다).
    """
    from services import dividends as svc
    _freeze(monkeypatch, _kst(2026, 1, 1, 0, 30), svc)
    assert _capture_bsns_year(monkeypatch, svc) == "2024"


@pytest.mark.parametrize(
    "instant,expected",
    [
        (_kst(2026, 4, 1, 12, 0), "2025"),   # 4월, UTC도 같은 달력일
        (_kst(2026, 3, 15, 12, 0), "2024"),  # 3월, UTC도 같은 달력일
        (_kst(2026, 12, 31, 23, 0), "2025"),  # 연말, UTC는 전일이지만 월 판정 불변
    ],
)
def test_b7_business_year_unchanged_outside_utc_gap(monkeypatch, instant, expected):
    """B7 대조군 — UTC와 KST의 달력일이 같은(또는 월 판정이 같은) 구간에서는 값이 그대로다."""
    from services import dividends as svc
    _freeze(monkeypatch, instant, svc)
    assert _capture_bsns_year(monkeypatch, svc) == expected


# ── B8: 컨센서스 report_date (US, yfinance upgrades_downgrades) ─────────
#
# 라이브 실측(yfinance 1.2.0, `scrapers/quote.py:554`): 인덱스는
# `pd.to_datetime(epochGradeDate, unit='s')` → **항상 naive UTC**이고 tz-aware가 아니다.
# 그래서 `_fetch_us_raw`의 `if idx.tz is not None: idx.tz_convert(None)` 분기는 현재
# 라이브에서 **dormant**이고, 실제로 살아 있는 결함은 「naive UTC를 시장일로 착각해
# `.date`를 취하는 것」이다 — 미 동부 20:00 이후(=UTC 다음날 00:00 이후)에 나온
# 애널리스트 액션이 하루 앞선 날짜로 저장된다(MSFT 929행 중 7행 실측).

_ET_HINT = "America/New_York"


class _FakeUsTicker:
    def __init__(self, ud=None, apt=None, info=None):
        self._ud = ud
        self._apt = apt or {}
        self.info = info or {}

    @property
    def upgrades_downgrades(self):
        return self._ud

    @property
    def analyst_price_targets(self):
        return self._apt


def _ud_frame(index):
    import pandas as pd
    return pd.DataFrame(
        {"ToGrade": ["Buy"], "Firm": ["TestBroker"], "currentPriceTarget": [250.0]},
        index=index,
    )


def _run_us_raw(monkeypatch, instant_utc, ticker_obj):
    """고정 시각 + 가짜 yfinance로 `_fetch_us_raw`를 돌린다.

    ⚠️ `_freeze`에 pipeline 모듈을 **반드시** 넘긴다. 넘기지 않으면 `services.utils`만
    고정되고, 모듈이 자체 `datetime.now()`로 회귀했을 때 그 호출이 실clock을 읽어
    「오늘과 우연히 같다」로 통과한다(실측: 이 인자를 빼고 fault injection했더니 축이
    그대로 초록이었다 — 이빨 없는 가드였다).
    """
    import yfinance
    from services import consensus_pipeline as pipeline
    _freeze(monkeypatch, instant_utc, pipeline)
    monkeypatch.setattr(yfinance, "Ticker", lambda sym: ticker_obj)
    rows = pipeline._fetch_us_raw("AAPL", days=7)
    # `_fetch_us_raw`는 broad except로 []를 반환한다 → 빈 결과를 통과로 읽지 않도록 sentinel.
    assert rows, "행이 0건 — 하니스가 파싱 경로에 닿지 못했다(broad except가 삼킨 것일 수 있다)"
    return rows


def test_b8_report_date_from_naive_utc_index_is_market_date(monkeypatch):
    """B8(red-first, 라이브 활성) — naive UTC 인덱스를 미 시장일로 읽는다.

    2026-08-21 00:30 UTC = 2026-08-20 20:30 ET(장 마감 후 애널리스트 노트). 현재 코드는
    `.date`로 2026-08-21을 박제해 **시장일보다 하루 앞선** report_date를 만든다.
    """
    import pandas as pd
    idx = pd.to_datetime(pd.Index(["2026-08-21 00:30:00"]))  # yfinance와 동일한 naive UTC
    assert idx.tz is None
    rows = _run_us_raw(monkeypatch, _kst(2026, 8, 21, 12, 0), _FakeUsTicker(ud=_ud_frame(idx)))
    assert rows[0]["report_date"] == "2026-08-20"


def test_b8_report_date_from_tz_aware_index_is_market_date(monkeypatch):
    """B8(red-first, dormant 분기) — tz-aware 인덱스도 UTC로 밀지 않는다.

    yfinance 1.2.0은 항상 naive를 주므로 이 분기는 라이브에서 dormant다(위 절 주석 참조).
    그래도 코드에 분기가 실재하고 버전이 바뀌면 살아나므로 계약을 못박는다:
    2026-08-20 20:00 ET을 `tz_convert(None)`하면 UTC 2026-08-21이 되어 하루 밀린다.
    """
    import pandas as pd
    idx = pd.to_datetime(pd.Index(["2026-08-20 20:00:00"])).tz_localize(_ET_HINT)
    assert idx.tz is not None
    rows = _run_us_raw(monkeypatch, _kst(2026, 8, 21, 12, 0), _FakeUsTicker(ud=_ud_frame(idx)))
    assert rows[0]["report_date"] == "2026-08-20"


def test_b8_intraday_rows_keep_their_market_date(monkeypatch):
    """B8 대조군 — 장중(=UTC와 시장일이 같은) 행은 종전과 같은 날짜를 유지한다.

    2026-08-20 13:30 UTC = 09:30 ET. UTC로 읽어도 ET로 읽어도 2026-08-20이다.
    """
    import pandas as pd
    idx = pd.to_datetime(pd.Index(["2026-08-20 13:30:00"]))
    rows = _run_us_raw(monkeypatch, _kst(2026, 8, 21, 12, 0), _FakeUsTicker(ud=_ud_frame(idx)))
    assert rows[0]["report_date"] == "2026-08-20"


def test_b8_consensus_fallback_report_date_is_today_kst(monkeypatch):
    """B8 회귀 가드 — `analyst_price_targets` 폴백 행의 report_date는 today_kst()다.

    ⚠️ **이 축은 수정 전에도 통과한다**(구동 축이 아니라 회귀 가드다). S1 판별에서
    `consensus_pipeline`은 이미 `services.utils.today_kst`를 쓰고 있음이 확인됐으므로
    (계획서가 지목한 「report_date가 UTC로 하루 밀린다」는 이 경로에서는 이미 해소됨),
    그 사실이 되돌려지지 않도록 못박는 용도다. 00:30 KST(=UTC 전일)로 고정해
    UTC로 회귀하면 즉시 빨개진다.

    폴백 진입 조건 주의: `ud`가 **빈** DataFrame이면 조기 return하므로 폴백에 닿지 못한다.
    「행은 있으나 전부 cutoff보다 오래됨」이어야 이 경로가 열린다.

    이빨 검증(fault injection 실측): 모듈 최상단에 `from datetime import datetime`을 넣고
    `today_kst()` → `datetime.now().date()`로 되돌리면 `'2026-08-21' == '2026-08-22'`로
    실패한다. ⚠️ 첫 시도에서는 `__import__("datetime")`으로 주입해 **초록이 나왔다** —
    그 호출은 `_freeze`가 닿지 못하는 경로라 실clock을 읽고 우연히 오늘과 같았다.
    「이빨 없음」이 아니라 「주입이 하니스 밖을 탔음」이었다(→ `_run_us_raw` 주석 참조).
    """
    import pandas as pd
    stale = _ud_frame(pd.to_datetime(pd.Index(["2026-01-05 14:00:00"])))
    tick = _FakeUsTicker(
        ud=stale,
        apt={"mean": 250.0},
        info={"recommendationKey": "buy"},
    )
    rows = _run_us_raw(monkeypatch, _kst(2026, 8, 22, 0, 30), tick)
    assert rows[0]["brokerage_code"] == "__consensus__"
    assert rows[0]["report_date"] == "2026-08-22"


# ── B42: DART 조회 창 (disclosures · insider_trades) ────────────────────

def _capture_dart_window(monkeypatch, svc, fetch, **kw):
    cap = {}

    def fake_get(url, params=None, timeout=None):
        for k in ("bgn_de", "end_de"):
            if params and k in params:
                cap.setdefault(k, params[k])
        return _FakeJsonResp({"status": "013"})

    monkeypatch.setattr(svc.requests, "get", fake_get)
    fetch(**kw)
    assert cap, "params를 못 받았다 — 하니스가 요청 경로에 닿지 못했다"
    return cap


def test_b42_disclosures_window_uses_kst(monkeypatch):
    """B42(red-first) — 공시 조회 bgn_de가 KST 기준이다.

    2026-08-22 00:30 KST(=08-21 15:30 UTC), days=30 → KST 기준 2026-07-23.
    UTC로 읽으면 08-21 기준이라 2026-07-22가 되어 창 전체가 하루 밀린다.
    """
    from services import disclosures as svc
    _freeze(monkeypatch, _kst(2026, 8, 22, 0, 30), svc)
    cap = _capture_dart_window(monkeypatch, svc, svc.fetch_disclosures,
                               corp_code="00164742", days=30)
    assert cap["bgn_de"] == "20260723"


def test_b42_insider_window_uses_kst(monkeypatch):
    """B42(red-first) — 내부자 보고 조회의 end_de가 **당일**(KST)을 포함한다.

    end_de는 창의 *상한*이라 하루 뒤처지면 그날 접수된 보고가 통째로 창 밖으로 떨어진다.
    disclosure_fetch(07:30 KST)·agm(08:00 KST) 배치가 정확히 그 위험 구간에서 돈다.
    """
    from services import insider_trades as svc
    _freeze(monkeypatch, _kst(2026, 8, 22, 0, 30), svc)
    cap = _capture_dart_window(monkeypatch, svc, svc.fetch_insider_trades,
                               corp_code="00164742", days=30)
    assert cap["end_de"] == "20260822"
    assert cap["bgn_de"] == "20260723"


def test_b42_disclosures_window_unchanged_after_9am(monkeypatch):
    """B42 대조군 — 09:00 이후 KST(=UTC와 같은 달력일)에서는 종전과 같은 값이다."""
    from services import disclosures as svc
    _freeze(monkeypatch, _kst(2026, 8, 22, 12, 0), svc)
    cap = _capture_dart_window(monkeypatch, svc, svc.fetch_disclosures,
                               corp_code="00164742", days=45)
    assert cap["bgn_de"] == (date(2026, 8, 22) - timedelta(days=45)).strftime("%Y%m%d")


def test_b42_insider_window_unchanged_after_9am(monkeypatch):
    """B42 대조군 — 09:00 이후 KST에서는 bgn_de·end_de가 종전과 같다."""
    from services import insider_trades as svc
    _freeze(monkeypatch, _kst(2026, 8, 22, 12, 0), svc)
    cap = _capture_dart_window(monkeypatch, svc, svc.fetch_insider_trades,
                               corp_code="00164742", days=30)
    assert cap["end_de"] == "20260822"
    assert cap["bgn_de"] == (date(2026, 8, 22) - timedelta(days=30)).strftime("%Y%m%d")


# ── 잔존 감사: 소유 4파일에 bare now/utcnow가 없다 ──────────────────────

_OWNED = (
    "services/dividends.py",
    "services/consensus_pipeline.py",
    "services/disclosures.py",
    "services/insider_trades.py",
    # 적대 검토 수복(task#330 review): 구루 명부 `last_updated`의 두 writer.
    # 사용자 대면 값이라(관리자 화면이 그대로 표시) 9시간 뒤처지면 "어제 크롤이 안 돌았다"로
    # 오판해 불필요한 재크롤(83명 재수집)을 유발한다. 수동·자동 두 레인이 쌍이므로 함께 본다.
    "routers/guru.py",
    "scheduler/jobs.py",
)


def test_owned_modules_have_no_naive_now_or_utcnow():
    """소유 4파일에 naive `datetime.now()`·`datetime.utcnow()`·bare `date.today()`가 0건.

    ast로 실제 호출 노드만 본다(문자열·주석 오탐 방지). `datetime.now(tz)`처럼 인자가
    있는 호출은 시간대를 명시한 것이므로 허용 — 정본은 `services.utils.today_kst`다.
    `test_no_bare_today.py`가 `.today()`만 보므로 `now()`/`utcnow()`는 이 축이 담당한다.
    """
    import ast
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    offenders = []
    for rel in _OWNED:
        path = os.path.join(base, rel)
        with open(path, encoding="utf-8") as f:
            tree = ast.parse(f.read(), filename=rel)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            name = node.func.attr
            if name == "utcnow":
                offenders.append(f"{rel}:{node.lineno} utcnow()")
            elif name == "now" and not node.args and not node.keywords:
                offenders.append(f"{rel}:{node.lineno} now() (tz 미지정)")
    assert not offenders, (
        "naive 시각 호출 잔존 — services.utils.today_kst()를 쓸 것: " + ", ".join(offenders)
    )


# ══════════════════════════════════════════════════════════════════════════════
# 적대 검토 수복 (task#330 review) — 구루 명부 `last_updated`가 UTC였다
# ══════════════════════════════════════════════════════════════════════════════
# `routers/guru.py::_run_crawl`(수동)과 `scheduler/jobs.py::_run_guru_crawl`(자동)이
# `datetime.now().isoformat(timespec="seconds")`로 명부 갱신시각을 기록한다 → 컨테이너 UTC.
# `frontend/src/pages/GuruCrawlNow.jsx`가 그 문자열을 「마지막 갱신: …」으로 **그대로 표시**하므로
# 방금 돌린 크롤이 9시간 전으로 보이고, 00~09시 KST엔 날짜까지 하루 뒤로 보인다.
# 정본은 `services.utils.now_kst`(스칼라 날짜는 `today_kst`, 타임스탬프는 이것).

def test_now_kst_reads_the_same_instant_as_kst(monkeypatch):
    """정본 헬퍼 단위 축 — 같은 순간을 KST 벽시계로 읽는다(+09:00 aware)."""
    _freeze(monkeypatch, _kst(2026, 8, 22, 0, 30))

    now = utils_mod.now_kst()

    assert now.date() == date(2026, 8, 22), "naive UTC였다면 2026-08-21이 된다"
    assert now.hour == 0 and now.minute == 30
    assert now.utcoffset().total_seconds() == 9 * 3600


@pytest.mark.parametrize("lane", ["manual", "auto"])
def test_guru_last_updated_is_kst_in_both_lanes(monkeypatch, lane):
    """수동·자동 두 레인이 같은 KST 달력일·시각을 기록한다.

    한쪽만 고치면 값이 레인마다 9시간 엇갈려 어느 쪽이 맞는지 화면에서 판정할 수 없다.
    """
    import routers.guru as guru_mod
    import scheduler.jobs as jobs_mod
    import services.job_runs as job_runs
    from contextlib import contextmanager

    _freeze(monkeypatch, _kst(2026, 8, 22, 0, 30), utils_mod)

    @contextmanager
    def _noop(job_id, trigger):
        class _Run:
            def set_status(self, *a, **k):
                pass
        yield _Run()

    monkeypatch.setattr(job_runs, "record", _noop)
    saved: dict = {}

    def fake_save(payload):
        saved.update(payload)
        return {"saved": True, "fresh": 1, "stale": 0, "dropped": 0, "held": 0}

    if lane == "manual":
        monkeypatch.setattr(guru_mod.job_runs, "record", _noop)
        monkeypatch.setattr(guru_mod.storage, "save_guru_managers", fake_save)
        monkeypatch.setattr(guru_mod, "scrape_all_managers",
                            lambda on_progress=None: ([{"id": "1"}], [{"id": "1"}]))
        guru_mod._run_crawl()
    else:
        monkeypatch.setattr(jobs_mod.job_runs, "record", _noop)
        monkeypatch.setattr(jobs_mod.storage, "save_guru_managers", fake_save)
        import services.guru_scraper as scraper
        monkeypatch.setattr(scraper, "scrape_all_managers",
                            lambda *a, **k: ([{"id": "1"}], [{"id": "1"}]))
        jobs_mod._run_guru_crawl()

    stamp = saved["last_updated"]
    assert stamp.startswith("2026-08-22T00:30"), (
        f"UTC로 기록됐다(naive now) — {stamp!r}"
    )
