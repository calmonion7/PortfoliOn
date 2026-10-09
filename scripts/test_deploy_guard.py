"""deploy.sh·auto-deploy-poll.sh 옛 트리 배포 방지 가드 (task#377).

시나리오마다 임시 디렉터리에 bare origin과 클론을 만들고, 이 저장소의 실제 두 스크립트를
클론에 복사해 실행한다. npm·docker·curl·sleep은 PATH 스텁으로 대체해 호출만 기록한다.

⚠️ 안전장치: 복사본 안의 실 경로 리터럴(체크아웃·잠금·로그)을 임시 경로로 치환한 뒤,
남은 리터럴이 없는지 확인하고서야 실행한다. 그래서 환경변수 오버라이드를 모르는
옛 스크립트를 돌려도(이빨 확인) 실제 체크아웃·잠금을 건드리지 않는다.

실행: backend/.venv/bin/python -m pytest scripts/test_deploy_guard.py -q
"""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
REAL_PROJECT = "/Users/calmonion/Project/PortfoliOn"
REAL_LOCK = "/tmp/portfolion-deploy.lock"
REAL_LOG = "/Users/calmonion/Library/Logs/com.portfolion.auto-deploy-poll.log"
REAL_MARKER = "/Users/calmonion/.portfolion-deployed-sha"
REAL_FAILED = "/Users/calmonion/.portfolion-deploy-failed-sha"
# 폴러가 PATH 뒤에 덧붙이는 실 도구 디렉터리(task#382). 복사본에서는 덫 디렉터리로 바꾼다 —
# PATH 를 앞에 붙이는 회귀가 생겨도 실 npm·docker 대신 덫이 불려 기록만 남고 exit 1 한다.
REAL_TOOL_DIRS = ("/Users/calmonion/.local/share/fnm/aliases/default/bin", "/usr/local/bin")

STUB = """#!/bin/bash
echo "$(basename "$0") $*" >> "$STUB_CALLS"
if [ "$(basename "$0")" = "npm" ] && [ -n "$STUB_NPM_COMMIT" ] && [ "$1" = "run" ]; then
  git commit -q --allow-empty -m "mid-build commit"
fi
if [ "$(basename "$0")" = "npm" ] && [ -n "$STUB_NPM_RC" ]; then exit "$STUB_NPM_RC"; fi
if [ "$(basename "$0")" = "curl" ]; then echo ok; fi
exit 0
"""

TRAP = """#!/bin/bash
echo "TRAP $(basename "$0") $*" >> "$STUB_CALLS"
exit 1
"""

# 폴러가 부르는 deploy.sh 를 대신하는 스텁 — 잠금 존재 여부와 종료코드만 다룬다.
DEPLOY_STUB = """#!/bin/bash
echo "deploy-stub lock=$([ -e "$DEPLOY_LOCK" ] && echo yes || echo no)" >> "$STUB_CALLS"
exit {rc}
"""


GIT_ENV = {
    "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
}


def _git(cwd, *args, check=True):
    return subprocess.run(["git", *args], cwd=cwd, check=check,
                          capture_output=True, text=True,
                          env={**os.environ, **GIT_ENV})


def _commit(cwd, path, content, msg):
    p = Path(cwd) / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    _git(cwd, "add", path)
    _git(cwd, "commit", "-q", "-m", msg)


class Env:
    def __init__(self, tmp):
        self.tmp = tmp
        self.origin = tmp / "origin.git"
        self.work = tmp / "work"
        self.other = tmp / "other"
        self.lock = tmp / "deploy.lock"
        self.log = tmp / "poll.log"
        self.calls = tmp / "calls.txt"
        self.marker = tmp / "deployed-sha"
        self.failed = tmp / "deploy-failed-sha"
        stubs = tmp / "stubs"
        stubs.mkdir()
        for name in ("npm", "docker", "curl", "sleep"):
            s = stubs / name
            s.write_text(STUB)
            s.chmod(0o755)
        trap = tmp / "trap"
        trap.mkdir()
        for name in ("npm", "docker"):
            s = trap / name
            s.write_text(TRAP)
            s.chmod(0o755)
        home = tmp / "home"
        home.mkdir()
        self.env = {
            "PATH": f"{stubs}:{os.environ['PATH']}",
            "HOME": str(home),
            **GIT_ENV,
            "STUB_CALLS": str(self.calls),
            "PROJECT_DIR": str(self.work),
            "LOG": str(self.log),
            "DEPLOY_LOCK": str(self.lock),
            "DEPLOY_MARKER": str(self.marker),
            "DEPLOY_FAILED_MARKER": str(self.failed),
        }

        _git(tmp, "init", "-q", "--bare", "-b", "main", str(self.origin))
        _git(tmp, "clone", "-q", str(self.origin), str(self.work))
        _git(self.work, "symbolic-ref", "HEAD", "refs/heads/main")
        for rel in ("deploy.sh", "scripts/auto-deploy-poll.sh"):
            text = (REPO / rel).read_text()
            text = (text.replace(REAL_PROJECT, str(self.work))
                        .replace(REAL_LOCK, str(self.lock))
                        .replace(REAL_LOG, str(self.log))
                        .replace(REAL_MARKER, str(self.marker))
                        .replace(REAL_FAILED, str(self.failed)))
            for d in REAL_TOOL_DIRS:
                text = text.replace(d, str(trap))
            for lit in (REAL_PROJECT, REAL_LOCK, REAL_LOG, REAL_MARKER, REAL_FAILED,
                        *REAL_TOOL_DIRS):
                assert lit not in text, f"실 경로 리터럴 잔존: {lit}"
            dst = self.work / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(text)
            dst.chmod(0o755)
        for rel, body in (("frontend/app.js", "v1\n"), ("backend/main.py", "v1\n"),
                          ("nginx/nginx.conf", "v1\n"), (".forge/notes.md", "v1\n"),
                          ("README.md", "v1\n")):
            p = self.work / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(body)
        _git(self.work, "add", "-A")
        _git(self.work, "commit", "-q", "-m", "base")
        _git(self.work, "push", "-q", "origin", "main")
        _git(tmp, "clone", "-q", str(self.origin), str(self.other))

    def head(self):
        return _git(self.work, "rev-parse", "HEAD").stdout.strip()

    def origin_head(self):
        return _git(self.origin, "rev-parse", "main").stdout.strip()

    def push_from_other(self, msg="remote change"):
        _commit(self.other, "README.md", msg + "\n", msg)
        _git(self.other, "push", "-q", "origin", "main")

    def local_commit(self, msg="local change"):
        _commit(self.work, "backend/main.py", msg + "\n", msg)

    def docker_called(self):
        return self.calls.exists() and "docker " in self.calls.read_text()

    def call_log(self):
        return self.calls.read_text() if self.calls.exists() else ""

    def poll_log(self):
        return self.log.read_text() if self.log.exists() else ""

    def read(self, path):
        return path.read_text().strip() if path.exists() else None

    def stub_deploy(self, rc):
        """작업트리의 deploy.sh 를 스텁으로 덮는다(커밋하지 않음 — README 만 바뀌는 ff 는 통과)."""
        p = self.work / "deploy.sh"
        p.write_text(DEPLOY_STUB.format(rc=rc))
        p.chmod(0o755)

    def deploy_stub_calls(self):
        return self.call_log().count("deploy-stub")

    def run(self, script, **extra):
        env = {**self.env, **extra}
        return subprocess.run(["bash", script], cwd=self.work, env=env,
                              capture_output=True, text=True, timeout=60)

    def deploy(self, **extra):
        return self.run("deploy.sh", **extra)

    def poll(self):
        return self.run("scripts/auto-deploy-poll.sh")


@pytest.fixture
def e(tmp_path):
    return Env(tmp_path)


def _out(r):
    return r.stdout + r.stderr


# ── deploy.sh ──────────────────────────────────────────────────────────

def test_deploy_equal_proceeds_and_prints_sha(e):
    r = e.deploy()
    assert r.returncode == 0, _out(r)
    assert e.docker_called()
    short = _git(e.work, "rev-parse", "--short", "HEAD").stdout.strip()
    assert f"배포된 커밋: {short}" in _out(r)


def test_deploy_behind_fast_forwards_then_proceeds(e):
    e.push_from_other()
    r = e.deploy()
    assert r.returncode == 0, _out(r)
    assert e.head() == e.origin_head()
    assert e.docker_called()


def test_deploy_ahead_refuses(e):
    e.local_commit()
    before = e.head()
    r = e.deploy()
    assert r.returncode != 0, _out(r)
    assert not e.docker_called()
    assert e.head() == before


def test_deploy_diverged_refuses(e):
    e.push_from_other()
    e.local_commit()
    r = e.deploy()
    assert r.returncode != 0, _out(r)
    assert not e.docker_called()


def test_deploy_uncommitted_frontend_refuses(e):
    (e.work / "frontend/app.js").write_text("dirty\n")
    r = e.deploy()
    assert r.returncode != 0, _out(r)
    assert not e.docker_called()
    assert "frontend/app.js" in _out(r)


def test_deploy_uncommitted_forge_allowed(e):
    (e.work / ".forge/notes.md").write_text("dirty\n")
    r = e.deploy()
    assert r.returncode == 0, _out(r)
    assert e.docker_called()


def test_deploy_fetch_failure_refuses(e):
    _git(e.work, "remote", "set-url", "origin", str(e.tmp / "missing.git"))
    r = e.deploy()
    assert r.returncode != 0, _out(r)
    assert not e.docker_called()


def test_deploy_head_change_during_build_fails_loud(e):
    r = e.deploy(STUB_NPM_COMMIT="1")
    assert r.returncode != 0, _out(r)
    assert "배포된 커밋:" not in _out(r)


# ── auto-deploy-poll.sh ────────────────────────────────────────────────

def test_poller_ahead_keeps_local_commit(e):
    """task#372 재현 — 로컬이 앞섰을 때 push 전 origin으로 되돌리면 안 된다."""
    e.local_commit()
    before = e.head()
    e.poll()
    assert e.head() == before
    assert not e.docker_called()


def test_poller_behind_fast_forwards(e):
    e.push_from_other()
    e.poll()
    assert e.head() == e.origin_head()


def test_poller_behind_preserves_uncommitted_edit(e):
    e.push_from_other()
    (e.work / "frontend/app.js").write_text("wip\n")
    e.poll()
    assert e.head() == e.origin_head()
    assert (e.work / "frontend/app.js").read_text() == "wip\n"


def test_poller_diverged_keeps_head(e):
    e.push_from_other()
    e.local_commit()
    before = e.head()
    e.poll()
    assert e.head() == before
    assert not e.docker_called()


# ── task#382: 배포 기록 · 사전 거부 exit 2 · 폴러 실배포 ─────────────────────
# 기록 파일(DEPLOY_MARKER)은 deploy.sh 가 성공 끝에 쓰고, 폴러는 origin/main 과 그것을
# 대조해 배포한다. 사전 거부(컨테이너를 건드리기 전 종료)는 exit 2 → 폴러가 재시도,
# 그 밖의 비0 은 실패 → 폴러가 실패 기록에 그 SHA 를 쓰고 같은 커밋을 다시 시도하지 않는다.

def test_deploy_success_writes_marker(e):
    r = e.deploy()
    assert r.returncode == 0, _out(r)
    assert e.read(e.marker) == e.head()


def _ahead(e):
    e.local_commit()


def _diverged(e):
    e.push_from_other()
    e.local_commit()


def _uncommitted(e):
    (e.work / "frontend/app.js").write_text("dirty\n")


def _fetch_fail(e):
    _git(e.work, "remote", "set-url", "origin", str(e.tmp / "missing.git"))


def _locked(e):
    e.lock.write_text("")


@pytest.mark.parametrize("setup", [_ahead, _diverged, _uncommitted, _fetch_fail, _locked],
                         ids=["ahead", "diverged", "uncommitted", "fetch-fail", "locked"])
def test_deploy_precheck_refusal_is_exit2_and_keeps_marker(e, setup):
    e.marker.write_text("previous\n")
    setup(e)
    r = e.deploy()
    assert r.returncode == 2, _out(r)
    assert not e.docker_called()
    assert e.read(e.marker) == "previous"


def test_deploy_refusal_on_lock_leaves_foreign_lock(e):
    """잠금을 남이 잡았으면 거부하되, 그 잠금을 지우지 않는다."""
    e.lock.write_text("")
    e.deploy()
    assert e.lock.exists()


def test_deploy_build_failure_is_exit1_even_if_tool_exits_2(e):
    """사전 점검 이후의 실패는 도구의 종료코드와 무관하게 1 — 2 는 사전 거부 전용이다."""
    e.marker.write_text("previous\n")
    r = e.deploy(STUB_NPM_RC="2")
    assert r.returncode == 1, _out(r)
    assert e.read(e.marker) == "previous"


def test_deploy_head_change_is_exit1_and_no_marker(e):
    r = e.deploy(STUB_NPM_COMMIT="1")
    assert r.returncode == 1, _out(r)
    assert e.read(e.marker) is None


def test_poller_equal_unrecorded_deploys(e):
    """ⓐ 이 체크아웃에서 commit+push 한 경우 — HEAD == origin 이지만 배포 기록이 다르다."""
    e.marker.write_text("stale\n")
    e.poll()
    sha = e.origin_head()
    assert e.docker_called(), e.poll_log()
    assert f"Deploy complete: {sha}" in e.poll_log()
    assert e.read(e.marker) == sha


def test_poller_equal_recorded_skips(e):
    """ⓑ 이미 배포된 커밋은 다시 배포하지 않는다."""
    e.marker.write_text(e.origin_head() + "\n")
    e.poll()
    assert not e.docker_called()
    assert "Deploy" not in e.poll_log()


def test_poller_behind_deploys_and_records(e):
    """ⓒ 다른 곳에서 push → ff 후 배포."""
    old = e.head()
    e.marker.write_text(old + "\n")
    e.push_from_other()
    new = e.origin_head()
    e.poll()
    log = e.poll_log()
    assert e.head() == new
    assert f"New commit detected: {old} -> {new}" in log
    assert f"Deploy complete: {new}" in log
    assert log.index("New commit detected") < log.index("Deploy complete:")
    assert e.read(e.marker) == new


def test_poller_refused_exit2_retries_next_poll(e):
    """ⓔ 사전 거부는 실패가 아니다 — 실패 기록 없이 다음 폴에서 재시도."""
    e.stub_deploy(2)
    e.poll()
    assert e.deploy_stub_calls() == 1, e.poll_log()
    assert "Deploy refused (exit 2)" in e.poll_log()
    assert e.read(e.failed) is None
    e.poll()
    assert e.deploy_stub_calls() == 2


def test_poller_failure_records_and_stops_retrying(e):
    """ⓕ 빌드·기동 실패는 1회로 끝 — 같은 커밋을 2분마다 재기동하지 않는다."""
    e.stub_deploy(1)
    e.poll()
    sha = e.origin_head()
    assert e.deploy_stub_calls() == 1, e.poll_log()
    assert f"Deploy FAILED (exit 1) — {sha}" in e.poll_log()
    assert e.read(e.failed) == sha
    e.poll()
    assert e.deploy_stub_calls() == 1


def test_poller_failure_retries_on_new_origin_commit(e):
    """ⓕ 실패 기록은 새 push 가 오면 풀린다."""
    e.stub_deploy(1)
    e.poll()
    e.push_from_other()
    e.poll()
    assert e.deploy_stub_calls() == 2, e.poll_log()


def test_poller_does_not_take_lock(e):
    """ⓖ 잠금은 deploy.sh 만 잡는다 — 폴러가 잡으면 deploy.sh 가 자기 잠금을 보고 끝난다(B84)."""
    e.stub_deploy(0)
    e.poll()
    assert "deploy-stub lock=no" in e.call_log(), e.call_log() + e.poll_log()


def test_poller_lock_present_skips_and_keeps_lock(e):
    e.lock.write_text("")
    e.poll()
    assert not e.docker_called()
    assert e.lock.exists()


def test_poller_appends_path_so_stubs_win(e):
    """ⓗ 폴러가 세우는 PATH 는 뒤에 덧붙인다 — 앞에 붙이면 실 npm·docker(여기선 덫)가 먼저 잡힌다."""
    e.poll()
    calls = e.call_log()
    assert "TRAP" not in calls, calls
    assert "npm run" in calls, calls + e.poll_log()
    assert e.docker_called()
