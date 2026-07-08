---
last_mapped_commit: 78e6f09a65ee76a7af351da7b7d417a13b6de820
mapped: 2026-07-09
---

# STACK — 기술 스택 / 런타임 / 배포

구현 사실만 기록한다(용어 정의는 CONTEXT.md 담당). 경로는 모두 리포 루트 기준.

## 백엔드 (Python / FastAPI)

- **런타임**: Python 3.12 (`backend/Dockerfile` = `FROM python:3.12-slim`). 로컬 가상환경 `backend/.venv/` (macOS `backend/.venv/bin/python`).
- **엔트리포인트**: `backend/main.py` — `FastAPI(title="Stock Portfolio Manager", lifespan=lifespan)`. `lifespan`이 기동 시 `_migrate()`(idempotent DDL) → `sched.start()`(APScheduler) → `_warm_market_cache()`(데몬 스레드) 순으로 배선하고, `include_router`로 20여 개 라우터를 마운트. 실행 커맨드: `uvicorn main:app --host 0.0.0.0 --port 8000`(Dockerfile CMD / 로컬 `--reload --port 8000`).
- **의존성**(`backend/requirements.txt`, 하한 버전 명시):
  - 웹: `fastapi>=0.104.0`, `uvicorn[standard]>=0.24.0`, `httpx>=0.25.0`, `requests>=2.31.0`
  - 스케줄러: `apscheduler>=3.10.4` — `AsyncIOScheduler`(`backend/scheduler/_state.py`)
  - 데이터/수치: `pandas>=2.1.0`, `numpy>=1.26.0`, `yfinance>=0.2.40`, `exchange_calendars>=4.5`
  - 파싱: `beautifulsoup4>=4.12.0`, `lxml>=4.9.0` — ⚠️ `lxml`은 Docker 이미지엔 있으나 로컬 `.venv`엔 없음(CLAUDE.md gotcha). 로컬 검증 코드는 `BeautifulSoup(html, "html.parser")` 사용.
  - DB: `psycopg2-binary>=2.9.0`
  - 인증: `authlib>=1.3.0`, `python-jose[cryptography]>=3.3.0`(JWT HS256), `bcrypt>=4.0.0`, `itsdangerous>=2.0.0`(세션)
  - 기타: `python-dotenv`, `pytest>=7.4.0`
- **미들웨어**(`backend/main.py`): `SessionMiddleware`(`SESSION_SECRET`), `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`), `CORSMiddleware`(origins = `localhost:3000`, `localhost:5173`, `FRONTEND_URL`).
- **패키지 구조**: `backend/routers/`(19개 라우터), `backend/services/`(도메인 서비스 + 하위 패키지 `kiwoom/`·`kis/`·`market/`·`market_indicators/`·`recommendation/`·`storage/`), `backend/scheduler/`(루트 레벨 패키지: `__init__.py`·`jobs.py`·`schedule.py`·`_state.py`).
- **테스트**: `pytest`(`backend/pytest.ini`), `backend/tests/`(100+ 파일). 실행 `cd backend && .venv/bin/python -m pytest`.
- **DB 마이그레이션**: 신규 설치는 `backend/auth_schema.sql` → `backend/app_schema.sql`(docker-entrypoint-initdb.d 마운트). 라이브 DB는 `main.py:_migrate()`의 idempotent `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`만 탄다(ADR-0006). 신규 컬럼은 두 곳 모두 갱신 필수.

## 프론트엔드 (React 19 + Vite/rolldown)

- **런타임/프레임워크**(`frontend/package.json`, `type: module`):
  - `react@^19.2.5`, `react-dom@^19.2.5`, `react-router-dom@^7.14.2`
  - `recharts@^3.8.1`(차트), `axios@^1.16.0`(HTTP)
- **빌드/툴체인**(devDependencies):
  - `vite@^8.0.10` — **rolldown 번들러**. `@vitejs/plugin-react@^6.0.1`
  - `vite-plugin-pwa@^1.3.0`(PWA/서비스워커)
  - 테스트: `vitest@^4.1.9`, `jsdom@^29.1.1`, `@testing-library/react@^16.3.2`, `@testing-library/jest-dom@^6.9.1`
  - 린트: `eslint@^10.2.1`, `@eslint/js@^10.0.1`, `eslint-plugin-react-hooks@^7.1.1`, `eslint-plugin-react-refresh@^0.5.2`, `globals@^17.5.0`
- **스크립트**: `dev`(vite), `build`(vite build), `test`(vitest run), `lint`(eslint .), `preview`.
- **설정**(`frontend/vite.config.js`):
  - 개발 서버 port 5173, `/api/*` → `http://localhost:8000` 프록시, `watch.usePolling`.
  - **`build.rollupOptions.output.manualChunks`는 함수형만**(rolldown 제약) — `recharts`/`d3-`/`victory-vendor`는 `charts` 청크, 나머지 node_modules는 `vendor`.
  - PWA: `VitePWA`(registerType autoUpdate, workbox runtimeCaching — google-fonts/cdn-fonts CacheFirst, `/api/*` NetworkFirst 5분·auth 제외), manifest(`PortfoliOn`, standalone, lang ko).
  - 커스텀 플러그인 `sw-cache-bust`: 빌드 후 `dist/index.html`·`registerSW.js`에 `BUILD_DATE` 쿼리 스트링 주입.
- **린트 설정**: `frontend/eslint.config.js`. **엔트리 HTML**: `frontend/index.html`.
- **환경변수**: `frontend/.env` — `VITE_API_BASE_URL`(배포 시 nginx 직접 호출용; 미설정 시 상대경로), 그 외 레거시 `VITE_SUPABASE_*`(현재 미사용).

## 환경변수 (파일별)

- **`backend/.env.docker`**(gitignore, docker-compose `env_file`로 backend 컨테이너에 주입) — 실사용 변수:
  - DB/인증: `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`
  - OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
  - 외부 데이터 키: `FRED_API_KEY`, `KITA_API_KEY`(관세청), `KOFIA_API_KEY`(공공데이터포털), `DART_API_KEY`
  - 브로커 시세: `KIWOOM_BASE_URL`·`KIWOOM_APP_KEY`·`KIWOOM_SECRET_KEY`, `KIS_APP_KEY`·`KIS_APP_SECRET`(옵션 `KIS_BASE_URL`)
  - 기타: `FRONTEND_URL`(CORS·OAuth redirect·다이제스트), `COWORK_API_KEY`(외부 Cowork X-API-Key 인증), `ANTHROPIC_API_KEY`(**백엔드 미사용** — INTEGRATIONS.md 참조)
  - 템플릿: `backend/.env.docker.example`(플레이스홀더만).
- **`backend/.env`**(로컬 개발용, 레거시 `SUPABASE_*` 포함 — 현 인프라 미사용).
- **루트 `.env`**(docker-compose 변수 보간용) — `FRED_API_KEY`, `KITA_API_KEY` 정의. `docker-compose.yml`은 `${POSTGRES_PASSWORD:-portfolion}` 기본값으로 보간.
- **Telegram**(옵션): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — `.env.docker.example`엔 없고 `services/digest_service.py`가 `os.getenv`로만 읽음(미설정 시 다이제스트 발송 스킵).

## 배포 스택 (Mac 로컬 Docker)

- **컨테이너 4종**(`docker-compose.yml`):
  1. `postgres` — `postgres:16-alpine`, DB/USER `portfolion`, 볼륨 `pgdata`, 포트 5432, healthcheck `pg_isready`. 초기화 SQL 마운트(`auth_schema.sql`→01, `app_schema.sql`→02).
  2. `backend` — `build: ./backend`, `env_file: ./backend/.env.docker`, postgres healthy 대기.
  3. `nginx` — `nginx:alpine`, 포트 80/443. `frontend/dist`(`:ro`)·`nginx/nginx.conf`·`certbot/conf`·`certbot/www` 마운트.
  4. `certbot` — `certbot/certbot`, 12h마다 `certbot renew`.
- **nginx**(`nginx/nginx.conf`): HTTP(80) 서빙, `/api/` + `/health` → `http://backend:8000` 프록시. `index.html`·서비스워커 no-cache, 해시 정적자산 장기 캐시. 443 ssl 블록은 주석 처리(Cloudflare Tunnel이 TLS 종단).
- **배포 스크립트**(`deploy.sh`): ① 프론트 빌드(`npm install && npm run build`) ② `docker build -t portfolion-backend ./backend` ③ backend 컨테이너 `docker stop/rm/run`(⚠️ compose가 아닌 `docker run`이라 `docker compose ps`에 안 잡힘) ④ nginx 컨테이너 교체 ⑤ `curl localhost/health` 검증. 동시 배포 락 `/tmp/portfolion-deploy.lock`.
- **자동 배포 경로 = 2중화**:
  - **주**: self-hosted GitHub Actions 러너 — `.github/workflows/deploy.yml`(`on: push [main]`, `runs-on: self-hosted`, `git reset --hard origin/main` 후 `bash deploy.sh`). PortfoliOn 전용 러너 = `~/actions-runner-portfolion`(launchd `actions.runner.calmonion7-PortfoliOn.macbook-portfolion`).
  - **폴백**: 폴러 `scripts/auto-deploy-poll.sh` — launchd `com.portfolion.auto-deploy-poll`가 2분마다 실행, `LOCAL != origin/main`이면 `git reset --hard origin/main` 후 `deploy.sh`. ⚠️ push 안 한 로컬 커밋/편집은 다음 폴에서 reset으로 소실(commit+push 묶어 반영).
- **launchd 서비스**(`~/Library/LaunchAgents/`): `com.portfolion.auto-deploy-poll`(폴러), `com.portfolion.docker-compose`(compose 기동), `actions.runner.calmonion7-PortfoliOn.macbook-portfolion`(러너), `com.cloudflare.cloudflared`(터널).
- **Cloudflare Tunnel**: `portfolion.taebro.com` → `localhost:80`. cloudflared는 compose 컨테이너가 아니라 launchd로 실행.
- **프론트 서빙 특성**: nginx가 `frontend/dist`를 직접 서빙 → 로컬 `npm run build`가 즉시 라이브(배포 폴러와 무관). 백엔드 변경만 폴러 재배포 후 라이브.
- **로컬 실행**: `start.sh`/`start.bat`(양 서버), `stop.sh`/`stop.bat`.
