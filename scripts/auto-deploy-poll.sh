#!/bin/bash
# Poller: runs every 2 minutes via launchd. It is the automatic deploy path while the
# self-hosted runner is offline (task#382, B84).
#
# Trigger = the deploy record, not "HEAD is behind": deploy.sh writes the SHA it deployed
# to $DEPLOY_MARKER, and this poller deploys whenever origin/main differs from it —
#   HEAD == origin  → deploy        (a commit+push made in this checkout)
#   HEAD behind     → ff, then deploy
#   ahead/diverged  → leave it alone (never rewinds local commits, task#377)
# The runner and a manual `bash deploy.sh` write the same record, so nothing deploys twice.
#
# Failure policy (deploy.sh exit codes):
#   2   = refused before touching containers (lock, dirty tree, fetch…) → retry next poll
#   else = failed → record the SHA in $DEPLOY_FAILED_MARKER and do not retry that commit
#          (re-running a broken build every 2 minutes takes the backend down for ~5 min each).
#          A new push, or a successful manual deploy.sh, clears it.
#
# The lock belongs to deploy.sh alone. Taking it here made deploy.sh see its own
# lock and quit — the reason this poller never deployed (B84).

# Whole body in one group so bash parses it before running — guards against an
# in-place edit of this file mid-run. (git ff below writes a new inode, so it is
# already safe on its own — task#377 retro.)
{
set -e

# launchd's default PATH has neither npm (fnm) nor docker. APPEND, never prepend:
# scripts/test_deploy_guard.py puts stub npm/docker at the front of PATH, and a
# prepended real docker would stop/rm the production containers during the tests.
export PATH="$PATH:/Users/calmonion/.local/share/fnm/aliases/default/bin:/usr/local/bin"

PROJECT_DIR="${PROJECT_DIR:-/Users/calmonion/Project/PortfoliOn}"
LOG="${LOG:-/Users/calmonion/Library/Logs/com.portfolion.auto-deploy-poll.log}"
LOCK="${DEPLOY_LOCK:-/tmp/portfolion-deploy.lock}"
MARKER="${DEPLOY_MARKER:-/Users/calmonion/.portfolion-deployed-sha}"
FAILED="${DEPLOY_FAILED_MARKER:-/Users/calmonion/.portfolion-deploy-failed-sha}"
export DEPLOY_MARKER="$MARKER"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# Skip if deploy already running (Actions runner or a manual deploy.sh)
if [ -f "$LOCK" ]; then
  log "Deploy in progress (lock exists), skipping."
  exit 0
fi

cd "$PROJECT_DIR"

# Fetch silently; bail on network error
git fetch origin main --quiet 2>/dev/null || { log "git fetch failed, skipping."; exit 0; }

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
DEPLOYED=$(cat "$MARKER" 2>/dev/null || true)

if [ "$LOCAL" != "$REMOTE" ]; then
  if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
    if git merge-base --is-ancestor "$REMOTE" "$LOCAL"; then
      exit 0  # local is ahead (unpushed commits) — leave it alone
    fi
    log "Local and origin/main diverged ($LOCAL vs $REMOTE), skipping."
    exit 0
  fi
  log "New commit detected: $LOCAL -> $REMOTE."
  if ! git merge --ff-only --quiet origin/main >> "$LOG" 2>&1; then
    log "Fast-forward failed (overlapping local edits?), skipping."
    exit 0
  fi
fi

[ "$DEPLOYED" = "$REMOTE" ] && exit 0                            # already live
[ "$(cat "$FAILED" 2>/dev/null || true)" = "$REMOTE" ] && exit 0  # failed once, waiting for a new push

log "Deploying $REMOTE (last deployed: ${DEPLOYED:-none})..."
rc=0
bash deploy.sh >> "$LOG" 2>&1 || rc=$?

if [ "$rc" -eq 0 ]; then
  log "Deploy complete: $(cat "$MARKER" 2>/dev/null)"
elif [ "$rc" -eq 2 ]; then
  log "Deploy refused (exit 2) — retrying on the next poll."
else
  echo "$REMOTE" > "$FAILED"
  log "Deploy FAILED (exit $rc) — $REMOTE 재시도 안 함 (새 push 또는 수동 deploy.sh 성공 시 해제)"
fi
exit 0
}
