#!/bin/bash
set -e
cd "$(dirname "$0")"

BACKEND_CONTAINER=docker-infra-migration-backend-1
NGINX_CONTAINER=docker-infra-migration-nginx-1
NETWORK=docker-infra-migration_default
BACKEND_IMAGE=docker-infra-migration-backend
PROJECT_DIR="$(pwd)"

echo "=== PortfoliOn Deploy ==="

# Docker 키체인 우회 (CI 환경에서 macOS keychain 접근 불가 시)
TMP_DOCKER_CONFIG=$(mktemp -d)
echo '{"auths":{}}' > "$TMP_DOCKER_CONFIG/config.json"
export DOCKER_CONFIG="$TMP_DOCKER_CONFIG"

# 1. 프론트엔드 빌드
echo "[1/4] Building frontend..."
npm run build --prefix frontend --silent
echo "      Done: frontend/dist/"

# 2. 백엔드 이미지 빌드
echo "[2/4] Building backend image..."
docker build -t $BACKEND_IMAGE ./backend --quiet
echo "      Done: $BACKEND_IMAGE"

# 3. 백엔드 컨테이너 교체 (env 유지)
echo "[3/4] Restarting backend..."
ENV_FLAGS=$(docker inspect $BACKEND_CONTAINER --format '{{range .Config.Env}}--env "{{.}}" {{end}}' 2>/dev/null)
docker stop $BACKEND_CONTAINER 2>/dev/null || true
docker rm   $BACKEND_CONTAINER 2>/dev/null || true
eval docker run -d \
  --name $BACKEND_CONTAINER \
  --network $NETWORK \
  --network-alias backend \
  --restart unless-stopped \
  $ENV_FLAGS \
  $BACKEND_IMAGE > /dev/null
echo "      Done"

# 4. nginx 컨테이너 교체 (메인 프로젝트 경로로 마운트)
echo "[4/4] Restarting nginx..."
docker stop $NGINX_CONTAINER 2>/dev/null || true
docker rm   $NGINX_CONTAINER 2>/dev/null || true
docker run -d \
  --name $NGINX_CONTAINER \
  --network $NETWORK \
  -p 80:80 -p 443:443 \
  -v "$PROJECT_DIR/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PROJECT_DIR/frontend/dist:/usr/share/nginx/html:ro" \
  --restart unless-stopped \
  nginx:alpine > /dev/null
echo "      Done"

echo ""
echo "=== Deploy complete ==="
sleep 2
curl -s http://localhost/health && echo " <- /health OK" || echo "WARNING: health check failed"
