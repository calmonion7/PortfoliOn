"""A/B 하네스 쓰기 차단 프록시의 이빨 (task#350).

이 프록시의 **유일한 존재 이유**는 측정 세션이 프로드에 쓰지 못하게 하는 것이다.
그래서 여기서 잠그는 것은 「차단했다고 로그에 적었다」가 아니라 **업스트림이 호출되지 않았다**는
사실 자체다 — 로그 문자열은 구현이 거짓말할 수 있는 자리이므로 판정 근거가 될 수 없다.

설계 전제: 판정 로직은 `handle_request()` 순수 함수로 분리돼 있고 업스트림 호출자를 주입받는다.
HTTP 서버는 그 함수를 감싸는 껍데기다(그래야 실제 소켓 없이 이빨을 잴 수 있다).
"""
import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent.parent
PROXY = REPO / "scripts" / "ab-proxy.py"
REAL_KEY = "sk-REAL-KEY-NEVER-LEAVES-PROXY"
DUMMY_KEY = "sk-DUMMY-FOR-CHILD-SESSION"

pytestmark = pytest.mark.skipif(not PROXY.exists(), reason="프록시 스크립트 부재")


def _load():
    spec = importlib.util.spec_from_file_location("ab_proxy", PROXY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _SpyUpstream:
    """업스트림 호출을 세는 스파이 — 쓰기 경로에서 0이어야 한다."""

    def __init__(self, status=200, body=b'{"ok":true}'):
        self.calls = []
        self._status = status
        self._body = body

    def __call__(self, method, path, body, headers):
        self.calls.append({"method": method, "path": path, "headers": headers})
        return self._status, {"Content-Type": "application/json"}, self._body


@pytest.fixture
def ctx(tmp_path):
    mod = _load()
    return mod, mod.Context(
        upstream_base="https://portfolion.taebro.com",
        real_key=REAL_KEY,
        capture_dir=tmp_path / "capture",
        log_path=tmp_path / "proxy.log",
    )


WRITE_METHODS = ["POST", "PUT", "DELETE", "PATCH"]


@pytest.mark.parametrize("method", WRITE_METHODS)
def test_write_method_never_reaches_upstream(ctx, method):
    """① 쓰기 메서드는 업스트림을 **호출하지 않는다** — 이 프록시의 본체."""
    mod, c = ctx
    spy = _SpyUpstream()
    mod.handle_request(method, "/api/tech-reports/smr", b'{"title":"x"}', {}, c, upstream=spy)
    assert spy.calls == [], f"{method}가 프로드에 도달했다: {spy.calls}"


@pytest.mark.parametrize("method", WRITE_METHODS)
def test_write_method_is_captured_to_file(ctx, method):
    """② 쓰기 본문은 파일로 캡처된다 — 모델에게 out.json을 부탁할 필요가 없는 이유."""
    mod, c = ctx
    payload = {"title": "테스트 발행물", "n": 1}
    mod.handle_request(
        method, "/api/analyst-reports/GOOGL", json.dumps(payload).encode(), {}, c, upstream=_SpyUpstream()
    )
    files = list(c.capture_dir.glob("*.json"))
    assert len(files) == 1, f"캡처 파일이 {len(files)}개"
    saved = json.loads(files[0].read_text())
    assert saved["method"] == method
    assert saved["path"] == "/api/analyst-reports/GOOGL"
    assert saved["body"] == payload


def test_repeated_writes_do_not_clobber_each_other(ctx):
    """③ 같은 경로로 2회 쓰면 캡처가 2개 남는다 (앞 캡처를 덮지 않는다).

    fire 리스너가 같은 초 2회 fire로 run.log를 truncate했던 것과 같은 함정(task#254).
    """
    mod, c = ctx
    for i in range(2):
        mod.handle_request(
            "POST", "/api/tech-reports/smr", json.dumps({"i": i}).encode(), {}, c, upstream=_SpyUpstream()
        )
    assert len(list(c.capture_dir.glob("*.json"))) == 2


def test_write_returns_success_with_content_length(ctx):
    """④ 차단 응답은 **성공처럼** 보이고 `Content-Length`를 반드시 싣는다.

    길이가 없으면 클라이언트가 바디를 읽을 때 간헐 ConnectionReset이 나고, 세션 로그에
    상태코드 대신 「연결 끊김」이 남아 원인 추적이 끊긴다(task#346 실측: 6회 중 2회).
    실패로 보이면 세션이 재시도 루프를 돌아 측정 자체가 오염되므로 2xx여야 한다.
    """
    mod, c = ctx
    status, headers, body = mod.handle_request(
        "POST", "/api/tech-reports/smr", b"{}", {}, c, upstream=_SpyUpstream()
    )
    assert 200 <= status < 300, f"차단 응답이 {status} — 세션이 재시도 루프를 돈다"
    assert "Content-Length" in headers
    assert int(headers["Content-Length"]) == len(body)


def test_get_passes_through_to_upstream(ctx):
    """⑤ GET은 업스트림에 실제로 전달되고 응답이 그대로 돌아온다 (읽기 현실성 보존)."""
    mod, c = ctx
    spy = _SpyUpstream(status=200, body=b'{"reports":[1,2]}')
    status, _, body = mod.handle_request("GET", "/api/tech-reports", None, {}, c, upstream=spy)
    assert len(spy.calls) == 1
    # 업스트림 호출자는 전체 URL을 받는다(urllib이 그것을 요구한다). bare path를 기대하면
    # 틀리므로, 대신 **업스트림 base가 실제로 prod인지**까지 함께 못박는다(더 강한 단언).
    assert spy.calls[0]["path"] == "https://portfolion.taebro.com/api/tech-reports"
    assert status == 200 and body == b'{"reports":[1,2]}'


def test_get_carries_the_real_key_upstream(ctx):
    """⑥ 업스트림 GET에는 **진짜 키**가 붙는다 — 진짜 키는 프록시 밖으로 나가지 않는다."""
    mod, c = ctx
    spy = _SpyUpstream()
    mod.handle_request("GET", "/api/portfolio", None, {"X-API-Key": DUMMY_KEY}, c, upstream=spy)
    sent = {k.lower(): v for k, v in spy.calls[0]["headers"].items()}
    assert sent["x-api-key"] == REAL_KEY, "업스트림에 진짜 키가 안 갔다"


def test_child_dummy_key_is_not_the_real_key(ctx):
    """⑦ 자식에게 주는 더미 키는 진짜 키와 **다르다** — 2겹 방어의 두 번째 겹.

    이것이 같으면 세션이 프록시를 우회해 prod를 직접 때릴 때 쓰기가 성립한다.
    """
    mod, _ = ctx
    dummy = mod.make_dummy_key()
    assert dummy != REAL_KEY
    assert len(dummy) >= 16, "너무 짧으면 실수로 진짜 키와 충돌할 수 있다"


def test_every_request_is_logged_with_verdict(ctx):
    """⑧ 통과/차단이 로그에 남는다 (판정 근거가 아니라 **사후 감사**용)."""
    mod, c = ctx
    mod.handle_request("GET", "/api/x", None, {}, c, upstream=_SpyUpstream())
    mod.handle_request("POST", "/api/y", b"{}", {}, c, upstream=_SpyUpstream())
    log = c.log_path.read_text()
    assert "PASS" in log and "GET /api/x" in log
    assert "BLOCK" in log and "POST /api/y" in log
