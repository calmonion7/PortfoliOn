---
last_mapped_commit: f835958b49b4a4d7ce30254fd610ed6362462311
mapped: 2026-06-22
---

# STACK

PortfoliOn은 백엔드(Python/FastAPI)와 프론트엔드(React 19/Vite)로 구성된 모놀리식 풀스택 앱이며, Mac 로컬 Docker 4-컨테이너(postgres·backend·nginx·certbot)로 배포된다.

## Backend — Python / FastAPI

런타임은 `backend/Dockerfile`에서 `python:3.12-slim`으로 고정된다. 컨테이너 기동 명령은 `uvicorn main:app --host 0.0.0.0 --port 8000`이고, 로컬 개발은 `--reload` 옵션으로 동일 포트(8000)에서 띄운다.

의존성은 `backend/requirements.txt`에 정의된다(버전은 모두 하한 `>=` 핀):

- `fastapi>=0.104.0` — 웹 프레임워크 (앱 진입점 `backend/main.py`).
- `uvicorn[standard]>=0.24.0` — ASGI 서버.
- `apscheduler>=3.10.4` — 배치 스케줄러 (`backend/scheduler.py`, 루트 레벨; `backend/services/batch_registry.py`에 배치 카탈로그).
- `yfinance>=0.2.40` — US 시세·재무·히스토리 1차 소스, KR sector/industry 보조 (`backend/services/market/us.py`, `backend/services/market/__init__.py`).
- `pandas>=2.1.0` / `numpy>=1.26.0` — 시세 시계열·지표 계산 (`backend/services/indicators.py` 등).
- `matplotlib>=3.8.0` — 차트 렌더링 (`backend/services/charts.py`).
- `requests>=2.31.0` — 외부 HTTP 호출 전반(키움·KIS·Naver·DART·FRED·KOFIA·FnGuide·OAuth 토큰 교환 일부).
- `beautifulsoup4>=4.12.0` + `lxml>=4.9.0` — HTML 파싱(스크레이퍼·수주잔고). 단 로컬 `backend/.venv`에는 `lxml` 미설치라 로컬 테스트 코드는 `html.parser`를 써야 한다(CLAUDE.md gotcha).
- `httpx>=0.25.0` — 비동기 HTTP (OAuth 콜백 토큰 교환, `backend/routers/auth.py`).
- `pytest>=7.4.0` — 백엔드 테스트 (`cd backend && .venv/bin/python -m pytest`).
- `exchange_calendars>=4.5` — 거래소 영업일 계산.
- `psycopg2-binary>=2.9.0` — PostgreSQL 드라이버 (`backend/services/db.py`, `ThreadedConnectionPool` minconn=1/maxconn=20).
- `authlib>=1.3.0` — OAuth (라우터에 import, 다만 `auth.py`는 대부분 직접 HTTP로 OAuth 플로우 구현).
- `python-jose[cryptography]>=3.3.0` — JWT 인코딩/디코딩(HS256, `backend/services/auth_service.py`).
- `bcrypt>=4.0.0` — 비밀번호 해싱 (`auth_service.hash_password`/`verify_password`).
- `itsdangerous>=2.0.0` — starlette `SessionMiddleware` 의존성.
- `python-dotenv` — `.env` 로딩.

미들웨어(`backend/main.py`): `SessionMiddleware`(secret=`SESSION_SECRET`), 커스텀 `EventTrackerMiddleware`(사용자 행동 로깅), `CORSMiddleware`(허용 origin `http://localhost:3000`, `http://localhost:5173`, `FRONTEND_URL`). 라우터는 portfolio·watchlist·stocks·report·guru·calendar·digest·market_indicators·analytics·analysis·auth·admin·events 등(`backend/routers/`).

서비스 패키지 구조: `backend/services/market/`(시세 진입·`kr.py`·`us.py`·`format.py`), `backend/services/market_indicators/`(fx·commodities·earnings·econ·exports·macro·cache), `backend/services/kiwoom/`·`backend/services/kis/`(KR/US 시세 클라이언트), `backend/services/storage/`·`backend/services/recommendation/`(서브패키지).

## Frontend — React 19 / Vite

`frontend/package.json` (ESM, `"type": "module"`):

- React `^19.2.5` + `react-dom ^19.2.5`.
- `react-router-dom ^7.14.2` — 라우팅.
- `axios ^1.16.0` — API 호출.
- `recharts ^3.8.1` — 차트(별도 청크 `charts`로 분리).
- `react-markdown ^10.1.0` + `remark-gfm ^4.0.1` — 리포트 마크다운 렌더링(별도 청크 `markdown`).

빌드 도구(devDependencies):

- `vite ^8.0.10` — **Vite 8 = rolldown 번들러**. `frontend/vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 허용(객체형 쓰면 빌드 실패). 현재 함수가 `node_modules` 경로 substring으로 `charts`(recharts/d3/victory-vendor)·`markdown`(remark/micromark/mdast/hast 등 트랜지티브 포함)·`vendor`로 분기.
- `@vitejs/plugin-react ^6.0.1`.
- `vite-plugin-pwa ^1.3.0` + `@vite-pwa/assets-generator ^1.0.2` — PWA(서비스워커 `autoUpdate`, workbox 런타임 캐시: google-fonts/cdn-fonts CacheFirst, `/api/*`(auth 제외) NetworkFirst 5분). 매니페스트 lang=ko, theme `#f6f6f4`. `vite.config.js`에 커스텀 `sw-cache-bust` 플러그인(빌드 타임스탬프로 registerSW.js·manifest·sw.js 캐시 버스팅).
- `eslint ^10.2.1` + `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`.
- `vitest ^4.1.9` + `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`(환경), setup `./src/test/setup.js`.

scripts: `dev`(vite), `build`(vite build), `test`(vitest run), `lint`(eslint), `preview`. 스타일은 plain CSS(TailwindCSS 없음); 토큰은 `frontend/src/styles/tokens.css`(KR 색 관례: `--up`=빨강/`--down`=파랑).

개발 서버는 포트 5173, `/api`를 `http://localhost:8000`으로 프록시(`vite.config.js` server.proxy), `watch.usePolling`. 배포 환경은 `VITE_API_BASE_URL` 미설정 시 상대경로 사용(nginx 직결).

## 빌드 / 배포 구성

- `docker-compose.yml` — 4 서비스:
  - `postgres` (`postgres:16-alpine`, DB/USER `portfolion`, 비밀번호 env `POSTGRES_PASSWORD`, 포트 5432, 볼륨 `pgdata`). 초기화 SQL을 entrypoint에 마운트: `backend/auth_schema.sql` → `01-auth.sql`, `backend/app_schema.sql` → `02-app.sql`. healthcheck `pg_isready`.
  - `backend` (`build: ./backend`, `env_file: ./backend/.env.docker`, postgres healthy 의존).
  - `nginx` (`nginx:alpine`, 포트 80/443, `./frontend/dist`를 `:ro`로 직접 서빙, `./nginx/nginx.conf`·certbot 볼륨 마운트).
  - `certbot` (`certbot/certbot`, 12시간마다 `certbot renew`).
- `nginx/nginx.conf` — HTTP(80) 서빙. `/api/`·`/health`를 `http://backend:8000`으로 프록시. `index.html`·`sw.js`·`workbox-*.js`는 캐시 금지, Vite 해시 자산(js/css/img/woff2)은 `max-age=31536000 immutable` 장기 캐시, SPA 폴백 `try_files $uri /index.html`. 443 ssl 블록은 주석 처리(현재 HTTPS는 Cloudflare Tunnel이 종단).
- 환경변수 파일: `backend/.env.docker`(백엔드 시크릿/API 키), `.env`(루트, docker-compose 보간용).
- 기동 스크립트: `start.bat`/`stop.bat`(Windows), `start.sh`(macOS/Linux).
- 자동 배포: `git push origin main` 시 launchd `com.portfolion.auto-deploy-poll`이 2분마다 `scripts/auto-deploy-poll.sh`로 `origin/main`을 폴해 `git reset --hard` 후 재배포. `docker compose build`/`up` 수동 실행 금지.

## 환경변수 (이름만 — 값은 `backend/.env.docker`에 보관)

`DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `POSTGRES_PASSWORD`(루트 `.env`/compose), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ANTHROPIC_API_KEY`(현재 백엔드 미사용), `FRED_API_KEY`, `KITA_API_KEY`(실제로는 관세청 키), `KOFIA_API_KEY`, `DART_API_KEY`, `FRONTEND_URL`, `COWORK_API_KEY`(외부 Cowork API 인증), `KIWOOM_BASE_URL`, `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_BASE_URL`(선택, 미설정 시 실전 `:9443`). 프론트는 `VITE_API_BASE_URL`(선택). DDNS 스크립트는 `CF_ZONE_ID`/`CF_RECORD_ID`/`CF_API_TOKEN`(`scripts/ddns_update.sh`).

## 주요 설정 파일 경로

- `backend/requirements.txt`, `backend/Dockerfile`, `backend/main.py`, `backend/scheduler.py`
- `backend/auth_schema.sql`, `backend/app_schema.sql`
- `backend/.env.docker`, 루트 `.env`
- `frontend/package.json`, `frontend/vite.config.js`
- `docker-compose.yml`, `nginx/nginx.conf`
- `API_SPEC.md`(REST 레퍼런스), `CLAUDE_COWORK_API.md`(외부 Cowork API), `KIWOOM_API.md`, `KIS_API.md`
