---
last_mapped_commit: 4bb49ff0402c150884f2fa9c80dfed8dff1945d5
mapped: 2026-07-29
---

# STACK — 기술 스택 · 빌드 · 실행

PortfoliOn의 언어/런타임, 의존성, 빌드·설정 파일, 실행/테스트 커맨드, 배포 토폴로지를 담는다.
외부 API 연동·DB 테이블·인증 제공자는 `.forge/codebase/INTEGRATIONS.md`를 볼 것.

---

## 1. 언어 · 런타임 버전

| 영역 | 런타임 | 근거 파일 |
|---|---|---|
| 백엔드 (프로덕션) | Python **3.12-slim** | `backend/Dockerfile` (`FROM python:3.12-slim`) |
| 백엔드 (로컬 venv) | Python **3.9.6** | `backend/.venv/` — `backend/.venv/bin/python --version` |
| 프론트엔드 | Node **v24.15.0** / npm 11.12.1 (개발 머신 실측) | — |
| DB | PostgreSQL **16-alpine** | `docker-compose.yml` (`image: postgres:16-alpine`) |
| 리버스 프록시 | nginx **alpine** | `docker-compose.yml`, `deploy.sh` |

> **로컬 3.9 ↔ 컨테이너 3.12 격차가 하드 제약이다.** 런타임 평가되는 어노테이션(Pydantic 모델·FastAPI 시그니처)에 PEP604 `X | None`을 쓰면 로컬 pytest가 `TypeError`로 깨진다 → `Optional[X]`를 쓸 것. 또 `lxml`은 `backend/requirements.txt`에 있고 이미지엔 설치되지만 로컬 `.venv`엔 없다 → 로컬 pytest가 지나는 HTML 파싱은 `BeautifulSoup(html, "html.parser")`. 같은 패키지의 *버전차*도 API 형태를 바꾼다(이미지 FastAPI 0.138.1은 `include_router`된 라우트를 `_IncludedRouter`로 감싸 `app.routes`에 평탄히 노출하지 않는다 — `routes`와 `original_router`를 함께 재귀 하강해야 열거된다).

---

## 2. 백엔드 프레임워크 · 의존성

정본: `backend/requirements.txt` (핀 없음, 모두 `>=` 하한만)

| 패키지 | 역할 | 주 사용처 |
|---|---|---|
| `fastapi>=0.104.0` | REST 프레임워크 | `backend/main.py`, `backend/routers/*` |
| `uvicorn[standard]>=0.24.0` | ASGI 서버 | `backend/Dockerfile` CMD, `start.sh` |
| `apscheduler>=3.10.4` | 배치 스케줄러 | `backend/scheduler/__init__.py`, `backend/scheduler/schedule.py` |
| `yfinance>=0.2.40` | US 시세·재무·히스토리 1차 소스 | `backend/services/market/us.py` 외 다수 (§INTEGRATIONS) |
| `pandas>=2.1.0` / `numpy>=1.26.0` | 시계열·지표 계산 | `backend/services/indicators.py`, `backend/services/analysis_service.py`, `backend/services/kr_sector_service.py` |
| `requests>=2.31.0` | 모든 외부 HTTP(REST/스크레이핑) | `backend/services/kiwoom/client.py`, `backend/services/kis/client.py`, `backend/services/market/kr.py` 등 |
| `beautifulsoup4>=4.12.0` | HTML 파싱 | `backend/services/backlog.py`, `backend/services/market_indicators/indices.py`, `backend/services/guru_scraper.py`, `backend/services/scraper.py` |
| `lxml>=4.9.0` | BS4 파서 백엔드 (**컨테이너에만 존재**) | 위와 동일 |
| `httpx>=0.25.0` | 비동기 HTTP (OAuth 토큰 교환) | `backend/routers/auth.py` |
| `exchange_calendars>=4.5` | 거래소 휴장일 달력 | `backend/routers/calendar.py` (`import exchange_calendars as xcals`) |
| `psycopg2-binary>=2.9.0` | PostgreSQL 드라이버 + `ThreadedConnectionPool` | `backend/services/db.py` |
| `authlib>=1.3.0` | OAuth 클라이언트 유틸 | `backend/routers/auth.py` |
| `python-jose[cryptography]>=3.3.0` | JWT 인코딩/디코딩(HS256) | `backend/services/auth_service.py` |
| `bcrypt>=4.0.0` | 비밀번호 해시 | `backend/services/auth_service.py` |
| `itsdangerous>=2.0.0` | starlette `SessionMiddleware` 서명 | `backend/main.py` |
| `python-dotenv` | `.env` 로드 | `backend/main.py` (`load_dotenv`) |
| `pytest>=7.4.0` | 테스트 러너 | `backend/tests/` (128 파일) |

**LLM 의존성 없음** — `anthropic` 등 LLM SDK는 requirements에 없다. 백엔드는 시장 데이터 스냅샷만 만들고, AI 분석 텍스트는 외부 클라이언트가 enrich API로 써넣는다.

### 백엔드 구조 (패키지)

```
backend/
  main.py                     앱 엔트리 — _configure_logging() → _migrate() → 라우터 18개 include
  auth.py                     인증 의존성 (get_current_user / require_admin / *_or_api_key)
  run_backfill.py             수급지표 백필 CLI
  app_schema.sql              앱 스키마 (신규 설치용)
  auth_schema.sql             인증 스키마 (app_schema.sql보다 먼저 실행)
  supabase_schema.sql         레거시(미사용)
  Dockerfile
  pytest.ini
  routers/                    19개 (admin analysis analyst_reports analytics auth batches calendar
                              digest events guru investor market_indicators portfolio rankings
                              recommendations report short_sell stocks watchlist)
  services/                   도메인 서비스 + 하위 패키지 kis/ kiwoom/ market/ market_indicators/
                              recommendation/ storage/
  scheduler/                  루트 레벨 패키지 (__init__.py=배선·_JOB_FUNCS, jobs.py, schedule.py, _state.py)
  middleware/                 event_tracker.py
  data/                       정적 참조 데이터 + 로컬 파일 캐시 (§4)
  tests/                      128 파일
```

`backend/main.py`가 `include_router` 하는 순서(라우터 등록 누락 감지용): auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, analyst_reports, admin.

미들웨어 스택(`backend/main.py`): `SessionMiddleware`(`SESSION_SECRET`) → `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`) → `CORSMiddleware`. `RequestValidationError` 커스텀 핸들러가 검증 에러 detail을 `services.utils.sanitize`로 감싸 NaN echo에 의한 422→500 전이를 막는다.

---

## 3. 프론트엔드 프레임워크 · 의존성

정본: `frontend/package.json`

**dependencies**

| 패키지 | 버전 | 역할 |
|---|---|---|
| `react` / `react-dom` | ^19.2.5 | UI 런타임 |
| `react-router-dom` | ^7.14.2 | 라우팅 (`frontend/src/routes.js`, `frontend/src/App.jsx`) |
| `recharts` | ^3.8.1 | 모든 차트 (`frontend/src/components/market/*`, `frontend/src/components/reports/*`) |
| `axios` | ^1.16.0 | HTTP 클라이언트 (`frontend/src/api.js`) |

**devDependencies**

| 패키지 | 버전 | 역할 |
|---|---|---|
| `vite` | ^8.0.10 | 번들러 (**rolldown 기반**) |
| `@vitejs/plugin-react` | ^6.0.1 | React 변환 |
| `vite-plugin-pwa` | ^1.3.0 | 서비스워커·매니페스트 생성 |
| `vitest` | ^4.1.9 | 테스트 러너 |
| `jsdom` | ^29.1.1 | vitest DOM 환경 |
| `@testing-library/react` | ^16.3.2 | 컴포넌트 테스트 |
| `@testing-library/jest-dom` | ^6.9.1 | 매처 (`frontend/src/test/setup.js`가 유일하게 import) |
| `eslint` | ^10.2.1 | 린터 (`frontend/eslint.config.js`) |
| `@eslint/js`, `eslint-plugin-react-hooks` ^7.1.1, `eslint-plugin-react-refresh` ^0.5.2, `globals` ^17.5.0 | — | 린트 설정 |
| `@types/react`, `@types/react-dom` | ^19.2.x | 타입(JSDoc/IDE용, 프로젝트는 JSX) |

**CSS는 plain CSS** — TailwindCSS·CSS-in-JS 라이브러리 없음. 토큰은 `frontend/src/styles/` (`tokens.css` 등)와 컴포넌트별 `.css`.

### 프론트엔드 구조

```
frontend/
  index.html
  vite.config.js
  eslint.config.js
  package.json
  dist/                       빌드 산출물 — nginx가 :ro 볼륨마운트로 직접 서빙
  src/
    main.jsx  App.jsx  routes.js  api.js  utils.js
    pages/  components/  hooks/  contexts/  utils/  styles/  glossary/  assets/
    test/setup.js
```

`frontend/src/api.js` — axios 인스턴스. `baseURL = import.meta.env.VITE_API_BASE_URL || ''`(미설정 시 상대경로). request 인터셉터가 `localStorage.access_token`을 `Authorization: Bearer`로 붙이고, response 인터셉터가 401에 토큰 2종을 지우고 `/`로 리다이렉트한다. 프론트 테스트 24 파일(그중 `.test.jsx` 16).

---

## 4. 빌드 · 설정 파일

### `frontend/vite.config.js`

- **plugins**: `react()`, `VitePWA({...})`, 인라인 커스텀 플러그인 `sw-cache-bust`.
- **PWA**: `registerType: 'autoUpdate'`, workbox `cacheId: portfolion-<BUILD_DATE>`, `skipWaiting`/`clientsClaim` true, **`navigateFallback: null`**(SW가 OAuth 콜백 내비게이션을 가로채지 못하게), runtimeCaching 3종 — Google Fonts/jsDelivr CacheFirst, `/api/*`(단 `/api/auth/*` 제외) NetworkFirst(timeout 10s, maxAge 5분).
- **`sw-cache-bust`**: `closeBundle`(order post)에서 `index.html`의 `registerSW.js`·`manifest.webmanifest`와 `registerSW.js`의 `/sw.js`에 `?<BUILD_DATE>` 쿼리를 붙인다. **`configResolved`로 실제 `config.build.outDir`을 읽는다** — 과거 `'dist'` 하드코딩이 `--outDir` 검증 빌드에서도 라이브 `dist/index.html`을 오염시켰다.
- **build.rollupOptions.output.manualChunks**: **함수 형식만** 허용(Vite 8=rolldown; 객체형은 `Expected Function but received Object`로 빌드 실패). `recharts`/`/d3-`/`victory-vendor` → `charts`, 그 외 `node_modules` → `vendor`.
- **test**: `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`.
- **server**: port 5173, `/api` → `http://localhost:8000` 프록시, `watch.usePolling: true`(interval 500).

### `backend/Dockerfile`

`python:3.12-slim` → `WORKDIR /app` → `requirements.txt` 복사 후 `pip install --no-cache-dir` → 소스 복사 → `CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000"]`.

### `docker-compose.yml` (4 서비스)

| 서비스 | 이미지/빌드 | 포트 | 볼륨 |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432:5432 | `pgdata`, `backend/auth_schema.sql`→`01-auth.sql`, `backend/app_schema.sql`→`02-app.sql` (initdb.d) |
| `backend` | `build: ./backend` | (내부 8000) | `env_file: ./backend/.env.docker` |
| `nginx` | `nginx:alpine` | 80:80, 443:443 | `./frontend/dist`→`/usr/share/nginx/html:ro`, `./nginx/nginx.conf:ro`, `./certbot/conf:ro`, `./certbot/www:ro` |
| `certbot` | `certbot/certbot` | — | `./certbot/conf`, `./certbot/www` — 12시간 루프 `certbot renew` |

`postgres` healthcheck `pg_isready -U portfolion`; `backend`는 `depends_on: postgres(service_healthy)`. 보간 변수는 `POSTGRES_PASSWORD`(기본값 있음) 하나뿐.

> **실 라이브 백엔드/nginx는 compose가 아니라 `deploy.sh`의 `docker run`으로 뜬다**(§7) — 그래서 `docker compose ps`에 backend가 안 잡히고 `docker ps`로 봐야 한다.

### `nginx/nginx.conf`

단일 `server { listen 80; server_name _; }`:
- `/.well-known/acme-challenge/` → `root /var/www/certbot` (certbot)
- `/health`, `/api/` → `proxy_pass http://backend:8000` (+ `Host`/`X-Real-IP`/`X-Forwarded-For`/`X-Forwarded-Proto`)
- `= /index.html`, `sw.js`/`workbox-*.js` → `Cache-Control: no-cache, no-store, must-revalidate`
- `\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$` → `public, max-age=31536000, immutable` (Vite 해시 파일명)
- `/` → `try_files $uri /index.html` (SPA)
- 443 ssl 블록은 **전체 주석 처리**됨(HTTPS는 Cloudflare Tunnel이 종단).

### `.env` 계열 — **키 이름만** (값은 절대 문서화하지 않는다)

`backend/.env.docker` (컨테이너 `env_file`, gitignored):

```
DATABASE_URL  JWT_SECRET  SESSION_SECRET  FRONTEND_URL
GOOGLE_CLIENT_ID  GOOGLE_CLIENT_SECRET  GITHUB_CLIENT_ID  GITHUB_CLIENT_SECRET
KIWOOM_APP_KEY  KIWOOM_SECRET_KEY  KIWOOM_BASE_URL
KIS_APP_KEY  KIS_APP_SECRET
DART_API_KEY  FRED_API_KEY  KOFIA_API_KEY  KITA_API_KEY
COWORK_API_KEY  COWORK_ROUTINE_FIRE_URL  COWORK_ROUTINE_FIRE_TOKEN
ANTHROPIC_API_KEY
```

코드가 읽지만 위 파일에 현재 없는 키(설정 시 활성): `KIS_BASE_URL`(기본 실전 도메인), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

루트 `.env` (docker-compose 보간·`start.sh` source용): `FRED_API_KEY`, `KITA_API_KEY`. (`POSTGRES_PASSWORD`는 미기재 → compose 기본값 사용.)

프론트 빌드타임 변수: `VITE_API_BASE_URL` 하나 — `frontend/src/api.js`, `frontend/src/App.jsx`, `frontend/src/pages/LoginPage.jsx`.

### `backend/pytest.ini`

```
[pytest]
testpaths = tests
pythonpath = .
```

### `backend/data/` — 정적 참조 + 로컬 캐시

- **read-only 시드**: `sp500_tickers.json`, `kospi_tickers.json` (task#234 이후 write 경로 0 — 티커 캐시는 `market_cache` 키 `sp500_tickers`/`kospi_tickers`로 이전). `backend/services/recommendation/universe.py`가 `_SP500_PATH`로 read만.
- **로컬 파일 캐시/레거시**(gitignored 또는 폴백): `consensus/`, `calendar/`, `digest/`, `holdings.json`, `stocks.json`, `watchlist.json`, `schedule.json`, `guru_managers.json`, `guru_schedule.json`, `kr_exports.json`.
- `backend/snapshots/`, `backend/reports/` — 생성 산출물/레거시 JSON 폴백(gitignored).

---

## 5. 실행 커맨드

```bash
# 양쪽 서버 (macOS/Linux) — .env source, 8000/5173 포트 정리, uvicorn --reload + vite dev
./start.sh          # 종료: ./stop.sh
# Windows
start.bat           # 종료: stop.bat

# 백엔드만 (프로젝트 루트에서)
cd backend && python -m uvicorn main:app --reload --port 8000

# 프론트만
cd frontend && npm run dev        # :5173, /api → :8000 프록시
```

`npm` 스크립트(`frontend/package.json`): `dev`=vite, `build`=vite build, `test`=vitest run, `lint`=eslint ., `preview`=vite preview.

---

## 6. 테스트 커맨드

```bash
# 백엔드 (128 파일) — 로컬 venv가 게이트
cd backend && .venv/bin/python -m pytest

# 프론트 (24 파일)
cd frontend && npm test          # vitest run
cd frontend && npm run lint
```

테스트 환경의 하드 제약:

- `backend/tests/conftest.py`의 **`_block_real_db` autouse 가드**가 실 DB 접근을 차단한다(로컬 `DATABASE_URL`이 라이브 도커 postgres를 가리키기 때문). DB를 타는 테스트는 `services.db`의 `query`/`execute` 또는 그 상위를 mock해야 한다 — 가드가 raise하면 mock을 추가할 일이고, 가드를 풀 일이 아니다.
- `backend/tests/test_no_print.py`가 앱 코드의 `print(` 0건을 단언한다(로깅은 모듈 `logger`로).
- `backend/tests/test_api_doc_sync.py`가 라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 `### \`METHOD /path\`` 헤더를 대조해 엔드포인트 *존재* drift를 잡는다(요청/응답 스키마·인증 게이팅 산문은 수동 DoD).
- **jsdom에서 recharts는 렌더되지 않는다**(`ResponsiveContainer` 0크기) — 축/틱/마커 단언 불가. 차트의 시각 속성은 Playwright 라이브 `getBoundingClientRect()` 실측이 유일한 게이트.
- 전체 스위트 실행 뒤 `git status`로 부수효과(추적 파일 수정)를 확인하는 습관.

라이브 UAT 보조 스크립트는 `scripts/` (Playwright `.mjs`/`.js` 프로브 다수, `scripts/package.json`에 별도 npm 트리).

---

## 7. 배포 토폴로지

```
인터넷 ──► Cloudflare Tunnel (portfolion.taebro.com)
             │  cloudflared: launchd (compose 컨테이너 아님)
             ▼
        localhost:80  nginx:alpine ──► frontend/dist  (:ro 볼륨마운트, 정적 서빙)
                              └─ /api/, /health ──► backend:8000 (uvicorn, portfolion_default 네트워크)
                                                        └──► postgres:16 (pgdata 볼륨, 5432 호스트 노출)
                                          certbot: 12h renew 루프
```

- **인프라**: Mac 로컬 Docker (Render/Vercel/Supabase 전부 제거됨). 네트워크 `portfolion_default`, 컨테이너 이름 `portfolion-backend-1`·`portfolion-nginx-1`.
- **launchd 서비스**(`~/Library/LaunchAgents/`): `com.portfolion.docker-compose`, `com.portfolion.auto-deploy-poll`, `com.portfolion.cowork-fire-listener`, `com.cloudflare.cloudflared`(+`homebrew.mxcl.cloudflared`), `actions.runner.calmonion7-PortfoliOn.macbook-portfolion`.

### 배포 경로 2개

1. **주 경로 — self-hosted GitHub Actions 러너**: `.github/workflows/deploy.yml` (`on: push[main]`, `runs-on: self-hosted`) → `cd /Users/calmonion/Project/PortfoliOn && git fetch origin && git reset --hard origin/main && bash deploy.sh`. **PortfoliOn 전용 러너 디렉터리는 `~/actions-runner-portfolion`** — 다른 프로젝트 세팅 때 재등록되면 잡이 `queued→24h cancelled`로 무음 미배포가 된다.
2. **폴백 — 폴러**: `scripts/auto-deploy-poll.sh` (launchd, 2분 간격). `/tmp/portfolion-deploy.lock`이 있으면 skip, `HEAD == origin/main`이면 exit 0, **다르면(앞서든 뒤처지든) `git reset --hard origin/main` 후 `bash deploy.sh`**. → 메인 체크아웃의 **커밋 안 한 tracked 편집과 push 안 한 로컬 커밋이 ≤2분 내 소실**된다. `commit` + `git push origin main`을 묶어서 할 것. `.forge/` 등 untracked는 안전.

### `deploy.sh` (4단계)

`/tmp/portfolion-deploy.lock`으로 동시 배포 차단(러너 ↔ 폴러), `DOCKER_CONFIG`를 임시 디렉터리로 바꿔 macOS keychain 우회.

1. `cd frontend && npm install --silent && npm run build --silent` → `frontend/dist/`
2. `docker build -t portfolion-backend ./backend`
3. `docker stop/rm portfolion-backend-1` → `docker run -d --name portfolion-backend-1 --network portfolion_default --network-alias backend --restart unless-stopped --env-file ./backend/.env.docker portfolion-backend`
4. `docker stop/rm portfolion-nginx-1` → `docker run -d ... -p 80:80 -p 443:443 -v nginx.conf:ro -v frontend/dist:ro nginx:alpine`

끝에 `curl -s http://localhost/health` 검증.

**반영 시점 차이**: nginx가 `frontend/dist`를 직접 서빙하므로 로컬 `cd frontend && npm run build`는 **즉시 라이브**(서빙 번들 해시 = 로컬 빌드 해시로 검증 가능). 반면 **백엔드 변경은 재배포 후에야 라이브** — 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작한다. `docker compose build`/`up` 같은 ad-hoc 재빌드는 하지 않고, 필요하면 정식 `bash deploy.sh` 1회.

### 기동 시 DB 마이그레이션

`backend/main.py`의 `_migrate()`가 lifespan에서 idempotent하게 돈다(`CREATE TABLE IF NOT EXISTS` 11개 + `ADD COLUMN IF NOT EXISTS` 다수). `backend/app_schema.sql`은 **신규 설치용**이므로 라이브 DB에 신규 컬럼을 넣으려면 `_migrate`에 `ADD COLUMN IF NOT EXISTS`를 **쌍으로** 추가해야 한다(한쪽만 고치면 배포 직후 그 컬럼을 쓰는 SQL이 깨진다).

### CORS · DB 풀

- CORS origins(`backend/main.py`): `localhost:3000`, `localhost:5173`, 그리고 `FRONTEND_URL` env.
- DB 풀(`backend/services/db.py`): `psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=20, dsn=DATABASE_URL)`. 대시보드 빌드가 10-워커 ThreadPool × 카드당 다중 read를 돌려 콜드 첫 호출에 풀 경합이 났던 이력이 있다.

---

## 8. 참고 문서 (루트)

`README.md`(인프라·화면구성·환경변수·스택·아키텍처·배치 overview), `CLAUDE.md`(작업 규약 + 가토 목록), `API_SPEC.md`(전체 REST 레퍼런스 — 엔드포인트 정본), `CLAUDE_COWORK_API.md`(외부 Cowork 전용 API), `KIWOOM_API.md`·`KIS_API.md`(증권사 API 카탈로그·대체 로드맵), `.forge/adr/0001~0029`(결정 기록).
