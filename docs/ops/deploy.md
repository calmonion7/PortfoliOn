# PortfoliOn Docker 배포 운영 가이드

도메인: **taebro.com** | 등록: Cloudflare

---

## Task 14: 최초 배포 절차

### 1. 프론트엔드 빌드

```bash
cd frontend && npm run build
```

### 2. 환경변수 파일 준비

```bash
cp backend/.env.docker.example backend/.env.docker
# 실제 값으로 편집
nano backend/.env.docker
```

필수 설정:
- `DATABASE_URL=postgresql://portfolion:STRONG_PASS@postgres:5432/portfolion`
- `POSTGRES_PASSWORD=STRONG_PASS` (docker-compose에서 참조)
- `JWT_SECRET=` (32바이트 이상 랜덤 문자열: `openssl rand -hex 32`)
- `SESSION_SECRET=` (32바이트 이상 랜덤 문자열: `openssl rand -hex 32`)
- `FRONTEND_URL=https://taebro.com`
- `ANTHROPIC_API_KEY=`

### 3. HTTP 전용으로 먼저 시작 (SSL 발급 전)

`nginx/nginx.conf`에서 443 server 블록을 임시 주석 처리:

```bash
docker compose up -d postgres backend nginx certbot
```

### 4. Let's Encrypt SSL 최초 발급

```bash
docker compose run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email thkim@anchors-biz.com \
    --agree-tos \
    --no-eff-email \
    -d taebro.com
```

Expected: `Successfully received certificate`

### 5. nginx.conf HTTPS 블록 주석 해제 후 재시작

```bash
docker compose restart nginx
```

### 6. OAuth 앱 등록

**Google:**
1. https://console.cloud.google.com → API 및 서비스 → 사용자 인증 정보
2. OAuth 2.0 클라이언트 ID 생성
3. 승인된 리디렉션 URI: `https://taebro.com/api/auth/oauth/google/callback`
4. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`을 `backend/.env.docker`에 입력

**GitHub:**
1. https://github.com/settings/developers → OAuth Apps → New OAuth App
2. Authorization callback URL: `https://taebro.com/api/auth/oauth/github/callback`
3. `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`을 `backend/.env.docker`에 입력

### 7. 전체 재시작

```bash
docker compose down && docker compose up -d
```

### 8. 헬스체크

```bash
curl https://taebro.com/health
# Expected: {"status":"ok"}
```

### 9. DDNS 스크립트 설정

```bash
# scripts/ddns_update.sh에서 ZONE_ID, RECORD_ID, API_TOKEN 입력
nano scripts/ddns_update.sh

# Record ID 조회 방법:
curl -s -X GET \
    "https://api.cloudflare.com/client/v4/zones/YOUR_ZONE_ID/dns_records?type=A&name=taebro.com" \
    -H "Authorization: Bearer YOUR_API_TOKEN" | python3 -m json.tool | grep '"id"'

# cron 등록 (5분마다):
crontab -e
# 추가: */5 * * * * /Users/calmonion/Project/PortfoliOn/scripts/ddns_update.sh >> /tmp/ddns.log 2>&1
```

---

## Task 15: Supabase 데이터 마이그레이션

### 1. 사용자 UUID 추출 (Supabase 대시보드)

Supabase 대시보드 → SQL Editor:
```sql
SELECT id, email FROM auth.users;
```

결과를 기록해둡니다.

### 2. 로컬 DB에 동일 UUID로 사용자 삽입

```bash
docker compose exec postgres psql -U portfolion portfolion
```

```sql
INSERT INTO users (id, email) VALUES
  ('기존-uuid-1', 'user1@example.com'),
  ('기존-uuid-2', 'user2@example.com');
```

### 3. Supabase에서 데이터 덤프

Supabase 대시보드 → Settings → Database → Connection string (URI):

```bash
pg_dump \
  --data-only \
  -t tickers \
  -t user_stocks \
  -t snapshots \
  -t schedules \
  -t guru_managers \
  -t guru_schedules \
  -t digests \
  -t consensus_history \
  "postgresql://postgres:[password]@[host]:5432/postgres" > supabase_data.sql
```

### 4. 로컬 DB에 복원

```bash
docker compose exec -T postgres psql -U portfolion portfolion < supabase_data.sql
```

### 5. 데이터 확인

```bash
docker compose exec postgres psql -U portfolion portfolion \
  -c "SELECT COUNT(*) FROM user_stocks;" \
  -c "SELECT COUNT(*) FROM snapshots;"
```

### 6. 로그인 테스트

브라우저에서 `https://taebro.com` 접속 → Google 또는 GitHub OAuth 로그인 → 기존 보유종목 확인

### 7. 외부 인프라 비활성화

데이터 이전 및 동작 확인 후:
- Vercel 대시보드 → 프로젝트 삭제 또는 비활성화
- Render 대시보드 → 서비스 일시정지
- Supabase 프로젝트는 백업 보관 목적으로 일정 기간 유지 후 삭제
