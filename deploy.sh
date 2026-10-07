#!/bin/bash
# 본문 전체를 한 그룹으로 묶는다 — 아래 fast-forward 가 실행 중인 이 파일을 바꿀 수 있어서,
# bash 가 끝까지 미리 읽어 두게 한다(task#377).
{
set -e
cd "$(dirname "$0")"

# Prevent concurrent deploys (poller + Actions runner)
LOCK="${DEPLOY_LOCK:-/tmp/portfolion-deploy.lock}"
if [ -f "$LOCK" ]; then echo "Deploy already in progress."; exit 1; fi
touch "$LOCK"; trap 'rm -f "$LOCK"' EXIT

# 옛 트리 배포 방지 (task#377) — origin/main 과 같은 커밋만 배포한다.
DIRTY=$(git status --porcelain --untracked-files=no -- frontend backend nginx deploy.sh)
if [ -n "$DIRTY" ]; then
  echo "❌ 커밋 안 한 변경이 있다 — 커밋·push 한 뒤 다시 배포할 것:"
  echo "$DIRTY"
  exit 1
fi
if ! git fetch -q origin main; then
  echo "❌ git fetch 실패 — origin/main 을 확인할 수 없어 중단한다."
  exit 1
fi
HEAD_SHA=$(git rev-parse HEAD)
ORIGIN_SHA=$(git rev-parse origin/main)
if [ "$HEAD_SHA" != "$ORIGIN_SHA" ]; then
  if git merge-base --is-ancestor "$HEAD_SHA" "$ORIGIN_SHA"; then
    echo "HEAD 가 origin/main 보다 뒤처져 있다 — fast-forward 한다."
    git merge --ff-only -q origin/main || { echo "❌ fast-forward 실패"; exit 1; }
  else
    echo "❌ HEAD($(git rev-parse --short HEAD)) 가 origin/main 보다 앞서거나 갈라졌다 — push 먼저."
    exit 1
  fi
fi
START_SHA=$(git rev-parse HEAD)

BACKEND_CONTAINER=portfolion-backend-1
NGINX_CONTAINER=portfolion-nginx-1
NETWORK=portfolion_default
BACKEND_IMAGE=portfolion-backend
PROJECT_DIR="$(pwd)"

echo "=== PortfoliOn Deploy ==="

# Docker 키체인 우회 (CI 환경에서 macOS keychain 접근 불가 시)
TMP_DOCKER_CONFIG=$(mktemp -d)
echo '{"auths":{}}' > "$TMP_DOCKER_CONFIG/config.json"
export DOCKER_CONFIG="$TMP_DOCKER_CONFIG"

# 1. 프론트엔드 빌드
echo "[1/4] Building frontend..."
(cd frontend && npm install --silent && npm run build --silent)
echo "      Done: frontend/dist/"

# 2. 백엔드 이미지 빌드
echo "[2/4] Building backend image..."
docker build -t $BACKEND_IMAGE ./backend --quiet
echo "      Done: $BACKEND_IMAGE"

# 3. 백엔드 컨테이너 교체 (.env.docker에서 env 로드)
echo "[3/4] Restarting backend..."
docker stop $BACKEND_CONTAINER 2>/dev/null || true
docker rm   $BACKEND_CONTAINER 2>/dev/null || true
docker run -d \
  --name $BACKEND_CONTAINER \
  --network $NETWORK \
  --network-alias backend \
  --restart unless-stopped \
  --env-file ./backend/.env.docker \
  $BACKEND_IMAGE > /dev/null
echo "      Done"

# 4. nginx 컨테이너 교체 (메인 프로젝트 경로로 마운트)
echo "[4/4] Restarting nginx..."
docker stop $NGINX_CONTAINER 2>/dev/null || true
docker rm   $NGINX_CONTAINER 2>/dev/null || true
# 게시는 루프백 전용 — 공개 경로는 Cloudflare 터널뿐이다.
# 근거·트레이드오프는 docker-compose.yml 의 nginx 주석 참조(B82).
# ⚠️ 이 주석을 docker run 의 연속행(\) 안으로 옮기지 말 것 — 그러면 # 가 나머지 인자를
#    통째로 삼켜 nginx 가 포트·볼륨 없이 뜬다(구문 검사 bash -n 는 통과한다).
docker run -d \
  --name $NGINX_CONTAINER \
  --network $NETWORK \
  -p 127.0.0.1:80:80 \
  -v "$PROJECT_DIR/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PROJECT_DIR/frontend/dist:/usr/share/nginx/html:ro" \
  --restart unless-stopped \
  nginx:alpine > /dev/null
echo "      Done"

echo ""
echo "=== Deploy complete ==="
sleep 2
curl -s http://localhost/health && echo " <- /health OK" || echo "WARNING: health check failed"

# 끝 대조 — 빌드 도중 HEAD 가 바뀌었으면 무엇을 배포했는지 말할 수 없다.
END_SHA=$(git rev-parse HEAD)
if [ "$END_SHA" != "$START_SHA" ]; then
  echo "❌ 배포 도중 HEAD 가 바뀌었다 ($(git rev-parse --short "$START_SHA") -> $(git rev-parse --short "$END_SHA")) — push 후 다시 배포할 것."
  exit 1
fi
echo "배포된 커밋: $(git log -1 --format='%h %s' "$START_SHA")"
exit 0
}
