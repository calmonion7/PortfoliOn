#!/usr/bin/env bash
# 표준 배포 훅(taebro-infra 계약 4절) — bin/deploy 가 헬스 통과 직후 `post-deploy.sh <env> <generation>` 로 부른다(cwd = 러너 체크아웃).
# ≠0 으로 끝나면 bin/deploy 가 컨테이너·RUNTIME_FILES 를 직전 세대로 되돌리고 알린다 — 여기서 롤백을 다시 구현하지 않는다.
# fire 리스너(com.portfolion.cowork-fire-listener)는 prod 실행 자리의 scripts/cowork-fire-listener.py 사본을 돌린다.
# 배포가 그 사본을 갈아 끼우므로 prod 배포마다 재기동하고, 새 프로세스가 8787 을 쥐었는지(launchd PID = LISTEN PID) 확인한다.
# 재기동은 대기열(인메모리)의 잔여 청크를 잃는다 — ADR 260913-013425 가 받아들인 트레이드오프(진행 중 세션은 별도 세션이라 살아남는다).
# kickstart 실패·확인 실패를 삼키지 않는다 — "배포가 리스너를 되살렸다"고 거짓말하는 것은 아무것도 안 하는 것보다 나쁘다.
# 테스트 훅: LISTENER_WAIT(확인 대기 초, 기본 15)
set -euo pipefail
ENV="${1:?env}"; GEN="${2:?generation}"
LABEL=com.portfolion.cowork-fire-listener
PORT=8787
WAIT="${LISTENER_WAIT:-15}"

if [ "$ENV" != prod ]; then
  echo "리스너 재시작 건너뜀 — $ENV 는 프로덕션이 아니다 (세대 $GEN)"
  exit 0
fi

SVC="gui/$(id -u)/$LABEL"
echo "리스너 재시작: $LABEL (세대 $GEN)"
launchctl kickstart -k "$SVC"

pid=""; lpid=""
for ((i = 0; i <= WAIT; i++)); do
  pid=$(launchctl print "$SVC" 2>/dev/null | sed -n 's/^[[:space:]]*pid = //p' | head -1) || true
  lpid=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1) || true
  if [ -n "$pid" ] && [ "$pid" = "$lpid" ]; then
    echo "리스너 확인: pid $pid 가 $PORT LISTEN (세대 $GEN)"
    exit 0
  fi
  [ "$i" -lt "$WAIT" ] && sleep 1
done
echo "리스너 확인 실패: ${WAIT}초 안에 launchd pid [$pid] ≠ $PORT LISTEN pid [$lpid]" >&2
exit 1
