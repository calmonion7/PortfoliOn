---
last_mapped_commit: e815fb8e452f74713f9082fafeeb9e7d60334d0e
mapped: 2026-07-26
---

# STACK — 언어·런타임·프레임워크·의존성·빌드·배포 토폴로지

PortfoliOn의 기술 스택 실측 매핑. 도메인 용어 정의는 다루지 않고 구현 사실만 기록한다(정의는 `.forge/CONTEXT.md`). 시크릿 값은 미기재 — **변수명만**.

## 1. 백엔드 (Python / FastAPI)

| 항목 | 실측 |
|------|------|
| 프로덕션 런타임 | **Python 3.12** — `backend/Dockerfile` = `FROM python:3.12-slim`, `CMD uvicorn main:app --host 0.0.0.0 --port 8000` |
| 로컬 개발 런타임 | **Python 3.9.6** — `backend/.venv/pyvenv.cfg` |
| 앱 엔트리 | `backend/main.py` (`app = FastAPI(title="Stock Portfolio Manager", lifespan=lifespan)`) |
| 테스트 러너 | `pytest` — `backend/pytest.ini` (`testpaths = tests`, `pythonpath = .`), 테스트 파일 **123개**(`backend/tests/test_*.py`) |

- ⚠️ **로컬 3.9 ≠ Docker 3.12 갭**: 런타임 평가 어노테이션(Pydantic 모델·FastAPI 시그니처)에 PEP604 `X | None` 금지 → `Optional[X]`. `from __future__ import annotations`가 있는 모듈은 문자열화돼 로컬에서도 통과.
- ⚠️ **`lxml`은 Docker에만 설치**(로컬 `.venv` 부재) → 실사용 파서는 전부 `BeautifulSoup(html, "html.parser")`.

### 의존성 (`backend/requirements.txt` — 18줄, 상한 핀 없음)

| 패키지 | 용도 · 주 소비 모듈 |
|--------|--------------------|
| `fastapi>=0.104.0` / `uvicorn[standard]>=0.24.0` | REST + ASGI. `backend/main.py` |
| `apscheduler>=3.10.4` | 배치 스케줄. `backend/scheduler/` (**`AsyncIOScheduler`**, `backend/scheduler/_state.py`) |
| `psycopg2-binary>=2.9.0` | PostgreSQL 드라이버. `backend/services/db.py` (`ThreadedConnectionPool` minconn 1 / **maxconn 20**) |
| `yfinance>=0.2.40` | US 1차 시세·재무·지표. import 사이트 **19개 모듈** |
| `pandas>=2.1.0` / `numpy>=1.26.0` | 시계열·지표 계산 |
| `requests>=2.31.0` / `httpx>=0.25.0` | 외부 HTTP (requests=동기 서비스 전반, httpx=`backend/routers/auth.py` OAuth 토큰 교환) |
| `beautifulsoup4>=4.12.0` / `lxml>=4.9.0` | HTML 파싱 — 호출 사이트 9곳 전부 `"html.parser"`, `"lxml"` 사용 **0** |
| `exchange_calendars>=4.5` | 휴장일. **유일 소비처 `backend/routers/calendar.py:12`** |
| `authlib>=1.3.0` | 선언만 — 백엔드 코드에 import **0**(OAuth는 httpx 직접 호출) |
| `python-jose[cryptography]>=3.3.0` | JWT HS256. `backend/auth.py`, `backend/services/auth_service.py`, `backend/middleware/event_tracker.py` |
| `bcrypt>=4.0.0` | 로컬 계정 패스워드 해시 |
| `itsdangerous>=2.0.0` | starlette `SessionMiddleware` 서명 |
| `python-dotenv` | `backend/main.py` 최상단 `load_dotenv()` |

> `anthropic` 의존성 **없음** — 백엔드에 LLM 호출 0(§6 루틴 파이프라인).

### 앱 배선 (`backend/main.py`)

- **라우터 19개** include(`backend/routers/`): `auth`, `portfolio`, `report`, `watchlist`, `stocks`, `guru`, `calendar`, `digest`, `market_indicators`, `analytics`, `analysis`, `events`, `rankings`, `investor`, `short_sell`, `batches`, `recommendations`, **`analyst_reports`**, `admin`.
  - prefix 2계열: 전용(`/api/stocks`·`/api/analyst-reports`·`/api/admin`·`/api/auth`·`/api/guru`·`/api/analysis`·`/api/events`·`/api/recommendations`·`/api/market`·`/api/watchlist`·`/api/portfolio`·`/api/analytics`)과 **공용 `/api`**(`report`·`calendar`·`digest`·`rankings`·`investor`·`short_sell`·`batches`).
- **미들웨어 순서**: `SessionMiddleware(secret_key=os.environ["SESSION_SECRET"])` → `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`) → `CORSMiddleware`(origins = `localhost:3000`·`localhost:5173`·`FRONTEND_URL`, 빈 값 필터).
- **예외 핸들러**: `RequestValidationError` → 422 body를 `services.utils.sanitize` 통과(요청의 NaN/inf echo가 starlette `allow_nan=False`에서 500 되는 것 차단, `backend/main.py:253-259`).
- **lifespan**(`backend/main.py:241-247`): `_migrate()` → `sched.start()` → `_warm_market_cache()` 데몬 스레드 → (종료) `sched.stop()`.
- **`_configure_logging()`**(모듈 로드 시 1회): `basicConfig(level=INFO)` + `urllib3`/`yfinance`/`apscheduler`/`asyncio` → WARNING + `uvicorn*` `propagate=False`.
- **`_migrate()`**: 기동 idempotent DDL 20+ 블록, 각각 개별 `try/except` + `logger.warning`. 최신 블록 = `tickers.analyst_target`(boolean) · **`analyst_reports` 테이블**. 신규 컬럼/테이블의 **정본은 여기**(`app_schema.sql`은 빈 pgdata 초회만 적용).
- **헬스체크**: `GET|HEAD /health` → `{"status":"ok"}` (nginx·`deploy.sh` 스모크가 소비).

### 인메모리 캐시 계층 (`backend/services/cache.py`)

`TTLCache(ttl, maxsize=200)` 인스턴스 **10종**: snapshot(LRU 200) · list(**60s**) · dashboard(300s) · correlation(300s) · sector(300s) · macro(300s) · quote(60s) · live_prices(15s) · rebalance(300s) · exposure(300s).
> ⚠️ CLAUDE.md는 "캐시 6종 / list TTL **5s**"로 서술 — 코드는 **10종 / 60s**. 코드가 정본.

## 2. 프론트엔드 (React 19 / Vite 8)

| 항목 | 실측 |
|------|------|
| 프레임워크 | `react@^19.2.5` + `react-dom@^19.2.5`, 라우팅 `react-router-dom@^7.14.2` |
| 빌드 | `vite@^8.0.10` (**rolldown 번들러**), `@vitejs/plugin-react@^6.0.1` |
| HTTP | `axios@^1.16.0` — 인스턴스 정본 `frontend/src/api.js` |
| 차트 | `recharts@^3.8.1` (+트랜지티브 d3·victory-vendor) |
| 테스트 | `vitest@^4.1.9` + `jsdom@^29.1.1` + `@testing-library/react@^16.3.2` — 설정은 **`frontend/vite.config.js`의 `test` 블록**(별도 vitest.config 없음), setup `frontend/src/test/setup.js`(1줄), 테스트 **19개** |
| 린트 | `eslint@^10.2.1` flat config `frontend/eslint.config.js`(`js.recommended` + `react-hooks` + `react-refresh`, 커스텀 룰 0, **테스트 글로벌 override 없음**) |
| PWA | `vite-plugin-pwa@^1.3.0` |
| CSS | plain CSS(TailwindCSS 없음) — `frontend/src/styles/tokens.css`(269줄, ADR-0026 에디토리얼 토큰) + `pc.css`·`mobile.css`·`motion.css` |

- **스크립트**(`frontend/package.json`, `"type":"module"`): `dev` · `build` · `test`(vitest run) · `lint` · `preview`.
- **dev 서버**: port 5173, `server.proxy['/api'] → http://localhost:8000`(`changeOrigin`), `watch.usePolling`.
- **청크 분할**: `build.rollupOptions.output.manualChunks`는 **함수 형식만**(rolldown은 객체형 미지원 → `Expected Function but received Object`). 현재 분기: `charts`(recharts·`/d3-`·victory-vendor) / `vendor`(그 외 node_modules). 산출물 `frontend/dist/assets/`에 `charts-*`·`vendor-*`·`index-*`·`rolldown-runtime-*`.
- **PWA**: `registerType:'autoUpdate'`, `injectRegister:'auto'`, `cacheId: portfolion-<BUILD_DATE>`, `skipWaiting`+`clientsClaim`, `navigateFallback:null`. runtimeCaching 3종 — google-fonts·jsdelivr `CacheFirst`(1년) / `/api/` `NetworkFirst`(10s 타임아웃·300s·50엔트리) **단 `/api/auth/`는 캐시 제외**.
  - 인라인 플러그인 **`sw-cache-bust`**(apply build, closeBundle): `configResolved`에서 `build.outDir`를 읽어 `dist/index.html`(registerSW.js·manifest.webmanifest)과 `dist/registerSW.js`(`/sw.js`)에 `?<BUILD_DATE>` 부착.
  - SW 등록 코드는 `src/`에 없음(전부 플러그인 생성). 설치 유도 UI는 `frontend/src/components/InstallPrompt.jsx` + 판정 헬퍼 `frontend/src/utils/pwa.js`(iOS/Android/인앱브라우저 감지, localStorage `pwa-install-dismissed-at` 14일 억제).
  - ⚠️ manifest에 **`icons` 배열 없음**, `frontend/public/`엔 `favicon.svg`·`icons.svg`뿐(래스터 아이콘 0). `index.html` `lang="en"`·`theme-color #f6f1e7` ↔ manifest `lang:'ko'`·`theme_color #f6f6f4` **불일치**.
- **API base URL**: `import.meta.env.VITE_API_BASE_URL || ''` — `frontend/src/api.js:4` 외에 `frontend/src/App.jsx:35,131`·`frontend/src/pages/LoginPage.jsx:8`이 raw `fetch`로 **독립 참조**(총 4곳), `frontend/src/utils/analytics.js:4`는 하드코딩 상대경로. axios 인터셉터가 `localStorage.access_token` 부착 + 401 시 토큰 제거 후 `/`로 하드 리다이렉트.
- **라우팅**: `frontend/src/App.jsx`(라우트 16개, 전부 eager import — **`React.lazy`/`Suspense` 0**, **catch-all `*` 없음**). 리다이렉트 맵은 공유 모듈 `frontend/src/routes.js`(`/`→`/reports`, `/research`→`/reports`, `/market`→`/market/indicators`, `/analysis`→`/portfolio`). `LoginPage`는 라우트 없이 auth 게이트에서 직접 렌더. Provider 순서 `ToastProvider` → `AuthProvider`(`frontend/src/contexts/AuthContext.jsx`, 앱 유일 컨텍스트) → `BrowserRouter`.
- **런타임 요구**: `engines`·`.nvmrc`·CI `setup-node` **전무**. 로컬 실측 Node **v24.15.0** / npm 11.12.1.
  - ⚠️ README는 "Node.js 18+"로 적지만 vite 8·vitest 4·eslint 10·jsdom 29는 Node ≥20 필요 — **README 서술이 스택과 모순**.

## 3. 빌드·설정 파일 인벤토리

| 경로 | 역할 |
|------|------|
| `docker-compose.yml` | 4 서비스(postgres·backend·nginx·certbot) + `pgdata` 볼륨 + postgres `pg_isready` healthcheck |
| `backend/Dockerfile` | python:3.12-slim 단일 스테이지 |
| `deploy.sh` | 배포 정본 스크립트(§5) |
| `nginx/nginx.conf` | :80 서버블록 + 캐시 정책. **:443 블록은 전체 주석 처리** |
| `.github/workflows/deploy.yml` | `on: push[main]`, `runs-on: self-hosted` → `git reset --hard origin/main` + `bash deploy.sh` |
| `scripts/auto-deploy-poll.sh` | 폴러 폴백(§5) |
| `scripts/start-docker-compose.sh` | docker 소켓 대기 후 `docker compose up -d` — ⚠️ **존재하지 않는 워크트리 경로로 `cd`**(§5) |
| `scripts/cowork-fire-listener.py` · `scripts/cowork-routine-prompt.md` | 루틴 fire 리스너 + 정책 프롬프트(§6) |
| `backend/pytest.ini` · `frontend/vite.config.js`(test) · `frontend/eslint.config.js` | 테스트·린트 설정 |
| `backend/auth_schema.sql`(25줄) → `backend/app_schema.sql`(406줄) | DB 스키마. compose가 `docker-entrypoint-initdb.d/01-auth.sql`·`02-app.sql`로 마운트(빈 pgdata 초회만) |
| `backend/migrations/001_user_events.sql` · `002_backlog_history.sql` | 레거시 수동 마이그레이션(정본은 `main._migrate`) |
| `start.sh`/`start.bat` · `stop.sh`/`stop.bat` | 로컬 양 서버 기동/종료 |
| `backend/Procfile` · `backend/supabase_schema.sql` · `frontend/vercel.json` · `supabase/` | **사장된 배포 유물**. `vercel.json`은 SPA rewrite 1줄 — 현 서빙은 nginx `try_files` |

## 4. 환경변수 인벤토리 (이름만 · 값 미기재)

파일: 루트 `.env`(compose 보간) · `backend/.env.docker`(백엔드 컨테이너 `env_file`, gitignored) · `backend/.env.docker.example`(템플릿) · `backend/.env`(로컬) · `frontend/.env`.

| 변수 | 소비 모듈 | 미설정 시 |
|------|-----------|-----------|
| `DATABASE_URL` | `backend/services/db.py:26` | `os.environ[…]` → **필수**(KeyError) |
| `JWT_SECRET` | `backend/auth.py:26,52` · `services/auth_service.py:19` · `middleware/event_tracker.py:35` | **필수** |
| `SESSION_SECRET` | `backend/main.py:262`(필수) · `routers/auth.py:45` `_HMAC_SECRET`(기본 `dev-secret`) | 기동 실패 |
| `FRONTEND_URL` | `main.py:265`(CORS, 기본 `""`) · `routers/auth.py` OAuth redirect(필수) | CORS 항목 누락 + OAuth 500 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `routers/auth.py:145,166-167` | Google OAuth 불가 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | `routers/auth.py:191,210-211` | GitHub OAuth 불가 |
| `COWORK_API_KEY` | `backend/auth.py:44` (`X-API-Key` 검증) | 빈 값이면 모든 API-Key 인증 401 |
| `COWORK_ROUTINE_FIRE_URL` / `COWORK_ROUTINE_FIRE_TOKEN` | `services/cowork_trigger.py:22,29,33` | `configured()` False → **휴면**(fire no-op, admin fire 503) |
| `FRED_API_KEY` | `market_indicators/econ.py:13,64` · `macro.py:59` · `routers/calendar.py:229` | 지표 수집 실패(저장값 유지), 캘린더 econ 이벤트 누락 |
| `KITA_API_KEY` | `market_indicators/exports.py:107` (실체 = **관세청** 키) | UN Comtrade 공개 API 폴백 |
| `KOFIA_API_KEY` | `services/leverage_service.py:13,30` · `lending_service.py:13` · `run_backfill.py:27` | 수급지표 요청 실패 |
| `DART_API_KEY` | `disclosures.py` · `dividends.py` · `insider_trades.py` · `backlog.py` · `agm.py` · `market/kr.py:459,549` | KR 공시·수주잔고·배당·주총·내부자 **휴면** |
| `KIWOOM_APP_KEY` / `KIWOOM_SECRET_KEY` / `KIWOOM_BASE_URL` | `services/kiwoom/client.py:27,31` | `configured()` False → KR 시세는 KIS/Naver 폴백, 키움 전용 배치 빈 결과 |
| `KIS_APP_KEY` / `KIS_APP_SECRET` / `KIS_BASE_URL` | `services/kis/client.py:30,34` | `configured()` False → 휴면(백업 시세 미가동·선물 dormant) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | `services/digest_service.py:270-271` | 조용히 return(발송 스킵) — ⚠️ **`.env.docker`에 이름 없음 → 현재 휴면** |
| `POSTGRES_PASSWORD` | `docker-compose.yml:9` `${POSTGRES_PASSWORD:-…}` 보간만 | ⚠️ **루트 `.env`엔 없음**(실제 이름은 `FRED_API_KEY`·`KITA_API_KEY` 2개뿐) → compose 기본값 적용. README 47행 서술과 불일치 |
| `VITE_API_BASE_URL` | `frontend/src/api.js` · `App.jsx` · `LoginPage.jsx` | 빈 값 = same-origin 상대경로(정상 운용 형태) |

**사장된 이름(코드 참조 0, grep 확인)**: `ANTHROPIC_API_KEY`(`.env.docker`·example에 존재) · `backend/.env`의 `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_ANON_KEY`·`SUPABASE_JWT_SECRET` · `frontend/.env`의 `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`.

## 5. 배포 토폴로지

```
Cloudflare Tunnel (launchd cloudflared)  portfolion.taebro.com → localhost:80
        ▼
nginx:alpine  :80  ─ /api/*, /health → backend:8000 프록시
                   ─ /            → /usr/share/nginx/html (= frontend/dist, :ro 마운트)
        ▼
portfolion-backend-1  uvicorn :8000  (network portfolion_default, alias `backend`)
        ▼
postgres:16-alpine  :5432(호스트 노출)  volume pgdata
certbot/certbot     12h `certbot renew` 루프
```

- **nginx 캐시 정책**(`nginx/nginx.conf`): `/index.html`·`sw.js`·`workbox-*.js` → `no-store`; 해시 자산(js·css·이미지·woff) → `max-age=31536000, immutable`; SPA 폴백 `try_files $uri /index.html`; ACME `/.well-known/acme-challenge/` → `/var/www/certbot`.
- ⚠️ **HTTPS는 nginx가 종단하지 않는다** — :443 서버블록 전체 주석. certbot 갱신 루프는 돌지만 발급 인증서를 서빙하는 블록이 없고 TLS는 Cloudflare Tunnel이 담당.
- ⚠️ **compose ≠ 배포 후 실제 실행 형태**: `deploy.sh`가 backend·nginx를 `docker stop/rm` 후 **`docker run`으로 재생성**(`--network portfolion_default`, `--env-file ./backend/.env.docker`). 배포 이후 `docker compose ps`엔 backend·nginx가 안 잡히고 `docker ps`로만 보인다. compose 관리 대상은 postgres·certbot뿐.
- **`deploy.sh` 4단계**: ① `frontend && npm install && npm run build` ② `docker build -t portfolion-backend ./backend` ③ backend 컨테이너 교체 ④ nginx 컨테이너 교체 → `curl -s http://localhost/health` 스모크. 동시배포 락 `/tmp/portfolion-deploy.lock`, `DOCKER_CONFIG`를 임시 dir로 덮어 macOS keychain 우회.
- **프론트 즉시 라이브**: nginx가 `frontend/dist`를 직접 서빙 → 로컬 `npm run build`가 즉시 반영(배포 무관). 백엔드 변경은 이미지 재빌드(=배포) 후에야 라이브.

### launchd 서비스 (레포에 plist **0** — 전부 `~/Library/LaunchAgents/`)

| label | 실행 | 상태·주기 |
|-------|------|----------|
| `actions.runner.calmonion7-PortfoliOn.macbook-portfolion` | `~/actions-runner-portfolion/runsvc.sh` | 가동중 — **자동배포 주 경로**(`deploy.yml` self-hosted) |
| `com.portfolion.auto-deploy-poll` | `/bin/bash scripts/auto-deploy-poll.sh` | `StartInterval 120`(2분) — 폴백. 로그 `~/Library/Logs/com.portfolion.auto-deploy-poll.log` |
| `com.portfolion.cowork-fire-listener` | `/usr/bin/python3 scripts/cowork-fire-listener.py` | `RunAtLoad`+`KeepAlive` 가동중. env에 `HOME`/`USER`/`LOGNAME`/`PATH` 명시(launchd keychain OAuth 최소조건) |
| `com.cloudflare.cloudflared` | `cloudflared tunnel run portfolion` | 가동중 (`homebrew.mxcl.cloudflared`는 exit 1로 중복 잔존) |
| `com.portfolion.docker-compose` | `.claude/worktrees/docker-infra-migration/scripts/start-docker-compose.sh` | ⚠️ **exit 127 · 미가동** — 대상 워크트리가 존재하지 않음(현존 워크트리는 `settings-batch-hub`뿐). CLAUDE.md/README의 "launchd 자동실행 = cloudflared + docker compose" 중 **compose 부분은 현재 깨져 있다** |

- **폴러 동작**(`scripts/auto-deploy-poll.sh`): 락 존재 시 skip → `git fetch origin main`(네트워크 실패 시 조용히 종료) → `HEAD != origin/main`이면 **방향 무관** `git reset --hard origin/main` + `bash deploy.sh`. 커밋만 하고 push하지 않은 로컬 커밋이 ≤2분 내 소실되는 경로.

## 6. 루틴(AI 분석) 실행 토폴로지 — ADR-0028 개정본

백엔드는 LLM을 호출하지 않고 **HTTP POST 1발(fire)** 만 보낸다.

```
daily_report_kr/us 배치 종료 (backend/scheduler/jobs.py:39-43, job_runs.record 블록 *밖*)
  또는 POST /api/admin/cowork/fire (backend/routers/admin.py:228-240, require_admin_or_api_key)
        ▼ backend/services/cowork_trigger.py
          POST {COWORK_ROUTINE_FIRE_URL}  Authorization: Bearer {…FIRE_TOKEN}  {"text": …}
          (컨테이너→호스트: host.docker.internal:8787)
        ▼ scripts/cowork-fire-listener.py   127.0.0.1:8787  POST /fire  (launchd, Bearer 검증)
        ▼ subprocess.Popen(["claude","-p",prompt,"--model","sonnet",
                            "--allowedTools","Bash,WebSearch,WebFetch,Read,Write"])
          cwd=~/portfolion-routine-runs/<YYYYmmdd-HHMMSS>/, stdout→run.log, fire-and-forget
        ▼ claude -p 가 curl로 X-API-Key 인증해 enrich·발행 API 호출
```

- 정책 프롬프트는 레포 파일 `scripts/cowork-routine-prompt.md`(29줄) — `{{COWORK_API_KEY}}` 자리표시자를 리스너가 spawn 시점에 `backend/.env.docker`에서 치환(레포에 실키 미상주).
- `cowork_trigger.fire()`는 **절대 raise하지 않음**(미설정·HTTP≥300·예외 모두 `logger.warning` + `False`) — 배치 본문 보호. admin 엔드포인트는 미설정 503 / fire 실패 502.
- 클라우드 루틴(claude.ai) 경로는 샌드박스 egress 불가로 기각·비활성 보존(ADR-0028 개정 노트).

## 7. 스케줄러 / 배치 인프라

- `backend/scheduler/` 4파일: `_state.py`(`AsyncIOScheduler()` — timezone 인자 없음, 잡별 `CronTrigger(timezone=…)`) · `jobs.py`(잡 함수 + `_JOB_FUNCS` **28엔트리**) · `schedule.py`(`_build_trigger`·`_reschedule_job`·`_seed_spec_for`·`_seed_batch_schedules`·`_check_missed_report`) · `__init__.py`(파사드 + `start()`/`stop()`/`reload()`).
- `start()` 순서: `_seed_batch_schedules()` → editable 배치별 `_reschedule_job` → `_check_missed_report()` → `_seed_rankings_if_empty()` → `_seed_kr_sector_if_empty()` → `_seed_us_sector_if_empty()` → `_scheduler.start()`.
- 배치 레지스트리 `backend/services/batch_registry.py` — 엔트리 **29개**(⚠️ 모듈 docstring은 "20개"로 stale). 각 엔트리 필드: `id`·`label`·`category`(report/market/guru)·`market`(KR/US/공통)·`source[]`·`usage[]`·`schedule_desc`·`default_schedule`·`editable`·`trigger_kinds[]`·`manual_endpoint`·`scheduler_job_id`·`timezone`(±`misfire_grace_time`). `consensus`만 스케줄러 잡 없음(daily_report 내부 실행).
- 스케줄 저장 = `batch_schedules(job_id text PK, data jsonb)`; 스펙 검증·cron 변환 = `backend/services/schedule_spec.py`(`daily|weekly|monthly|interval`, 시각 정규식 `^([01]\d|2[0-3]):[0-5]\d$`, `every_minutes ≥ 5`). 실행이력 = `job_runs`(`backend/services/job_runs.py`, job_id별 최신 20건 유지). 조회·편집 API = `backend/routers/batches.py`.
- 타임존: 전 배치 `Asia/Seoul`, **예외 `us_rankings_fetch` = `America/New_York`**. `misfire_grace_time`은 `daily_report_kr`/`daily_report_us`만 82800(미지정 시 APScheduler 기본 1s — `None` 전달은 "무제한"이 되므로 코드가 의도적으로 non-None일 때만 넘긴다).
- 기본 disabled 배치 3종: `daily_report_kr`, `daily_report_us`, `guru_crawl`.

## 8. 저장소 요약 (상세는 `INTEGRATIONS.md`)

- **PostgreSQL 16** = 정본. 접근은 `backend/services/db.py`의 `query`/`execute`/`execute_many`(psycopg2 `RealDictCursor`·`execute_batch`) + `get_connection()` 컨텍스트매니저(commit/rollback/putconn).
- 테스트는 conftest `_block_real_db` autouse 가드로 실 DB 접근 차단(로컬 `DATABASE_URL`이 도커 postgres를 가리키므로 필수 가드).
- 로컬 파일(gitignored 런타임): `backend/snapshots/`(per-ticker/date JSON) · `backend/data/consensus/` · `backend/data/calendar/`(빈 디렉터리 잔존) · `backend/reports/`(레거시 read-only).
- 정적 참조 데이터(커밋됨): `backend/data/sp500_tickers.json` · `backend/data/kospi_tickers.json`.
