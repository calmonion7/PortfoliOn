---
last_mapped_commit: 7f3aec7d6aab5b2ed9837f9aada7405f9505ae6b
mapped: 2026-06-17
---

# Technology Stack

**Analysis Date:** 2026-06-17

## Languages

**Primary:**
- Python (백엔드) — `backend/` 전체. 런타임 이미지 Python 3.12 (`backend/Dockerfile`의 `FROM python:3.12-slim`).
- JavaScript / JSX (프론트엔드) — `frontend/src/`. ESM (`frontend/package.json`의 `"type": "module"`).

**Secondary:**
- SQL — 스키마 정의 `backend/auth_schema.sql`, `backend/app_schema.sql`, 기동 마이그레이션 인라인 DDL `backend/main.py`.
- Bash / Batch — 실행·배포 스크립트 `start.sh`, `stop.sh`, `deploy.sh`, `start.bat`, `stop.bat`, `scripts/auto-deploy-poll.sh`, `scripts/ddns_update.sh`.
- 플레인 CSS — TailwindCSS 미사용. 토큰 `frontend/src/styles/tokens.css`, 컴포넌트별 `*.css`.

## Runtime

**환경:**
- 백엔드 런타임: Python 3.12 (Docker), 로컬 개발은 `backend/.venv` (macOS `backend/.venv/bin/python`, Windows `backend/.venv/Scripts/python`).
- ASGI 서버: uvicorn (`uvicorn[standard]>=0.24.0`), 진입점 `main:app` (`backend/main.py`).
- 프론트 개발 서버: Vite dev server (port 5173).

**Package Manager:**
- 백엔드: pip (`backend/requirements.txt`). 핀 방식은 `>=` 하한만 지정(상한 없음). 별도 lockfile 없음.
- 프론트: npm (`frontend/package.json`). lockfile은 `frontend/package-lock.json` (저장소 존재 가정 — 빌드/배포 시 `npm install` 후 `npm run build`).
- `scripts/`에도 별도 Node 패키지(`scripts/package.json`, `scripts/package-lock.json`) — Playwright 스크린샷 등 도구용(`scripts/screenshot.js`, `scripts/check-permissions.js`).

## Frameworks

**Core (백엔드):**
- FastAPI `>=0.104.0` — REST API 프레임워크. 앱 객체·라우터 마운트·미들웨어 `backend/main.py`.
- Starlette `SessionMiddleware` — OAuth 상태 세션 (`backend/main.py`, `SESSION_SECRET`로 서명).
- APScheduler `>=3.10.4` — 배치 스케줄러. 설정 `backend/scheduler.py`(루트 레벨, services 아님), 배치 카탈로그 `backend/services/batch_registry.py`.

**Core (프론트엔드):**
- React `^19.2.5` + react-dom `^19.2.5`.
- react-router-dom `^7.14.2` — 라우팅.
- recharts `^3.8.1` — 차트(시장지표·리포트 차트). 거대 의존성이라 별도 청크 `charts`로 분리(`frontend/vite.config.js`).
- react-markdown `^10.1.0` + remark-gfm `^4.0.1` — 리포트 텍스트 렌더. 별도 청크 `markdown`.
- axios `^1.16.0` — HTTP 클라이언트.

**Testing:**
- pytest `>=7.4.0` — 백엔드 테스트. 테스트 위치 `backend/tests/`. 실행 `cd backend && .venv/bin/python -m pytest`.
- 프론트엔드 테스트 러너 미설치(별도 단위 테스트 프레임워크 없음). UAT는 Playwright 디바이스 에뮬레이션(`scripts/screenshot.js`, 격리 하니스 `frontend/uat.html`).

**Build/Dev:**
- Vite `^8.0.10` — 번들러. **Vite 8 = rolldown 엔진**이라 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 받음(`frontend/vite.config.js`). 객체형 사용 시 빌드 깨짐.
- @vitejs/plugin-react `^6.0.1`.
- vite-plugin-pwa `^1.3.0` + @vite-pwa/assets-generator `^1.0.2` — PWA(서비스워커·매니페스트·아이콘). 설정 `frontend/vite.config.js`(`VitePWA`, manifest `name: PortfoliOn`, `display: standalone`, `lang: ko`). 커스텀 closeBundle 플러그인 `sw-cache-bust`로 `registerSW.js`/`sw.js`/`manifest.webmanifest`에 BUILD_DATE 쿼리스트링 캐시버스팅.
- ESLint `^10.2.1` + @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh — 린트. 실행 `npm run lint`.

## Key Dependencies

**Critical (백엔드 데이터):**
- yfinance `>=0.2.40` — US 1차 시세·섹터·시총·히스토리, 배치 1콜(`yf.download`). KR은 키움 실패 시 폴백. 사용처 `backend/services/market.py`.
- pandas `>=2.1.0`, numpy `>=1.26.0` — 시계열·수치 처리.
- matplotlib `>=3.8.0` — 차트 PNG 생성(`backend/services/charts.py`, `matplotlib.use("Agg")` 헤드리스).
- beautifulsoup4 `>=4.12.0` + lxml `>=4.9.0` — HTML 파싱(스크래핑·DART 원문). **주의: lxml은 Docker엔 있으나 로컬 `.venv`엔 없음** — 로컬 pytest 코드는 `html.parser` 파서 사용.
- requests `>=2.31.0` — 동기 HTTP(대부분의 외부 API 호출). httpx `>=0.25.0` — 비동기 HTTP(OAuth 콜백 `backend/routers/auth.py`).
- exchange_calendars `>=4.5` — 거래소 영업일 캘린더(`backend/routers/calendar.py`, `xcals.get_calendar`).

**Critical (백엔드 인증·DB):**
- psycopg2-binary `>=2.9.0` — PostgreSQL 드라이버. 풀 `ThreadedConnectionPool` (`backend/services/db.py`, `DATABASE_URL` 사용).
- python-jose[cryptography] `>=3.3.0` — JWT(HS256) 발급·검증 (`backend/services/auth_service.py`, `backend/auth.py`).
- bcrypt `>=4.0.0` — 비밀번호 해시 (`backend/services/auth_service.py`).
- authlib `>=1.3.0` — OAuth 보조(requirements에 존재). itsdangerous `>=2.0.0` — 세션 서명 보조.
- python-dotenv — `.env` 로드 (`backend/main.py`의 `load_dotenv()`).

**참고 — 미사용:**
- `ANTHROPIC_API_KEY` env는 `.env.docker`에 있으나 **백엔드에서 미사용**(`requirements.txt`에 anthropic 패키지 없음). AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성.

## Configuration

**환경변수 파일 (key NAME만 — 값 미기재):**
- `backend/.env.docker` — Docker 백엔드 컨테이너 env(`docker-compose.yml`의 `env_file`). 키: `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `FRED_API_KEY`, `KITA_API_KEY`, `KOFIA_API_KEY`, `DART_API_KEY`, `FRONTEND_URL`, `COWORK_API_KEY`, `KIWOOM_BASE_URL`, `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIS_APP_KEY`, `KIS_APP_SECRET` (옵션 `KIS_BASE_URL`).
- `backend/.env.docker.example` — 템플릿(빈 값/CHANGE_ME 플레이스홀더).
- `backend/.env` — 로컬 개발용. 키: `SUPABASE_*`(레거시 잔존, 현 인프라 미사용), `JWT_SECRET`, `SESSION_SECRET`, `DATABASE_URL`.
- 루트 `.env` — docker-compose 보간용. 키: `FRED_API_KEY`, `KITA_API_KEY` (+ `docker-compose.yml`이 보간하는 `POSTGRES_PASSWORD`).
- 프론트: `VITE_API_BASE_URL`(배포 시 nginx 직접 호출용, 미설정 시 상대경로). 로컬은 Vite proxy `/api` → `http://localhost:8000`.

**모든 .env 파일은 gitignore 대상. 값은 절대 커밋 금지.**

**Build:**
- 프론트: `frontend/vite.config.js` (Vite 빌드 옵션·PWA·manualChunks·dev proxy).
- 백엔드: `backend/Dockerfile` (Python 3.12-slim, `pip install -r requirements.txt`, `CMD uvicorn main:app --host 0.0.0.0 --port 8000`).
- 린트: `frontend/eslint.config.*` (ESLint flat config).

## How Servers Start

**로컬 개발 (양쪽 동시):**
- macOS/Linux: `./start.sh` — `.env` 로드 → 포트 8000/5173 kill → uvicorn `main:app --reload --port 8000`(`backend/.venv` 활성화) + `npm run dev`(frontend) 백그라운드 기동 → `/health` 폴링 후 브라우저 오픈. 로그 `/tmp/portfolion-*.log`.
- Windows: `start.bat` — 숨김 PowerShell 창에서 동일 기동. 종료 `stop.bat`.
- 백엔드 단독: `cd backend && python -m uvicorn main:app --reload --port 8000`.
- 프론트 단독: `cd frontend && npm run dev`.

**프로덕션 (Mac 로컬 Docker 4-컨테이너):**
- `docker-compose.yml` 서비스: `postgres`(postgres:16-alpine, 스키마 자동 적재 `01-auth.sql`→`02-app.sql`), `backend`(FastAPI 빌드), `nginx`(nginx:alpine, 80/443, `./frontend/dist` `:ro` 마운트·`/api/*`·`/health` → `backend:8000` 프록시), `certbot`(certbot/certbot, 12h마다 `certbot renew`).
- 배포: `deploy.sh` — 프론트 `npm install && npm run build` → 백엔드 Docker 이미지 빌드 → 백엔드 컨테이너 교체. `git push origin main` 시 자동 배포(launchd 폴러 `scripts/auto-deploy-poll.sh`가 2분마다 `origin/main` 확인 후 `deploy.sh`). 수동 `docker compose build/up` 금지.
- nginx config `nginx/nginx.conf` — index.html·서비스워커 캐시 금지, 해시 JS/CSS 장기 캐시(`max-age=31536000, immutable`), SPA fallback `try_files $uri /index.html`. 443 SSL 블록은 현재 주석 처리(HTTP만 활성).
- 외부 노출: Cloudflare Tunnel(`portfolion.taebro.com` → localhost:80, cloudflared는 compose 아닌 launchd 실행). DDNS 보조 `scripts/ddns_update.sh`(Cloudflare API).

## Platform Requirements

**Development:**
- Python 3.12 + `backend/.venv`, Node.js(npm), 로컬 PostgreSQL 또는 Docker postgres(`DATABASE_URL`).

**Production:**
- 배포 대상: Mac 로컬 Docker(Render/Vercel/Supabase 제거됨). launchd가 cloudflared + docker compose 자동 기동.

---

*Stack analysis: 2026-06-17*
