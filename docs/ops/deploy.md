# PortfoliOn Docker 배포 운영 가이드

도메인: **taebro.com** | 등록: Cloudflare

---

## Task 14: 최초 배포 절차

### 1. 프론트엔드 빌드

별도 빌드 단계는 없다 — 프론트는 `nginx/Dockerfile` 멀티스테이지로 nginx 이미지에 구워져 백엔드와 같은 배포로 나간다(task#386).

### 2. 환경변수 파일 준비

비밀 정본은 `~/runtime/portfolion/prod/.env`(권한 600)이고 `backend/.env.docker`는 그 파일을 가리키는 심링크다.
최초 설치라면 예시 파일을 정본 자리로 복사해 값을 채운다.

```bash
mkdir -p ~/runtime/portfolion/prod
cp backend/.env.docker.example ~/runtime/portfolion/prod/.env && chmod 600 ~/runtime/portfolion/prod/.env
ln -s ~/runtime/portfolion/prod/.env backend/.env.docker   # 보조 스크립트가 이 경로로 읽는다
# 실제 값으로 편집
nano ~/runtime/portfolion/prod/.env
```

필수 설정:
- `DATABASE_URL=postgresql://portfolion:STRONG_PASS@postgres:5432/portfolion`
- `POSTGRES_PASSWORD=STRONG_PASS` (docker-compose에서 참조)
- `JWT_SECRET=` (32바이트 이상 랜덤 문자열: `openssl rand -hex 32`)
- `SESSION_SECRET=` (32바이트 이상 랜덤 문자열: `openssl rand -hex 32`)
- `FRONTEND_URL=https://taebro.com`
- `ANTHROPIC_API_KEY=`

### 3. 스택 기동

HTTPS 는 Cloudflare Tunnel 이 종단한다 — nginx 는 루프백 :80 만 받고, 인증서 발급·갱신 컨테이너는 없다(task#384).

postgres 는 배포 compose 에 없다 — DB 는 taebro-infra 공용 postgres 의 발급 DB 라 이 레포에서 띄울 것이 없다.
backend·nginx 는 배포 계약(`~/runtime/taebro-infra/bin/deploy portfolion prod`)이 compose 로 띄운다.
옛 `deploy.sh`(`docker run` 방식)는 task#386 에서 은퇴했다.

```bash
git push origin main   # 또는 수동: gh workflow run deploy.yml --ref main
```

판정은 Deploy run success(`headSha` 대조) + `~/runtime/portfolion/prod/.taebro-deploy` 의 `generation=…-<커밋7자>` 이다.
롤백: `~/runtime/taebro-infra/bin/deploy --rollback portfolion prod <세대>`.

### 4. OAuth 앱 등록

**Google:**
1. https://console.cloud.google.com → API 및 서비스 → 사용자 인증 정보
2. OAuth 2.0 클라이언트 ID 생성
3. 승인된 리디렉션 URI: `https://taebro.com/api/auth/oauth/google/callback`
4. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`을 `backend/.env.docker`에 입력

**GitHub:**
1. https://github.com/settings/developers → OAuth Apps → New OAuth App
2. Authorization callback URL: `https://taebro.com/api/auth/oauth/github/callback`
3. `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`을 `backend/.env.docker`에 입력

### 5. 재배포

OAuth 키를 `~/runtime/portfolion/prod/.env` 에 넣은 뒤에는 ad-hoc `docker compose down/up` 대신 배포를 다시 돌린다.

```bash
gh workflow run deploy.yml --ref main
```

### 6. 헬스체크

```bash
curl https://taebro.com/health
# Expected: {"status":"ok","service":"portfolion"}
```

### 7. DDNS 스크립트 설정

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
