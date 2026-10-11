#!/usr/bin/env bash
# task#386 컷오버 ① — 옛 배포 경로의 launchd 잡을 은퇴시킨다(ADR 261011-074335).
#   bash scripts/cutover/01-retire-launchd.sh            실행
#   bash scripts/cutover/01-retire-launchd.sh --dry-run  사전 확인만(아무것도 바꾸지 않음)
#
# 무엇을 바꾸는가:
#   - launchd 잡 2개 bootout: com.portfolion.auto-deploy-poll(2분 폴러) · com.portfolion.docker-compose(부팅 잡)
#   - ~/Library/LaunchAgents 의 plist 3개 삭제(위 둘 + docker-compose.plist.bak)
#   - 배포 기록 마커 삭제: ~/.portfolion-deployed-sha · ~/.portfolion-deploy-failed-sha · /tmp/portfolion-deploy.lock
# 무엇을 안 바꾸는가: 컨테이너(재기동 없음) · 러너 서비스(actions.runner.*) · cowork-fire-listener 잡.
#
# ⚠️ 전환 커밋을 push 하기 **전에** 끝내야 한다 — 폴러가 살아 있으면 전환 커밋을 ff 해 옛 deploy.sh 로 배포한다.
set -euo pipefail
trap 'ec=$?; echo "❌ 예기치 못한 종료: line $LINENO, exit $ec" >&2' ERR
cd "$(dirname "$0")/../.."

DRY=0; [ "${1:-}" = --dry-run ] && DRY=1
DOMAIN="gui/$(id -u)"
LABELS=(com.portfolion.auto-deploy-poll com.portfolion.docker-compose)
PLISTS=("$HOME/Library/LaunchAgents/com.portfolion.auto-deploy-poll.plist"
        "$HOME/Library/LaunchAgents/com.portfolion.docker-compose.plist"
        "$HOME/Library/LaunchAgents/com.portfolion.docker-compose.plist.bak")
MARKERS=("$HOME/.portfolion-deployed-sha" "$HOME/.portfolion-deploy-failed-sha")
LOCK=/tmp/portfolion-deploy.lock

die() { echo "❌ $*" >&2; exit 1; }
echo "== 컷오버 ①: 폴러·부팅 잡 bootout, plist 3개·배포 기록 마커 삭제 (컨테이너는 건드리지 않음)$( [ $DRY = 1 ] && echo ' [dry-run]')"

# --- 사전 확인: 폴러가 할 일이 없는 상태(배포 기록 == origin/main)이고 배포가 돌고 있지 않을 것 ---
git fetch -q origin || die "git fetch 실패"
ORIGIN=$(git rev-parse origin/main)
RECORDED=$(cat "$HOME/.portfolion-deployed-sha" 2>/dev/null || echo "(없음)")
echo "origin/main = $ORIGIN"
echo "배포 기록   = $RECORDED"
if [ -e "$HOME/.portfolion-deployed-sha" ] && [ "$RECORDED" != "$ORIGIN" ]; then
  die "배포 기록 ≠ origin/main — 폴러가 지금 배포할 차례다. 그 배포가 끝난 뒤(기록 == origin/main) 다시 실행할 것"
fi
[ ! -e "$LOCK" ] || die "배포 잠금 $LOCK 이 있다 — deploy.sh 가 도는 중이다. 끝난 뒤 다시 실행할 것"
for l in "${LABELS[@]}"; do
  if launchctl print "$DOMAIN/$l" >/dev/null 2>&1; then echo "적재됨: $l"; else echo "미적재: $l"; fi
done
for f in "${PLISTS[@]}" "${MARKERS[@]}"; do [ -e "$f" ] && echo "있음: $f"; done
[ $DRY = 1 ] && { echo "dry-run — 아무것도 바꾸지 않았다"; exit 0; }

# --- 실행 ---
for l in "${LABELS[@]}"; do
  launchctl bootout "$DOMAIN/$l" 2>/dev/null && echo "bootout: $l" || echo "이미 미적재: $l"
done
rm -f "${PLISTS[@]}" "${MARKERS[@]}"
rm -rf "$LOCK"

# --- 검증 ---
fail=0
for l in "${LABELS[@]}"; do
  if launchctl print "$DOMAIN/$l" >/dev/null 2>&1; then echo "❌ 아직 적재됨: $l"; fail=1; fi
done
for f in "${PLISTS[@]}" "${MARKERS[@]}" "$LOCK"; do
  if [ -e "$f" ]; then echo "❌ 아직 있음: $f"; fail=1; fi
done
[ $fail = 0 ] || die "은퇴 검증 실패"
echo "✅ 컷오버 ① 완료 — 폴러·부팅 잡 미적재, plist·마커 0"
