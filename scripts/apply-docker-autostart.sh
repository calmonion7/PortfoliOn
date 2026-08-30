#!/bin/bash
# PortfoliOn 도커 자동기동 잡 적용 (task#338 S3)
#
#   백업 → plist 배치 → launchctl 재적재 → 1회 실행 → 정지조건 검증
#
# 사용법:
#   bash scripts/apply-docker-autostart.sh              # 대화형(확인 후 진행)
#   bash scripts/apply-docker-autostart.sh --yes        # 확인 없이 진행
#   bash scripts/apply-docker-autostart.sh --dry-run    # 아무것도 바꾸지 않고 현 상태만 점검
#   bash scripts/apply-docker-autostart.sh --rollback   # 백업으로 되돌림
#
# 재실행해도 안전하다. 단 **백업은 최초 1회만** 만든다 — 두 번째 실행이 백업을 덮으면
# 「진짜 원본」이 사라져 롤백이 무의미해지기 때문이다.

set -u

LABEL="com.portfolion.docker-compose"
SRC="/Users/calmonion/Project/PortfoliOn/scripts/${LABEL}.plist"
DST="$HOME/Library/LaunchAgents/${LABEL}.plist"
BAK="$DST.bak"
DOMAIN="gui/$(id -u)"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || echo 172.16.11.230)"

MODE="apply"; ASSUME_YES=0
for a in "$@"; do
  case "$a" in
    --dry-run)  MODE="dryrun" ;;
    --rollback) MODE="rollback" ;;
    --yes|-y)   ASSUME_YES=1 ;;
    *) echo "알 수 없는 인자: $a" >&2; exit 64 ;;
  esac
done

ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
no(){ printf '  \033[31m✗\033[0m %s\n' "$*"; }
info(){ printf '  · %s\n' "$*"; }
die(){ printf '\033[31mFATAL:\033[0m %s\n' "$*" >&2; exit 1; }
# 「죽었는데 아무도 모른다」 방지 — 예기치 못한 실패도 반드시 소리를 낸다
trap 'rc=$?; if [ $rc -ne 0 ]; then printf "\033[31m중단됨 (exit %s)\033[0m\n" "$rc" >&2; fi' EXIT

job_status(){ launchctl list | awk -v l="$LABEL" '$3==l{print $2}'; }
job_pid(){    launchctl list | awk -v l="$LABEL" '$3==l{print $1}'; }

# ── 현 상태 ─────────────────────────────────────────────
echo "── 현재 상태 ──"
st="$(job_status)"; info "launchd 잡 exit status : ${st:-<미등록>}"
info "postgres 게시          : $(docker ps --format '{{.Ports}}' -f name=portfolion-postgres 2>/dev/null || echo '<docker 응답없음>')"
info "nginx 게시             : $(docker ps --format '{{.Ports}}' -f name=portfolion-nginx 2>/dev/null)"
info "컨테이너 수            : $(docker ps --format '{{.Names}}' 2>/dev/null | grep -c portfolion)"
echo

# ── 롤백 ────────────────────────────────────────────────
if [ "$MODE" = "rollback" ]; then
  [ -f "$BAK" ] || die "백업이 없다: $BAK"
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  cp "$BAK" "$DST" || die "백업 복원 실패"
  launchctl bootstrap "$DOMAIN" "$DST" || die "bootstrap 실패"
  ok "롤백 완료 — 옛 plist 로 되돌렸다"
  echo "  ⚠️ 옛 plist 는 삭제된 워크트리를 가리키므로 잡은 다시 exit 127 이 된다(원래 고장난 상태)."
  echo "     컨테이너 자체는 restart: unless-stopped 로 계속 살아 있다."
  exit 0
fi

# ── 프리플라이트 (dry-run 도 여기까지는 동일하게 검사) ──
echo "── 프리플라이트 ──"
[ -f "$SRC" ] || die "정본 plist 부재: $SRC"
plutil -lint "$SRC" >/dev/null 2>&1 || die "정본 plist 가 plutil -lint 실패: $SRC"
ok "정본 plist lint 통과"

script_path="$(plutil -extract ProgramArguments.1 raw -o - "$SRC" 2>/dev/null)"
[ -n "$script_path" ] && [ -f "$script_path" ] || die "plist 가 가리키는 스크립트가 없다: ${script_path:-<추출 실패>}"
bash -n "$script_path" || die "기동 스크립트 구문 오류: $script_path"
ok "기동 스크립트 존재·구문 통과 ($script_path)"

docker info >/dev/null 2>&1 || die "docker 데몬이 응답하지 않는다 — Docker Desktop 을 먼저 켤 것"
ok "docker 데몬 응답"

if [ -f "$BAK" ]; then
  info "백업이 이미 있다 — 보존한다(덮지 않음): $BAK"
else
  info "백업 예정: $BAK"
fi

if [ "$MODE" = "dryrun" ]; then
  echo
  echo "── dry-run 이므로 여기서 멈춘다. 실제 적용 시 일어날 일: ──"
  echo "  1) $DST 백업(최초 1회)"
  echo "  2) 정본 plist 배치"
  echo "  3) launchctl bootout/bootstrap 재적재"
  echo "  4) kickstart 1회 실행 →  docker compose up -d postgres certbot  +  bash deploy.sh"
  echo "     · postgres 가 **재생성**되며 127.0.0.1:5432 바인딩이 적용된다"
  echo "       (데이터는 named volume portfolion_pgdata 라 보존된다)"
  echo "     · backend·nginx 가 재기동되어 수십 초 다운타임이 생긴다"
  trap - EXIT; exit 0
fi

# ── 확인 ────────────────────────────────────────────────
if [ "$ASSUME_YES" -ne 1 ] && [ -t 0 ]; then
  echo
  echo "이 스크립트는 컨테이너를 재생성한다(수십 초 다운타임). 데이터는 보존된다."
  printf "진행할까요? [y/N] "; read -r ans
  case "$ans" in y|Y|yes|YES) ;; *) echo "취소됨."; trap - EXIT; exit 0 ;; esac
fi

# ── 적용 ────────────────────────────────────────────────
echo
echo "── 적용 ──"
if [ ! -f "$BAK" ] && [ -f "$DST" ]; then
  cp "$DST" "$BAK" || die "백업 생성 실패"
  ok "원본 백업 → $BAK"
fi
cp "$SRC" "$DST" || die "plist 배치 실패"
ok "정본 plist 배치 → $DST"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$DST" || die "bootstrap 실패 — plist 를 확인할 것"
ok "launchctl 재적재"

launchctl kickstart -k "$DOMAIN/$LABEL" || die "kickstart 실패"
ok "잡 1회 실행 시작"

# 완료 대기 — PID 가 사라지면 끝난 것. 최대 10분(프론트 빌드 포함).
# ⚠️ 레이스 주의 — kickstart 직후엔 아직 PID 가 안 붙어 있을 수 있다.
#    그때 "PID 없음 = 완료"로 읽으면 즉시 빠져나가 *직전 실행*의 status 를 보고한다.
#    ① PID 가 뜨기를 잠깐 기다리고 ② 그 다음 사라지기를 기다린다.
echo -n "  · 기동 대기"
started=0
for _ in $(seq 1 10); do
  p="$(job_pid)"
  if [ -n "$p" ] && [ "$p" != "-" ]; then started=1; break; fi
  printf '.'; sleep 1
done
if [ "$started" -eq 1 ]; then
  echo -n " 실행중"
  for _ in $(seq 1 200); do
    p="$(job_pid)"
    if [ -z "$p" ] || [ "$p" = "-" ]; then break; fi
    printf '.'; sleep 3
  done
else
  echo -n " (PID 미포착 — 매우 빨리 끝났거나 기동 실패)"
fi
echo

st="$(job_status)"
if [ "$st" = "0" ]; then ok "잡 종료 status=0"; else no "잡 종료 status=${st:-<불명>} — 로그를 볼 것"; fi

# ── 검증 (정지조건 축) ──────────────────────────────────
echo
echo "── 검증 ──"
fail=0
[ "$(job_status)" = "0" ] && ok "C8  launchd exit status = 0" || { no "C8  launchd exit status = $(job_status)"; fail=1; }

pg="$(docker ps --format '{{.Ports}}' -f name=portfolion-postgres)"
case "$pg" in *127.0.0.1:5432*) ok "C9  postgres 게시 = $pg" ;; *) no "C9  postgres 게시 = $pg"; fail=1 ;; esac

if nc -z -G 2 "$LAN_IP" 5432 >/dev/null 2>&1; then no "C10 LAN $LAN_IP:5432 도달 가능"; fail=1; else ok "C10 LAN $LAN_IP:5432 거부"; fi

n="$(docker ps --format '{{.Names}}' | grep -c portfolion)"
[ "$n" = "4" ] && ok "C11 컨테이너 4개" || { no "C11 컨테이너 ${n}개 (기대 4)"; fail=1; }

code=""
for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://localhost/health)"
  [ "$code" = "200" ] && break; sleep 3
done
[ "$code" = "200" ] && ok "C3  localhost/health = 200" || { no "C3  localhost/health = $code"; fail=1; }

t="$(curl -s -o /dev/null -m 15 -w '%{http_code}' https://portfolion.taebro.com/health)"
[ "$t" = "200" ] && ok "C4  터널 /health = 200" || { no "C4  터널 /health = $t"; fail=1; }

s="$(curl -s -o /dev/null -m 15 -w '%{http_code}' https://portfolion.taebro.com/)"
[ "$s" = "200" ] && ok "C15 사이트 본체 = 200" || { no "C15 사이트 본체 = $s"; fail=1; }

if docker exec -i portfolion-backend-1 python -c "from services.db import query; assert query('SELECT 1 AS ok')[0]['ok']==1" >/dev/null 2>&1; then
  ok "C13 백엔드 DB SELECT 1 정상"
else no "C13 백엔드 DB 접속 실패"; fail=1; fi

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32m전부 통과 — /forge:fg-loop 를 재호출하면 나머지를 마무리합니다.\033[0m\n'
else
  printf '\033[31m실패 축이 있다. 로그: tail -40 ~/Library/Logs/%s.err.log\033[0m\n' "$LABEL"
  echo "되돌리려면: bash scripts/apply-docker-autostart.sh --rollback"
fi
trap - EXIT
exit "$fail"
