#!/usr/bin/env bash
# task#386 컷오버 ② — prod 를 표준 배포(taebro-infra bin/deploy)로 옮긴다(ADR 261011-074335).
#   bash scripts/cutover/02-prod-cutover.sh                 실행(다운타임 ~8–12분 — 시장 휴장 시간에)
#   bash scripts/cutover/02-prod-cutover.sh --dry-run       사전 확인만(아무것도 바꾸지 않음)
#   bash scripts/cutover/02-prod-cutover.sh --remove-legacy 새 스택이 건강한 것을 확인한 뒤 *-legacy 컨테이너 삭제
#
# 무엇을 바꾸는가(실행):
#   1. 실행 자리 ~/runtime/portfolion/prod/ 생성, backend/.env.docker 를 그리로 .env(600)로 **이동**하고
#      backend/.env.docker 는 그것을 가리키는 심링크로 둔다(비밀 정본 = 실행 자리).
#   2. 라벨 없는 옛 컨테이너 portfolion-backend-1·portfolion-nginx-1 을 **정지 + 이름 변경(*-legacy)**으로 보관.
#      이름이 같아 그대로 두면 compose 기동이 이름 충돌로 실패한다. 여기서 다운타임이 시작된다.
#   3. gh workflow run deploy.yml --ref main → 러너가 bin/deploy portfolion prod → run 완료까지 대기.
#   4. 헬스 확인(127.0.0.1/health 에 portfolion). 000 이면 127.0.0.1:80 포워딩 stuck 회복(stop → 10초 → start) 1회.
#   실패하면 복구: 새 backend·nginx 만 제거 → legacy 이름 복원·기동 → stuck 회복. .env 이동·심링크는 그대로 둔다
#   (legacy 컨테이너는 생성 때 환경을 구워 두어 docker start 가 env 파일을 다시 읽지 않는다).
# 무엇을 안 바꾸는가: portfolion-postgres-1(재기동도 없음) · 루트 .env · 작업 폴더의 코드.
set -euo pipefail
trap 'ec=$?; echo "❌ 예기치 못한 종료: line $LINENO, exit $ec" >&2' ERR
cd "$(dirname "$0")/../.."
REPO=$(pwd)

MODE=run
case "${1:-}" in --dry-run) MODE=dry ;; --remove-legacy) MODE=cleanup ;; '') ;; *) echo "사용: $0 [--dry-run|--remove-legacy]" >&2; exit 64 ;; esac

RT="$HOME/runtime/portfolion/prod"
SECRET_SRC="$REPO/backend/.env.docker"
BE=portfolion-backend-1; NG=portfolion-nginx-1; PG=portfolion-postgres-1
BE_L=portfolion-backend-legacy; NG_L=portfolion-nginx-legacy

die() { echo "❌ $*" >&2; exit 1; }
label() { docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$1" 2>/dev/null || echo "(없음)"; }
exists() { docker inspect "$1" >/dev/null 2>&1; }
local_health() { curl -s -m 5 http://127.0.0.1/health 2>/dev/null || true; }

stuck_recover() { # 127.0.0.1:80 포워딩 stuck — 즉시 재시작은 회복 안 될 수 있다(deploy-ops task#381): stop → 리스너 소멸 → 10초 → start
  local c=$1
  echo "127.0.0.1:80 포워딩 stuck 회복: $c stop → 10초 → start"
  docker stop "$c" >/dev/null
  for _ in $(seq 1 10); do lsof -nP -iTCP:80 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done
  sleep 10
  docker start "$c" >/dev/null
}

wait_health() { # <초> — 로컬 /health 에 "portfolion" 이 나올 때까지
  local deadline=$((SECONDS + $1))
  while [ "$SECONDS" -lt "$deadline" ]; do
    case "$(local_health)" in *portfolion*) return 0 ;; esac
    sleep 3
  done
  return 1
}

# ── --remove-legacy ──
if [ "$MODE" = cleanup ]; then
  echo "== 컷오버 ② 정리: 새 스택이 건강하면 $BE_L·$NG_L 삭제"
  [ "$(label $BE)" = portfolion ] && [ "$(label $NG)" = portfolion ] || die "새 컨테이너가 compose(portfolion) 소유가 아니다 — 정리하지 않는다"
  case "$(local_health)" in *portfolion*) ;; *) die "로컬 /health 에 portfolion 이 없다 — 정리하지 않는다" ;; esac
  case "$(curl -s -m 10 https://portfolion.taebro.com/health || true)" in *portfolion*) ;; *) die "공개 /health 에 portfolion 이 없다 — 정리하지 않는다" ;; esac
  for c in $BE_L $NG_L; do exists "$c" && docker rm "$c" >/dev/null && echo "삭제: $c"; done
  n=$(docker ps -a --format '{{.Names}}' | grep -c legacy || true)
  [ "$n" = 0 ] || die "legacy 컨테이너가 아직 $n 개"
  echo "✅ legacy 정리 완료"
  exit 0
fi

echo "== 컷오버 ②: 실행 자리 생성·비밀 이동+심링크 → legacy 정지·개명 → gh workflow run deploy.yml → 헬스$( [ $MODE = dry ] && echo ' [dry-run]')"

# ── 사전 확인 ──
git fetch -q origin || die "git fetch 실패"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "HEAD ≠ origin/main — 전환 커밋을 push 한 상태에서 실행할 것"
git cat-file -e origin/main:deploy/taebro.env 2>/dev/null || die "origin/main 에 deploy/taebro.env 가 없다 — 전환 커밋이 아직 push 되지 않았다"
if git show origin/main:docker-compose.yml | grep -q '^  postgres:'; then die "origin/main 의 docker-compose.yml 에 postgres 서비스가 남아 있다 — 배포마다 prod DB 가 재생성된다"; fi
git cat-file -e origin/main:deploy.sh 2>/dev/null && die "origin/main 에 deploy.sh 가 남아 있다 — 은퇴 커밋이 아직이다"
if launchctl print "gui/$(id -u)/com.portfolion.auto-deploy-poll" >/dev/null 2>&1; then die "폴러가 아직 적재돼 있다 — 01-retire-launchd.sh 먼저"; fi
online=$(gh api repos/calmonion7/PortfoliOn/actions/runners --jq '[.runners[]|select(.status=="online")]|length')
[ "$online" -ge 1 ] || die "online 러너가 없다 — 배포 잡이 queued 로 멈춘다"
exists $PG || die "$PG 가 없다"
PG_STARTED=$(docker inspect -f '{{.State.StartedAt}}' $PG)
echo "postgres StartedAt = $PG_STARTED (끝에 대조)"
! exists $BE_L || die "$BE_L 이 이미 있다 — 앞선 컷오버의 잔재. 상태를 확인할 것"
! exists $NG_L || die "$NG_L 이 이미 있다 — 앞선 컷오버의 잔재. 상태를 확인할 것"
for c in $BE $NG; do
  exists "$c" || die "$c 가 없다"
  [ -z "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c")" ] || die "$c 가 이미 compose 소유다 — 컷오버가 끝난 상태로 보인다"
done
if [ -L "$SECRET_SRC" ]; then
  [ "$(readlink "$SECRET_SRC")" = "$RT/.env" ] || die "backend/.env.docker 가 엉뚱한 곳을 가리키는 심링크다: $(readlink "$SECRET_SRC")"
  [ -f "$RT/.env" ] || die "심링크 대상 $RT/.env 가 없다"
  echo "비밀: 이미 이동됨(심링크 → $RT/.env)"
else
  [ -f "$SECRET_SRC" ] || die "backend/.env.docker 가 없다"
  [ ! -e "$RT/.env" ] || die "$RT/.env 가 이미 있다 — 덮어쓰지 않는다. 어느 쪽이 정본인지 사람이 정할 것"
  grep -q '^DATABASE_URL=' "$SECRET_SRC" || die "backend/.env.docker 에 DATABASE_URL 이 없다"
  echo "비밀: backend/.env.docker(일반 파일) → $RT/.env 로 이동 예정"
fi
echo "현재 로컬 /health: $(local_health)"
[ $MODE = dry ] && { echo "dry-run — 아무것도 바꾸지 않았다"; exit 0; }

# ── 1. 실행 자리 + 비밀 정본 ──
mkdir -p "$RT"; chmod 700 "$HOME/runtime/portfolion" "$RT" 2>/dev/null || true
if [ ! -L "$SECRET_SRC" ]; then
  mv "$SECRET_SRC" "$RT/.env"
  chmod 600 "$RT/.env"
  ln -s "$RT/.env" "$SECRET_SRC"
fi
[ "$(readlink "$SECRET_SRC")" = "$RT/.env" ] && [ "$(stat -f %Lp "$RT/.env")" = 600 ] || die "심링크·권한 검증 실패"
echo "✓ 비밀 정본 $RT/.env (600), backend/.env.docker → 심링크"

# ── 2. legacy 정지·개명 (다운타임 시작) ──
recover() { # 새 스택 실패 → legacy 로 되돌린다
  echo "↩️  복구: 새 backend·nginx 제거 → legacy 복원" >&2
  for c in $NG $BE; do
    if exists "$c" && [ "$(label "$c")" = portfolion ]; then docker rm -f "$c" >/dev/null && echo "  제거: $c" >&2; fi
  done
  exists $BE_L && docker rename $BE_L $BE && docker start $BE >/dev/null
  exists $NG_L && docker rename $NG_L $NG && docker start $NG >/dev/null
  if ! wait_health 30; then stuck_recover $NG; fi
  echo "  복구 뒤 로컬 /health: $(local_health)" >&2
}
docker stop $NG $BE >/dev/null
docker rename $BE $BE_L
docker rename $NG $NG_L
echo "✓ legacy 정지·개명: $BE_L · $NG_L (다운타임 시작 $(date '+%H:%M:%S'))"

# ── 3. 표준 배포 ──
before=$(gh run list --workflow deploy.yml --event workflow_dispatch -L1 --json databaseId --jq '.[0].databaseId // 0')
if ! gh workflow run deploy.yml --ref main; then recover; die "gh workflow run 실패"; fi
id="$before"
for _ in $(seq 1 30); do
  id=$(gh run list --workflow deploy.yml --event workflow_dispatch -L1 --json databaseId --jq '.[0].databaseId // 0')
  [ "$id" != "$before" ] && break
  sleep 2
done
[ "$id" != "$before" ] || { recover; die "새 Deploy run 을 찾지 못했다"; }
echo "Deploy run $id — 완료까지 대기 (빌드 + 헬스 최대 600초)"
if ! gh run watch "$id" --exit-status >/dev/null; then
  gh run view "$id" --log-failed 2>/dev/null | tail -30 >&2 || true
  recover; die "Deploy run $id 실패 — legacy 로 복구했다"
fi
gh run view "$id" --log 2>/dev/null | grep -E '완료 — portfolion 세대|거부:|실패:' | tail -3 || true

# ── 4. 헬스 (Deploy run 은 bin/deploy 헬스를 통과했다 — 여기선 호스트 포워딩까지 본다) ──
if ! wait_health 30; then
  stuck_recover $NG
  wait_health 60 || { recover; die "새 스택 로컬 /health 실패(포워딩 회복 뒤에도) — legacy 로 복구했다"; }
fi
echo "✓ 로컬 /health: $(local_health) (다운타임 끝 $(date '+%H:%M:%S'))"
echo "  공개 /health: $(curl -s -m 10 https://portfolion.taebro.com/health || echo '(실패)')"
[ "$(docker inspect -f '{{.State.StartedAt}}' $PG)" = "$PG_STARTED" ] || echo "⚠️ postgres StartedAt 이 바뀌었다 — 확인 필요"
cat "$RT/.taebro-deploy" 2>/dev/null | grep '^generation=' || echo "⚠️ 세대 기록 없음"
echo "✅ 컷오버 ② 완료. 확인 뒤: bash scripts/cutover/02-prod-cutover.sh --remove-legacy"
