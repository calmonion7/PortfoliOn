---
last_mapped_commit: 1bbea86804f93c6f544092809ff8ed13977e5975
mapped: 2026-06-06
---

# 기술 스택 (STACK)

PortfoliOn은 Python/FastAPI 백엔드와 React/Vite 프론트엔드로 구성된 풀스택 애플리케이션이며, Mac 로컬 Docker 4-컨테이너(postgres, backend, nginx, certbot)로 배포된다.

## 언어 및 런타임

- **백엔드 언어**: Python. 컨테이너 베이스 이미지는 `python:3.12-slim` (`backend/Dockerfile`). 별도의 `.python-version`이나 `runtime.txt`는 없다.
- **프론트엔드 언어**: JavaScript (JSX, ESM). `frontend/package.json`에 `"type": "module"`로 명시.
- **DB 런타임**: PostgreSQL 16 (`postgres:16-alpine`, `docker-compose.yml`).
- **리버스 프록시**: nginx (`nginx:alpine`, `docker-compose.yml`).

## 백엔드 프레임워크 및 주요 의존성

의존성은 `backend/requirements.txt`에 정의된다. `pyproject.toml`은 없다.

- **웹 프레임워크**: `fastapi>=0.104.0`
- **ASGI 서버**: `uvicorn[standard]>=0.24.0` — 기동 명령은 `uvicorn main:app --host 0.0.0.0 --port 8000` (`backend/Dockerfile`)
- **스케줄러**: `apscheduler>=3.10.4` — `AsyncIOScheduler` 사용 (`backend/scheduler.py`)
- **시장 데이터**: `yfinance>=0.2.40`
- **데이터 처리**: `pandas>=2.1.0`, `numpy>=1.26.0`
- **차트 생성**: `matplotlib>=3.8.0`
- **HTTP 클라이언트**: `requests>=2.31.0` (동기), `httpx>=0.25.0` (비동기 — OAuth 토큰 교환 등 `backend/routers/auth.py`)
- **HTML 파싱/스크래핑**: `beautifulsoup4>=4.12.0`, `lxml>=4.9.0`
- **거래소 캘린더**: `exchange_calendars>=4.5`
- **PostgreSQL 드라이버**: `psycopg2-binary>=2.9.0` — `ThreadedConnectionPool`(minconn=1, maxconn=10) 사용 (`backend/services/db.py`)
- **인증/보안**: `authlib>=1.3.0`, `python-jose[cryptography]>=3.3.0` (HS256 JWT 디코드, `backend/auth.py`), `bcrypt>=4.0.0` (비밀번호 해시), `itsdangerous>=2.0.0` (세션 서명)
- **환경변수 로딩**: `python-dotenv` — `backend/main.py` 최상단에서 `load_dotenv()` 호출
- **테스트**: `pytest>=7.4.0` — 테스트는 `backend/tests/`에 위치

## 프론트엔드 프레임워크 및 주요 의존성

의존성은 `frontend/package.json`에 정의된다.

- **UI 프레임워크**: `react@^19.2.5`, `react-dom@^19.2.5`
- **라우팅**: `react-router-dom@^7.14.2`
- **HTTP 클라이언트**: `axios@^1.16.0` — 인스턴스 생성은 `frontend/src/api.js`
- **차트**: `recharts@^3.8.1`
- **마크다운 렌더링**: `react-markdown@^10.1.0`, `remark-gfm@^4.0.1`
- **스타일링**: plain CSS (TailwindCSS 미사용)

## 빌드 도구 및 설정 파일

- **번들러/개발 서버**: Vite (`vite@^8.0.10`), 설정 파일 `frontend/vite.config.js`.
  - 개발 서버 포트 5173, `/api` 요청을 `http://localhost:8000`으로 프록시 (`server.proxy`).
  - 파일 감시는 polling 모드(`usePolling: true`, interval 500ms).
- **React 플러그인**: `@vitejs/plugin-react@^6.0.1`
- **PWA**: `vite-plugin-pwa@^1.3.0` + `@vite-pwa/assets-generator@^1.0.2`.
  - `VitePWA`로 service worker(autoUpdate), Workbox 런타임 캐시 정의(`frontend/vite.config.js`): Google Fonts/jsDelivr는 CacheFirst, `/api/*`(단 `/api/auth/*` 제외)는 NetworkFirst.
  - 커스텀 `sw-cache-bust` 플러그인이 빌드 후 `dist/index.html`·`registerSW.js`에 빌드 타임스탬프 쿼리스트링을 주입해 캐시 무효화.
- **린터**: ESLint (`eslint@^10.2.1`), 플러그인 `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`.
- **프론트엔드 스크립트** (`frontend/package.json`): `dev`(vite), `build`(vite build), `lint`(eslint), `preview`(vite preview).
- **빌드 산출물**: `frontend/dist`를 nginx 컨테이너가 `/usr/share/nginx/html`로 read-only 마운트 (`docker-compose.yml`).

## 컨테이너 및 인프라 설정 파일

- **`docker-compose.yml`** — 4개 서비스 정의:
  - `postgres` (PostgreSQL 16): `pgdata` 볼륨, 초기화 SQL을 `/docker-entrypoint-initdb.d/`로 마운트 — `backend/auth_schema.sql`(01) → `backend/app_schema.sql`(02) 순서, `pg_isready` healthcheck, 5432 포트 노출.
  - `backend`: `./backend` 빌드, postgres healthy 조건 의존, `env_file: ./backend/.env.docker`.
  - `nginx`: 80/443 포트, `frontend/dist`·`nginx/nginx.conf`·`certbot/conf`·`certbot/www` 마운트.
  - `certbot`: Let's Encrypt 인증서 자동 갱신(12시간 주기 `certbot renew`).
- **`backend/Dockerfile`** — `python:3.12-slim` 기반, requirements 설치 후 uvicorn 기동.
- **`nginx/nginx.conf`** — HTTP(80) 서빙. `/api/`·`/health`를 `http://backend:8000`으로 프록시. `index.html`/service worker는 캐시 금지, Vite 해시 정적 파일은 1년 immutable 캐시. 443 SSL 블록은 주석 처리됨.

## 환경변수

값은 비밀이므로 변수명과 용도만 기술한다.

### 백엔드 (`backend/.env.docker`, 템플릿: `backend/.env.docker.example`, 로컬 `backend/.env`)

- `DATABASE_URL` — PostgreSQL DSN (`backend/services/db.py`에서 커넥션 풀 생성에 사용)
- `POSTGRES_PASSWORD` — `docker-compose.yml`의 postgres 컨테이너 비밀번호 보간용
- `JWT_SECRET` — HS256 JWT 서명/검증 키 (`backend/auth.py`, `backend/services/auth_service.py`, `backend/middleware/event_tracker.py`)
- `SESSION_SECRET` — Starlette `SessionMiddleware` 서명 키 (`backend/main.py`), OAuth state HMAC (`backend/routers/auth.py`)
- `FRONTEND_URL` — CORS 허용 오리진 및 OAuth redirect_uri 베이스 (`backend/main.py`, `backend/routers/auth.py`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth (`backend/routers/auth.py`)
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — GitHub OAuth (`backend/routers/auth.py`)
- `COWORK_API_KEY` — 외부 Claude Cowork용 `X-API-Key` 검증 키 (`backend/auth.py`)
- `ANTHROPIC_API_KEY` — `backend/.env.docker.example` 및 문서에서 리포트 생성용으로 명시되나, 현재 `backend/` 파이썬 코드에서 직접 참조하는 곳은 없음(외부 Claude Cowork가 소비하는 것으로 추정)
- `FRED_API_KEY` — FRED 경제지표 API (`backend/services/market_indicators/econ.py`)
- `KITA_API_KEY` — 실제로는 관세청(Korea Customs Service) API 키 (`backend/services/market_indicators/exports.py`)
- `KOFIA_API_KEY` — 공공데이터포털 KOFIA 통계·대차잔고 API (`backend/services/leverage_service.py`, `backend/services/lending_service.py`, `backend/run_backfill.py`)
- `DART_API_KEY` — DART 수주잔고 OpenAPI (`backend/services/backlog.py`)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — 일일 다이제스트 텔레그램 발송 (`backend/services/digest_service.py`, 미설정 시 발송 생략)

### 프론트엔드 (`frontend/.env`)

- `VITE_API_BASE_URL` — API 베이스 URL. 미설정 시 상대경로 사용 (`frontend/src/api.js`, `frontend/src/App.jsx`, `frontend/src/pages/LoginPage.jsx`)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — `frontend/.env`에 키만 존재(빈 값). Supabase는 인프라에서 제거되어 현재 소스에서 사용되지 않는 잔존 변수

### 루트 (`.env`, docker-compose 보간용)

- `FRED_API_KEY`, `KITA_API_KEY` — docker-compose 변수 보간 컨텍스트용으로 루트 `.env`에도 키 존재

### 배포/DDNS 스크립트 (`scripts/ddns_update.sh`)

- `CF_ZONE_ID`, `CF_RECORD_ID`, `CF_API_TOKEN` — Cloudflare DNS A 레코드 갱신용(현행 배포는 Cloudflare Tunnel 사용, 본 스크립트는 대체 DDNS 경로)
