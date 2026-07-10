import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi.testclient import TestClient
from main import app
from auth import get_current_user

app.dependency_overrides[get_current_user] = lambda: "test-user-id"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_quote_cache():
    # get_quote는 종목 단위 TTL 캐시를 쓰므로, 테스트 간 교차 오염을 막기 위해 매 테스트 전 비운다.
    from services import cache as cache_svc
    cache_svc.invalidate_quote()
    yield


@pytest.fixture(autouse=True)
def _block_real_db(monkeypatch):
    # 테스트가 실 DB에 닿는 것을 차단 — 로컬에선 DATABASE_URL이 도커 postgres(=라이브 DB)를
    # 가리켜, generate_report 류의 end-to-end 테스트가 실 스냅샷을 fixture로 덮는 사고가 났다
    # (005930 스냅샷 클로버, task#169 UAT). DB가 필요한 테스트는 services.db의
    # query/execute를 테스트 계층에서 mock할 것.
    from services import db as db_svc

    def _no_real_db(*_a, **_k):
        raise RuntimeError("tests must not touch the real DB — mock services.db.query/execute")

    monkeypatch.setattr(db_svc, "_get_pool", _no_real_db)
