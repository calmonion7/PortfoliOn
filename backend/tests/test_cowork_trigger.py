"""이벤트 구동 루틴 fire (ADR-0028, task#213) — 서비스·스케줄러 훅·admin 수동 fire·enriched_at 노출."""
from unittest.mock import patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import cowork_trigger


# ── fire 서비스 ───────────────────────────────────────────────────────

def test_fire_dormant_without_env(monkeypatch):
    monkeypatch.delenv("COWORK_ROUTINE_FIRE_URL", raising=False)
    monkeypatch.delenv("COWORK_ROUTINE_FIRE_TOKEN", raising=False)
    with patch("services.cowork_trigger.requests.post") as mock_post:
        assert cowork_trigger.fire("t") is False
    mock_post.assert_not_called()


def test_fire_posts_with_token(monkeypatch):
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.requests.post", return_value=MagicMock(status_code=200)) as mock_post:
        assert cowork_trigger.fire("KR 배치 완료") is True
    kwargs = mock_post.call_args.kwargs
    assert kwargs["headers"]["Authorization"] == "Bearer tok"
    assert kwargs["json"] == {"text": "KR 배치 완료"}


def test_fire_payload_is_byte_identical_without_extensions(monkeypatch):
    """기존 호출의 본문이 확장 전과 바이트 동일하다 — 리스너 구버전 무회귀의 근거.

    확장 3키가 None이면 payload에서 **통째로 생략**돼야 한다. `"tickers": null`을 실어
    보내면 구버전 리스너는 무시하겠지만, 신버전은 그것을 전량 모드로 오독할 수 있다.
    """
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.requests.post", return_value=MagicMock(status_code=200)) as mock_post:
        cowork_trigger.fire("manual")
    assert mock_post.call_args.kwargs["json"] == {"text": "manual"}  # 키 3개 부재


def test_fire_payload_carries_extensions_when_given(monkeypatch):
    """확장 payload 3키가 그대로 실린다(야간 전량 회차의 계약)."""
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.requests.post", return_value=MagicMock(status_code=200)) as mock_post:
        assert cowork_trigger.fire("야간", tickers=["AAPL", "005930"], model="sonnet", chunk=5) is True
    assert mock_post.call_args.kwargs["json"] == {
        "text": "야간", "tickers": ["AAPL", "005930"], "model": "sonnet", "chunk": 5,
    }


def test_nightly_text_names_no_policy(monkeypatch):
    """야간 본문은 상한·게이트를 열거하지 않는다(task#279 — 트리거가 정본을 이기는 것 차단)."""
    t = cowork_trigger.nightly_text()
    assert "enrich" in t
    assert not any(tok in t for tok in ("5개", "7일", "상한", "애널리스트", "주요기술"))


def test_fire_swallows_failures(monkeypatch):
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.requests.post", side_effect=Exception("boom")):
        assert cowork_trigger.fire("t") is False  # 예외 전파 없음(배치 본문 보호)
    with patch("services.cowork_trigger.requests.post", return_value=MagicMock(status_code=500, text="err")):
        assert cowork_trigger.fire("t") is False


# ── 야간 전량 enrich 잡 (task#344) ─────────────────────────────────────

class _FakeRun:
    """job_runs.record가 yield하는 상태 핸들 대역."""
    def __init__(self):
        self.status = None

    def set_status(self, status, detail=None):
        self.status = (status, detail)


def _patch_record(run):
    from contextlib import contextmanager

    @contextmanager
    def fake(job_id, trigger):
        fake.seen = (job_id, trigger)
        yield run
    return fake


def _run_nightly(monkeypatch, *, portfolio, configured=True, fire_ok=True):
    from scheduler import jobs
    from services import cowork_trigger
    run = _FakeRun()
    rec = _patch_record(run)
    fired = {}

    def fake_fire(text, **kw):
        fired["text"] = text
        fired.update(kw)
        return fire_ok

    monkeypatch.setattr(jobs.job_runs, "record", rec)
    monkeypatch.setattr(jobs.storage, "get_global_portfolio", lambda: portfolio)
    monkeypatch.setattr(cowork_trigger, "configured", lambda: configured)
    monkeypatch.setattr(cowork_trigger, "fire", fake_fire)
    jobs._run_nightly_enrich()
    return run, fired, getattr(rec, "seen", None)


def test_nightly_enrich_fires_holdings_and_watchlist_union(monkeypatch):
    """보유+관심 합집합을 중복 없이·정렬해 싣고, **opus**·chunk 5로 발사한다.

    모델 이력: task#345가 A/B로 opus를 확정 → task#348이 무료 모델(muse-spark)로 전환 →
    **task#350 A/B로 opus 복귀**(2026-09-16, 사용자 결정 「품질이 중요하니」).

    복귀 근거 두 가지:
    ① 품질 — 20표본 3팔 섀도 A/B에서 muse 산출물에 **20/20 표본 전부 결함**이 있었다
       (표본당 3~16건, high 63건). 지어낸 출처(존재할 수 없는 「SK하이닉스 20-F」)·반대로
       말한 사실·자기 산식과 어긋나는 결론이 반복됐고, 무엇보다 muse는 20세션에서
       **외부 웹 조사를 0회** 했다(같은 과제에서 opus는 63회).
    ② task#348이 전환 근거로 든 「주간 한도로 opus 8런 즉사」는 **청크 분할 이전(9/8~9/11)의
       실측**이다. 청크 적용 후 09-14 야간 opus는 27세션으로 126/126 종목을 완주했고
       한도 마커가 0건이었다 — 기각 사유가 이미 낡아 있었다.

    07:05·20:42 발행 레인(리스너 DEFAULT_MODEL)은 줄곧 opus였고 무변경이다.
    ⚠️ 한도로 죽으면 배치현황은 초록인 채 95%가 미갱신일 수 있다(ADR 260913-013425 §46) —
    관측은 `~/portfolion-routine-runs/` 디렉터리 수와 `enriched_at` 분포로 한다.
    """
    run, fired, seen = _run_nightly(monkeypatch, portfolio={
        "stocks": [{"ticker": "AAPL"}, {"ticker": "005930"}],
        "watchlist": [{"ticker": "AAPL"}, {"ticker": "NVDA"}],  # AAPL 중복
    })
    assert seen == ("cowork_enrich_nightly", "auto")
    assert fired["tickers"] == ["005930", "AAPL", "NVDA"]
    assert fired["model"] == "opus" and fired["chunk"] == 5
    assert run.status is None  # 성공은 set_status를 부르지 않는다(기본 success)


def test_nightly_enrich_marks_failed_when_fire_returns_false(monkeypatch):
    """fire는 예외가 아니라 False를 반환한다 — 명시하지 않으면 배치현황이 영원히 초록이다."""
    run, _, _ = _run_nightly(monkeypatch, portfolio={"stocks": [{"ticker": "AAPL"}], "watchlist": []},
                             fire_ok=False)
    assert run.status is not None and run.status[0] == "failed"


def test_nightly_enrich_skips_when_dormant_or_empty(monkeypatch):
    """미설정·대상 0은 실패가 아니라 skipped다(둘을 failed로 적으면 진짜 실패가 묻힌다)."""
    run, fired, _ = _run_nightly(monkeypatch, portfolio={"stocks": [], "watchlist": []},
                                 configured=False)
    assert run.status[0] == "skipped" and not fired

    run2, fired2, _ = _run_nightly(monkeypatch, portfolio={"stocks": [], "watchlist": []})
    assert run2.status[0] == "skipped" and not fired2


# ── 스케줄러 훅 — 배치 말미 fire, 실패해도 배치 안 깨짐 ─────────────────

def test_generate_all_fires_after_batch(monkeypatch):
    from scheduler import jobs
    with patch("services.db.query", return_value=[]), \
         patch("scheduler.jobs.job_runs.record"), \
         patch("services.cowork_trigger.fire") as mock_fire:
        # job_runs.record는 컨텍스트 매니저 — MagicMock이 대체
        jobs._generate_all("KR", "daily_report_kr")
    assert mock_fire.call_count == 1
    assert "KR" in mock_fire.call_args.args[0]


# ── admin 수동 fire ──────────────────────────────────────────────────

from routers.admin import router as admin_router
from auth import require_admin, require_admin_or_api_key

app = FastAPI()
app.include_router(admin_router)
# cowork/fire·analyst-targets 쓰기는 require_admin_or_api_key (Cowork-facing 쓰기 게이트 컨벤션),
# analyst-targets 조회(task#224)는 화면 전용이라 require_admin
app.dependency_overrides[require_admin_or_api_key] = lambda: "admin-id"
app.dependency_overrides[require_admin] = lambda: "admin-id"
client = TestClient(app)


def test_admin_fire_unconfigured_503(monkeypatch):
    monkeypatch.delenv("COWORK_ROUTINE_FIRE_URL", raising=False)
    monkeypatch.delenv("COWORK_ROUTINE_FIRE_TOKEN", raising=False)
    assert client.post("/api/admin/cowork/fire", json={"text": ""}).status_code == 503


def test_admin_fire_ok(monkeypatch):
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.fire", return_value=True) as mock_fire:
        resp = client.post("/api/admin/cowork/fire", json={"text": "005930 enrich"})
    assert resp.status_code == 200
    assert mock_fire.call_args.args[0] == "005930 enrich"


def test_admin_fire_default_text(monkeypatch):
    # task#279: 이 단언은 "기본 문구가 사용된다"는 부수적 확인이었지 정책 열거가
    # 결정된 것이 아니었다(task#264 절차로 판별 완료 — ADR-0028은 트리거의 정책
    # 열거를 결정한 바 없음). 빌더가 유일한 산지이므로 exact-equality로 강화.
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_URL", "https://example.com/fire")
    monkeypatch.setenv("COWORK_ROUTINE_FIRE_TOKEN", "tok")
    with patch("services.cowork_trigger.fire", return_value=True) as mock_fire:
        resp = client.post("/api/admin/cowork/fire", json={})
    assert resp.status_code == 200
    assert mock_fire.call_args.args[0] == cowork_trigger.manual_text()


def test_admin_fire_unauthenticated_401():
    fresh = FastAPI()
    fresh.include_router(admin_router)
    assert TestClient(fresh).post("/api/admin/cowork/fire", json={}).status_code == 401


# ── GET /api/stocks enriched_at additive (S2) ────────────────────────

from routers.stocks import router as stocks_router
from auth import get_current_user_or_api_key

sapp = FastAPI()
sapp.include_router(stocks_router)
sapp.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
sclient = TestClient(sapp)

PORTFOLIO = {
    "stocks": [{"ticker": "LLY", "name": "일라이 릴리"}],
    "watchlist": [{"ticker": "005930", "name": "삼성전자"}],
}


def test_get_stocks_includes_enriched_at_and_target():
    import datetime
    rows = [{"ticker": "LLY", "enriched_at": datetime.datetime(2026, 7, 20, 1, 0), "analyst_target": True}]
    with patch("routers.stocks.storage.get_full_portfolio", return_value=PORTFOLIO), \
         patch("routers.stocks.query", return_value=rows):
        data = sclient.get("/api/stocks").json()
    by = {d["ticker"]: d for d in data}
    assert by["LLY"]["enriched_at"].startswith("2026-07-20")
    assert by["LLY"]["analyst_target"] is True
    assert by["005930"]["enriched_at"] is None  # 미enrich → null
    assert by["005930"]["analyst_target"] is False  # 미지정 기본 False


def test_admin_analyst_target_toggle():
    with patch("routers.admin.execute", return_value=1) as mock_exec:
        resp = client.put("/api/admin/analyst-targets/tst", json={"enabled": True})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "ticker": "TST", "analyst_target": True}
    assert mock_exec.call_args.args[1] == (True, "TST")
    with patch("routers.admin.execute", return_value=0):
        assert client.put("/api/admin/analyst-targets/NONE", json={"enabled": True}).status_code == 404


def test_admin_analyst_target_unauthenticated_401():
    fresh = FastAPI()
    fresh.include_router(admin_router)
    assert TestClient(fresh).put("/api/admin/analyst-targets/TST", json={"enabled": True}).status_code == 401


# ── GET /api/admin/analyst-targets — 전역 지정 목록 (task#224) ────────

def test_admin_analyst_targets_list_is_global():
    rows = [
        {"ticker": "035420", "name": "NAVER", "market": "KR"},
        {"ticker": "GOOGL", "name": "Alphabet Inc.", "market": "US"},
        {"ticker": "TST", "name": None, "market": None},  # 이름·시장 결측 → 폴백
    ]
    with patch("routers.admin.query", return_value=rows) as mock_q:
        data = client.get("/api/admin/analyst-targets").json()
    assert [d["ticker"] for d in data] == ["035420", "GOOGL", "TST"]
    # 소유자 무관 전역 조회 — user_id 조건 없이 analyst_target 플래그만 본다
    sql = mock_q.call_args.args[0]
    assert "analyst_target = true" in sql and "user_id" not in sql
    assert data[0]["market"] == "KR"
    assert data[2] == {"ticker": "TST", "name": "TST", "market": "US"}  # 결측 폴백


def test_admin_analyst_targets_list_unauthenticated_401():
    fresh = FastAPI()
    fresh.include_router(admin_router)
    assert TestClient(fresh).get("/api/admin/analyst-targets").status_code == 401


def test_get_stocks_enriched_at_query_failure_graceful():
    with patch("routers.stocks.storage.get_full_portfolio", return_value=PORTFOLIO), \
         patch("routers.stocks.query", side_effect=Exception("db down")):
        resp = sclient.get("/api/stocks")
    assert resp.status_code == 200
    assert all(d["enriched_at"] is None for d in resp.json())
