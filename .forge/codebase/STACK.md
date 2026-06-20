---
last_mapped_commit: 53b30e71425b810f8ce3edc33b2767b1be2e242c
mapped: 2026-06-20
---

# STACK

PortfoliOn의 기술 스택 — 백엔드(Python/FastAPI), 프론트엔드(React/Vite), Docker 배포 인프라, 빌드 도구, 설정 파일. 버전은 실제 파일(`backend/requirements.txt`, `frontend/package.json`, `backend/Dockerfile`)에서 확인했다. (외부 API·DB·인증 연동 상세는 `INTEGRATIONS.md`.)

## Languages & Runtimes

| 항목 | 값 | 출처 |
|------|-----|------|
| 백엔드 언어 | Python | — |
| 백엔드 런타임 (Docker) | **Python 3.12-slim** | `backend/Dockerfile` (`FROM python:3.12-slim`) |
| 백엔드 런타임 (로컬 .venv) | **Python 3.9.6** | `backend/.venv/pyvenv.cfg` (`version = 3.9.6`) |
| 프론트 언어 | JavaScript (ESM, `"type": "module"`) | `frontend/package.json` |
| DB | PostgreSQL 16 (alpine) | `docker-compose.yml` (`postgres:16-alpine`) |

README 명시 최소 버전: Python 3.9+, Node.js 18+, Docker 24+ (`README.md` 개발 환경 요구사항).

⚠️ **로컬 .venv(3.9.6)와 Docker 런타임(3.12) 불일치** — 로컬 pytest 검증과 운영 동작이 갈릴 수 있다. 특히 로컬 `.venv`에는 `lxml`이 없다(`requirements.txt`엔 있고 Docker엔 설치됨). HTML 파싱 코드/테스트는 `BeautifulSoup(html, "html.parser")`(stdlib)를 쓸 것.

## Backend Framework & Dependencies

진입점 `backend/main.py` (FastAPI app, uvicorn, port 8000). app은 `FastAPI(title="Stock Portfolio Manager", lifespan=...)`이며 `lifespan`이 기동 시 `_migrate()`(idempotent DDL — `CREATE TABLE/ADD COLUMN IF NOT EXISTS`) → `scheduler.start()` → 캘린더·시장 캐시 워밍 스레드를 실행한다. 스케줄러는 `backend/scheduler/` 패키지(`__init__.py`/`_state.py`/`jobs.py`/`schedule.py`)로 분리됨.

`backend/requirements.txt` (모두 `>=` 하한 핀, 상한 없음):

| 패키지 | 핀 | 용도 |
|--------|-----|------|
| `fastapi` | >=0.104.0 | 웹 프레임워크 |
| `uvicorn[standard]` | >=0.24.0 | ASGI 서버 |
| `apscheduler` | >=3.10.4 | 배치 스케줄러 (`backend/scheduler/`) |
| `yfinance` | >=0.2.40 | US 시세/재무/히스토리 (1차 소스) |
| `pandas` | >=2.1.0 | 데이터 처리 |
| `numpy` | >=1.26.0 | 수치 연산 |
| `matplotlib` | >=3.8.0 | 차트 렌더 (`backend/services/charts.py` 단독 사용) |
| `requests` | >=2.31.0 | 동기 HTTP (대부분의 외부 API 호출) |
| `beautifulsoup4` | >=4.12.0 | HTML 파싱 (DART 원문, 스크레이퍼, FnGuide) |
| `lxml` | >=4.9.0 | BS4 파서 백엔드 (Docker만; 로컬 .venv 없음) |
| `httpx` | >=0.25.0 | 비동기 HTTP (OAuth 토큰 교환 `backend/routers/auth.py`) |
| `pytest` | >=7.4.0 | 테스트 (`backend/tests/`) |
| `exchange_calendars` | >=4.5 | 거래소 캘린더 (`backend/routers/calendar.py`) |
| `psycopg2-binary` | >=2.9.0 | PostgreSQL 드라이버 (`backend/services/db.py`, ThreadedConnectionPool) |
| `authlib` | >=1.3.0 | OAuth (선언; auth.py는 직접 httpx/jose 사용) |
| `python-jose[cryptography]` | >=3.3.0 | JWT (HS256, `backend/services/auth_service.py`) |
| `bcrypt` | >=4.0.0 | 비밀번호 해시 (`auth_service.py`) |
| `itsdangerous` | >=2.0.0 | 세션 서명 (starlette SessionMiddleware) |
| `python-dotenv` | (핀 없음) | `.env` 로딩 (`main.py` `load_dotenv()`) |

**LLM 의존성 없음** — `requirements.txt`에 `anthropic` 등 LLM SDK 부재. AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성한다(`CLAUDE_COWORK_API.md`). 백엔드 `report_generator`는 시장 데이터 스냅샷만 생성.

DB 접근: `backend/services/db.py` — `psycopg2` `ThreadedConnectionPool`(minconn=1, maxconn=20), `RealDictCursor`, `DATABASE_URL` 환경변수 DSN.

스키마 파일: `backend/auth_schema.sql`(users, refresh_tokens) → `backend/app_schema.sql`(앱 테이블) 순서. docker-compose가 `/docker-entrypoint-initdb.d/01-auth.sql`·`02-app.sql`로 마운트해 빈 DB 최초 1회 init. 이후 신규 테이블/컬럼은 `main._migrate()`의 `CREATE TABLE IF NOT EXISTS`가 정본.

### 배치 레지스트리 (`backend/services/batch_registry.py`)

`BATCHES` 리스트가 **26개 배치**의 정적 메타데이터(`id`·`label`·`category`·`source`·`usage`·`market`(KR/US/공통)·`default_schedule`)를 정의하며 `GET /api/batches`가 그대로 노출한다. `source`(데이터 fetch 출처) ≠ `usage`(소비 UI). 배치 ID는 `scheduler` 잡 id 및 `services.job_runs.record` 호출 id와 일치해야 한다. 배치별 데이터 소스·게이팅 키·스케줄 상세는 `INTEGRATIONS.md` 참고.

## Frontend Framework & Dependencies

`frontend/package.json`. 빌드는 `vite build`, 개발은 `vite`, 린트는 `eslint .`, 미리보기는 `vite preview`.

dependencies:

| 패키지 | 핀 | 용도 |
|--------|-----|------|
| `react` / `react-dom` | ^19.2.5 | **React 19** |
| `react-router-dom` | ^7.14.2 | 라우팅 (React Router v7) |
| `axios` | ^1.16.0 | HTTP 클라이언트 (`frontend/src/api.js`) |
| `recharts` | ^3.8.1 | 차트 (`charts` 청크로 분리) |
| `react-markdown` | ^10.1.0 | 마크다운 렌더 (`markdown` 청크) |
| `remark-gfm` | ^4.0.1 | GFM 마크다운 |

devDependencies:

| 패키지 | 핀 | 용도 |
|--------|-----|------|
| `vite` | **^8.0.10** | 번들러 (Vite 8 = rolldown, 아래 주의) |
| `@vitejs/plugin-react` | ^6.0.1 | React 플러그인 |
| `vite-plugin-pwa` | ^1.3.0 | PWA (서비스워커/매니페스트) |
| `@vite-pwa/assets-generator` | ^1.0.2 | PWA 아이콘 생성 |
| `eslint` | ^10.2.1 | 린터 (flat config `eslint.config.js`) |
| `@eslint/js` | ^10.0.1 | ESLint core |
| `eslint-plugin-react-hooks` | ^7.1.1 | hooks 린트 |
| `eslint-plugin-react-refresh` | ^0.5.2 | refresh 린트 |
| `@types/react` / `@types/react-dom` | ^19.2.x | 타입 |
| `globals` | ^17.5.0 | 린트 globals |

스타일: plain CSS (TailwindCSS 없음). 색 토큰은 `frontend/src/styles/tokens.css`(KR 관례: `--up`=빨강/상승, `--down`=파랑/하락).

⚠️ **Vite 8 = rolldown 번들러** — `vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 받는다(객체형 쓰면 `Expected Function but received Object`로 빌드 깨짐). `manualChunks(id)`가 `node_modules` 경로 substring으로 `charts`(recharts/d3/victory-vendor) · `markdown`(react-markdown/remark/micromark/mdast/hast 등 트랜지티브) · `vendor`로 3분할.

## Frontend Build & Dev Config

`frontend/vite.config.js`:
- **dev server** port 5173, `/api` → `http://localhost:8000` 프록시 (`changeOrigin`), watch는 `usePolling` interval 500ms.
- **PWA** (`VitePWA`): `registerType: 'autoUpdate'`, `injectRegister: 'auto'`, `skipWaiting`/`clientsClaim`, manifest(`name: PortfoliOn`, `display: standalone`, `lang: ko`, `theme_color: #f6f6f4`), runtime caching(google-fonts CacheFirst, cdn-fonts CacheFirst, `/api/*` NetworkFirst(5분 TTL) 단 `/api/auth/*` 제외). `cacheId`/`globPatterns`는 빌드 타임스탬프 버스팅.
- **커스텀 플러그인** `sw-cache-bust` (closeBundle post) — `BUILD_DATE` 쿼리스트링을 `dist/index.html`(registerSW.js·manifest.webmanifest)·`dist/registerSW.js`(sw.js)에 부착해 캐시 버스팅.

프론트→백엔드 base URL (`frontend/src/api.js`): `axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '' })` — 미설정 시 상대경로(로컬은 Vite 프록시, 배포는 nginx 동일 origin). request 인터셉터가 `localStorage.access_token`을 `Authorization: Bearer`로 첨부, response 인터셉터가 401 시 토큰 제거 후 `/`로 리다이렉트. `frontend/src/contexts/AuthContext`가 로그인 시 role + 메뉴 권한을 로드해 nav 필터링.

## Docker Deployment

`docker-compose.yml` — version "3.9". 컨테이너 4종 + 볼륨 `pgdata`:

| 서비스 | 이미지/빌드 | 포트 | 비고 |
|--------|-------------|------|------|
| `postgres` | `postgres:16-alpine` | 5432 | DB `portfolion`, `pgdata` 볼륨, healthcheck `pg_isready`, 스키마 자동 init 마운트(`01-auth.sql`/`02-app.sql`) |
| `backend` | `build: ./backend` (`backend/Dockerfile`) | 8000(내부) | `env_file: ./backend/.env.docker`, postgres healthy 의존 |
| `nginx` | `nginx:alpine` | 80, 443 | `./frontend/dist`를 `:ro`로 직접 서빙, `./nginx/nginx.conf` 마운트, certbot 볼륨 마운트 |
| `certbot` | `certbot/certbot` | — | `certbot renew` 12h 루프 |

**backend Dockerfile** (`backend/Dockerfile`): `python:3.12-slim` → `pip install -r requirements.txt` → CMD `uvicorn main:app --host 0.0.0.0 --port 8000`.

**nginx** (`nginx/nginx.conf`): HTTP(80) 서빙. `/api/`·`/health` → `http://backend:8000` 프록시. `/.well-known/acme-challenge/` → certbot. `index.html`/`sw.js`/`workbox-*.js`는 no-cache, Vite 해시 파일(js/css/img/woff2)은 1년 immutable. 443 SSL 블록은 주석 처리됨.

**프론트 서빙**: nginx가 `frontend/dist`를 볼륨마운트로 직접 서빙 → 로컬 `cd frontend && npm run build`가 즉시 라이브(서빙 번들 해시=로컬 빌드 해시). 백엔드 변경은 자동배포 폴러 재배포 후 라이브.

**Cloudflare Tunnel**: `portfolion.taebro.com` → `localhost:80`. cloudflared는 compose 컨테이너가 아니라 **launchd**로 실행. docker compose도 launchd 자동실행.

**자동 배포 폴러**: launchd `com.portfolion.auto-deploy-poll`이 2분마다 `scripts/auto-deploy-poll.sh` 실행 → `origin/main`이 로컬 HEAD보다 앞서면 `git reset --hard origin/main` 후 배포. (배포는 `git push origin main`; 수동 `docker compose build/up` 금지.) → 커밋 안 한 tracked 편집은 다음 폴(≤2분)에 소실, `.forge/` 등 untracked는 안전.

## 서버 기동 (로컬 개발)

- 양쪽 동시: `./start.sh`(macOS/Linux) / `start.bat`(Windows). 두 스크립트 모두 8000·5173 포트 기존 프로세스를 kill 후 백엔드(uvicorn)·프론트(`npm run dev`)를 백그라운드 기동하고 `/health`·5173 응답을 폴링한 뒤 브라우저를 연다. 로그: `/tmp/portfolion-{backend,frontend}.log`(mac) / `%TEMP%`(win). 종료: `stop.bat`(win).
- 백엔드 단독: `cd backend && .venv/bin/python -m uvicorn main:app --reload --port 8000` (start.sh는 `source .venv/bin/activate` 후 `uvicorn main:app --reload --port 8000`).
- 프론트 단독: `cd frontend && npm run dev`. 빌드: `npm run build`(→ `frontend/dist`). lint: `npm run lint`. preview: `npm run preview`.
- 백엔드 테스트: `cd backend && .venv/bin/python -m pytest`.

## Config & Key Files

| 파일 | 역할 |
|------|------|
| `backend/.env.docker` | 백엔드 환경변수(시크릿 — 값 비기재; 키 목록은 INTEGRATIONS.md) |
| `.env` (루트) | docker-compose 변수 보간용 (`POSTGRES_PASSWORD` 등) |
| `backend/auth_schema.sql` / `backend/app_schema.sql` | PostgreSQL 스키마 (auth → app 순서) |
| `backend/Dockerfile` | 백엔드 이미지 빌드 |
| `docker-compose.yml` | 4-컨테이너 정의 |
| `nginx/nginx.conf` | 리버스 프록시/정적 서빙 |
| `frontend/vite.config.js` | Vite 빌드/dev/PWA/청크 설정 |
| `frontend/eslint.config.js` | ESLint flat config |
| `API_SPEC.md` | 전체 REST API 레퍼런스 |
| `CLAUDE_COWORK_API.md` | 외부 Cowork API 명세 |
| `KIWOOM_API.md` / `KIS_API.md` | 키움/KIS API 카탈로그·로드맵 |
| `start.sh` / `start.bat` / `stop.bat` | 로컬 두 서버 기동/종료 |

## Backend Module Layout (참고)

- `backend/routers/` — auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin (`main.py` include 순).
- `backend/services/` — storage(pkg), market(pkg: `__init__`/`format`/`kr`/`us`), market_indicators(pkg), kiwoom(pkg), kis(pkg), recommendation(pkg). 스케줄러는 `backend/scheduler/`(루트). 그 외 다수 단일 모듈(cache, db, auth_service, charts, indicators, report_generator, scraper, consensus, consensus_pipeline, guru_scraper, guru_stats, digest_service, leverage_service, lending_service, analysis_service, kr_sector_service, ranking_service, investor_service, short_sell_service, insider_trades, dividends, disclosures, backlog, backlog_parser, supply_score, batch_registry, job_runs, schedule_spec, parallel, progress, errors, utils).
