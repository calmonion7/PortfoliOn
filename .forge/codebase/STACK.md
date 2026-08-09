---
last_mapped_commit: 91bac67ddb3ca7277a850fa6840a0fce0f7344cf
mapped: 2026-07-30
---

# 기술 스택 (STACK)

PortfoliOn의 언어·런타임·프레임워크·의존성·빌드도구·설정파일·환경변수를 기록한다.
외부 API/DB/배치 소스는 자매 문서 `INTEGRATIONS.md`를 참조.

---

## 1. 언어 및 런타임

| 계층 | 언어/런타임 | 근거 파일 |
|------|-------------|-----------|
| 백엔드 | Python (FastAPI, ASGI) | `backend/Dockerfile`, `backend/requirements.txt` |
| 프론트엔드 | JavaScript (JSX, ESM `"type": "module"`) | `frontend/package.json` |
| 인프라 스크립트 | Bash | `deploy.sh`, `start.sh`, `stop.sh`, `scripts/*.sh` |
| 인프라 스크립트(Windows) | Batch | `start.bat`, `stop.bat` |
| 스키마 | SQL (PostgreSQL) | `backend/auth_schema.sql`, `backend/app_schema.sql` |
| UAT 하니스 | Node (Playwright, `.mjs`) | `scripts/package.json`, `scripts/uat*.mjs` |

프론트엔드에는 CSS 프레임워크가 없다 — plain CSS(`frontend/src/styles/`, 컴포넌트별 `.css`). TailwindCSS 미사용.

### 1.1 ⚠️ 로컬 `backend/.venv` ↔ Docker 컨테이너 런타임 격차 (실측)

`backend/requirements.txt`는 **전 항목이 하한 핀(`>=`)만** 걸려 있고 lock 파일이 없다. 그래서
컨테이너는 이미지 빌드 시점의 최신 버전을 해석해 받고, 로컬 `.venv`는 생성 시점 버전에 고정돼
**같은 패키지가 서로 다른 메이저 버전으로 갈린다.** 아래는 2026-07-30 실측값이다.

| 패키지 | 로컬 `backend/.venv` | Docker 컨테이너 `portfolion-backend-1` |
|--------|----------------------|-----------------------------------------|
| **python** | **3.9.6** (`backend/.venv/pyvenv.cfg`, CommandLineTools 시스템 파이썬) | **3.12.13** (`backend/Dockerfile`: `FROM python:3.12-slim`) |
| **fastapi** | 0.128.8 | **0.138.1** |
| **starlette** | 0.49.3 | **1.3.1** (메이저 차이) |
| **pandas** | 2.3.3 | **3.0.3** (메이저 차이) |
| **numpy** | 2.0.2 | 2.5.0 |
| **yfinance** | 1.2.0 | 1.4.1 |
| **lxml** | **미설치** | 6.1.1 |
| pydantic | 2.13.4 | 2.13.4 (일치) |

이 격차가 만드는 하드 제약 3종:

1. **PEP604 유니온(`X | None`) 금지 — 런타임 평가 어노테이션 자리에 한해.** 로컬이 3.9라
   Pydantic 모델·FastAPI 시그니처처럼 어노테이션이 런타임 평가되는 자리에 `float | None`을 쓰면
   로컬 pytest가 `TypeError`로 죽는다(컨테이너 3.12에선 동작). `Optional[X]`를 쓸 것.
   단 `from __future__ import annotations`가 있는 모듈(예: `backend/services/db.py`,
   `backend/services/cowork_trigger.py`)은 어노테이션이 문자열로 지연되므로 `X | None`이 통과한다 —
   그래서 "파일에 있으니 괜찮다"가 다른 파일에서 성립하지 않는다.
2. **`lxml`은 로컬에 없다.** `requirements.txt:9`에 있고 컨테이너엔 6.1.1이 설치돼 있지만
   로컬 `.venv`엔 없다. 로컬 pytest가 게이트이므로 HTML 파싱은 `BeautifulSoup(html, "lxml")`이 아니라
   stdlib `BeautifulSoup(html, "html.parser")`를 쓸 것(양쪽 다 동작). 실사용 예:
   `backend/services/market_indicators/indices.py`(Shiller CAPE 파싱).
3. **FastAPI 0.138.1은 `include_router()` 라우트를 `_IncludedRouter`로 감싼다.** `app.routes`를
   평탄 순회하는 코드는 로컬(구버전)에서 라우트를 세지만 컨테이너에서는 **0개**를 센다 —
   `original_router`까지 재귀 하강해야 한다. `backend/tests/_routes.py`·
   `backend/tests/test_api_doc_sync.py`·`scripts/audit_unauth_endpoints.py`가 이 표면이다.

또한 **컨테이너에 `TZ` env가 없어 로컬시간이 UTC**다(실측: 컨테이너 `date.today()`=2026-07-29인데
KST는 2026-07-30). KR 시장-날짜 판정은 bare `date.today()` 대신
`datetime.now(ZoneInfo("Asia/Seoul")).date()`를 쓸 것 — `backend/services/market_indicators/kospi_signal.py`,
`backend/scheduler/schedule.py`의 `_KST` 패턴.

### 1.2 로컬 `.venv`의 잔여 패키지 (requirements.txt 밖)

`backend/.venv`에는 `requirements.txt`에 없는 패키지가 남아 있다 — Supabase 시절 잔재 및 전이 의존성:
`supabase`/`supabase-auth`/`supabase-functions`/`postgrest`/`realtime`/`storage3`(2.30.0 계열),
`matplotlib`, `passlib`, `peewee`, `pyiceberg`, `PyJWT`, `openpyxl`, `curl_cffi`(yfinance 전이).
**컨테이너에는 없으므로** 이들을 import하는 코드를 쓰면 로컬만 통과하고 배포에서 죽는다.

### 1.3 Node

로컬 `node v24.15.0` / `npm 11.12.1`. **버전 핀이 없다** — `frontend/package.json`에 `engines` 필드 없고
`.nvmrc`도 없다. 프론트 빌드는 `deploy.sh`가 호스트 Node로 수행하므로(컨테이너 빌드 아님)
호스트 Node 버전이 사실상의 빌드 런타임이다.

---

## 2. 백엔드 프레임워크 및 의존성

`backend/requirements.txt` 전문(18개, 전부 하한 핀):

| 패키지 | 용도 | 주요 사용처 |
|--------|------|-------------|
| `fastapi>=0.104.0` | 웹 프레임워크 | `backend/main.py` (앱 생성·라우터 19개 마운트) |
| `uvicorn[standard]>=0.24.0` | ASGI 서버 | `backend/Dockerfile` CMD, `start.sh` |
| `apscheduler>=3.10.4` | 배치 스케줄러 | `backend/scheduler/_state.py` (`AsyncIOScheduler`) |
| `yfinance>=0.2.40` | US 1차 시세·재무·히스토리 | `backend/services/market/us.py` 외 다수 |
| `pandas>=2.1.0` | 시계열/지표 계산 | `backend/services/indicators.py`, `market/*` |
| `numpy>=1.26.0` | 수치 계산 | `backend/services/indicators.py`, `analysis_service.py` |
| `requests>=2.31.0` | 동기 HTTP (외부 API 대부분) | `kiwoom/client.py`, `kis/client.py`, `market_indicators/*` |
| `beautifulsoup4>=4.12.0` | HTML 파싱 | `services/scraper.py`, `guru_scraper.py`, `market_indicators/indices.py` |
| `lxml>=4.9.0` | XML/HTML 파서 백엔드 | ⚠️ 로컬 미설치 (§1.1) |
| `httpx>=0.25.0` | 비동기 HTTP | `backend/routers/auth.py` (OAuth 토큰 교환) |
| `pytest>=7.4.0` | 테스트 | `backend/tests/` (127 파일) |
| `exchange_calendars>=4.5` | 거래소 휴장일 | `backend/routers/calendar.py:12,278` (`xcals.get_calendar`) |
| `psycopg2-binary>=2.9.0` | PostgreSQL 드라이버 | `backend/services/db.py` |
| `authlib>=1.3.0` | OAuth 클라이언트 | OAuth 흐름(현 구현은 `httpx` 직접 호출이 주력) |
| `python-jose[cryptography]>=3.3.0` | JWT 서명/검증 (HS256) | `backend/auth.py`, `services/auth_service.py` |
| `bcrypt>=4.0.0` | 비밀번호 해싱 | `backend/services/auth_service.py` |
| `itsdangerous>=2.0.0` | 세션 서명 (starlette `SessionMiddleware` 의존) | `backend/main.py:262` |
| `python-dotenv` | `.env` 로드 (유일한 무버전 항목) | `backend/main.py:1-2` (`load_dotenv()` 최상단) |

**`anthropic` 패키지는 없다(확인).** 백엔드에 LLM 호출이 없고, `ANTHROPIC_API_KEY`를 읽는 코드도
전무하다(grep 0건). AI 분석 텍스트는 외부 루틴이 `CLAUDE_COWORK_API.md` 워크플로우로 써 넣으며,
백엔드가 하는 일은 트리거 HTTP POST 1개(`backend/services/cowork_trigger.py`)뿐이다.

### 2.1 백엔드 앱 배선 (`backend/main.py`, 296줄)

- `load_dotenv()`가 **파일 최상단**(1-2줄) — 다른 import보다 먼저 실행돼야 env가 채워진다.
- `_configure_logging()` (18-30줄): `basicConfig(level=INFO)` + `urllib3`/`yfinance`/`apscheduler`/`asyncio`를
  WARNING으로 억제 + `uvicorn` 로거 `propagate=False`(중복 emit 방지).
- `lifespan` (241-247줄): `_migrate()` → `sched.start()` → `_warm_market_cache()` 데몬 스레드 → yield → `sched.stop()`.
- 미들웨어 스택: `SessionMiddleware`(`secret_key=os.environ["SESSION_SECRET"]` — **없으면 KeyError로 기동 실패**),
  `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`), `CORSMiddleware`.
- CORS origins: `http://localhost:3000`, `http://localhost:5173`, `FRONTEND_URL`(빈값이면 제외) — 265-271줄.
- `RequestValidationError` 커스텀 핸들러(253-259줄): 422 detail을 `services.utils.sanitize`로 통과시켜
  입력 NaN echo가 starlette `allow_nan=False`에서 500이 되는 걸 앱 전역에서 막는다.
- 라우터 19개 `include_router` (273-291줄). `/health`는 `@app.api_route`로 GET/HEAD (294-296줄).
- `_migrate()` (60-238줄): 기동 시 idempotent DDL — 테이블 11개 `CREATE TABLE IF NOT EXISTS` +
  컬럼 14개 `ADD COLUMN IF NOT EXISTS` + 인덱스 5개. 블록마다 독립 `try/except → logger.warning`이라
  실패해도 기동은 계속된다. 자세한 목록은 `INTEGRATIONS.md` §1.

---

## 3. 프론트엔드 프레임워크 및 의존성

`frontend/package.json`.

### 런타임 의존성 (5개)

| 패키지 | 버전 | 용도 |
|--------|------|------|
| `react` / `react-dom` | ^19.2.5 | UI 런타임 (React 19) |
| `react-router-dom` | ^7.14.2 | 라우팅 (`frontend/src/routes.js`, `App.jsx`) |
| `recharts` | ^3.8.1 | 차트 전량 (`frontend/src/components/market/*`, `reports/*`) |
| `axios` | ^1.16.0 | HTTP 클라이언트 (`frontend/src/api.js`) |

### 개발 의존성 주요항

| 패키지 | 버전 | 용도 |
|--------|------|------|
| `vite` | ^8.0.10 | 번들러/개발서버 — **Vite 8 = rolldown** (§4.1 주의) |
| `@vitejs/plugin-react` | ^6.0.1 | React 변환 |
| `vite-plugin-pwa` | ^1.3.0 | 서비스워커·매니페스트 생성 |
| `vitest` | ^4.1.9 | 단위 테스트 (25 파일) |
| `jsdom` | ^29.1.1 | vitest DOM 환경 — ⚠️ recharts 미렌더 (§6.2) |
| `@testing-library/react` / `jest-dom` | ^16.3.2 / ^6.9.1 | 렌더 테스트·매처 |
| `eslint` + `@eslint/js` | ^10.2.1 / ^10.0.1 | 린트 (flat config) |
| `eslint-plugin-react-hooks` / `-react-refresh` | ^7.1.1 / ^0.5.2 | React 린트 규칙 |
| `globals` | ^17.5.0 | 린트 전역 정의 |

### 3.1 API 클라이언트 (`frontend/src/api.js`)

`axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '' })`.
요청 인터셉터가 `localStorage.access_token`을 `Authorization: Bearer`로 주입하고,
응답 인터셉터가 **401이면 두 토큰을 지우고 `window.location.href = '/'`로 강제 이동**한다.
`api.js`를 우회해 `fetch`를 직접 쓰는 곳(`frontend/src/App.jsx:37,138`,
`frontend/src/pages/LoginPage.jsx:11`)은 이 인터셉터 혜택을 못 받는다.

### 3.2 외부 폰트 (CSP/오프라인 표면)

`frontend/index.html`이 3개 외부 호스트를 `<link>`로 로드한다:
`fonts.googleapis.com`, `fonts.gstatic.com`(Inter, Noto Serif KR), `cdn.jsdelivr.net`(Pretendard v1.3.9).
서비스워커가 이 둘을 `CacheFirst`로 1년 캐시한다(`frontend/vite.config.js` `runtimeCaching`).

---

## 4. 빌드 도구 및 설정

### 4.1 `frontend/vite.config.js`

- **`manualChunks`는 함수 형식만** — Vite 8(rolldown)은 rollup식 객체형(`{name:[pkgs]}`)을 받으면
  `Expected Function but received Object`로 빌드가 깨진다. 현재 분기: `recharts`/`/d3-`/`victory-vendor` →
  `charts` 청크, 나머지 `node_modules` → `vendor`.
- **PWA** (`VitePWA`): `registerType: 'autoUpdate'`, `skipWaiting`/`clientsClaim` true,
  `navigateFallback: null`. `cacheId`는 빌드시각(`portfolion-<YYYYMMDDHHmmss>`).
- **⚠️ 서비스워커가 `/api/*`를 가로챈다** — `runtimeCaching`의 마지막 규칙이
  `/api/`(단 `/api/auth/` 제외)를 `NetworkFirst`(타임아웃 10s, 5분·50엔트리)로 캐시한다.
  그래서 Playwright `page.route` 응답 인터셉트가 안 먹고, UAT 컨텍스트는
  **`serviceWorkers: 'block'`**으로 만들어야 한다.
- **커스텀 플러그인 `sw-cache-bust`** (`closeBundle`, `order:'post'`): `index.html`의
  `registerSW.js`·`manifest.webmanifest`와 `registerSW.js`의 `/sw.js`에 `?<BUILD_DATE>` 쿼리를 붙인다.
  `configResolved`에서 실제 `config.build.outDir`을 잡아 쓴다 — 과거 `'dist'` 하드코딩이
  `--outDir` 검증 빌드마다 라이브 `dist/index.html`을 오염시켰다(주석에 task#191로 기록).
- **vitest 설정이 같은 파일에 인라인** (`test` 키): `environment: 'jsdom'`, `globals: true`,
  `setupFiles: './src/test/setup.js'`(내용은 `@testing-library/jest-dom` import 1줄).
- 개발서버: 포트 5173, `/api` → `http://localhost:8000` 프록시, `watch.usePolling: true`(interval 500).

### 4.2 `frontend/eslint.config.js`

ESLint 10 flat config. `dist` 전역 무시, `**/*.{js,jsx}` 대상,
`js.configs.recommended` + `reactHooks.configs.flat.recommended` + `reactRefresh.configs.vite`.
**`console.*` 규칙은 없다** — 프론트 로깅 규약은 컨벤션 문서상 합의이고 자동 가드가 아니다.

### 4.3 `backend/pytest.ini`

전문 3줄: `[pytest]` / `testpaths = tests` / `pythonpath = .`.
`addopts`·마커·커버리지·`asyncio_mode` 설정 없음.

---

## 5. 컨테이너 및 인프라 설정 파일

| 파일 | 역할 |
|------|------|
| `docker-compose.yml` | 4서비스 정의: `postgres`(postgres:16-alpine, `pgdata` 볼륨, 5432 노출, `pg_isready` 헬스체크), `backend`(`build: ./backend`, `env_file: ./backend/.env.docker`), `nginx`(nginx:alpine, 80/443), `certbot`(12시간마다 `certbot renew` 루프) |
| `backend/Dockerfile` | `python:3.12-slim` → `requirements.txt` 설치 → 소스 복사 → `uvicorn main:app --host 0.0.0.0 --port 8000` |
| `nginx/nginx.conf` | HTTP(80)만 활성. `/api/`·`/health` → `http://backend:8000` 프록시, `frontend/dist` 정적 서빙, SPA fallback(`try_files $uri /index.html`). **443 블록은 전체 주석 처리** — 외부 노출은 Cloudflare Tunnel 담당 |
| `deploy.sh` | 정식 배포 스크립트. `/tmp/portfolion-deploy.lock`으로 동시 배포 차단 → 프론트 `npm install && npm run build` → `docker build ./backend` → backend/nginx 컨테이너 `stop/rm/run` 교체 → `curl /health` |
| `.github/workflows/deploy.yml` | `push: [main]` → `runs-on: self-hosted` → `git fetch && git reset --hard origin/main && bash deploy.sh` |
| `scripts/auto-deploy-poll.sh` | 폴백 폴러(launchd, 2분). 락 있으면 skip, `HEAD != origin/main`이면 `git reset --hard origin/main` 후 `deploy.sh` |
| `start.sh` / `stop.sh` | 로컬 개발: `.env` source → 8000·5173 포트 kill → uvicorn `--reload` + `npm run dev` 백그라운드 → `/health` 대기 → 브라우저 오픈. 로그는 `/tmp/portfolion-{backend,frontend}.log` |
| `start.bat` / `stop.bat` | 위의 Windows 대응판 |
| `scripts/start-docker-compose.sh` | launchd용 compose 기동 대기 래퍼. ⚠️ `cd`가 **워크트리 경로**(`.claude/worktrees/docker-infra-migration`)로 하드코딩돼 있다 |
| `scripts/ddns_update.sh` | Cloudflare DNS A레코드 갱신(보조 DDNS 경로). `CF_ZONE_ID`/`CF_RECORD_ID`/`CF_API_TOKEN` 환경변수 필요, 3개 중 하나라도 없으면 종료 |
| `scripts/package.json` | UAT 하니스용 `playwright ^1.50.0` (프로젝트 본체와 무관한 별도 노드 패키지) |

`deploy.sh`가 `docker run`으로 backend/nginx를 직접 교체하므로 **backend 컨테이너는
`docker compose ps`에 잡히지 않는다** — uptime 확인은 `docker ps`로.
프론트는 nginx가 `frontend/dist`를 `:ro` 볼륨마운트로 직접 서빙하므로
로컬 `npm run build`가 즉시 라이브다(백엔드 변경은 재배포 후 반영).

**launchd 서비스는 레포에 plist가 없다**(추적 `.plist` 0건) — 호스트에만 존재:
cloudflared, docker compose 기동, 자동배포 폴러(`com.portfolion.auto-deploy-poll`),
GH Actions 러너(`~/actions-runner-portfolion`), Cowork fire 리스너.

### 5.1 레거시/미사용 설정 파일

| 경로 | 상태 |
|------|------|
| `frontend/vercel.json` | SPA rewrite 규칙만 — Vercel 배포는 제거됐고 현행 SPA fallback은 `nginx/nginx.conf` |
| `supabase/.temp/*` | Supabase CLI가 남긴 임시 메타(project-ref, 각 서비스 버전) — 미사용 |
| `backend/supabase_schema.sql` | 구 스키마(9테이블), `app_schema.sql`로 대체됨 |
| `backend/migrations/001_user_events.sql`, `002_backlog_history.sql` | 독립 마이그레이션 파일이지만 **어떤 러너에도 배선돼 있지 않다**; `app_schema.sql`이 흡수 |
| `certbot/conf/` | gitignore(민감). 443 블록이 주석이라 현재 미사용 경로 |

---

## 6. 환경변수

> 값은 이 문서에 절대 기록하지 않는다. 아래는 **변수명과 용도**만이다.
> 실제 값은 `backend/.env.docker`(gitignored)와 루트 `.env`(gitignored)에 있다.

### 6.1 백엔드가 읽는 변수 (코드 grep 기준 23개)

**필수 — 없으면 기동/요청이 실패**

| 변수 | 읽는 위치 | 실패 방식 |
|------|-----------|-----------|
| `DATABASE_URL` | `backend/services/db.py:29` (`os.environ[...]`) | 첫 DB 접근 시 `KeyError` (기본값 없음) |
| `SESSION_SECRET` | `backend/main.py:262` (`os.environ[...]`), `backend/routers/auth.py:45` | **기동 즉시 `KeyError`**. auth.py 쪽은 `.get(..., "dev-secret")` 폴백(OAuth state HMAC) |
| `JWT_SECRET` | `backend/auth.py:26,52`, `backend/services/auth_service.py`, `backend/middleware/event_tracker.py` | 토큰 검증 시 `KeyError` → 401 |
| `FRONTEND_URL` | `backend/main.py:265`(`.getenv`, 기본 `""`), `backend/routers/auth.py:142,162,182` (`os.environ[...]`) | CORS는 빈값 허용, **OAuth 경로는 `KeyError`** |

**외부 데이터 소스 키 — 미설정 시 해당 기능만 휴면(dormant-safe)**

| 변수 | 읽는 위치 | 기본값/휴면 방식 |
|------|-----------|------------------|
| `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY` | `backend/services/kiwoom/client.py:31` | `configured()`(34줄)가 False → Naver/KIS 폴백 |
| `KIWOOM_BASE_URL` | `backend/services/kiwoom/client.py:27` | 코드 기본값 `https://api.kiwoom.com` |
| `KIS_APP_KEY`, `KIS_APP_SECRET` | `backend/services/kis/client.py:34` | `configured()`(37줄)가 False → 휴면 |
| `KIS_BASE_URL` | `backend/services/kis/client.py:30` | 코드 기본값 `https://openapi.koreainvestment.com:9443`(실전). 모의는 이 변수로 override |
| `DART_API_KEY` | `disclosures.py`, `agm.py`, `insider_trades.py`, `dividends.py`, `backlog.py`, `market/kr.py` | 미설정 시 KR 공시·수주잔고·주총·내부자·KR배당 전부 휴면 |
| `FRED_API_KEY` | `market_indicators/econ.py`, `market_indicators/macro.py`, `routers/calendar.py` | 미설정 시 경제지표·매크로신호 수집 실패(저장값 무변경). 캘린더 FOMC는 정적이라 불필요 |
| `KOFIA_API_KEY` | `services/leverage_service.py`, `services/lending_service.py`, `backend/run_backfill.py` | 신용잔고·반대매매·대차잔고. 두 서비스가 **같은 키 공유** |
| `KITA_API_KEY` | `backend/services/market_indicators/exports.py` | 실제로는 **관세청** 키. 미설정 시 UN Comtrade 공개 API로 자동 폴백 |

**연동/알림**

| 변수 | 읽는 위치 | 비고 |
|------|-----------|------|
| `COWORK_API_KEY` | `backend/auth.py:46` | 외부 Cowork/루틴의 `X-API-Key` 쓰기 인증. 빈값이면 어떤 키도 401 |
| `COWORK_ROUTINE_FIRE_URL`, `COWORK_ROUTINE_FIRE_TOKEN` | `backend/services/cowork_trigger.py:24,30,33` | 둘 다 있어야 `configured()` True. 미설정 시 fire 휴면, 실패는 로깅만(전파 없음) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | `backend/services/digest_service.py:270-273` | 둘 중 하나라도 없으면 `send_telegram`이 조용히 early-return |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `backend/routers/auth.py:145,166-167` | `os.environ[...]` — 미설정 시 해당 OAuth 라우트만 500 |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `backend/routers/auth.py:191,210-211` | 동일 |

### 6.2 프론트엔드가 읽는 변수

| 변수 | 읽는 위치 | 용도 |
|------|-----------|------|
| `VITE_API_BASE_URL` | `frontend/src/api.js:4`, `frontend/src/App.jsx:37,138`, `frontend/src/pages/LoginPage.jsx:11` | API 베이스. **미설정 시 빈 문자열 = 상대경로**(nginx 동일 오리진 서빙 전제) |

`frontend/.env`에는 `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`도 있으나
`frontend/src/`에서 읽는 코드가 0건이다 — **Supabase 시절 데드 변수**.

### 6.3 루트 `.env` (docker-compose 보간용)

현재 키: `FRED_API_KEY`, `KITA_API_KEY`.
⚠️ **`POSTGRES_PASSWORD`가 없다.** `docker-compose.yml:8`은 `${POSTGRES_PASSWORD:-portfolion}`으로
보간하므로 compose 경로는 **기본값 `portfolion`으로 떨어진다**(README §환경변수는 여기에
`POSTGRES_PASSWORD`를 두라고 안내 — 문서와 실파일이 어긋나 있다).
한편 backend 컨테이너는 `deploy.sh`가 `--env-file ./backend/.env.docker`로 띄우므로
`DATABASE_URL`을 거기서 받는다.

### 6.4 env 파일 ↔ 코드 정합성 (드리프트 실측)

`backend/.env.docker` 키 21개 vs 코드가 읽는 23개를 대조하고, 실행 중 컨테이너에서
**존재 여부만**(값 미확인) 확인한 결과:

| 항목 | 상태 | 영향 |
|------|------|------|
| `ANTHROPIC_API_KEY` | `.env.docker`에 **키만 있고 값 없음**(컨테이너에서 빈 문자열) + **코드 read 0건** | 완전 데드. 백엔드 무LLM 원칙과 일치 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | `.env.docker`에 **부재**(컨테이너에도 키 자체 없음) | **다이제스트 텔레그램 발송은 현재 휴면** — `send_telegram`이 early-return. README는 이 기능을 문서화하고 있어 문서-실태 격차 |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `.env.docker`에 키는 있으나 **빈값** | GitHub OAuth 라우트는 실질 미동작 |
| `KIS_BASE_URL` | `.env.docker` 부재 | 무해 — 코드 기본값(실전 도메인)이 적용 |
| `KIWOOM_APP_KEY`, `KIS_APP_KEY`, `FRED_API_KEY`, `DART_API_KEY`, `KOFIA_API_KEY`, `KITA_API_KEY`, `COWORK_ROUTINE_FIRE_URL`, `GOOGLE_CLIENT_ID` | 컨테이너에 **설정됨** | 해당 연동 활성 |

**`backend/.env.docker.example`(추적됨) 은 stale하다.** 13키만 담고 있고
`KIWOOM_*`·`KOFIA_API_KEY`·`DART_API_KEY`·`COWORK_*`·`TELEGRAM_*`가 빠져 있다 — 이걸 그대로 복사해
새 환경을 세우면 KR 시세·공시·수급이 통째 휴면한다.

`backend/.env`(로컬 개발용, gitignored)에는 `DATABASE_URL`·`JWT_SECRET`·`SESSION_SECRET` 외에
`SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_JWT_SECRET`이 남아 있다(데드).

### 6.5 gitignore 되는 설정·데이터 경로

루트 `.gitignore` 기준: `.env`(모든 계층), `backend/.env.docker`, `backend/.venv/`,
`backend/snapshots/`, `backend/reports/`, `backend/data/consensus/`, `backend/data/calendar/`,
런타임 JSON 8종(`holdings.json`·`watchlist.json`·`stocks.json`·`schedule.json`·
`guru_schedule.json`·`guru_managers.json`·`kr_exports.json`), `certbot/conf/`,
`frontend/dist/`, `frontend/node_modules/`, `frontend/.vite/`, `scripts/node_modules/`,
`screenshots/`, `.worktrees/`, `.claude/settings.local.json`.

`backend/data/`에서 **추적되는 파일**은 `sp500_tickers.json`, `kospi_tickers.json`,
`digest/2026-05-24.json` 3개다. 앞의 두 티커 파일은 **read-only 시드**다 —
과거 `market_indicators/earnings.py`가 이들을 7일 캐시로 겸용(read+write)해 전체 테스트 실행이
정적 참조 데이터를 오염시켰고, 캐시는 `market_cache` 테이블(키 `sp500_tickers`·`kospi_tickers`)로
이전됐다. 전체 스위트 실행 후 `git status`로 부수효과를 확인하는 습관이 남는다.

---

## 7. 테스트 하니스

| 계층 | 러너 | 규모 | 설정 |
|------|------|------|------|
| 백엔드 | pytest | `backend/tests/test_*.py` **127개** | `backend/pytest.ini` |
| 프론트 | vitest | `frontend/src/**/*.test.jsx` **25개** | `frontend/vite.config.js`의 `test` 키 |
| 라이브 UAT | Playwright(Node) | `scripts/uat*.mjs`, `scripts/*.js` | `scripts/package.json` |

실행: `cd backend && .venv/bin/python -m pytest` / `cd frontend && npm test`.

### 7.1 `backend/tests/conftest.py` (37줄, 트리 내 유일한 conftest)

- **모듈 레벨(픽스처 아님) auth override**: `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`.
  import 시점에 걸리고 **teardown이 없다** → 세션 전체가 인증 상태.
  `require_admin`·`get_current_user_or_api_key`·`require_admin_or_api_key`는 **override되지 않으므로**
  admin 게이트 라우트는 실 DB read를 시도하다 아래 가드에 막힌다 — 그래서 20여 개 테스트 파일이
  각자 `dependency_overrides`를 조작한다.
- `client` 픽스처: `TestClient(app)`를 **컨텍스트매니저 없이** 생성 → `lifespan`(`_migrate()`+`sched.start()`) 미실행.
- `_clear_quote_cache` (autouse): 매 테스트 전 `services.cache.invalidate_quote()` — `get_quote` TTL 캐시 교차오염 방지.
- **`_block_real_db` (autouse)**: `monkeypatch.setattr(db_svc, "_get_pool", _no_real_db)`로 **풀 팩토리 한 지점**을
  치환해 `RuntimeError`를 던진다. `get_connection()`이 `_get_pool()`을 2회 호출하므로
  `query`/`execute`/`execute_many`가 한 번에 봉쇄된다. 로컬 `DATABASE_URL`이 **라이브 도커 postgres**를
  가리켜 테스트가 prod `snapshots`를 fixture 값으로 덮어썼던 사고(005930 클로버) 때문에 생긴 가드다.
  **가드가 raise하면 그 테스트가 실 DB에 닿고 있다는 뜻 — 가드를 풀지 말고 `services.db.query`/`execute`를 모킹할 것.**
- 보조 모듈: `backend/tests/_routes.py`(라우트 인벤토리 헬퍼), `backend/tests/fixtures/backlog/`(데이터).

### 7.2 테스트가 구조적으로 못 보는 표면

- **jsdom에서 recharts는 렌더되지 않는다** — `ResponsiveContainer`가 0크기라 축·틱·막대·라벨이 전무.
  차트 vitest는 범례 텍스트·캡션·데이터 유무 분기만 단언할 수 있고, 라벨 겹침·정렬·잘림 같은
  시각 속성은 라이브 Playwright `getBoundingClientRect()` 실측이 유일한 게이트다.
  `getComputedTextLength`도 jsdom에 없어 문자폭 실측 코드는 추정 폴백을 남겨야 한다.
- **배지 색 의미·레이아웃 수치**에 vitest와 빌드는 블라인드하다.
- **`text-overflow: ellipsis` 잘림은 `getBoundingClientRect` 넘침 검사에 원리적으로 안 잡힌다**
  (박스를 넘지 않고 박스 안에서 내용을 지우므로) — `scrollWidth > clientWidth`를 별도 축으로 재야 한다.
- **query-mock 테스트는 SQL의 라이브 정합을 못 잡는다**(uuid `= ANY(%s::uuid[])` 캐스트 누락,
  `VALUES` 괄호 형태 등) — 신규/개작 SQL은 배포 후 라이브 스모크가 필요하다.
- 자동 가드가 있는 규약: `backend/tests/test_no_print.py`(앱 코드 `print(` 0건),
  `backend/tests/test_api_doc_sync.py`(엔드포인트 *존재* ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md` 헤더 대조).
  후자는 요청/응답 스키마와 **인증 게이팅 산문은 검증하지 않는다**.

---

## 8. 문서 자산 (스택 관련 정본)

| 파일 | 내용 |
|------|------|
| `API_SPEC.md` | 전체 REST 레퍼런스 (엔드포인트 정본) |
| `CLAUDE_COWORK_API.md` | 외부 Cowork/루틴 전용 enrich·발행 API (Base URL `https://portfolion.taebro.com`) |
| `KIWOOM_API.md` | 키움 REST API 카탈로그·대체 로드맵 |
| `KIS_API.md` | 한국투자증권 REST API 카탈로그·대체 로드맵 |
| `README.md` | 인프라·환경변수·화면구성·배치 개괄 |
| `backend/auth_schema.sql` → `backend/app_schema.sql` | DB 스키마 (반드시 이 순서) |
