#!/bin/bash
# Fallback poller: deploys when GitHub Actions runner misses a push event.
# Runs every 2 minutes via launchd. Skips if deploy.sh is already running.

set -e

PROJECT_DIR="/Users/calmonion/Project/PortfoliOn"
LOG="/Users/calmonion/Library/Logs/com.portfolion.auto-deploy-poll.log"
LOCK="/tmp/portfolion-deploy.lock"

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

log "New commit detected: $LOCAL -> $REMOTE. Deploying..."
touch "$LOCK"
trap 'rm -f "$LOCK"' EXIT

git reset --hard origin/main >> "$LOG" 2>&1
bash deploy.sh >> "$LOG" 2>&1

log "Deploy complete."
