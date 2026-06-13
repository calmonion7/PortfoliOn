---
last_mapped_commit: 27346baec719306d5c2be8f259cc448ca4f64f4a
mapped: 2026-06-13
---

# STACK

PortfoliOn은 백엔드(Python/FastAPI)와 프론트엔드(React 18 + Vite)로 구성된 풀스택 앱이며, Mac 로컬 Docker 컨테이너로 배포된다.

## 언어 / 런타임

- **백엔드**: Python 3.12 (`backend/Dockerfile`의 베이스 이미지 `python:3.12-slim`). 코드 전반에서 `from __future__ import annotations`, `zoneinfo`(stdlib) 사용.
- **프론트엔드**: JavaScript(ESM, `frontend/package.json`의 `"type": "module"`). React 라이브러리는 `^19.2.5` 버전이 설치돼 있다(프로젝트 문서상 "React 18" 표기와 실제 설치 버전이 다름).
- **DB**: PostgreSQL 16 (`docker-compose.yml`의 `postgres:16-alpine`).

## 백엔드 프레임워크 / 주요 의존성 (`backend/requirements.txt`)

- `fastapi>=0.104.0` — 웹 프레임워크. 진입점 `backend/main.py`가 라우터를 마운트하고 `lifespan`에서 스케줄러를 기동한다.
- `uvicorn[standard]>=0.24.0` — ASGI 서버. 컨테이너 실행 커맨드는 `uvicorn main:app --host 0.0.0.0 --port 8000`(`backend/Dockerfile`).
- `apscheduler>=3.10.4` — 배치 스케줄러. `backend/scheduler.py`가 `AsyncIOScheduler` + `CronTrigger`로 배치(리포트 생성, 구루 크롤, 다이제스트, 시장지표 갱신, 레버리지/대차/수주잔고 수집, 랭킹/수급 적재)를 등록한다.
- `psycopg2-binary>=2.9.0` — PostgreSQL 드라이버. `backend/services/db.py`가 `ThreadedConnectionPool`(minconn=1, maxconn=10)로 커넥션 풀을 관리.
- `yfinance>=0.2.40`, `pandas>=2.1.0`, `numpy>=1.26.0` — 시세/재무 데이터 수집·가공.
- `requests>=2.31.0`, `httpx>=0.25.0` — 외부 HTTP 호출(requests는 동기 서비스, httpx는 `backend/routers/auth.py`의 OAuth async 흐름).
- `beautifulsoup4>=4.12.0`, `lxml>=4.9.0` — HTML/XML 파싱. (주의: `lxml`은 Docker 이미지엔 있으나 로컬 `.venv`엔 없어, 로컬 검증 코드는 `html.parser` 사용 — `CLAUDE.md` Gotchas.)
- `matplotlib>=3.8.0` — 차트 생성(`backend/services/charts.py`).
- `exchange_calendars>=4.5` — 거래일 캘린더.
- `authlib>=1.3.0` — OAuth 라이브러리(의존성에 포함). 다만 실제 OAuth 토큰 교환은 `backend/routers/auth.py`에서 `httpx` 직접 호출로 구현돼 있다.
- `python-jose[cryptography]>=3.3.0` — JWT 발급/검증(`backend/services/auth_service.py`의 `jose.jwt`, HS256).
- `bcrypt>=4.0.0` — 비밀번호 해싱(`backend/services/auth_service.py`).
- `itsdangerous>=2.0.0` — Starlette `SessionMiddleware` 의존.
- `python-dotenv` — `.env` 로딩(`backend/main.py` 최상단 `load_dotenv()`).
- `pytest>=7.4.0` — 테스트(`backend/tests/`).

### 미들웨어 (`backend/main.py`)

- `SessionMiddleware`(secret_key=`SESSION_SECRET`), `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`), `CORSMiddleware`.
- CORS allow_origins: `http://localhost:3000`, `http://localhost:5173`, `FRONTEND_URL` 환경변수(비어있지 않을 때만).

## 프론트엔드 프레임워크 / 주요 의존성 (`frontend/package.json`)

- 의존성: `react ^19.2.5`, `react-dom ^19.2.5`, `react-router-dom ^7.14.2`, `axios ^1.16.0`, `recharts ^3.8.1`(차트), `react-markdown ^10.1.0` + `remark-gfm ^4.0.1`(리포트 텍스트 렌더).
- 빌드/개발 도구(devDependencies): `vite ^8.0.10`, `@vitejs/plugin-react ^6.0.1`, `eslint ^10.2.1`(+ `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`), `@types/react`, `@types/react-dom`.
- **PWA**: `vite-plugin-pwa ^1.3.0` + `@vite-pwa/assets-generator ^1.0.2`. 설정은 `frontend/vite.config.js`의 `VitePWA`(registerType `autoUpdate`, Workbox runtimeCaching — google-fonts/cdn-fonts CacheFirst, `/api/` NetworkFirst(auth 제외), manifest name "PortfoliOn"). 빌드 후 커스텀 `sw-cache-bust` 플러그인이 `registerSW.js`/`manifest.webmanifest`/`sw.js`에 빌드 타임스탬프 쿼리를 붙여 캐시 버스팅.
- 플레인 CSS(TailwindCSS 미사용).

### Vite 설정 (`frontend/vite.config.js`)

- dev 서버 포트 5173, `/api` → `http://localhost:8000` 프록시(`changeOrigin: true`), `watch.usePolling: true`.
- 빌드 산출물은 `frontend/dist/`(nginx가 직접 서빙).

## 패키지 매니저 / 스크립트

- **백엔드**: pip + `backend/requirements.txt`. 로컬 가상환경 `backend/.venv/`(macOS: `backend/.venv/bin/python`). 테스트: `cd backend && .venv/bin/python -m pytest`.
- **프론트엔드**: npm + `frontend/package.json`. 스크립트: `dev`(vite), `build`(vite build), `lint`(eslint .), `preview`(vite preview).
- **양 서버 동시 기동**: `start.sh`(macOS/Linux), `start.bat`(Windows, hidden PowerShell), `stop.sh`/`stop.bat`.

## 배포 — Docker 컨테이너 (`docker-compose.yml`)

`docker-compose.yml`에 정의된 서비스:

- **postgres** — `postgres:16-alpine`, DB/USER `portfolion`, 패스워드 `${POSTGRES_PASSWORD}`(기본값 보간). 포트 5432 노출. 볼륨 `pgdata`. 초기화 시 `backend/auth_schema.sql`(01-auth.sql) → `backend/app_schema.sql`(02-app.sql)을 `docker-entrypoint-initdb.d`로 마운트해 순서대로 실행. `pg_isready` healthcheck.
- **backend** — `./backend` 빌드(`backend/Dockerfile`). postgres healthy 조건 후 기동. `env_file: ./backend/.env.docker`.
- **nginx** — `nginx:alpine`, 포트 80/443. `./frontend/dist`를 `:ro`로 직접 서빙, `./nginx/nginx.conf` 마운트, certbot 볼륨(`./certbot/conf`, `./certbot/www`) 마운트. `/api/` 및 `/health` → `http://backend:8000` 프록시(`nginx/nginx.conf`).
- **certbot** — `certbot/certbot` 이미지. 12시간마다 `certbot renew` 루프.

`README.md`/`CLAUDE.md`는 "4-컨테이너(postgres, backend, nginx, cloudflared)"로 기술하지만, `docker-compose.yml`에 정의된 서비스는 postgres/backend/nginx/certbot이다. **cloudflared(Cloudflare Tunnel)와 docker compose는 launchd로 별도 자동실행**되며 compose 파일에는 포함돼 있지 않다(`CLAUDE.md` Deployment).

- **외부 노출**: Cloudflare Tunnel `portfolion.taebro.com → localhost:80`(launchd 자동실행). DDNS 갱신 스크립트 `scripts/ddns_update.sh`(Cloudflare API, `CF_ZONE_ID`/`CF_RECORD_ID`/`CF_API_TOKEN` 환경변수, cron 5분).
- **자동 배포**: launchd `com.portfolion.auto-deploy-poll`이 2분마다 `scripts/auto-deploy-poll.sh`를 돌려 `origin/main`이 로컬 HEAD보다 앞서면 `git reset --hard origin/main` 후 `deploy.sh` 배포. `deploy.sh`는 frontend 빌드 → backend 이미지 빌드 → 컨테이너 교체 순(동시 배포 방지 락 `/tmp/portfolion-deploy.lock`).

## 스케줄러 (APScheduler — `backend/scheduler.py`)

`AsyncIOScheduler`가 `backend/main.py`의 `lifespan`에서 기동(`sched.start()`)·종료(`sched.stop()`)된다. 배치 정의는 `backend/services/batch_registry.py`, 스케줄 스펙은 `backend/services/schedule_spec.py`로 관리. 등록 잡(`_JOB_FUNCS`): `daily_report`, `guru_crawl`, `daily_digest`, `earnings_refresh`, `monthly_refresh`, `leverage_fetch`, `lending_fetch`, `kr_rankings_fetch`, `us_rankings_fetch`, `investor_trend_fetch`, `backlog_fetch`. 기동 시 누락 리포트 복구(`_check_missed_report`)·빈 랭킹 시드(`_seed_rankings_if_empty`)·idempotent 마이그레이션 시드(`_seed_batch_schedules`) 수행. 잡 실행 기록은 `backend/services/job_runs.py`(`job_runs` 테이블).

## 런타임 기동 마이그레이션 (`backend/main.py` `_migrate()`)

기동 시 idempotent DDL을 실행한다(배포가 자동 적용): `backlog_history`에 `segments JSONB` 컬럼 추가(IF NOT EXISTS), `batch_schedules` 테이블 생성(IF NOT EXISTS). 또한 `_warm_calendar_cache`/`_warm_market_cache`를 데몬 스레드로 워밍업.

## 설정 파일 / 환경변수

- 설정 파일: `backend/.env.docker`(docker compose `env_file`), 루트 `.env`(compose 변수 보간용), `backend/Dockerfile`, `docker-compose.yml`, `nginx/nginx.conf`, `frontend/vite.config.js`, `frontend/eslint.config.js`(eslint flat config 추정).
- 스키마: `backend/auth_schema.sql`, `backend/app_schema.sql`.

### `backend/.env.docker`에 설정된 환경변수 (이름만)

`DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `FRED_API_KEY`, `KITA_API_KEY`, `KOFIA_API_KEY`, `DART_API_KEY`, `FRONTEND_URL`, `COWORK_API_KEY`.

### 코드가 참조하지만 `.env.docker`에 없는 환경변수 (이름만)

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — `backend/services/digest_service.py`의 `send_telegram`이 `os.getenv`로 조회(미설정 시 전송 스킵).
- `POSTGRES_PASSWORD` — 루트 `.env`에서 compose 변수 보간(`docker-compose.yml`).
- `CF_ZONE_ID`, `CF_RECORD_ID`, `CF_API_TOKEN` — `scripts/ddns_update.sh` 전용.
- `VITE_API_BASE_URL` — 프론트 빌드 시 nginx 직접 호출용(미설정 시 상대경로, `CLAUDE.md`).
