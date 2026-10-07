#!/bin/bash
# Poller: runs every 2 minutes via launchd. Catches the checkout up to origin/main
# only when it is BEHIND (fast-forward); never rewinds local commits (task#377).
# ⚠️ The deploy.sh call below has never succeeded — it collides with the lock this
#    script takes (B84). In practice the poller only syncs the working tree.

# Whole body in one group so bash parses it before running — guards against an
# in-place edit of this file mid-run. (git ff below writes a new inode, so it is
# already safe on its own — task#377 retro.)
{
set -e

PROJECT_DIR="${PROJECT_DIR:-/Users/calmonion/Project/PortfoliOn}"
LOG="${LOG:-/Users/calmonion/Library/Logs/com.portfolion.auto-deploy-poll.log}"
LOCK="${DEPLOY_LOCK:-/tmp/portfolion-deploy.lock}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# Skip if deploy already running (from Actions runner or previous poll)
if [ -f "$LOCK" ]; then
  log "Deploy in progress (lock exists), skipping."
  exit 0
fi

cd "$PROJECT_DIR"

# Fetch silently; bail on network error
git fetch origin main --quiet 2>/dev/null || { log "git fetch failed, skipping."; exit 0; }

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0  # already up to date, nothing to log
fi

if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  if git merge-base --is-ancestor "$REMOTE" "$LOCAL"; then
    exit 0  # local is ahead (unpushed commits) — leave it alone
  fi
  log "Local and origin/main diverged ($LOCAL vs $REMOTE), skipping."
  exit 0
fi

log "New commit detected: $LOCAL -> $REMOTE. Deploying..."
if ! git merge --ff-only --quiet origin/main >> "$LOG" 2>&1; then
  log "Fast-forward failed (overlapping local edits?), skipping."
  exit 0
fi

touch "$LOCK"
trap 'rm -f "$LOCK"' EXIT

bash deploy.sh >> "$LOG" 2>&1

log "Deploy complete."
exit 0
}
