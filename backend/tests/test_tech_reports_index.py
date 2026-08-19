"""기술 노출 역방향 연결용 경량 인덱스 `GET /api/tech-reports/index` (ADR-0043, task#307 S2).

형제 test_tech_reports_router.py와 동형 — self-app + dependency override,
DB는 services.tech_reports.query를 mock(conftest _block_real_db 가드).

이 파일의 핵심은 **라우트 순서 회귀**다: `/{slug}`가 `SlugPath = Literal[_SLUGS]`라
`/index`를 먼저 잡으면 허용 slug이 아니어서 **422로 죽는다**(다른 라우트로 흘러가지
않는다). 순서가 뒤집히면 조용히 깨지는 게 아니라 이 테스트가 잡는다.
"""
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.tech_reports import router
from auth import get_current_user_or_api_key
from services import tech_reports as svc

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
client = TestClient(app)


def _row(slug, players, title="헤드라인 문장", **extra):
    row = {
        "slug": slug,
        "title": title,
        "description": "본문 산문 — 인덱스에 실리면 안 된다.",
        "key_points": [{"text": "요약"}],
        "challenges": [{"title": "난제", "body": "본문"}],
        "players": players,
        "published_date": "2026-08-12",
    }
    row.update(extra)
    return row


ROWS = [
    _row("robotics", [
        {"name": "Tesla", "ticker": "TSLA"},
        {"name": "현대차", "ticker": "005380"},
        {"name": "Figure AI", "ticker": None},      # 비상장 → tickers에서 빠지고 total엔 남는다
        {"name": "Apptronik"},                       # ticker 키 자체가 없는 경우
    ]),
    _row("smr", [
        {"name": "TerraPower", "ticker": None},
        {"name": "두산에너빌리티", "ticker": "034020"},
    ]),
]


def test_index_returns_ticker_sets_and_totals():
    """tickers[]는 players[].ticker의 non-null 집합과 정확히 일치하고, players_total은 전체 수다."""
    with patch.object(svc, "query", return_value=ROWS):
        r = client.get("/api/tech-reports/index")
    assert r.status_code == 200
    idx = {e["slug"]: e for e in r.json()["index"]}

    assert idx["robotics"]["tickers"] == ["005380", "TSLA"]   # 정렬됨
    assert idx["robotics"]["players_total"] == 4              # ticker 없는 2명도 총계엔 남는다
    assert idx["smr"]["tickers"] == ["034020"]
    assert idx["smr"]["players_total"] == 2


def test_index_excludes_prose_fields():
    """산문은 싣지 않는다 — 소비처는 티커 교차만 필요하고 전문을 실으면 화면이 수백 KB를 받는다."""
    with patch.object(svc, "query", return_value=ROWS):
        r = client.get("/api/tech-reports/index")
    for entry in r.json()["index"]:
        for banned in ("description", "key_points", "challenges", "players", "composition"):
            assert banned not in entry, f"{banned}가 인덱스에 실렸다"
        assert set(entry) == {"slug", "name", "title", "tickers", "players_total"}


def test_index_carries_short_display_name():
    """칩 라벨용 표시명 — 리포트 title은 150자 헤드라인이라 칩에 못 쓴다."""
    with patch.object(svc, "query", return_value=ROWS):
        r = client.get("/api/tech-reports/index")
    idx = {e["slug"]: e for e in r.json()["index"]}
    names = {t["slug"]: t["name"] for t in svc.TECH_TOPICS}
    assert idx["robotics"]["name"] == names["robotics"] == "로봇"
    assert idx["smr"]["name"] == names["smr"] == "SMR"


def test_index_route_is_declared_before_slug_catch_all():
    """⚠️ 라우트 순서 회귀 — `/index`가 `/{slug}`보다 뒤에 선언되면 422로 죽는다.

    `SlugPath = Literal[_SLUGS]`이므로 catch-all이 먼저 잡으면 "index"는 허용값이 아니어서
    검증 실패한다. 즉 순서가 뒤집힌 세계에서 이 요청은 200이 아니라 422다.
    """
    with patch.object(svc, "query", return_value=ROWS):
        r = client.get("/api/tech-reports/index")
    assert r.status_code == 200, (
        f"/index가 catch-all에 먹혔다(status={r.status_code}) — "
        "@router.get('/index')를 @router.get('/{slug}')보다 위에 선언해야 한다"
    )
    assert "index" in r.json()


def test_existing_slug_route_still_works():
    """catch-all 자체는 살아 있어야 한다 — 신규 경로가 기존 slug 조회를 가리지 않는다."""
    with patch.object(svc, "query", return_value=[ROWS[0]]):
        r = client.get("/api/tech-reports/solid-state-battery")
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "solid-state-battery"
    assert isinstance(body["reports"], list)


def test_index_handles_report_with_no_players():
    """players가 비어도(또는 None) 빈 집합으로 graceful — 0을 성공으로 읽는 게 아니라 형태를 지킨다."""
    rows = [_row("robotics", []), _row("smr", None)]
    with patch.object(svc, "query", return_value=rows):
        r = client.get("/api/tech-reports/index")
    assert r.status_code == 200
    for entry in r.json()["index"]:
        assert entry["tickers"] == []
        assert entry["players_total"] == 0


def test_index_requires_auth():
    """무인증 거부는 override 없는 fresh app으로 검증(test_security_auth_gaps 패턴)."""
    fresh = FastAPI()
    fresh.include_router(router)
    r = TestClient(fresh).get("/api/tech-reports/index")
    assert r.status_code in (401, 403)
