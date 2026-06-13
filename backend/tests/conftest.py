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
