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
    rc = 0          # 클래스 속성 — 테스트가 갈아끼워 종료 코드를 흉내낸다
    hang = False    # True면 wait가 TimeoutExpired를 던진다

    def __init__(self, args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self.stdin = _FakeStdin()
        self.waited = False
        self.killed = False

    def wait(self, timeout=None):
        self.waited = True
        _EVENTS.append(("wait", self))
        if type(self).hang:
            import subprocess as _sp
            raise _sp.TimeoutExpired(self.args, timeout)
        return type(self).rc

    def kill(self):
        self.killed = True


_EVENTS = []  # (종류, proc) — 스폰/대기의 **순서**를 재기 위한 것


@pytest.fixture
def listener(monkeypatch, tmp_path):
    mod = _load()
    calls = []

    _EVENTS.clear()
    _FakeProc.rc = 0
    _FakeProc.hang = False

    def fake_popen(args, **kwargs):
        p = _FakeProc(args, **kwargs)
        calls.append(p)
        _EVENTS.append(("spawn", p))
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


def test_api_key_never_in_argv_or_prompt(listener):
    """③ API 키 **값**이 argv에도 stdin 프롬프트에도 없고, env로만 자식에게 간다 (task#349).

    task#254는 argv 노출(L2)만 닫고 키를 stdin 프롬프트에 실었다. 그 판은 `claude -p`가
    명령을 에코하지 않아 무해했지만, OpenCode `run`은 실행한 bash 명령을 run.log(0644)에
    에코하므로 프롬프트의 키가 **평문 로그로 샌다**(task#348 실측 — 26청크 로그 전부).
    그래서 전달 매체를 env로 옮긴다.

    ⚠️ 옛 단언 `FAKE_KEY in stdin`을 뒤집으면서 그것이 증명하던 성질(「키가 실제로 자식에게
    전달된다」)이 사라지지 않도록 **env 단언을 대체로** 둔다 — 없으면 키를 통째로 빠뜨려도
    이 테스트가 초록이 된다.
    """
    listener._spawn_claude("trigger")
    proc = listener._calls[-1]
    assert not any(FAKE_KEY in str(a) for a in proc.args), f"argv에 키 노출: {proc.args}"
    assert FAKE_KEY not in proc.stdin.written.decode(), "프롬프트에 키 값이 남아 있다"
    assert proc.kwargs["env"]["PORTFOLION_API_KEY"] == FAKE_KEY, "키가 자식 env로 전달되지 않았다"
    assert proc.stdin.closed, "stdin을 닫지 않으면 claude가 프롬프트 끝을 못 본다"


# ── 시크릿 env 주입 (task#349) ────────────────────────────────────────

def test_env_injection_preserves_parent_environment(listener, monkeypatch):
    """ⓐ 자식 env는 부모 환경 **위에** 키를 얹은 것이다.

    `env={"PORTFOLION_API_KEY": ...}` 처럼 통째로 갈아끼우면 PATH가 사라져 실행기 자체가
    뜨지 않는다(무음 고장). 부모 env 보존이 이 축의 본체다.
    """
    monkeypatch.setenv("FORGE_PROBE_VAR", "kept")
    listener._spawn_claude("trigger")
    env = listener._calls[-1].kwargs["env"]
    assert env["FORGE_PROBE_VAR"] == "kept", "부모 환경을 갈아끼웠다 — PATH도 함께 사라진다"
    assert env["PORTFOLION_API_KEY"] == FAKE_KEY


def test_prompt_references_env_var_not_literal(listener):
    """ⓑ 프롬프트의 `{{COWORK_API_KEY}}` 자리는 **값이 아니라 변수 참조**로 남는다.

    치환을 그냥 지우면 자리표시자가 그대로 남아 세션이 literal `{{COWORK_API_KEY}}`를
    헤더로 보내 401이 된다 — 「키가 없다」와 「키를 못 읽는다」를 가르는 축이다.
    """
    listener._spawn_claude("trigger")
    prompt = listener._calls[-1].stdin.written.decode()
    assert "{{COWORK_API_KEY}}" not in prompt, "자리표시자가 치환되지 않은 채 남았다"
    assert "$PORTFOLION_API_KEY" in prompt, "프롬프트가 env 변수를 참조하지 않는다"


def test_run_log_is_owner_only(listener):
    """ⓒ run.log는 0600으로 생성된다 — 실행기가 명령을 에코해도 타 사용자가 못 읽는다."""
    import stat as _stat
    workdir = Path(listener._spawn_claude("trigger"))
    mode = _stat.S_IMODE((workdir / "run.log").stat().st_mode)
    assert mode == 0o600, f"run.log 모드가 {oct(mode)} — 0600이어야 한다"


def test_secret_handling_identical_for_both_runners(listener):
    """ⓓ 키 은닉은 실행기 분기와 **독립**이다 — OpenCode 경로에서도 동일하다.

    원 결함이 OpenCode에서만 드러났기 때문에 claude 경로만 고치고 끝낼 위험이 있다.
    """
    for model in ("opus", "opencode/muse-spark-1.3-contributor-free"):
        proc, workdir = listener._spawn_proc("트리거", model)
        assert FAKE_KEY not in proc.stdin.written.decode(), f"{model}: 프롬프트에 키 값"
        assert proc.kwargs["env"]["PORTFOLION_API_KEY"] == FAKE_KEY, f"{model}: env 미주입"
        assert not any(FAKE_KEY in str(a) for a in proc.args), f"{model}: argv에 키"


# ── 실행기 분기: claude -p vs OpenCode (task#348) ──────────────────────

def test_runner_argv_claude_unchanged(listener):
    """ⓑ `/` 없는 model(예: opus)은 기존 argv와 완전 동일 — 이게 무회귀의 이빨이다."""
    assert listener._runner_argv("opus") == [
        "claude", "-p", "--model", "opus",
        "--allowedTools", "Bash,WebSearch,WebFetch,Read,Write",
    ]


def test_runner_argv_opencode_branch(listener):
    """ⓐ `/` 포함 model은 `opencode run -m <model> --auto`로 분기한다."""
    argv = listener._runner_argv("opencode/muse-spark-1.3-contributor-free")
    assert argv[0].endswith("opencode")
    assert argv[1:] == ["run", "-m", "opencode/muse-spark-1.3-contributor-free", "--auto"]


def test_spawn_proc_stdin_prompt_same_for_both_runners(listener):
    """ⓒ 두 실행기 모두 프롬프트가 같은 방식(stdin, 닫힘)으로 전달된다."""
    proc1, _ = listener._spawn_proc("트리거텍스트", "opus")
    proc2, _ = listener._spawn_proc("트리거텍스트", "opencode/x")
    for proc in (proc1, proc2):
        assert proc.stdin.closed
        assert "트리거텍스트" in proc.stdin.written.decode()


def test_no_payment_method_is_treated_as_limit(listener, tmp_path):
    """ⓓ OpenCode 무료 모델이 결제수단 부재로 즉사하면 한도 취급한다."""
    workdir = tmp_path / "oc-limit-run"
    workdir.mkdir()
    (workdir / "run.log").write_text("Error: No payment method on file\n")
    assert listener._hit_limit(workdir) is True


# ── 전량 모드: 청크 순차 스폰 (task#344) ──────────────────────────────

def _tickers(n):
    return [f"T{i:02d}" for i in range(n)]


def test_chunks_are_split_and_each_session_sees_only_its_own(listener):
    """ⓐ 12종목·chunk 5 → 세션 3개, 각 stdin에 5·5·2 종목만 실린다."""
    listener._run_chunks("야간", _tickers(12), "sonnet", 5)
    assert len(listener._calls) == 3
    groups = [_tickers(12)[0:5], _tickers(12)[5:10], _tickers(12)[10:12]]
    for proc, group in zip(listener._calls, groups):
        body = proc.stdin.written.decode()
        assert "[대상 종목]" in body
        for t in group:
            assert t in body
        # 남의 청크 종목이 새어들면 같은 종목을 두 세션이 동시에 건드린다
        for other in set(_tickers(12)) - set(group):
            assert f"\n{other}\n" not in body, f"{other}가 남의 청크에 있다"
    assert all("sonnet" in p.args for p in listener._calls)


def test_chunks_run_sequentially_not_in_parallel(listener):
    """ⓑ 다음 세션은 앞 세션의 wait 뒤에 뜬다 — 동시 세션 0이 이 배치의 존재 이유다."""
    listener._run_chunks("야간", _tickers(6), "sonnet", 2)
    kinds = [k for k, _ in _EVENTS]
    assert kinds == ["spawn", "wait", "spawn", "wait", "spawn", "wait"], kinds


def test_limit_hit_abandons_remaining_chunks(listener, capsys):
    """한도 즉사 시 남은 청크를 포기한다 — 계속 띄우면 같은 실패를 K번 반복한다."""
    real = listener._spawn_proc

    def spawn_then_limit(text, model=listener.DEFAULT_MODEL, tickers=None):
        proc, workdir = real(text, model, tickers)
        (workdir / "run.log").write_text("You've hit your weekly limit\n")
        return proc, workdir

    listener._spawn_proc = spawn_then_limit
    listener._run_chunks("야간", _tickers(12), "sonnet", 5)
    assert len(listener._calls) == 1, "한도 뒤에도 스폰이 계속됐다"
    assert "잔여 2청크" in capsys.readouterr().out


def test_normal_log_does_not_abort(listener):
    """대조군 — 평범한 로그는 중단시키지 않는다(한도 판정이 아무거나 잡으면 무용지물)."""
    real = listener._spawn_proc

    def spawn_then_normal(text, model=listener.DEFAULT_MODEL, tickers=None):
        proc, workdir = real(text, model, tickers)
        (workdir / "run.log").write_text("Starting analysis of T00\n")
        return proc, workdir

    listener._spawn_proc = spawn_then_normal
    listener._run_chunks("야간", _tickers(4), "sonnet", 2)
    assert len(listener._calls) == 2


def test_enqueue_returns_chunk_count(listener, monkeypatch):
    """청크 수는 올림이다(12/5 → 3) — 응답의 chunks가 이 값이다."""
    monkeypatch.setattr(listener, "_QUEUE", __import__("queue").Queue())
    monkeypatch.setattr(listener.threading, "Thread", lambda **kw: type(
        "T", (), {"start": lambda self: None, "is_alive": lambda self: True, "daemon": True})())
    assert listener._enqueue_chunks("t", _tickers(12), "sonnet", 5) == 3
    assert listener._enqueue_chunks("t", _tickers(10), "sonnet", 5) == 2
    assert listener._enqueue_chunks("t", _tickers(1), "sonnet", 5) == 1


def test_plain_fire_unchanged_single_opus_session(listener):
    """ⓒ `tickers` 없는 기존 요청은 경로·모델·논블로킹 전부 무변경이다."""
    workdir = listener._spawn_claude("평범한 트리거")
    assert isinstance(workdir, str)
    assert len(listener._calls) == 1
    proc = listener._calls[0]
    assert "opus" in proc.args and "sonnet" not in proc.args
    assert proc.waited is False, "기존 경로가 wait하면 fire 응답이 세션 내내 막힌다"
    # ⚠️ "[대상 종목]" 부재로 재면 안 된다 — 프롬프트 파일 자체가 그 마커를 **설명하느라**
    # 포함하므로 그 축은 원리적으로 통과 불가다. 등가로 좁힌다: 대상 블록이 *덧붙지* 않았다
    # = 본문이 트리거 지시로 끝난다(느슨화가 아니라 강화 — 뒤에 무엇이 붙어도 잡는다).
    assert proc.stdin.written.decode().rstrip().endswith("평범한 트리거")


def test_nonzero_exit_is_reported_not_silently_completed(listener, capsys):
    """한도 아닌 실패(인증 오류·바이너리 부재 등)를 「완료」로 찍으면 계측 실패를 성공으로 읽는다."""
    _FakeProc.rc = 127
    listener._run_chunks("야간", _tickers(4), "sonnet", 2)
    out = capsys.readouterr().out
    assert "실패 (exit 127" in out
    assert "완료" not in out
    assert len(listener._calls) == 2, "한 청크 실패로 나머지를 버리지는 않는다"


def test_hung_session_is_killed_and_run_continues(listener, capsys):
    """세션이 안 끝나면 죽이고 다음 청크로 간다 — 무한 대기는 워커를 영구 정지시킨다."""
    _FakeProc.hang = True
    listener._run_chunks("야간", _tickers(4), "sonnet", 2)
    assert all(p.killed for p in listener._calls), "타임아웃 세션을 죽이지 않았다"
    assert "타임아웃" in capsys.readouterr().out
    assert len(listener._calls) == 2


def test_limit_marker_beyond_first_line_is_still_caught(listener):
    """배너·로딩 로그가 앞서면 한도 문구가 첫 줄에 없다 — 그때도 잡아야 한다."""
    real = listener._spawn_proc

    def spawn_then_banner_limit(text, model=listener.DEFAULT_MODEL, tickers=None):
        proc, workdir = real(text, model, tickers)
        (workdir / "run.log").write_text("Loading MCP servers...\nbanner\nYou've hit your weekly limit\n")
        return proc, workdir

    listener._spawn_proc = spawn_then_banner_limit
    listener._run_chunks("야간", _tickers(12), "sonnet", 5)
    assert len(listener._calls) == 1


def test_chunk_is_clamped_to_max(listener):
    """chunk 상한이 없으면 ADR이 버린 「단일 세션 전량」으로 퇴행한다."""
    assert listener._MAX_CHUNK == 50
    listener._run_chunks("야간", _tickers(120), "sonnet", listener._MAX_CHUNK)
    assert len(listener._calls) == 3  # 120/50 → 3청크


def test_worker_survives_a_failing_job(listener):
    """워커가 예외로 죽으면 이후 모든 전량 회차가 큐에 쌓이기만 한다 — 실스레드로 확인."""
    import queue as _q, threading, time
    done = threading.Event()
    seen = []

    def boom(*a):
        seen.append("boom")
        raise RuntimeError("청크 처리 실패")

    def fine(*a):
        seen.append("fine")
        done.set()

    listener._QUEUE = _q.Queue()
    calls = iter([boom, fine])
    listener._run_chunks = lambda *a: next(calls)(*a)
    listener._WORKER = None
    listener._enqueue_chunks("t", _tickers(1), "sonnet", 5)
    listener._enqueue_chunks("t", _tickers(1), "sonnet", 5)
    assert done.wait(5), f"첫 작업의 예외가 워커를 죽였다 (처리된 것: {seen})"
    assert seen == ["boom", "fine"]
