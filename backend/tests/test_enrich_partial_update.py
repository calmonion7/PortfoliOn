"""enrich **부분 필드 갱신**의 계약 (task#353).

왜 이 파일이 필요한가 — task#351이 「필드별 차등 갱신(C안)은 enrich가 전 필드 치환이면 구현
불가다」를 정책 결정의 게이트로 삼았다. 구현은 이미 부분 갱신을 한다. 그런데 **기존 테스트는
컬럼의 *존재*만 단언하고 *부재*는 아무도 단언하지 않았다**(`test_storage.py`의
`test_enrich_stock_accepts_*`가 `"key_resource=%s" in sql`을 볼 뿐이다). 그래서 누군가
`enrich_stock`을 전 필드 치환으로 바꿔도 **스위트가 초록으로 통과한다.**

여기서 못박는 것은 셋이다:
  (a) 음성 — 보내지 않은 필드는 SET 절에 **없다**
  (b) 양성 — 8필드를 보내면 **전부** 있다
  (c) 라우터의 명시적 null 필터 — `null`로 보낸 필드는 저장 계층에 **도달하지 않는다**

⚠️ (b)가 왜 쌍으로 필요한가 — 음성만 두면 「부분 갱신이 동작한다」와 「내 입력이 대상에 닿지
못해 전부 누락됐다」가 **구별되지 않는다**. 양성이 없으면 이 파일은 구현을 통째로 지워도
통과한다(루트 CLAUDE.md task#342: 경계·범위 축은 음성과 양성을 반드시 쌍으로).

⚠️ conftest `_block_real_db`가 실 DB를 막으므로 `services.storage.portfolio`의 query/execute를
mock한다. 이 테스트는 라이브 DB에 닿지 않는다.

라이브 증거는 이 단위 계약과 **별개로** 존재한다 — `enrich_history`에서 `changed` 길이가 1인
행들이 나머지 필드를 보존하고 있음이 그것이고, 재현 명령은 `.forge/task351-findings.md` §6에 있다.
"""
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import get_current_user, get_current_user_or_api_key, require_admin_or_api_key
from routers.stocks import router

# enrich 8필드 (정본: services/storage/portfolio.py::_HISTORY_FIELDS)
ALL_FIELDS = (
    "moat", "growth_plan", "risks", "recent_disclosures",
    "insights", "key_resource", "competitor_edge", "market_outlook",
)

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
app.dependency_overrides[require_admin_or_api_key] = lambda: "test-user-id"
client = TestClient(app)


def _update_sql(mock_execute):
    """enrich_stock이 발행한 **UPDATE** 문. 두 번째 execute는 enrich_history INSERT다."""
    return mock_execute.call_args_list[0][0][0]


def test_partial_enrich_sets_only_the_sent_column():
    """(a) 음성 — 한 필드만 보내면 나머지 7개는 SET 절에 **없다**.

    이게 깨지면 전 필드 치환이라는 뜻이고, task#351의 C안(필드별 차등)이 구현 불가가 된다.
    """
    from services import storage

    with patch("services.storage.portfolio.query", return_value=[{"ticker": "AAPL"}]), \
         patch("services.storage.portfolio.execute", return_value=1) as mock_execute:
        assert storage.enrich_stock("AAPL", {"moat": "wide"}) is True

    sql = _update_sql(mock_execute)
    assert "moat=%s" in sql
    assert "enriched_at=NOW()" in sql
    # 부분문자열 오탐을 피해 `컬럼=%s` 형태로 정확히 본다.
    absent = [f for f in ALL_FIELDS if f != "moat" and f"{f}=%s" in sql]
    assert absent == [], f"보내지 않은 필드가 SET 절에 있다: {absent}"


def test_full_enrich_sets_every_sent_column():
    """(b) 양성 — 8필드를 보내면 **전부** SET 절에 있다.

    음성 축이 「대상에 닿았는지」를 증언하게 하는 대조군이다. 이것이 없으면 구현이 아무 컬럼도
    쓰지 않아도 (a)가 통과한다.
    """
    from services import storage

    payload = {f: f"value-{f}" for f in ALL_FIELDS}
    with patch("services.storage.portfolio.query", return_value=[{"ticker": "AAPL"}]), \
         patch("services.storage.portfolio.execute", return_value=1) as mock_execute:
        assert storage.enrich_stock("AAPL", payload) is True

    sql = _update_sql(mock_execute)
    missing = [f for f in ALL_FIELDS if f"{f}=%s" not in sql]
    assert missing == [], f"보낸 필드가 SET 절에 없다: {missing}"


def test_router_drops_explicitly_null_fields_before_storage():
    """(c) 라우터 필터 — `null`로 보낸 필드는 저장 계층에 도달하지 않는다.

    `model_dump(exclude_none=True)` + `v is not None` 이중 필터가 실제로 그렇게 동작함을 못박는다.
    이게 풀리면 루틴이 보낸 `"risks": null` 하나가 **기존 값을 NULL로 덮는다**(wrong < missing 위반).
    """
    with patch("routers.stocks.storage.enrich_stock", return_value=True) as mock_enrich:
        resp = client.put("/api/stocks/AAPL/enrich", json={"moat": "wide", "risks": None})

    assert resp.status_code == 200
    fields = mock_enrich.call_args[0][1]
    assert "moat" in fields
    assert "risks" not in fields, "명시적 null이 저장 계층까지 전달됐다"
    assert resp.json()["updated"] == ["moat"]


def test_history_changed_records_only_the_sent_keys():
    """`enrich_history.changed`가 「이번 요청이 건드린 키」를 담는다는 계약.

    이 문서의 라이브 증거(§3: changed 길이 1인 행이 나머지 필드를 보존)가 **이 계약에 의존한다** —
    `changed`가 「전 필드」를 담도록 바뀌면 그 쿼리의 의미가 조용히 달라진다.
    """
    import json

    from services import storage

    with patch("services.storage.portfolio.query",
               side_effect=[[{"ticker": "AAPL"}], [{"f": {f: None for f in ALL_FIELDS}}]]), \
         patch("services.storage.portfolio.execute", return_value=1) as mock_execute:
        assert storage.enrich_stock("AAPL", {"moat": "wide"}) is True

    insert_sql, insert_params = mock_execute.call_args_list[1][0]
    assert "INSERT INTO enrich_history" in insert_sql
    assert json.loads(insert_params[2]) == ["moat"]
