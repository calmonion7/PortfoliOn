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
