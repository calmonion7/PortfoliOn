#!/bin/bash
# Self-hosted runner job (.github/workflows/deploy.yml) — task#384.
#
# The runner and the poller (scripts/auto-deploy-poll.sh) both deploy on push, so the runner
# must read the same deploy record the poller does, or the same commit deploys twice:
#   record == origin/main → "이미 배포됨", exit 0 (deploy.sh is not called)
#   record != origin/main → bash deploy.sh, and return its exit code unchanged (0/1/2)
# If a deploy is running (lock), wait for it, then compare the record AGAIN — the poller may
# have deployed this very commit meanwhile. No `git reset --hard`: deploy.sh fetches and
# fast-forwards itself, and refuses (exit 2) when local is ahead/diverged/dirty.

# Whole body in one group so bash parses it before running (in-place edits are safe).
{
set -e

# launchd's PATH has neither npm (fnm) nor docker. APPEND, never prepend — same rule as the
# poller: scripts/test_deploy_guard.py puts stubs at the front of PATH.
export PATH="$PATH:/Users/calmonion/.local/share/fnm/aliases/default/bin:/usr/local/bin"

PROJECT_DIR="${PROJECT_DIR:-/Users/calmonion/Project/PortfoliOn}"
LOCK="${DEPLOY_LOCK:-/tmp/portfolion-deploy.lock}"
MARKER="${DEPLOY_MARKER:-/Users/calmonion/.portfolion-deployed-sha}"
WAIT_MAX="${RUNNER_LOCK_WAIT_SEC:-900}"
export DEPLOY_MARKER="$MARKER"

cd "$PROJECT_DIR"

recorded() {
  git fetch -q origin main || { echo "❌ git fetch 실패 — origin/main 을 확인할 수 없다."; exit 2; }
  REMOTE=$(git rev-parse origin/main)
  [ "$(cat "$MARKER" 2>/dev/null || true)" = "$REMOTE" ]
}

if recorded; then echo "이미 배포됨: $REMOTE"; exit 0; fi

waited=0
while [ -f "$LOCK" ]; do
  if [ "$waited" -ge "$WAIT_MAX" ]; then
    echo "❌ 배포 잠금이 ${WAIT_MAX}초 넘게 풀리지 않는다 ($LOCK) — 중단한다."
    exit 1
  fi
  [ "$waited" -eq 0 ] && echo "다른 배포가 진행 중 — 잠금이 풀릴 때까지 기다린다."
  sleep 5
  waited=$((waited + 5))
done

if recorded; then echo "이미 배포됨: $REMOTE"; exit 0; fi

echo "배포 기록($(cat "$MARKER" 2>/dev/null || echo none)) ≠ origin/main($REMOTE) — deploy.sh 실행"
rc=0
bash deploy.sh || rc=$?
exit "$rc"
}
