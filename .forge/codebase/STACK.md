---
last_mapped_commit: 74f5ca940c42a3ee866a45ccccfe24ac701a04d9
mapped: 2026-06-27
---

# 기술 스택

**분석 일자:** 2026-06-27

## 언어

**Primary:**
- Python 3.12 — 백엔드 전체 (`backend/`). Docker 이미지 `python:3.12-slim` (`backend/Dockerfile:1`)으로 고정. 로컬 가상환경은 `backend/.venv/`.
- JavaScript (ES Modules, JSX) — 프론트엔드 전체 (`frontend/src/`). `frontend/package.json:5`에서 `"type": "module"`.

**Secondary:**
- SQL — 스키마 정의 (`backend/auth_schema.sql`, `backend/app_schema.sql`). 기동 시 idempotent DDL 마이그레이션은 `backend/main.py:54`의 `_migrate()`.
- Bash — 배포/기동 스크립트 (`deploy.sh`, `start.sh`, `stop.sh`, `scripts/auto-deploy-poll.sh`, `scripts/ddns_update.sh`).

> 백엔드에 TypeScript/타입 체커 미사용. 프론트는 JS + JSX(`@types/react` devDependency는 에디터 인텔리센스용이며 TS 컴파일은 없음).

## 런타임

**백엔드:**
- Python 3.12 / ASGI. 엔트리: `backend/main.py`의 `app = FastAPI(...)`.
- 서버: uvicorn (`uvicorn[standard]`). 컨테이너 CMD `uvicorn main:app --host 0.0.0.0 --port 8000` (`backend/Dockerfile:10`). 로컬은 `python -m uvicorn main:app --reload --port 8000`.

**프론트엔드:**
- Node.js / Vite 8 (rolldown 번들러). dev 서버 포트 5173 (`frontend/vite.config.js:120`).
- Node 버전 핀 없음(`.nvmrc` 부재).

**패키지 매니저:**
- 백엔드: `pip` + `backend/requirements.txt` (버전 핀은 `>=` 하한만, 락파일 없음).
- 프론트: `npm` + `frontend/package-lock.json` (락파일 존재). `scripts/` 디렉터리도 별도 `scripts/package.json` + `scripts/package-lock.json` (Playwright UAT 도구).

## 프레임워크

**백엔드 Core:**
- `fastapi>=0.104.0` — REST API. 라우터 18개 마운트 (`backend/main.py:168-185`).
- `uvicorn[standard]>=0.24.0` — ASGI 서버.
- `apscheduler>=3.10.4` — 배치 스케줄러. 설정 패키지 `backend/scheduler/`(`__init__.py`·`_state.py`·`jobs.py`·`schedule.py`), 잡 함수는 `backend/scheduler/jobs.py`, 레지스트리는 `backend/services/batch_registry.py`.
- `starlette` (FastAPI 트랜지티브) — `SessionMiddleware`(`backend/main.py:157`), `CORSMiddleware`. 커스텀 미들웨어 `backend/middleware/event_tracker.py`.

**백엔드 데이터/연산:**
- `pandas>=2.1.0`, `numpy>=1.26.0` — 시세 시계열·지표 계산.
- `matplotlib>=3.8.0` — 차트 생성 (`backend/services/charts.py`).
- `exchange_calendars>=4.5` — 거래일 계산 (`backend/services/storage/dates.py`).
- `yfinance>=0.2.40` — US 시세·히스토리·섹터 (`backend/services/market/us.py`).
- `beautifulsoup4>=4.12.0` + `lxml>=4.9.0` — HTML 파싱. **로컬 `.venv`엔 lxml 미설치** — 로컬 pytest 대상 코드는 `html.parser` 사용 권장(프로젝트 Gotcha).

**백엔드 HTTP 클라이언트:**
- `requests>=2.31.0` — 동기 외부 호출 (키움·KIS·Naver·DART·FRED·KOFIA 등 대부분).
- `httpx>=0.25.0` — 비동기 호출 (OAuth 토큰 교환, `backend/routers/auth.py`).

**백엔드 인증/보안:**
- `python-jose[cryptography]>=3.3.0` — JWT 발급/검증 (`backend/services/auth_service.py:9`).
- `bcrypt>=4.0.0` — 비밀번호 해싱 (`backend/services/auth_service.py:8`).
- `authlib>=1.3.0` — OAuth 보조.
- `itsdangerous>=2.0.0` — Starlette 세션 서명.
- `python-dotenv` — `.env` 로드 (`backend/main.py:1`).

**백엔드 DB:**
- `psycopg2-binary>=2.9.0` — PostgreSQL 드라이버. `ThreadedConnectionPool`(minconn=1, maxconn=20) (`backend/services/db.py:21-27`).

**백엔드 테스트:**
- `pytest>=7.4.0` — 테스트 러너. 테스트 77개 파일 (`backend/tests/test_*.py`), 공용 픽스처 `backend/tests/conftest.py`·`backend/tests/fixtures/`.

**프론트엔드 Core:**
- `react@^19.2.5` + `react-dom@^19.2.5` — UI.
- `react-router-dom@^7.14.2` — 라우팅.
- `axios@^1.16.0` — API 호출.
- `recharts@^3.8.1` — 차트(별도 `charts` 청크로 분리, `frontend/vite.config.js:105`).
- `react-markdown@^10.1.0` + `remark-gfm@^4.0.1` — 마크다운 렌더(`markdown` 청크).

**프론트엔드 Build/Dev:**
- `vite@^8.0.10` (rolldown) — 빌드/dev 서버. **manualChunks는 함수 형식만** 지원 (`frontend/vite.config.js:103`).
- `@vitejs/plugin-react@^6.0.1` — React 플러그인.
- `vite-plugin-pwa@^1.3.0` + `@vite-pwa/assets-generator@^1.0.2` — PWA(서비스워커, manifest) (`frontend/vite.config.js:10-67`).
- `eslint@^10.2.1` + `@eslint/js` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` + `globals` — 린팅. 설정 `frontend/eslint.config.js`(flat config).

**프론트엔드 테스트:**
- `vitest@^4.1.9` — 러너 (`environment: jsdom`, `globals: true`, `setupFiles: ./src/test/setup.js`, `frontend/vite.config.js:94-98`).
- `@testing-library/react@^16.3.2` + `@testing-library/jest-dom@^6.9.1` — 컴포넌트 테스트.
- `jsdom@^29.1.1` — DOM 환경.
- 테스트 파일: `frontend/src/test/smoke.test.js`, `frontend/src/hooks/useStockManagement.test.js`, `frontend/src/hooks/useReportFilters.test.js`. setup: `frontend/src/test/setup.js`.

## 구성 (Configuration)

**환경 변수 로드:**
- 백엔드: `backend/main.py:1-2`의 `load_dotenv()`. 컨테이너는 `env_file: ./backend/.env.docker` (`docker-compose.yml:28`). docker-compose 보간용 루트 `.env`도 존재.
- 템플릿: `backend/.env.docker.example` (값 없는 키 목록).

**필수/주요 환경 변수** (코드에서 `os.environ[...]`로 직접 참조 = 미설정 시 기동/요청 실패):
- `DATABASE_URL` — PostgreSQL DSN (`backend/services/db.py:26`).
- `SESSION_SECRET` — Starlette 세션 서명 (`backend/main.py:157`).
- `JWT_SECRET` — JWT 서명 (`backend/services/auth_service.py:19`).
- `FRONTEND_URL` — OAuth redirect 베이스 + CORS origin (`backend/main.py:160`, `backend/routers/auth.py`).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — OAuth (`backend/routers/auth.py`).

**선택 환경 변수** (`os.environ.get(...)` = 미설정 시 해당 기능 휴면·폴백):
- `FRED_API_KEY` — FRED 경제/매크로 지표.
- `DART_API_KEY` — DART 공시·수주잔고·배당·내부자 거래.
- `KOFIA_API_KEY` — 공공데이터포털 신용잔고·대차잔고 (leverage/lending 공용 키).
- `KITA_API_KEY` — 관세청 수출입 통계(미설정 시 UN Comtrade 폴백).
- `KIWOOM_APP_KEY` / `KIWOOM_SECRET_KEY` / `KIWOOM_BASE_URL` — 키움 KR 시세.
- `KIS_APP_KEY` / `KIS_APP_SECRET` / `KIS_BASE_URL` — 한국투자증권 백업 시세.
- `COWORK_API_KEY` — 외부 Cowork 클라이언트 enrich 인증 (`backend/auth.py`).
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — 다이제스트 알림 (`backend/services/digest_service.py`).
- `ANTHROPIC_API_KEY` — `.env.docker`에 남아있으나 **현재 백엔드 미사용**(requirements.txt에 anthropic 없음; AI 분석은 외부 Cowork가 작성).

**프론트엔드 빌드 환경 변수:**
- `VITE_API_BASE_URL` — 미설정 시 상대경로(`/api`) 사용. 로컬 dev는 Vite 프록시가 `/api → http://localhost:8000` (`frontend/vite.config.js:121-125`).

> 비밀값 자체는 절대 인용 금지. `.env`, `.env.docker`는 존재만 확인하고 내용 미열람.

**빌드 설정 파일:**
- `frontend/vite.config.js` — Vite 빌드(manualChunks 청크 분할), PWA, dev 프록시, vitest 설정.
- `frontend/eslint.config.js` — ESLint flat config.
- `frontend/index.html` — SPA 엔트리.
- `frontend/vercel.json` — 레거시(현재 배포는 nginx, Vercel 미사용).
- `backend/Dockerfile` — 백엔드 이미지.
- `docker-compose.yml` — postgres/backend/nginx/certbot 4컨테이너 정의.
- `nginx/nginx.conf` — HTTP(80)/HTTPS(443) 서빙 + `/api/*` → backend:8000 프록시.

## 플랫폼 요구사항

**개발:**
- Python 3.12 + `backend/.venv/`, Node.js + npm.
- Docker(로컬 PostgreSQL 컨테이너) 또는 로컬 PostgreSQL.
- 양 서버 동시 기동: `start.bat`(Windows) / `./start.sh`(macOS/Linux).

**프로덕션:**
- Mac 로컬 Docker, 4컨테이너 (`docker-compose.yml`): `postgres`(postgres:16-alpine), `backend`(빌드), `nginx`(nginx:alpine), `certbot`(certbot/certbot). backend는 `deploy.sh`가 `docker run`으로 직접 기동(=`docker compose ps`에 안 잡힘).
- 외부 노출: Cloudflare Tunnel(`cloudflared`, launchd 실행, compose 외부) → localhost:80.
- 자동 배포: GitHub Actions self-hosted 러너(`.github/workflows/deploy.yml`, `runs-on: self-hosted`) + 폴러 폴백(`scripts/auto-deploy-poll.sh`). 둘 다 `deploy.sh` 실행. 프론트는 nginx가 `frontend/dist`를 `:ro` 마운트로 직접 서빙(`docker-compose.yml:37`).

---

*Stack analysis: 2026-06-27*
