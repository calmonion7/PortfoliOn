#!/bin/bash
# Postgres 비밀번호 회전 (B21 / task#334 S2)
#
# 왜 필요한가: docker-compose.yml의 tracked 폴백값(`${POSTGRES_PASSWORD:-...}`)이
# 공개 저장소에 커밋돼 있고, 그 값이 실제 운영 DB 비밀번호로 쓰이고 있다.
# 파일에서 지워도 git 이력에 영구히 남으므로 비밀번호 자체를 교체해야 해소된다.
#
# 사용법:  bash scripts/rotate-postgres-password.sh              # 32자 무작위 생성
#          bash scripts/rotate-postgres-password.sh <새비밀번호>   # 직접 지정 (영숫자 16자+)
#
# 건드리는 것 (전부 gitignored — git에 올라가지 않는다):
#   backend/.env.docker   DATABASE_URL       (컨테이너 백엔드)
#   backend/.env          DATABASE_URL       (로컬 venv·pytest·스크립트)
#   .env                  POSTGRES_PASSWORD  (docker compose 보간용, 없으면 추가)
#   DB                    ALTER USER portfolion
#
# 어느 단계에서 실패하든 위 넷을 전부 원상복구한다(rollback).
set -euo pipefail
# `set -e` 는 실패 시 **아무 메시지도 남기지 않는다** — 초판이 비밀번호 생성 파이프라인의
# SIGPIPE(141)로 조용히 죽어 "실행했는데 아무 일도 안 일어났다" 가 됐다. 그 무음을 없앤다.
trap 'ec=$?; echo "❌ 예기치 못한 종료: line $LINENO, exit $ec" >&2' ERR
cd "$(dirname "$0")/.."

PG=portfolion-postgres-1
BE=portfolion-backend-1
NETWORK=portfolion_default
PGHOST=postgres          # 도커 네트워크 별칭 (백엔드가 쓰는 것과 동일 경로)
PGIMAGE=postgres:16-alpine
STAMP=$(date +%Y%m%d-%H%M%S)
BAKDIR=".rotate-backup-$STAMP"

die() { echo "❌ $*" >&2; exit 1; }

# --- 0. 사전 점검 ------------------------------------------------------------
# ⚠️ 파이프를 쓰지 말 것 — `grep -q`가 첫 매치에서 즉시 끝나 좌변이 SIGPIPE(141)를 받고,
#    `set -o pipefail`이 그 141을 파이프라인 종료코드로 올려 **멀쩡한데 die** 한다.
#    출력을 먼저 받아 두고 here-string으로 검사한다(파이프라인이 아니라 SIGPIPE가 없다).
RUNNING=$(docker ps --format '{{.Names}}')
grep -qx "$PG" <<< "$RUNNING" || die "$PG 가 실행 중이 아니다"
grep -qx "$BE" <<< "$RUNNING" || die "$BE 가 실행 중이 아니다"
for f in backend/.env.docker backend/.env; do
  [ -f "$f" ] || die "$f 가 없다"
  grep -q '^DATABASE_URL=' "$f" || die "$f 에 DATABASE_URL 이 없다"
done
[ -f .env ] || die ".env 가 없다"

# --- 1. 새 비밀번호 ----------------------------------------------------------
NEWPW="${1:-}"
# ⚠️ `tr -dc ... | head -c 32` 를 쓰지 말 것 — head가 32바이트에서 파이프를 닫아 tr이
#    SIGPIPE(141)를 받고, `set -o pipefail` + `set -e` 조합이 **에러 메시지 하나 없이**
#    스크립트를 종료시킨다(실측: exit=141, 백업 생성 전이라 흔적조차 안 남는다).
[ -n "$NEWPW" ] || NEWPW=$(python3 -c "import secrets,string;print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(32)))")
# 영숫자로 제한한다 — DATABASE_URL 안에서 퍼센트 인코딩 없이 안전하고,
# `@ : / ? # % &` 가 섞이면 URL 파싱이 조용히 어긋난다
case "$NEWPW" in *[!A-Za-z0-9]*) die "비밀번호는 영숫자만 허용한다 (DATABASE_URL 파싱 안전용)";; esac
[ "${#NEWPW}" -ge 16 ] || die "비밀번호가 너무 짧다 (16자 이상)"

# 현재(옛) 비밀번호를 DATABASE_URL에서 추출 — 롤백용
OLDPW=$(python3 -c '
import re, sys, urllib.parse
line = next(l for l in open("backend/.env.docker") if l.startswith("DATABASE_URL="))
m = re.match(r"^[a-z0-9+]+://([^:@/]+):([^@]*)@", line.split("=", 1)[1].strip())
sys.stdout.write(urllib.parse.unquote(m.group(2)) if m else "")
')
[ -n "$OLDPW" ] || die "backend/.env.docker 의 DATABASE_URL 에서 현재 비밀번호를 읽지 못했다"
[ "$OLDPW" != "$NEWPW" ] || die "새 비밀번호가 현재와 같다"

# --- 2. 백업 ----------------------------------------------------------------
# ⚠️ backend/.env 와 .env 는 basename 이 같으므로 평탄한 이름으로 구분해 저장한다
mkdir -p "$BAKDIR"
cp backend/.env.docker "$BAKDIR/backend.env.docker"
cp backend/.env        "$BAKDIR/backend.env"
cp .env                "$BAKDIR/root.env"
echo "백업: $BAKDIR/"

rollback() {
  echo "↩️  롤백 중..." >&2
  docker exec -i "$PG" psql -U portfolion -d portfolion -q >/dev/null 2>&1 <<SQL || true
ALTER USER portfolion WITH PASSWORD '$OLDPW';
SQL
  cp "$BAKDIR/backend.env.docker" backend/.env.docker
  cp "$BAKDIR/backend.env"        backend/.env
  cp "$BAKDIR/root.env"           .env
  bash deploy.sh >/dev/null 2>&1 || true
  echo "↩️  롤백 완료 — 옛 비밀번호로 되돌렸다. 백업은 $BAKDIR/ 에 남겨 둔다." >&2
}

# --- 3. DB 비밀번호 교체 -----------------------------------------------------
# 컨테이너 내부 로컬 소켓은 trust 인증이라 현재 비밀번호 없이 변경할 수 있다.
# heredoc 으로 넘겨 비밀번호가 프로세스 argv 에 노출되지 않게 한다.
echo "[1/4] DB ALTER USER..."
docker exec -i "$PG" psql -U portfolion -d portfolion -q <<SQL || die "ALTER USER 실패 (아무것도 바뀌지 않았다)"
ALTER USER portfolion WITH PASSWORD '$NEWPW';
SQL

# 새 비밀번호가 암호인증 경로에서 실제로 통하는지 즉시 확인 — 조기 실패용.
#
# ⚠️ `docker exec "$PG" psql -h 127.0.0.1` 로 재면 **아무 비밀번호로도 통과한다** —
#    pg_hba.conf 의 `host all all 127.0.0.1/32 trust` 에 걸려 비밀번호를 아예 안 본다
#    (실측: 빈 값·틀린 값 모두 접속 성공). 그 형태는 이빨 없는 검사다.
#    암호인증(`host all all all scram-sha-256`)을 타려면 **컨테이너 밖**에서 와야 하므로
#    같은 네트워크의 일회용 컨테이너로 잰다.
if ! docker run --rm --network "$NETWORK" -e PGPASSWORD="$NEWPW" "$PGIMAGE" \
      psql -h "$PGHOST" -U portfolion -d portfolion -q -c 'SELECT 1' >/dev/null 2>&1; then
  rollback; die "새 비밀번호로 암호인증 접속이 안 된다"
fi
# 이빨 확인 — 옛 비밀번호가 거부되는지도 함께 본다(거부되지 않으면 ALTER USER 가 안 먹은 것)
if docker run --rm --network "$NETWORK" -e PGPASSWORD="$OLDPW" "$PGIMAGE" \
      psql -h "$PGHOST" -U portfolion -d portfolion -q -c 'SELECT 1' >/dev/null 2>&1; then
  rollback; die "옛 비밀번호가 아직 통한다 — 회전이 반영되지 않았다"
fi

# --- 4. env 파일 3개 갱신 ----------------------------------------------------
echo "[2/4] env 파일 갱신..."
if ! NEWPW="$NEWPW" python3 - <<'PY'
import os, re, pathlib
new = os.environ["NEWPW"]

# DATABASE_URL 의 비밀번호 성분만 교체한다.
# ⚠️ 단순 문자열 치환을 쓰면 안 된다 — 옛 비밀번호가 사용자명·DB명과 같은 문자열일 수 있고
#    (실제로 폴백값 'portfolion' 이 그렇다) 그러면 URL 전체가 망가진다.
pat = re.compile(r'^(DATABASE_URL=[a-z0-9+]+://[^:@/]+:)[^@]*(@)')
for p in ("backend/.env.docker", "backend/.env"):
    path = pathlib.Path(p)
    out = [pat.sub(lambda m: m.group(1) + new + m.group(2), l) if l.startswith("DATABASE_URL=") else l
           for l in path.read_text().splitlines(keepends=True)]
    path.write_text("".join(out))

env = pathlib.Path(".env")
lines = env.read_text().splitlines(keepends=True)
hit = False
for i, l in enumerate(lines):
    if l.startswith("POSTGRES_PASSWORD="):
        lines[i], hit = f"POSTGRES_PASSWORD={new}\n", True
if not hit:
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    lines.append(f"POSTGRES_PASSWORD={new}\n")
env.write_text("".join(lines))
PY
then rollback; die "env 파일 갱신 실패"; fi

# 세 파일의 비밀번호 성분이 실제로 새 값인지 확인
# ⚠️ `grep <옛비번>` 으로 검사하면 안 된다 — 옛 폴백값 'portfolion' 은 사용자명·DB명과
#    같은 문자열이라 정상 URL 에도 항상 걸려 거짓 실패를 낸다.
if ! NEWPW="$NEWPW" python3 - <<'PY'
import os, re, sys, urllib.parse, pathlib
new = os.environ["NEWPW"]
for p in ("backend/.env.docker", "backend/.env"):
    line = next(l for l in pathlib.Path(p).read_text().splitlines() if l.startswith("DATABASE_URL="))
    m = re.match(r"^[a-z0-9+]+://([^:@/]+):([^@]*)@", line.split("=", 1)[1])
    if not m or urllib.parse.unquote(m.group(2)) != new:
        sys.exit(f"{p}: 비밀번호 성분이 새 값이 아니다")
if not any(l.strip() == f"POSTGRES_PASSWORD={new}" for l in pathlib.Path(".env").read_text().splitlines()):
    sys.exit(".env: POSTGRES_PASSWORD 가 새 값이 아니다")
PY
then rollback; die "env 파일 검증 실패"; fi

# --- 5. 백엔드 재생성 --------------------------------------------------------
# ⚠️ docker restart 는 --env-file 을 다시 읽지 않는다 → stop/rm/run 하는 deploy.sh 가 필요하다
echo "[3/4] 백엔드 재생성 (deploy.sh — 프론트 빌드 포함, 1~2분)..."
bash deploy.sh || { rollback; die "deploy.sh 실패"; }

# --- 6. 검증 ----------------------------------------------------------------
# 기동 배치가 도는 동안 포트가 늦게 열릴 수 있어 최대 ~3분 폴링한다 (CLAUDE.md task#250)
echo "[4/4] 백엔드 DB 접속 검증 (최대 3분)..."
OK=0
for _ in $(seq 1 36); do
  if docker exec -i "$BE" python -c \
      "from services.db import query; assert query('SELECT 1 AS ok')[0]['ok'] == 1" 2>/dev/null; then
    OK=1; break
  fi
  sleep 5
done
[ "$OK" = 1 ] || { rollback; die "백엔드가 새 비밀번호로 DB에 접속하지 못한다"; }

# ⚠️ 여기서 파이프를 쓰면 검사가 **뒤집힌다** — 인증 실패가 *발견되면* grep이 먼저 끝나
#    docker logs가 SIGPIPE(141)를 받고, pipefail이 141을 올려 `if`가 거짓이 된다.
#    즉 진짜 실패일수록 통과한다. 출력을 먼저 받아 둔다.
LOGTAIL=$(docker logs "$BE" --since 5m 2>&1 || true)
if grep -qi 'password authentication failed' <<< "$LOGTAIL"; then
  rollback; die "백엔드 로그에 인증 실패가 있다"
fi

echo
echo "✅ 회전 완료"
echo "   - DB 비밀번호 교체됨 (ALTER USER)"
echo "   - backend/.env.docker · backend/.env · .env 갱신됨 (전부 gitignored)"
echo "   - 백엔드가 새 비밀번호로 SELECT 1 성공, 인증 실패 로그 없음"
echo "   - 백업: $BAKDIR/   (문제 없으면: rm -rf $BAKDIR)"
echo
echo "다음: 이 결과를 알려주면 docker-compose.yml 패치(폴백 제거 + 5432 루프백 바인딩)를"
echo "      커밋·푸시하고 CONCERNS 원장의 B21 행을 닫는다."
