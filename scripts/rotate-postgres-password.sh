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
cd "$(dirname "$0")/.."

PG=portfolion-postgres-1
BE=portfolion-backend-1
STAMP=$(date +%Y%m%d-%H%M%S)
BAKDIR=".rotate-backup-$STAMP"

die() { echo "❌ $*" >&2; exit 1; }

# --- 0. 사전 점검 ------------------------------------------------------------
docker ps --format '{{.Names}}' | grep -qx "$PG" || die "$PG 가 실행 중이 아니다"
docker ps --format '{{.Names}}' | grep -qx "$BE" || die "$BE 가 실행 중이 아니다"
for f in backend/.env.docker backend/.env; do
  [ -f "$f" ] || die "$f 가 없다"
  grep -q '^DATABASE_URL=' "$f" || die "$f 에 DATABASE_URL 이 없다"
done
[ -f .env ] || die ".env 가 없다"

# --- 1. 새 비밀번호 ----------------------------------------------------------
NEWPW="${1:-}"
[ -n "$NEWPW" ] || NEWPW=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
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

# 새 비밀번호가 TCP(암호인증) 경로에서 실제로 통하는지 즉시 확인 — 조기 실패용
docker exec -i "$PG" sh -c 'cat > /tmp/.pgpass && chmod 600 /tmp/.pgpass' <<PGP
127.0.0.1:5432:portfolion:portfolion:$NEWPW
PGP
if ! docker exec -e PGPASSFILE=/tmp/.pgpass -i "$PG" \
      psql -h 127.0.0.1 -U portfolion -d portfolion -q -c 'SELECT 1' >/dev/null 2>&1; then
  docker exec -i "$PG" rm -f /tmp/.pgpass || true
  rollback; die "새 비밀번호로 TCP 접속이 안 된다"
fi
docker exec -i "$PG" rm -f /tmp/.pgpass || true

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

if docker logs "$BE" --since 5m 2>&1 | grep -qi 'password authentication failed'; then
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
