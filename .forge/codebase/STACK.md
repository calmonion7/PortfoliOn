---
last_mapped_commit: 9de05a1ee9f11c92f58807adeff3dcc2cab63550
mapped: 2026-07-03
---

# STACK

기술 스택, 런타임 버전, 의존성, 빌드/설정 파일, 환경변수 이름 목록.

## 언어 & 런타임

- **백엔드**: Python. `backend/Dockerfile`이 `FROM python:3.12-slim` 고정. (로컬 개발 venv는 `backend/.venv/`; 호스트 `python3`은 3.14.) 앱 진입점 `backend/main.py` (`from dotenv import load_dotenv` 먼저, 그다음 FastAPI 앱).
- **프론트엔드**: JavaScript (ESM, `"type": "module"`), React 19 / JSX. 런타임 TypeScript 없음 (`@types/*`는 에디터 툴링 전용).

## 백엔드 — Python / FastAPI

`backend/requirements.txt` 의존성 (버전 하한, 핀 아님):

| 패키지 | 제약 | 역할 |
|---|---|---|
| `fastapi` | `>=0.104.0` | 웹 프레임워크 (`backend/main.py`가 라우터 마운트) |
| `uvicorn[standard]` | `>=0.24.0` | ASGI 서버 (Dockerfile CMD: `uvicorn main:app --host 0.0.0.0 --port 8000`) |
| `apscheduler` | `>=3.10.4` | 잡 스케줄러 — `AsyncIOScheduler` + `CronTrigger` (`backend/scheduler/` 패키지) |
| `yfinance` | `>=0.2.40` | US 시세·재무·수급 + US 섹터 ETF |
| `pandas` | `>=2.1.0` | 데이터프레임 처리 |
| `numpy` | `>=1.26.0` | 수치 계산 |
| `requests` | `>=2.31.0` | 동기 HTTP (대부분의 외부 API) |
| `beautifulsoup4` | `>=4.12.0` | HTML 파싱 (Shiller CAPE 크롤 등) |
| `lxml` | `>=4.9.0` | BS4 파서 백엔드 (Docker 전용; **로컬 `.venv`엔 없음** — 코드는 `html.parser` 사용) |
| `httpx` | `>=0.25.0` | 비동기 HTTP (`backend/routers/auth.py` OAuth 토큰 교환) |
| `pytest` | `>=7.4.0` | 백엔드 테스트 러너 (`backend/tests/`) |
| `exchange_calendars` | `>=4.5` | 거래일 캘린더 |
| `psycopg2-binary` | `>=2.9.0` | PostgreSQL 드라이버 (`ThreadedConnectionPool` 풀링 + `execute_batch` 기반 `execute_many` 배치 헬퍼 — `backend/services/db.py`) |
| `authlib` | `>=1.3.0` | OAuth 클라이언트 지원 |
| `python-jose[cryptography]` | `>=3.3.0` | JWT 인코드/디코드 (HS256) |
| `bcrypt` | `>=4.0.0` | 비밀번호 해싱 |
| `itsdangerous` | `>=2.0.0` | 서명된 세션/state 값 |
| `python-dotenv` | (무제약) | 기동 시 `.env` 로딩 |

`anthropic` 의존성 없음 — 백엔드는 LLM 호출을 하지 않는다. AI 분석 텍스트는 외부 Cowork enrich API로 들어온다.

실행 (`CLAUDE.md` 기준): `cd backend && python -m uvicorn main:app --reload --port 8000`. 테스트: `cd backend && .venv/bin/python -m pytest`.

로깅: 서비스 모듈 대부분이 `logging.getLogger` 로거를 사용한다 (`backend/services/` 29개 모듈에 `getLogger` — task#138에서 잔여 `print` → `logger` 마이그레이션 진행. 단 `us_sector_service.py` 등 일부에 `print` 잔존).

### 스케줄러 (`backend/scheduler/` 패키지)

APScheduler 설정은 단일 `scheduler.py`가 아니라 `backend/scheduler/` 패키지 (`backend/main.py`가 `import scheduler as sched`):
- `backend/scheduler/_state.py` — `AsyncIOScheduler` 모듈 싱글톤.
- `backend/scheduler/schedule.py` — `_build_trigger`가 `CronTrigger(**build_trigger_kwargs(spec), timezone=timezone)` 반환.
- `backend/scheduler/jobs.py` — 잡 함수 본문 + `_JOB_FUNCS` 매핑 (예: `kr_sector_fetch`, `us_sector_fetch`).
- `backend/scheduler/__init__.py` — 잡 배선 + 기동 시드 (`_seed_rankings_if_empty` / `_seed_kr_sector_if_empty` / `_seed_us_sector_if_empty` — 빈 캐시면 기동 시 1회 적재).

## 프론트엔드 — React 19 + Vite 8

`frontend/package.json` (`"name": "frontend"`, `"private": true`, ESM). 스크립트: `dev` (`vite`), `build` (`vite build`), `test` (`vitest run`), `lint` (`eslint .`), `preview` (`vite preview`).

런타임 의존성:

| 패키지 | 제약 | 역할 |
|---|---|---|
| `react` / `react-dom` | `^19.2.5` | UI 런타임 |
| `react-router-dom` | `^7.14.2` | 라우팅 |
| `axios` | `^1.16.0` | HTTP 클라이언트 |
| `recharts` | `^3.8.1` | 차트 (d3/victory-vendor와 함께 `charts` 수동 청크로 분리) |

개발 의존성:

| 패키지 | 제약 | 역할 |
|---|---|---|
| `vite` | `^8.0.10` | 빌드 도구 / 개발 서버 (**Vite 8 = rolldown 번들러 — manualChunks는 함수 형식만**) |
| `@vitejs/plugin-react` | `^6.0.1` | React 플러그인 |
| `vite-plugin-pwa` | `^1.3.0` | PWA (서비스 워커, manifest) |
| `vitest` | `^4.1.9` | 테스트 러너 (설정은 `vite.config.js` `test` 블록에 내장) |
| `jsdom` | `^29.1.1` | 테스트 DOM 환경 |
| `@testing-library/react` | `^16.3.2` | 컴포넌트 테스트 |
| `@testing-library/jest-dom` | `^6.9.1` | DOM 매처 |
| `eslint` | `^10.2.1` | 린터 (`frontend/eslint.config.js`) |
| `@eslint/js` | `^10.0.1` | ESLint 베이스 |
| `eslint-plugin-react-hooks` | `^7.1.1` | Hooks 린트 |
| `eslint-plugin-react-refresh` | `^0.5.2` | Fast-refresh 린트 |
| `globals` | `^17.5.0` | ESLint 전역 |
| `@types/react` / `@types/react-dom` | `^19.2.x` | 에디터 타입 힌트 |

### Vitest 하니스

별도 `vitest.config.js` 없이 `frontend/vite.config.js`의 `test` 블록: `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`. 하니스 파일: `frontend/src/test/setup.js`, `frontend/src/test/smoke.test.js`.

## 빌드 & 설정 파일

### `frontend/vite.config.js`
- 플러그인: `@vitejs/plugin-react`, `VitePWA` (`registerType: 'autoUpdate'`, `injectRegister: 'auto'`, workbox `cacheId`가 `BUILD_DATE` 타임스탬프 키, 런타임 캐싱 google-fonts / cdn-fonts / `api-cache` NetworkFirst — `/api/auth/`는 제외, manifest 인라인 정의, `pwaAssets` 옵션은 task#134에서 제거됨), 커스텀 인라인 `sw-cache-bust` 플러그인 (`closeBundle`에서 `registerSW.js` / `manifest.webmanifest` / `sw.js`에 `?<BUILD_DATE>` 부착).
- `build.rollupOptions.output.manualChunks(id)` — **함수 형식** (rolldown 요구): `recharts`/`/d3-`/`victory-vendor` → `charts` 청크, 그 외 `node_modules` → `vendor`.
- `server`: 포트 5173, `/api` → `http://localhost:8000` 프록시 (`changeOrigin: true`), `watch.usePolling: true` (interval 500ms).

### `backend/Dockerfile`
`python:3.12-slim`, `WORKDIR /app`, `pip install --no-cache-dir -r requirements.txt`, `COPY . .`, `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]`.

### `docker-compose.yml` (version `"3.9"`, 4개 서비스)
- `postgres` — `postgres:16-alpine`, db/user `portfolion`, 비밀번호 `${POSTGRES_PASSWORD:-portfolion}` 보간, 포트 `5432:5432`, `pgdata` 볼륨, init SQL 마운트: `backend/auth_schema.sql` → `01-auth.sql`, `backend/app_schema.sql` → `02-app.sql` (auth가 app보다 먼저). 헬스체크 `pg_isready`.
- `backend` — `build: ./backend`, postgres healthy 의존, `env_file: ./backend/.env.docker`.
- `nginx` — `nginx:alpine`, 포트 `80:80` + `443:443`, `frontend/dist` (`:ro`) / `nginx/nginx.conf` (`:ro`) / `certbot/conf`·`certbot/www` (`:ro`) 마운트.
- `certbot` — `certbot/certbot` 이미지, 12시간마다 `certbot renew` 루프.
- 네임드 볼륨: `pgdata`.

(`CLAUDE.md` 기준: 실제 `backend` 컨테이너는 `deploy.sh`가 `docker run`으로 띄우므로 `docker compose ps`에 안 잡힌다.)

### `nginx/nginx.conf`
HTTP `:80` 서버: `/.well-known/acme-challenge/` → certbot webroot; `/health`·`/api/` → `http://backend:8000` 프록시 (`/api/`엔 `X-Forwarded-*` 헤더); `/index.html`·`sw.js`/`workbox-*.js`는 `no-store`; 해시 자산 (`js|css|png|...|woff2?`)은 `max-age=31536000, immutable`; SPA 폴백 `try_files $uri /index.html`. `:443` SSL 서버 블록은 존재하나 주석 처리.

## 개발 vs 프로덕션

- **개발**: `./start.sh` (macOS) / `start.bat` (Windows)가 백엔드(uvicorn :8000)+프론트(vite :5173) 동시 기동. Vite dev 서버가 `/api`를 로컬 백엔드로 프록시.
- **프로덕션**: Mac 로컬 Docker 4-컨테이너 + Cloudflare Tunnel (`portfolion.taebro.com` → localhost:80). 프론트는 nginx가 로컬 빌드된 `frontend/dist`를 직접 서빙 — `npm run build` 즉시 라이브. 백엔드는 push → self-hosted GitHub Actions 러너(주) / 2분 폴러(폴백) → `deploy.sh` 재배포 후 라이브 (INTEGRATIONS.md 배포 섹션 참조).
- 배포 환경 프론트는 `VITE_API_BASE_URL` 미설정 시 상대경로 사용 (nginx `/api` 프록시 경유).

## 환경변수

이름만 나열 (`backend/.env.docker` 기준; 값은 절대 기재하지 않음). 템플릿 `backend/.env.docker.example`. 루트 `.env`는 docker-compose 보간용 (`FRED_API_KEY`, `KITA_API_KEY` 등). CORS origins (`backend/main.py`): `localhost:3000`, `localhost:5173`, + `FRONTEND_URL`.

- `DATABASE_URL` — PostgreSQL DSN (`backend/services/db.py`가 `os.environ["DATABASE_URL"]` 읽음)
- `POSTGRES_PASSWORD` — postgres 컨테이너 비밀번호 (compose 보간)
- `JWT_SECRET` — HS256 서명키 (`backend/services/auth_service.py`)
- `SESSION_SECRET` — 서명된 세션/state
- `FRONTEND_URL` — OAuth 리다이렉트 베이스 + CORS origin
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — GitHub OAuth
- `FRED_API_KEY` — FRED (경제지표/매크로 신호/캘린더 릴리즈 일정)
- `DART_API_KEY` — OpenDART (수주잔고, 공시, 주총, 내부자, KR 배당/재무)
- `KOFIA_API_KEY` — KOFIA / data.go.kr (수급지표 + 대차잔고)
- `KITA_API_KEY` — 실제로는 관세청 키 (수출; 미설정 시 UN Comtrade 폴백)
- `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIWOOM_BASE_URL` — 키움 REST (KR 시세/업종 등)
- `KIS_APP_KEY`, `KIS_APP_SECRET` — KIS 백업 시세 (`KIS_BASE_URL`은 기본값 있는 선택 키)
- `COWORK_API_KEY` — 외부 Cowork enrich API 키
- `ANTHROPIC_API_KEY` — env 파일에 존재하나 백엔드에서 현재 미사용
