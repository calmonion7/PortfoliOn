# scripts/uat289-oauth-handler-bench.py
#
# 컨테이너 안에서 OAuth 콜백 핸들러(auth.py:163, 178-180)의 두 성분 비용을 잰다.
# 실행: docker exec -i portfolion-backend-1 python - < scripts/uat289-oauth-handler-bench.py
# N 조절: docker exec -e UAT289_N=2 -i portfolion-backend-1 python - < scripts/uat289-oauth-handler-bench.py
#
# 안전: 서비스 함수(auth_service.*)는 호출하지 않는다 — get_connection()이 정상종료 시
# commit()하므로 원리적으로 롤백 불가. 대신 동등 SQL을 직접 연 커넥션에서 명시 트랜잭션으로
# 실행하고 매 반복 끝에 conn.rollback()으로 닫는다. 이 파일은 커밋 메서드 호출을 쓰지 않는다.

import asyncio
import os
import statistics
import sys
import time
from datetime import datetime, timedelta, timezone

import httpx
import psycopg2
from psycopg2.extras import RealDictCursor
from jose import jwt
import secrets as _secrets

N = int(os.environ.get("UAT289_N", "5"))

FAKE_EMAIL = "uat289-bench@invalid.local"
FAKE_SUB = "uat289-bench"
FAKE_PROVIDER = "google"


def fmt(vals):
    if not vals:
        return "n=0 (표본 없음)"
    return (
        f"median={statistics.median(vals) * 1000:.1f}ms "
        f"min={min(vals) * 1000:.1f}ms max={max(vals) * 1000:.1f}ms n={len(vals)}"
    )


# ── 측정 1: 구글 토큰 교환 콜드 vs 웜 ─────────────────────────────────────────

async def bench_google_token_exchange():
    google_client_id = os.environ["GOOGLE_CLIENT_ID"]
    google_client_secret = os.environ["GOOGLE_CLIENT_SECRET"]
    frontend_url = os.environ["FRONTEND_URL"]
    redirect_uri = frontend_url + "/api/auth/oauth/google/callback"
    payload = {
        "code": "uat289-bench-dummy-code",
        "client_id": google_client_id,
        "client_secret": google_client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }

    cold_times, cold_status = [], set()
    for _ in range(N):
        t0 = time.perf_counter()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post("https://oauth2.googleapis.com/token", data=payload)
        cold_times.append(time.perf_counter() - t0)
        cold_status.add(resp.status_code)

    warm_times, warm_status = [], set()
    async with httpx.AsyncClient(timeout=15.0) as client:
        for i in range(N + 1):  # 0번째(첫 요청)는 이 client에도 콜드라 집계에서 제외
            t0 = time.perf_counter()
            resp = await client.post("https://oauth2.googleapis.com/token", data=payload)
            elapsed = time.perf_counter() - t0
            warm_status.add(resp.status_code)
            if i == 0:
                continue
            warm_times.append(elapsed)

    print("\n=== 측정 1: 구글 토큰 교환 콜드 vs 웜 ===")
    print(f"콜드 (매회 new AsyncClient): {fmt(cold_times)} status={sorted(cold_status)}")
    print(f"웜   (client 재사용, 워밍업 1회 제외): {fmt(warm_times)} status={sorted(warm_status)}")
    if cold_times and warm_times:
        diff_ms = (statistics.median(cold_times) - statistics.median(warm_times)) * 1000
        print(f"차이(커넥션 재사용 이득 상한) = {diff_ms:.1f}ms")


# ── 측정 2: DB 3연산 (무쓰기, 롤백) ───────────────────────────────────────────

def _table_counts(cur):
    cur.execute("SELECT count(*) AS n FROM users")
    u = cur.fetchone()["n"]
    cur.execute("SELECT count(*) AS n FROM refresh_tokens")
    r = cur.fetchone()["n"]
    cur.execute("SELECT count(*) AS n FROM user_menu_permissions")
    p = cur.fetchone()["n"]
    return (u, r, p)


def bench_db_ops():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    op1_times, op2_times, op3_times = [], [], []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            before = _table_counts(cur)
        conn.rollback()

        print("\n=== 측정 2: DB 3연산 (무쓰기, 롤백) ===")
        print(
            f"실행 전 count: users={before[0]} refresh_tokens={before[1]} "
            f"user_menu_permissions={before[2]}"
        )
        print(
            "주의: 매 반복이 롤백되므로 op1은 신규유저 경로(2 SELECT miss + INSERT)를 "
            "측정한다 — 기존유저 경로(단일 SELECT hit)보다 비쌀 수 있다."
        )

        for _ in range(N):
            try:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    # op1: upsert_oauth_user 등가
                    t0 = time.perf_counter()
                    cur.execute(
                        "SELECT * FROM users WHERE oauth_provider = %s AND oauth_sub = %s",
                        (FAKE_PROVIDER, FAKE_SUB),
                    )
                    row = cur.fetchone()
                    if row is None:
                        cur.execute("SELECT * FROM users WHERE email = %s", (FAKE_EMAIL,))
                        row = cur.fetchone()
                    if row is None:
                        cur.execute(
                            "INSERT INTO users (email, oauth_provider, oauth_sub) "
                            "VALUES (%s, %s, %s) RETURNING *",
                            (FAKE_EMAIL, FAKE_PROVIDER, FAKE_SUB),
                        )
                        row = cur.fetchone()
                    op1_times.append(time.perf_counter() - t0)
                    user_id = str(row["id"])

                    # op2: apply_default_permissions 등가
                    t0 = time.perf_counter()
                    cur.execute(
                        "SELECT 1 FROM user_menu_permissions WHERE user_id = %s LIMIT 1",
                        (user_id,),
                    )
                    already = cur.fetchone()
                    if not already:
                        cur.execute("SELECT menu, enabled FROM default_menu_permissions")
                        defaults = cur.fetchall()
                        for d in defaults:
                            cur.execute(
                                "INSERT INTO user_menu_permissions (user_id, menu, enabled) "
                                "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                                (user_id, d["menu"], d["enabled"]),
                            )
                    op2_times.append(time.perf_counter() - t0)

                    # op3: issue_tokens 등가 (JWT 인코딩 + refresh_tokens INSERT)
                    t0 = time.perf_counter()
                    now = datetime.now(timezone.utc)
                    jwt.encode(
                        {"sub": user_id, "exp": now + timedelta(hours=1)},
                        os.environ["JWT_SECRET"],
                        algorithm="HS256",
                    )
                    refresh_token = _secrets.token_urlsafe(64)
                    cur.execute(
                        "INSERT INTO refresh_tokens (user_id, token, expires_at) "
                        "VALUES (%s, %s, %s)",
                        (user_id, refresh_token, now + timedelta(days=30)),
                    )
                    op3_times.append(time.perf_counter() - t0)
            finally:
                conn.rollback()

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            after = _table_counts(cur)
        conn.rollback()

        print(
            f"실행 후 count: users={after[0]} refresh_tokens={after[1]} "
            f"user_menu_permissions={after[2]}"
        )
        if before != after:
            print("!!! 경고: count 불일치 — 롤백 실패 가능성, 즉시 확인 필요 !!!")
            sys.exit(1)

        print(f"op1 (user lookup/insert 등가):        {fmt(op1_times)}")
        print(f"op2 (default permissions 등가):       {fmt(op2_times)}")
        print(f"op3 (JWT 인코딩 + refresh_token INSERT 등가): {fmt(op3_times)}")
        if op1_times and op2_times and op3_times:
            total_median = (
                statistics.median(op1_times)
                + statistics.median(op2_times)
                + statistics.median(op3_times)
            )
            print(f"합계(op1+op2+op3 중앙값의 합) = {total_median * 1000:.1f}ms")
    finally:
        conn.rollback()
        conn.close()


async def main():
    print(f"N={N}")
    try:
        await bench_google_token_exchange()
    except Exception as e:
        print(f"\n=== 측정 1 실패: {type(e).__name__}: {e} ===")
    bench_db_ops()


if __name__ == "__main__":
    asyncio.run(main())
