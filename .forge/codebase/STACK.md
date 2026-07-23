---
last_mapped_commit: 44629f27cfb796dbd2120b7002a99e3d82f7c725
mapped: 2026-07-24
---

# STACK — 언어·런타임·프레임워크·의존성·빌드

PortfoliOn의 기술 스택 실측 매핑. 도메인 정의는 다루지 않고 구현 사실만 기록한다.

## 백엔드 (Python / FastAPI)

- **런타임**: Docker 컨테이너 = **Python 3.12** (`backend/Dockerfile` = `FROM python:3.12-slim`). 로컬 개발 = **Python 3.9.6** (`backend/.venv`).
  - ⚠️ 로컬 3.9 ≠ Docker 3.12 갭: 런타임 평가 어노테이션(Pydantic 모델·FastAPI 시그니처)에 PEP604 `X | None` 금지 → `Optional[X]` 사용. `from __future__ import annotations`가 있는 모듈(예: `backend/services/db.py`의 `ThreadedConnectionPool | None`)은 문자열화되어 로컬에서도 통과.
  - ⚠️ `lxml`은 `requirements.txt`에 있고 Docker엔 설치되나 **로컬 `.venv`엔 없음** → 로컬 pytest로 검증할 HTML 파싱은 `BeautifulSoup(html, "html.parser")` 사용(`"lxml"` 금지).
- **웹 프레임워크**: `fastapi>=0.104.0`. 앱 엔트리 `backend/main.py` (`app` 객체), 서버 = `uvicorn[standard]>=0.24.0` (`uvicorn main:app --host 0.0.0.0 --port 8000`).
  - 라우터 마운트: `backend/main.py`가 `backend/routers/`의 20개 라우터 include (`portfolio`, `report`, `watchlist`, `stocks`, `guru`, `calendar`, `digest`, `analytics`, `market_indicators`, `analysis`, `auth`, `admin`, `events`, `rankings`, `investor`, `short_sell`, `batches`, `recommendations`).
  - 미들웨어: `CORSMiddleware`(CORS), `SessionMiddleware`(starlette, itsdangerous 기반), `middleware/event_tracker.EventTrackerMiddleware`.
  - 기동 훅: `_configure_logging()`(루트 로거 1회 배선, `basicConfig(level=INFO)` + urllib3/yfinance/apscheduler/asyncio는 WARNING 억제 + uvicorn `propagate=False`), `_migrate()`(idempotent `ADD COLUMN`/`CREATE TABLE IF NOT EXISTS` DDL), `_warm_market_cache()`.
- **스케줄러**: `apscheduler>=3.10.4`. `backend/scheduler/` 패키지(`__init__.py`·`jobs.py`·`schedule.py`·`_state.py`), `main.py`가 `import scheduler as sched`로 배선.
- **데이터 처리**: `pandas>=2.1.0`, `numpy>=1.26.0`.
- **HTTP 클라이언트**: `requests>=2.31.0`(대부분의 외부 fetch), `httpx>=0.25.0`.
- **HTML/파싱**: `beautifulsoup4>=4.12.0`, `lxml>=4.9.0`(Docker 전용, 위 갭 참조).
- **시세/금융**: `yfinance>=0.2.40`(US 시세·재무·배당·내부자), `exchange_calendars>=4.5`(장 캘린더).
- **DB 드라이버**: `psycopg2-binary>=2.9.0`. `backend/services/db.py`가 `ThreadedConnectionPool`(minconn=1, **maxconn=20**, `dsn=DATABASE_URL`)로 풀 관리, `RealDictCursor`·`execute_batch` 사용. `get_connection()` 컨텍스트매니저가 commit/rollback/putconn 처리. `query`/`execute` 헬퍼 노출.
- **인증/보안 라이브러리**: `authlib>=1.3.0`, `python-jose[cryptography]>=3.3.0`(`jose.jwt`, HS256), `bcrypt>=4.0.0`(패스워드 해시), `itsdangerous>=2.0.0`(세션 서명).
- **환경변수 로딩**: `python-dotenv`(`main.py`가 `load_dotenv()` 최상단 호출).
- **테스트**: `pytest>=7.4.0`. 실행 `cd backend && .venv/bin/python -m pytest`. `tests/conftest.py`가 `_block_real_db` autouse 가드로 실 DB 접근 차단(task#169).

## 프론트엔드 (React 19 + Vite 8)

- **프레임워크**: `react@^19.2.5` + `react-dom@^19.2.5`. `frontend/src/`, plain CSS(TailwindCSS 미사용).
- **라우팅**: `react-router-dom@^7.14.2`.
- **차트**: `recharts@^3.8.1`(+ 트랜지티브 d3).
- **HTTP**: `axios@^1.16.0`.
- **빌드 도구**: `vite@^8.0.10` — **Vite 8 = rolldown 번들러**. `@vitejs/plugin-react@^6.0.1`.
  - ⚠️ `vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 지원(rollup식 객체형 쓰면 `Expected Function but received Object`). 현재 `manualChunks(id)`가 `node_modules` substring으로 분기: `charts`(recharts/`/d3-`/victory-vendor), 나머지 `vendor`.
  - 커스텀 플러그인 `sw-cache-bust`(closeBundle 후 `index.html`·`registerSW.js`에 `BUILD_DATE` 쿼리 부착).
- **PWA**: `vite-plugin-pwa@^1.3.0`(Workbox, `registerType: 'autoUpdate'`, manifest·runtimeCaching 정의). manifest name `PortfoliOn`, `display: standalone`, `lang: ko`.
- **테스트**: `vitest@^4.1.9`(`vitest run`), `jsdom@^29.1.1`, `@testing-library/react@^16.3.2`, `@testing-library/jest-dom@^6.9.1`. 설정 `vite.config.js`의 `test`(environment jsdom, setupFiles `./src/test/setup.js`).
- **린트**: `eslint@^10.2.1`, `@eslint/js`, `eslint-plugin-react-hooks@^7.1.1`, `eslint-plugin-react-refresh`.
- **npm 스크립트**(`frontend/package.json`): `dev`(vite), `build`(vite build), `test`(vitest run), `lint`(eslint .), `preview`(vite preview). `"type": "module"`.
- **개발 서버**: 포트 **5173**, `/api` → `http://localhost:8000` 프록시(`changeOrigin`), watch `usePolling`.
- **API 베이스**: 배포 환경은 `VITE_API_BASE_URL`(미설정 시 상대경로).

## 설정 / 빌드 / 배포 스택

- **인프라**: Mac 로컬 Docker 4-컨테이너 (`docker-compose.yml`).
  - `postgres` — `postgres:16-alpine`, DB/USER `portfolion`, 포트 5432 노출, `pgdata` 볼륨, init 스크립트 `backend/auth_schema.sql`(01) → `backend/app_schema.sql`(02), healthcheck `pg_isready`.
  - `backend` — `build: ./backend`, `env_file: ./backend/.env.docker`, postgres healthy 대기.
  - `nginx` — `nginx:alpine`, 포트 80/443, `./frontend/dist:ro`(정적 서빙)·`./nginx/nginx.conf:ro`·certbot 볼륨 마운트.
  - `certbot` — `certbot/certbot`, `certbot renew` 12h 루프.
- **정식 배포 스크립트** `deploy.sh`: ① `frontend` npm install+build → `frontend/dist`, ② `docker build -t portfolion-backend ./backend`, ③ backend는 **`docker run`**으로 교체(`portfolion-backend-1`, network `portfolion_default`, alias `backend`, `--env-file ./backend/.env.docker`) — 그래서 `docker compose ps`엔 안 잡힘, ④ nginx도 `docker run`으로 교체(`portfolion-nginx-1`). `/tmp/portfolion-deploy.lock`로 동시 배포 방지.
- **nginx** (`nginx/nginx.conf`): `listen 80`, `/api/`·`/health` → `http://backend:8000` 프록시, SPA는 `frontend/dist` 직접 서빙(PWA `sw.js`/workbox 별도 location). 443 ssl 블록은 현재 주석 처리(HTTPS 종단은 Cloudflare Tunnel).
- **Cloudflare Tunnel**: `portfolion.taebro.com` → `localhost:80`. `cloudflared`는 compose 컨테이너가 아니라 **launchd** 실행.
- **launchd 자동실행**: cloudflared + docker compose.
- **자동 배포 경로**: **GitHub Actions self-hosted 러너**(`deploy.yml`, `runs-on: self-hosted`, PortfoliOn 전용 러너 `~/actions-runner-portfolion`)가 주경로 + **폴러**(`scripts/auto-deploy-poll.sh`, launchd `com.portfolion.auto-deploy-poll`, 2분마다 `LOCAL != origin/main`이면 `git reset --hard origin/main` 후 `deploy.sh`) 폴백.
- **환경변수 파일**: `backend/.env.docker`(백엔드 시크릿 — 값은 INTEGRATIONS.md 참조), `.env`(루트, docker-compose 보간용).
- **프론트 즉시 라이브**: nginx가 `frontend/dist`를 직접 서빙 → 로컬 `npm run build`가 즉시 반영(배포 무관). 백엔드 변경은 폴러/러너 재배포 후 라이브.

## 로깅 / 마이그레이션 규약(빌드 관점)

- 백엔드 로그는 모듈 `logger` 통일, `print` 신규 금지(`tests/test_no_print.py`가 단언).
- 신규 DB 컬럼은 `app_schema.sql`(신규 설치용)만으론 라이브 반영 안 됨 → `main.py:_migrate()`에 `ADD COLUMN IF NOT EXISTS` 쌍 추가 필수(라이브는 기동 idempotent 마이그레이션만 탄다).
