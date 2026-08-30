#!/bin/bash
# PortfoliOn 스택 자동 기동 — launchd `com.portfolion.docker-compose` 가 부팅 시 1회 실행한다.
#
# ⚠️ 왜 `docker compose up -d` 를 통째로 돌리지 않는가
#   이 스택은 관리 주체가 둘로 나뉜다(실측):
#     compose 소유    : postgres · certbot   (com.docker.compose.service 라벨 있음)
#     deploy.sh 소유  : backend · nginx      (`docker run`, compose 라벨 없음)
#   그런데 deploy.sh 가 쓰는 컨테이너 이름이 compose 의 것과 **같다**
#   (portfolion-backend-1 / portfolion-nginx-1). 그래서 compose 를 통째로 올리면
#   deploy.sh 가 만든 그 둘을 compose 정의로 재생성해 버린다(볼륨 마운트·포트가 갈린다).
#   → compose 는 자기 소유 2개만 올리고, backend·nginx 는 deploy.sh 에 맡긴다.
#
# ⚠️ PATH 를 여기서 직접 세우는 이유
#   launchd 기본 PATH 는 /usr/bin:/bin:/usr/sbin:/sbin 뿐이라 /usr/local/bin/docker 를 못 찾는다.
#   plist 의 EnvironmentVariables 에도 같은 값을 넣지만, 스크립트가 스스로 세워 두면
#   plist 가 그것 없이 재작성돼도 동작한다. node/npm 은 deploy.sh 의 프론트 빌드가 쓴다 —
#   fnm 의 **세션별 multishell 경로가 아니라** 안정적인 default alias 경로를 쓸 것.
export PATH="/Users/calmonion/.local/share/fnm/aliases/default/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

set -u
PROJECT_DIR=/Users/calmonion/Project/PortfoliOn
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Docker 데몬 대기 — **무한 대기 금지**. 옛 판은 `until docker info; do sleep 2; done` 이라
# 데몬이 영영 안 뜨면 잡이 영원히 running 으로 남아 「죽었는데 아무도 모르는」 상태가 된다.
log "docker 데몬 대기 (최대 5분)"
for _ in $(seq 1 150); do
    docker info >/dev/null 2>&1 && break
    sleep 2
done
if ! docker info >/dev/null 2>&1; then
    log "FATAL: docker 데몬이 5분 안에 준비되지 않았다 — 기동 포기"
    exit 1
fi
log "docker 준비됨"

cd "$PROJECT_DIR" || { log "FATAL: cd 실패 — $PROJECT_DIR"; exit 1; }

log "compose 소유 서비스 기동 (postgres certbot)"
if ! docker compose up -d postgres certbot; then
    log "FATAL: docker compose up 실패"
    exit 1
fi

log "deploy.sh 로 backend·nginx 기동"
if ! bash deploy.sh; then
    log "FATAL: deploy.sh 실패"
    exit 1
fi

log "기동 완료"
