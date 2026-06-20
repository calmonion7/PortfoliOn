---
last_mapped_commit: 91173837359c5f157349a51501f72efa7342c3fa
mapped: 2026-06-20
---

# STACK

PortfoliOn은 Python/FastAPI 백엔드(`backend/`)와 React 19 + Vite 프론트엔드(`frontend/`)로 구성된 모놀리식 2-tier 앱이다. 정적 자산은 nginx가 직접 서빙하고, 런타임 데이터는 Docker PostgreSQL에 저장한다. 통합·DB·인증·배포 사실은 `INTEGRATIONS.md`에 있다.

## Languages & Runtimes

- **Python 3.12** — 백엔드 런타임. Docker 이미지는 `python:3.12-slim`(`backend/Dockerfile`). 로컬 가상환경은 `backend/.venv/`(macOS: `backend/.venv/bin/python`).
- **JavaScript (ESM)** — 프론트엔드. `frontend/package.json`에 `"type": "module"`.
- **Bash** — 배포/운영 스크립트(`deploy.sh`, `scripts/auto-deploy-poll.sh`, `scripts/ddns_update.sh`, `start.sh`).
- **SQL** — PostgreSQL 스키마(`backend/auth_schema.sql`, `backend/app_schema.sql`).

## Backend Framework & Key Python Libraries

의존성 선언: `backend/requirements.txt`(버전은 `>=` 하한으로 고정).

- **FastAPI** (`>=0.104.0`) — 웹 프레임워크. 앱 엔트리 `backend/main.py`가 라우터 18종을 `app.include_router`로 마운트하고 lifespan 훅에서 마이그레이션·스케줄러·캐시 워밍을 수행.
- **uvicorn[standard]** (`>=0.24.0`) — ASGI 서버. 컨테이너 CMD `uvicorn main:app --host 0.0.0.0 --port 8000`.
- **APScheduler** (`>=3.10.4`) — 배치 스케줄러. `AsyncIOScheduler` 사용(`backend/scheduler/_state.py`), 크론 트리거는 `CronTrigger`(`backend/scheduler/schedule.py`). 자세한 잡 목록·동작은 `INTEGRATIONS.md`.
- **psycopg2-binary** (`>=2.9.0`) — PostgreSQL 드라이버. `ThreadedConnectionPool`(minconn=1, maxconn=20)을 싱글톤으로 관리(`backend/services/db.py`), `RealDictCursor`로 dict 반환.
- **yfinance** (`>=0.2.40`) — US 시세/재무/히스토리 1차 소스. 다수 라우터·서비스에서 사용(`backend/routers/stocks.py`, `report.py`, `analysis.py`, `analytics.py`, `calendar.py`, `services/scraper.py`, `consensus_pipeline.py`, `indicators.py`, `cache.py`, `digest_service.py`, `services/market_indicators/`).
- **pandas** (`>=2.1.0`) / **numpy** (`>=1.26.0`) — 시계열·수익률·상관계산.
- **matplotlib** (`>=3.8.0`) — 차트 생성(`backend/services/charts.py`).
- **requests** (`>=2.31.0`) — 키움/KIS/DART/FRED/공공데이터 등 외부 REST 호출의 공통 동기 HTTP 클라이언트.
- **httpx** (`>=0.25.0`) — 비동기 HTTP. OAuth 토큰 교환·프로필 조회(`backend/routers/auth.py`)에 사용.
- **beautifulsoup4** (`>=4.12.0`) + **lxml** (`>=4.9.0`) — HTML 파싱(스크래핑, DART 원문 파싱). **주의**: `lxml`은 Docker 이미지엔 있으나 로컬 `backend/.venv`엔 없을 수 있어, 로컬 검증 코드는 stdlib `html.parser` 파서 권장.
- **exchange_calendars** (`>=4.5`) — 거래소 영업일/리포트 기대일 계산.
- **authlib** (`>=1.3.0`) — OAuth 보조.
- **python-jose[cryptography]** (`>=3.3.0`) — JWT 인코딩/디코딩(HS256). 인증은 `INTEGRATIONS.md`.
- **bcrypt** (`>=4.0.0`) — 비밀번호 해시(`backend/services/auth_service.py`).
- **itsdangerous** (`>=2.0.0`) — Starlette `SessionMiddleware` 서명(`backend/main.py`).
- **python-dotenv** — `.env` 로딩(`load_dotenv()` in `backend/main.py`).
- **pytest** (`>=7.4.0`) — 백엔드 테스트(`backend/tests/`). 실행: `backend/.venv/bin/python -m pytest`.

> 참고: `anthropic`/LLM SDK는 `requirements.txt`에 **없고** 백엔드 코드에 import도 없다(`grep` 결과 0). 리포트 생성(`backend/services/report_generator.py`)은 시장 데이터 스냅샷만 만들고 AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 채운다.

## Frontend Framework & Key npm Dependencies

선언: `frontend/package.json`.

- **React 19** (`react`/`react-dom` `^19.2.5`).
- **Vite 8** (`^8.0.10`) — 빌드 도구/dev 서버(port 5173). **Vite 8은 rolldown 번들러** 기반이라 `vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 지원(객체형 쓰면 빌드 실패). 현재 `manualChunks(id)`가 `node_modules` 경로 substring으로 `charts`(recharts/d3/victory-vendor), `markdown`(react-markdown 트랜지티브 일체), `vendor`로 3분할.
- **@vitejs/plugin-react** (`^6.0.1`) — React Fast Refresh/JSX.
- **react-router-dom** (`^7.14.2`) — 라우팅.
- **recharts** (`^3.8.1`) — 차트(시장지표·재무·컨센서스). d3 트랜지티브 포함해 `charts` 청크로 분리.
- **react-markdown** (`^10.1.0`) + **remark-gfm** (`^4.0.1`) — AI 리포트 텍스트 렌더링.
- **axios** (`^1.16.0`) — HTTP 클라이언트.
- **vite-plugin-pwa** (`^1.3.0`) + **@vite-pwa/assets-generator** (`^1.0.2`, dev) — PWA(서비스워커/manifest). `vite.config.js`에서 `registerType: 'autoUpdate'`, workbox runtimeCaching(google-fonts/cdn-fonts CacheFirst, `/api/*` NetworkFirst 단 `/api/auth/*` 제외), manifest(name `PortfoliOn`, `display: standalone`, `lang: ko`). 커스텀 빌드 플러그인 `sw-cache-bust`가 `closeBundle`에서 `index.html`/`registerSW.js`에 BUILD_DATE 쿼리스트링을 주입해 SW 캐시 버스팅.
- **CSS**: 플레인 CSS만 사용(TailwindCSS 없음). 토큰은 `frontend/src/styles/tokens.css`(KR 색 관례: `--up`=빨강/`--down`=파랑).

### Frontend Build Tooling

- **빌드**: `npm run build` → `vite build` → `frontend/dist/`. nginx가 `dist`를 `:ro`로 볼륨마운트해 직접 서빙(`docker-compose.yml`).
- **dev 프록시**: `vite.config.js` `server.proxy`가 `/api` → `http://localhost:8000`. 파일워치는 `usePolling: true, interval: 500`.
- **API base URL**: 프론트는 배포 환경에서 `VITE_API_BASE_URL` 사용(미설정 시 상대경로). 자세한 환경변수는 `INTEGRATIONS.md`.
- **Lint**: ESLint 10(`@eslint/js` `^10.0.1`, `eslint` `^10.2.1`) + `eslint-plugin-react-hooks` `^7.1.1` + `eslint-plugin-react-refresh`. `npm run lint`.

## Configuration Files

- `backend/requirements.txt` — Python 의존성.
- `frontend/package.json` / `frontend/package-lock.json` — npm 의존성·스크립트.
- `frontend/vite.config.js` — Vite/PWA/번들 청크/dev 프록시 설정.
- `docker-compose.yml` — 4 컨테이너(postgres / backend / nginx / certbot) 정의(상세는 `INTEGRATIONS.md`).
- `backend/Dockerfile` — `python:3.12-slim`, `pip install -r requirements.txt`, uvicorn CMD.
- `nginx/nginx.conf` — HTTP(80) 서빙·`/api/` 프록시·캐시 정책(상세는 `INTEGRATIONS.md`).
- `backend/.env.docker.example` — 백엔드 환경변수 템플릿(키 이름만; 실값 없음).
- `.env`(루트) — docker-compose 보간용.
- `backend/auth_schema.sql` / `backend/app_schema.sql` — PostgreSQL 스키마(컨테이너 init 순서: auth → app).
- ESLint flat config(`frontend/eslint.config.js` 계열).

## Repository Tooling

- `start.sh` / `start.bat` / `stop.bat` — 백엔드+프론트 동시 기동/종료 헬퍼.
- `scripts/` — 운영/UAT 스크립트(`auto-deploy-poll.sh`, `screenshot.js`, `capture-*.js`, `uat-*.js` 등; Playwright 기반 UAT 스크립트는 node_modules 동반).
- `.forge/` — forge 워크플로 상태/문서(이 맵 포함). git untracked.
