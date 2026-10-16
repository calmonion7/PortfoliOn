#!/usr/bin/env bash
# deploy/hooks/post-deploy.sh 오프라인 테스트 — PATH 앞에 가짜 launchctl·lsof 를 두고 4경우를 단언한다.
#   1) prod 성공: kickstart 정확히 1회 + 종료 0   2) dev: launchctl 호출 0 + 종료 0
#   3) kickstart 실패 → ≠0                         4) 대기시간 안에 launchd PID ≠ 8787 LISTEN PID → ≠0
# 실행: bash deploy/hooks/post-deploy.test.sh (레포 루트에서)
set -u
HOOK="$(cd "$(dirname "$0")" && pwd)/post-deploy.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()  { pass=$((pass + 1)); echo "  ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL $1"; }

mkdir "$T/bin"
cat > "$T/bin/launchctl" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/launchctl.log"
case "$1" in
  kickstart) [ -e "$FAKE/kickstart-fail" ] && exit 1; exit 0 ;;
  print) printf '\tstate = running\n\tpid = %s\n' "$(cat "$FAKE/launchd-pid")" ;;
  *) exit 9 ;;
esac
EOF
cat > "$T/bin/lsof" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/lsof.log"
cat "$FAKE/listen-pid"
EOF
chmod +x "$T/bin/launchctl" "$T/bin/lsof"
export PATH="$T/bin:$PATH" FAKE="$T" LISTENER_WAIT=1

reset() { rm -f "$T/launchctl.log" "$T/lsof.log" "$T/kickstart-fail"; echo 4242 > "$T/launchd-pid"; echo 4242 > "$T/listen-pid"; }
kicks() { [ -f "$T/launchctl.log" ] || { echo 0; return; }; grep -c '^kickstart -k gui/[0-9]*/com.portfolion.cowork-fire-listener$' "$T/launchctl.log" || true; }

# 1) prod 성공
reset
out=$(bash "$HOOK" prod 7 2>&1); rc=$?
[ "$rc" = 0 ] && ok "prod 성공 → 종료 0" || bad "prod 성공 → 종료 $rc: $out"
[ "$(kicks)" = 1 ] && ok "prod: kickstart -k 정확히 1회" || bad "prod: kickstart $(kicks)회"
grep -q '리스너 재시작: com.portfolion.cowork-fire-listener' <<< "$out" && ok "prod: 재시작 줄 출력(배포 로그 판정용)" || bad "prod: 재시작 줄 없음: $out"
grep -q -- '-iTCP:8787' "$T/lsof.log" 2>/dev/null && ok "prod: 8787 LISTEN 확인" || bad "prod: lsof 8787 호출 없음"

# 2) dev — 리스너는 하나(prod)뿐이다
reset
out=$(bash "$HOOK" dev 3 2>&1); rc=$?
[ "$rc" = 0 ] && ok "dev → 종료 0" || bad "dev → 종료 $rc: $out"
[ ! -s "$T/launchctl.log" ] && ok "dev: launchctl 호출 0" || bad "dev: launchctl 호출됨: $(cat "$T/launchctl.log")"

# 3) kickstart 실패를 삼키지 않는다
reset; touch "$T/kickstart-fail"
out=$(bash "$HOOK" prod 8 2>&1); rc=$?
[ "$rc" != 0 ] && ok "kickstart 실패 → ≠0" || bad "kickstart 실패인데 종료 0: $out"

# 4) 새 프로세스가 8787 을 쥐지 못함(다른 PID 가 LISTEN) → 대기시간 뒤 ≠0
reset; echo 9999 > "$T/listen-pid"
out=$(bash "$HOOK" prod 9 2>&1); rc=$?
[ "$rc" != 0 ] && ok "PID 불일치 → ≠0" || bad "PID 불일치인데 종료 0: $out"
grep -q '4242' <<< "$out" && grep -q '9999' <<< "$out" && ok "PID 불일치: 사유에 두 PID" || bad "PID 불일치 사유 없음: $out"

echo "단언 총계: $((pass + fail)) · 통과 $pass · 실패 $fail"
[ "$fail" = 0 ]
