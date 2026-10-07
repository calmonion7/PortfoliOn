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

STUB = """#!/bin/bash
echo "$(basename "$0") $*" >> "$STUB_CALLS"
if [ "$(basename "$0")" = "npm" ] && [ -n "$STUB_NPM_COMMIT" ] && [ "$1" = "run" ]; then
  git commit -q --allow-empty -m "mid-build commit"
fi
if [ "$(basename "$0")" = "curl" ]; then echo ok; fi
exit 0
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
        stubs = tmp / "stubs"
        stubs.mkdir()
        for name in ("npm", "docker", "curl", "sleep"):
            s = stubs / name
            s.write_text(STUB)
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
        }

        _git(tmp, "init", "-q", "--bare", "-b", "main", str(self.origin))
        _git(tmp, "clone", "-q", str(self.origin), str(self.work))
        _git(self.work, "symbolic-ref", "HEAD", "refs/heads/main")
        for rel in ("deploy.sh", "scripts/auto-deploy-poll.sh"):
            text = (REPO / rel).read_text()
            text = (text.replace(REAL_PROJECT, str(self.work))
                        .replace(REAL_LOCK, str(self.lock))
                        .replace(REAL_LOG, str(self.log)))
            for lit in (REAL_PROJECT, REAL_LOCK, REAL_LOG):
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
