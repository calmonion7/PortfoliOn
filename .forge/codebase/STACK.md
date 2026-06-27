---
last_mapped_commit: f1839804fa84342f9e30cc6dc919d5e5abba7b8d
mapped: 2026-06-28
---

# 기술 스택 (STACK)

PortfoliOn의 언어·런타임·프레임워크·주요 의존성·빌드 설정·환경변수를 정리한 구현 사실 지도다. (외부 API 연동·DB·인증 제공자는 `INTEGRATIONS.md` 참조.)

## 언어 / 런타임

- **백엔드**: Python. 컨테이너 베이스 이미지 `python:3.12-slim` (`backend/Dockerfile:1`). 로컬 가상환경은 `backend/.venv/` (macOS `backend/.venv/bin/python`).
- **프론트엔드**: JavaScript (ESM, `frontend/package.json`의 `"type": "module"`). React 19 + JSX. 빌드 컨테이너 없이 nginx가 `frontend/dist`를 직접 서빙.
- 버전 핀 파일(`.nvmrc`, `.python-version`, `runtime.txt`)은 없음 — Python 버전은 Dockerfile, Node 버전은 미고정.

## 백엔드 프레임워크 / 주요 의존성 (`backend/requirements.txt`)

- **FastAPI** `>=0.104.0` — 웹 프레임워크. 앱 진입점 `backend/main.py` (라우터 마운트 + 미들웨어 + 스케줄러 기동).
- **uvicorn[standard]** `>=0.24.0` — ASGI 서버. 실행: `python -m uvicorn main:app --reload --port 8000`.
- **APScheduler** `>=3.10.4` — 배치 스케줄러. `backend/scheduler/` 패키지(`_state.py`가 `AsyncIOScheduler` 싱글톤, `Asia/Seoul` 타임존). (`INTEGRATIONS.md` 스케줄러 절 참조.)
- **yfinance** `>=0.2.40` — US 시세/재무/히스토리 fetch (`backend/services/market/us.py`, `backend/services/market/__init__.py`).
- **pandas** `>=2.1.0`, **numpy** `>=1.26.0` — 시세 시계열·지표 계산.
- **requests** `>=2.31.0` — 외부 REST 호출(Naver·DART·키움·KIS·FRED·KOFIA·관세청·Telegram·Dataroma 등).
- **httpx** `>=0.25.0` — OAuth 토큰 교환 등 비동기 HTTP (`backend/routers/auth.py`).
- **beautifulsoup4** `>=4.12.0` + **lxml** `>=4.9.0` — HTML/XML 파싱. **주의(`backend/services/backlog_parser.py:16`)**: `lxml`은 Docker 이미지엔 있으나 로컬 `.venv`엔 없으므로 코드는 `html.parser`를 사용.
- **exchange_calendars** `>=4.5` — 거래일/기대 리포트 날짜 계산 (`backend/services/storage/dates.py`).
- **psycopg2-binary** `>=2.9.0` — PostgreSQL 드라이버. `ThreadedConnectionPool(minconn=1, maxconn=20)` (`backend/services/db.py:22`).
- **authlib** `>=1.3.0` — OAuth (Starlette `SessionMiddleware` 연동).
- **python-jose[cryptography]** `>=3.3.0` — JWT (HS256) 인코딩/디코딩 (`backend/auth.py`, `backend/services/auth_service.py`).
- **bcrypt** `>=4.0.0` — 비밀번호 해싱.
- **itsdangerous** `>=2.0.0` — 세션 서명 (Starlette `SessionMiddleware`).
- **python-dotenv** — `.env` 로딩.
- **pytest** `>=7.4.0` — 백엔드 테스트 (`cd backend && .venv/bin/python -m pytest`, `backend/tests/`).
- **`anthropic` 미포함**: requirements에 없고 코드에서 import 0건 — 백엔드는 LLM/Anthropic 호출을 하지 않는다(AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성).

## 프론트엔드 프레임워크 / 주요 의존성 (`frontend/package.json`)

런타임 의존성:
- **react** `^19.2.5`, **react-dom** `^19.2.5` — React 19.
- **react-router-dom** `^7.14.2` — 라우팅.
- **recharts** `^3.8.1` — 차트 (시세/시장지표/재무).
- **axios** `^1.16.0` — HTTP 클라이언트.

개발 의존성:
- **vite** `^8.0.10` — 빌드/번들러 (Vite 8 = rolldown 엔진).
- **@vitejs/plugin-react** `^6.0.1`.
- **vite-plugin-pwa** `^1.3.0` — PWA(서비스워커·매니페스트).
- **vitest** `^4.1.9` + **jsdom** `^29.1.1` + **@testing-library/react** `^16.3.2` + **@testing-library/jest-dom** `^6.9.1` — 프론트 테스트 (`vite.config.js`의 `test` 블록, `setupFiles: ./src/test/setup.js`).
- **eslint** `^10.2.1` + **@eslint/js** `^10.0.1` + **eslint-plugin-react-hooks** `^7.1.1` + **eslint-plugin-react-refresh** `^0.5.2` + **globals** `^17.5.0` — 린트 (flat config `frontend/eslint.config.js` 형태).

## 빌드 / 번들러 설정 (`frontend/vite.config.js`)

- **스크립트** (`frontend/package.json`): `dev`(vite), `build`(vite build), `test`(vitest run), `lint`(eslint .), `preview`.
- **manualChunks (함수형 필수)**: Vite 8(rolldown)은 객체형 `manualChunks`를 거부 — `manualChunks(id)` 함수로 `node_modules` 경로 substring 분기. `recharts`/`d3-`/`victory-vendor` → `charts` 청크, 그 외 → `vendor`.
- **dev 서버**: 포트 5173, `/api` → `http://localhost:8000` 프록시(`changeOrigin: true`), `watch.usePolling: true`(interval 500).
- **PWA(VitePWA)**: `registerType: autoUpdate`, `cacheId: portfolion-<BUILD_DATE>`, runtimeCaching — Google Fonts/jsdelivr CacheFirst, `/api/*`(단 `/api/auth/*` 제외) NetworkFirst(timeout 10s). manifest(name PortfoliOn, lang ko, display standalone).
- **sw-cache-bust 커스텀 플러그인**: 빌드 후 `dist/index.html`·`registerSW.js`에 `?<BUILD_DATE>` 쿼리 추가로 서비스워커 캐시 버스팅.

## 환경변수 (어디서 읽는가)

`backend/.env.docker`(gitignore)에 키 정의, 루트 `.env`는 docker-compose 보간용. 예시 템플릿: `backend/.env.docker.example`.

| 변수 | 읽는 위치 | 용도 |
|------|-----------|------|
| `DATABASE_URL` | `backend/services/db.py:26` | PostgreSQL DSN (`ThreadedConnectionPool`) |
| `JWT_SECRET` | `backend/auth.py`, `backend/services/auth_service.py:19` | JWT HS256 서명 키 |
| `SESSION_SECRET` | `backend/main.py:157`(SessionMiddleware), `backend/routers/auth.py:40`(HMAC) | 세션/HMAC 서명 |
| `FRONTEND_URL` | `backend/main.py:160`(CORS), `backend/routers/auth.py`(OAuth redirect) | CORS origin + OAuth 콜백 base |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `backend/routers/auth.py:140,162` | Google OAuth |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | `backend/routers/auth.py:186,206` | GitHub OAuth |
| `COWORK_API_KEY` | `backend/auth.py:44` | 외부 Cowork API 키 (X-API-Key 헤더 검증) |
| `DART_API_KEY` | `backend/services/backlog.py:62`, `disclosures.py:37`, `insider_trades.py:62`, `dividends.py:37`, `market/kr.py` | DART(전자공시) API |
| `FRED_API_KEY` | `backend/services/market_indicators/econ.py:8`, `macro.py:55` | FRED 경제·매크로 지표 |
| `KOFIA_API_KEY` | `backend/services/leverage_service.py:27`, `lending_service.py:13` | 공공데이터포털(레버리지·대차잔고) |
| `KITA_API_KEY` | `backend/services/market_indicators/exports.py:117` | 관세청 수출 통계(미설정 시 UN Comtrade 폴백) |
| `KIWOOM_APP_KEY` / `KIWOOM_SECRET_KEY` | `backend/services/kiwoom/client.py:31` | 키움 REST 자격증명 |
| `KIWOOM_BASE_URL` | `backend/services/kiwoom/client.py:27` | 키움 베이스 URL(기본 `https://api.kiwoom.com`) |
| `KIS_APP_KEY` / `KIS_APP_SECRET` | `backend/services/kis/client.py:34` | 한국투자증권 REST 자격증명 |
| `KIS_BASE_URL` | `backend/services/kis/client.py:30` | KIS 베이스 URL(기본 실전 `:9443`) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | `backend/services/digest_service.py:229,230` | 다이제스트 Telegram 발송(선택) |
| `POSTGRES_PASSWORD` | `docker-compose.yml:9`(루트 `.env` 보간) | PostgreSQL 컨테이너 비밀번호 |
| `ANTHROPIC_API_KEY` | `.env.docker`에 잔존하나 백엔드 코드에서 미사용 | (현재 미사용) |

프론트엔드 환경변수:
- `VITE_API_BASE_URL` — 배포 시 nginx 직접 호출용 API base(미설정 시 상대경로). 로컬은 Vite 프록시(`/api` → `:8000`).

## 컨테이너 / 인프라 (`docker-compose.yml`)

- `postgres` — `postgres:16-alpine`, DB/USER `portfolion`, 비밀번호 `${POSTGRES_PASSWORD}`, `pgdata` 볼륨.
- `backend` — `build: ./backend` (FastAPI, port 8000).
- `nginx` — `nginx:alpine` (HTTP 80, `/api/*` → backend:8000, `frontend/dist` `:ro` 마운트 직접 서빙).
- `certbot` — `certbot/certbot` (HTTPS 인증서 갱신).
- Cloudflare Tunnel(`cloudflared`)은 compose 컨테이너가 아니라 launchd로 실행.
