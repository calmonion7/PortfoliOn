"""fire 리스너의 run 격리·키 은닉 회귀 가드 (task#254 — 버그리포트 5차 M2·L2).

리스너는 launchd로 뜬 장수 단일 프로세스라 PID가 모든 fire에서 동일하다 → PID 접미사로는
같은 초 2회 fire의 workdir 충돌을 막을 수 없다. 여기서 잠그는 건 그 원자성과 키 은닉이다.

실 키·홈 디렉터리는 건드리지 않는다(`_env_value`·`RUN_DIR`·`Popen` 전부 monkeypatch).
"""
import importlib.util
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent.parent
LISTENER = REPO / "scripts" / "cowork-fire-listener.py"
FAKE_KEY = "sk-cowork-FAKE-KEY-FOR-TEST"

pytestmark = pytest.mark.skipif(not LISTENER.exists(), reason="리스너 스크립트 부재")


def _load():
    # 하이픈 파일명은 import 문으로 못 불러온다.
    spec = importlib.util.spec_from_file_location("cowork_fire_listener", LISTENER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _FakeStdin:
    def __init__(self):
        self.written = b""
        self.closed = False

    def write(self, b):
        self.written += b

    def close(self):
        self.closed = True


class _FakeProc:
    def __init__(self, args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self.stdin = _FakeStdin()


@pytest.fixture
def listener(monkeypatch, tmp_path):
    mod = _load()
    calls = []

    def fake_popen(args, **kwargs):
        p = _FakeProc(args, **kwargs)
        calls.append(p)
        return p

    monkeypatch.setattr(mod.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(mod, "RUN_DIR", tmp_path / "runs")
    monkeypatch.setattr(mod, "_env_value", lambda key: FAKE_KEY if key == "COWORK_API_KEY" else "tok")
    # 같은 초 2회 fire를 재현 — ts가 초 단위인 한 이름 충돌은 실재한다.
    monkeypatch.setattr(mod.time, "strftime", lambda *a: "20260731-190000")
    mod._calls = calls
    return mod


def test_same_second_fires_get_distinct_workdirs(listener):
    """① 같은 초 2회 fire의 workdir이 서로 다르다 (PID 접미사로는 통과 불가 — 단일 프로세스)."""
    first = listener._spawn_claude("a")
    second = listener._spawn_claude("b")
    assert first != second, f"같은 초 두 fire가 workdir을 공유한다: {first}"
    assert Path(first).is_dir() and Path(second).is_dir()


def test_running_run_log_is_not_truncated_by_next_fire(listener):
    """② 앞 fire의 run.log가 뒤 fire로 truncate되지 않는다 (실행 중 프로세스의 출력 보존)."""
    first = Path(listener._spawn_claude("a"))
    # 첫 fire의 자식이 아직 이 cwd에서 돌며 로그를 쓰고 있는 상황을 재현.
    (first / "run.log").write_text("FIRST RUN OUTPUT")
    listener._spawn_claude("b")
    assert (first / "run.log").read_text() == "FIRST RUN OUTPUT"


def test_api_key_goes_to_stdin_not_argv(listener):
    """③ API 키가 argv 어느 원소에도 없고 stdin으로 전달된다 (ps 노출 차단)."""
    listener._spawn_claude("trigger")
    proc = listener._calls[-1]
    assert not any(FAKE_KEY in str(a) for a in proc.args), f"argv에 키 노출: {proc.args}"
    assert FAKE_KEY in proc.stdin.written.decode(), "키가 stdin으로 전달되지 않았다"
    assert proc.stdin.closed, "stdin을 닫지 않으면 claude가 프롬프트 끝을 못 본다"
