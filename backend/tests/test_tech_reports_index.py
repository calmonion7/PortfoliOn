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
        # `note`는 산문이라 listed에서 빠져야 한다 — 픽스처에 실제로 넣어야 그 축에 이빨이 생긴다.
        {"name": "Tesla", "ticker": "TSLA", "country": "US", "state_led": False,
         "tech_level": 5, "gap_years": 0, "category": "휴머노이드",
         "note": "산문 — listed에 실리면 안 된다.", "share_pct": 31.5, "leader_name": "머스크"},
        {"name": "현대차", "ticker": "005380", "country": "KR", "state_led": False,
         "tech_level": 3, "gap_years": 4, "category": None},   # category 결측(실측 12%)
        {"name": "Figure AI", "ticker": None},      # 비상장 → tickers에서 빠지고 total엔 남는다
        {"name": "Apptronik"},                       # ticker 키 자체가 없는 경우
    ]),
    _row("smr", [
        {"name": "TerraPower", "ticker": None},
        {"name": "두산에너빌리티", "ticker": "034020", "country": "KR", "state_led": True,
         "tech_level": 4, "gap_years": None, "category": "SMR 일체형"},  # gap_years 결측(실측 14%)
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
        # `players`(전문)는 **여전히 금지**다. task#323이 실은 것은 산문 없는 축약 배열
        # `listed`이므로 ADR-0043의 결정(「산문을 싣지 않는다」·근거는 페이로드 크기)의
        # *의도*를 지킨다 — 그래서 키를 `players`로 재사용하지 않고 새로 명명했고,
        # 미래에 전문이 다시 유입되면 이 금지 목록이 그대로 잡는다(task#264 절차).
        for banned in ("description", "key_points", "challenges", "players", "composition"):
            assert banned not in entry, f"{banned}가 인덱스에 실렸다"
        assert set(entry) == {"slug", "name", "title", "tickers", "listed", "players_total"}


def test_index_carries_short_display_name():
    """칩 라벨용 표시명 — 리포트 title은 120자 이내 리드 문장이라 칩에 못 쓴다."""
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


# ── task#323 — 축약 `listed[]` (후보 칩의 데이터 경로) ────────────────────────────
_LISTED_KEYS = {"ticker", "name", "tech_level", "gap_years", "country", "state_led", "category"}


def test_index_listed_matches_tickers_identity():
    """`tickers[] == [p["ticker"] for p in listed]` — dual-source가 조용히 갈라지는 것을 막는 유일한 장치.

    `tickers`(집합 기반)와 `listed`(원소 기반)는 출처가 같아도 코드가 둘로 나뉘어 있어
    한쪽만 고치면 화면의 「노출 계산」과 「후보 칩」이 서로 다른 모집단을 쓰게 된다.
    """
    with patch.object(svc, "query", return_value=ROWS):
        r = client.get("/api/tech-reports/index")
    for entry in r.json()["index"]:
        got = [p["ticker"] for p in entry["listed"]]
        assert got == entry["tickers"], f'{entry["slug"]}: listed={got} tickers={entry["tickers"]}'
        assert got == sorted(got), f'{entry["slug"]}: listed가 정렬돼 있지 않다'


def test_index_listed_elements_are_prose_free_and_key_capped():
    """원소 키 상한 + `note` 부재 — 산문 금지를 **원소 수준**까지 내린다.

    항목 수준 금지(`players` not in entry)만으로는 축약 배열 안에 507자 `note`가
    실려도 통과한다. 픽스처의 Tesla가 실제 `note`·`share_pct`·`leader_name`을 갖고
    있으므로 이 축은 이빨이 있다(그 셋이 새어 나오면 FAIL한다).
    """
    with patch.object(svc, "query", return_value=ROWS):
        r = client.get("/api/tech-reports/index")
    seen = 0
    for entry in r.json()["index"]:
        for p in entry["listed"]:
            assert set(p) <= _LISTED_KEYS, f"허용 밖 키: {set(p) - _LISTED_KEYS}"
            assert "note" not in p, "산문 note가 listed에 실렸다"
            assert "share_pct" not in p, "채움률 9%인 share_pct가 실렸다"
            assert "leader_name" not in p
            seen += 1
    assert seen == 3, f"표본 {seen}건 — 0이면 통과가 아니라 미측정이다"


def test_index_listed_omits_tickerless_players_but_total_keeps_them():
    """티커 없는 업체는 `listed`에 없고 `players_total`엔 남는다 — 그 차이가 「미매칭 N개 제외」 부기다."""
    with patch.object(svc, "query", return_value=ROWS):
        r = client.get("/api/tech-reports/index")
    idx = {e["slug"]: e for e in r.json()["index"]}

    assert [p["name"] for p in idx["robotics"]["listed"]] == ["현대차", "Tesla"]  # 티커 정렬 순
    assert idx["robotics"]["players_total"] == 4        # Figure AI·Apptronik은 총계에 남는다
    assert len(idx["smr"]["listed"]) == 1
    assert idx["smr"]["players_total"] == 2
    # 값이 실제로 옮겨졌는지 — 「필드가 있다」가 아니라 「그 값이다」를 잰다.
    hyundai = idx["robotics"]["listed"][0]
    assert (hyundai["tech_level"], hyundai["gap_years"], hyundai["country"]) == (3, 4, "KR")
    assert hyundai["category"] is None                 # 결측은 None으로 내려온다(칩이 Lv만 쓴다)
    assert idx["smr"]["listed"][0]["state_led"] is True


def test_index_listed_dedupes_duplicate_ticker():
    """한 리포트에 같은 티커가 두 번 나와도 `tickers`(집합)와 갈라지지 않는다.

    `tickers`는 set 기반이라 자동 dedupe되는데 `listed`가 원소마다 붙으면 길이가
    어긋나 위 identity 축이 깨진다 — 그 경로를 픽스처로 못박는다.
    """
    rows = [_row("robotics", [
        {"name": "Tesla", "ticker": "TSLA", "tech_level": 5, "category": "휴머노이드"},
        {"name": "Tesla Optimus", "ticker": "TSLA", "tech_level": 4, "category": "구동부"},
    ])]
    with patch.object(svc, "query", return_value=rows):
        r = client.get("/api/tech-reports/index")
    e = r.json()["index"][0]
    assert e["tickers"] == ["TSLA"]
    assert [p["ticker"] for p in e["listed"]] == ["TSLA"]     # identity 유지
    assert e["listed"][0]["name"] == "Tesla"                   # 첫 등장 보존
    assert e["players_total"] == 2                             # 총계는 2를 유지한다
