---
last_mapped_commit: 7f3aec7d6aab5b2ed9837f9aada7405f9505ae6b
mapped: 2026-06-17
---

# External Integrations

**Analysis Date:** 2026-06-17

## APIs & External Services

**시세 — KR (폴백 체인: 키움 → KIS → Naver):**
- 키움증권(Kiwoom) REST — KR 1차 시세 소스(읽기전용, 주문·계좌 미연동). 클라이언트 `backend/services/kiwoom/client.py`(토큰 `POST /oauth2/token`, TR `POST /api/dostk/{category}`, base `https://api.kiwoom.com`). TR 모듈: `quote.py`(ka10001 현재가), `chart.py`(ka10081/82/83 일·주·월봉), `investor.py`(수급), `sector.py`(ka20006/ka20002 업종 모멘텀), `shortsell.py`(공매도).
  - Auth: `KIWOOM_APP_KEY` + `KIWOOM_SECRET_KEY` (옵션 base override `KIWOOM_BASE_URL`).
  - 토큰: 인프로세스 싱글톤, 12h 캐시, 401/403 시 1회 강제 재발급 재시도. 직렬 throttle 최소 0.25s.
  - Graceful: `configured()`가 키 없으면 False → 호출측이 Naver로 폴백(예외 전파).
- KIS 한국투자증권 REST — KR/US 읽기전용 *백업* 시세(주문·계좌 미연동). 클라이언트 `backend/services/kis/client.py`(토큰 `POST /oauth2/tokenP`, GET `/uapi/...`, base 실전 `https://openapi.koreainvestment.com:9443`). 시세 `backend/services/kis/quote.py`: 국내 `FHKST01010100`, 해외 `HHDFS00000300`/`HHDFS76240000`(EXCD NAS→NYS→AMS probe).
  - Auth: `KIS_APP_KEY` + `KIS_APP_SECRET` (옵션 `KIS_BASE_URL` — 모의투자 도메인 override).
  - 토큰: 인프로세스 싱글톤, 23h 캐시, **발급 1분당 1회 제한(EGW00133) 방어로 강제 재발급 60s 가드**, 401/403 재발급 재시도. throttle 0.05s.
  - Graceful: `configured()` False면 **휴면**(키 없는 게 안전 기본값) — 코드 머지돼도 무해, 기존 체인만 동작.
- Naver 모바일 증권 API — KR 시세·재무 최종 폴백 + 컨센서스·뉴스. `backend/services/market.py`(`https://m.stock.naver.com/api/stock/{ticker}/...` basic·finance/quarter·finance/annual), 컨센서스 `backend/services/consensus_pipeline.py`(`https://m.stock.naver.com/api/research/stock/{ticker}`), 뉴스 `backend/services/scraper.py`(`https://m.stock.naver.com/api/news/...`), 구루 US `backend/services/guru_scraper.py`(`https://api.stock.naver.com/stock`). 공개 API(키 불요, `Referer` 헤더 필요).
- FnGuide — KR 시총·컨센서스 보조 스크래핑. `backend/services/market.py`·`backend/services/consensus_pipeline.py`(`https://comp.fnguide.com/SVO2/...`). 키 불요, `Referer` 헤더.

**시세 — US:**
- yfinance (Yahoo Finance) — US 1차 시세·섹터·시총·히스토리, 배치 `yf.download`. `backend/services/market.py`. 키 불요. KR sector/industry도 키움에 TR 없어 yfinance 보조.

**거시·경제 지표:**
- FRED (St. Louis Fed) — 경제지표·매크로 신호 시계열. `backend/services/market_indicators/econ.py`·`macro.py`(`https://api.stlouisfed.org/fred/series/observations`). 매크로 신호: T10Y2Y·BAMLH0A0HYM2·M2SL·DFF.
  - Auth: `FRED_API_KEY`. Graceful: 미설정 시 `{"error": "FRED_API_KEY 환경변수가 필요합니다."}` 반환(수집 실패, 저장값 무변경).

**KR 공시·재무·수주:**
- DART (금융감독원 OpenDART) — KR 전용 공시·재무·배당·수주잔고. base `https://opendart.fss.or.kr/api`. 공시 피드 `backend/services/disclosures.py`(list.json A·B·C·D 유형별 4콜), 배당 `backend/services/dividends.py`(alotMatter.json), 수주잔고 `backend/services/backlog.py`(document.xml 원문 ZIP 파싱). 뷰어 `https://dart.fss.or.kr/dsaf001/main.do`.
  - Auth: `DART_API_KEY`. Graceful: 키 없으면 빈 문자열 반환·status 013(무데이터)은 빈 리스트.

**KR 수급·대차 (공공데이터포털 data.go.kr):**
- 신용잔고·반대매매·시총(KOFIA 통계) — `backend/services/leverage_service.py`(`https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService` + `GetMarketIndexInfoService`) → `market_leverage_indicators` 테이블.
- 내외국인 대차잔고 — `backend/services/lending_service.py`(`https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2`) → `market_lending_balance` 테이블.
  - Auth: 둘 다 `KOFIA_API_KEY`(동일 키). Graceful: 미설정 시 요청 실패(HTTP 오류 예외).

**KR 수출:**
- 관세청(Korea Customs Service) Itemtrade — `backend/services/market_indicators/exports.py`(`https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`). **env명은 `KITA_API_KEY`지만 실제론 관세청 키.**
- UN Comtrade — 폴백. `https://comtradeapi.un.org/public/v1/preview/C/M/HS`. 키 불요(공개 preview).
  - Auth/Graceful: `KITA_API_KEY` 있으면 관세청, 없으면 자동으로 UN Comtrade 공개 API 폴백.

**시장지표 yfinance 소스 (`backend/services/market_indicators/`):**
- FX/VIX `fx.py`, 원자재/국채 `commodities.py`, M7/KR Top2 실적 `earnings.py` — yfinance incremental fetch. PostgreSQL `market_cache` 영구 저장 후 요청은 저장값만 읽음(`cache.py`의 `_mc_load`/`_mc_save`).

**스크래핑 — 구루·뉴스:**
- Dataroma — 구루 운용역·보유내역. `backend/services/guru_scraper.py`(`https://www.dataroma.com/m/managers.php`·`holdings.php`). 키 불요.
- Finviz — US 종목 스냅샷 보조. `backend/services/scraper.py`(`https://finviz.com/quote.ashx`). 키 불요.

## Data Storage

**Databases:**
- PostgreSQL 16 (Docker 컨테이너 `postgres`, postgres:16-alpine). 기본 저장소.
  - 연결: `DATABASE_URL` env. 드라이버 psycopg2 `ThreadedConnectionPool` (`backend/services/db.py`).
  - 스키마 적재 순서: `backend/auth_schema.sql`(01) → `backend/app_schema.sql`(02), `docker-compose.yml`의 init 볼륨 마운트. 추가 컬럼/테이블은 `backend/main.py` `_migrate()` 기동 시 idempotent DDL.
  - 인증 테이블(`auth_schema.sql`): `users`(role user|admin·OAuth), `refresh_tokens`.
  - 앱 테이블(`app_schema.sql`): `tickers`, `snapshots`, `user_stocks`, `schedules`, `guru_managers`, `guru_schedules`, `batch_schedules`, `digests`, `consensus_history`, `calendar_cache`, `market_cache`, `user_menu_permissions`, `default_menu_permissions`, `raw_reports`, `daily_consensus_mart`, `user_events`, `market_leverage_indicators`, `market_lending_balance`, `backlog_history`, `market_rankings`, `market_investor_trend`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `job_runs`.

**File Storage (로컬 파일 캐시, gitignored):**
- `backend/data/calendar/YYYY-MM.json` — 월별 캘린더 이벤트(종목 변동 시 자동 무효화).
- `backend/data/consensus/` — per-ticker 컨센서스(Naver/yfinance).
- `backend/snapshots/` — 생성된 JSON 스냅샷(per-ticker/date).
- `backend/reports/` — 레거시 리포트(읽기 전용 JSON 폴백).
- `backend/data/` 정적 참조: `sp500_tickers.json`, `kospi_tickers.json`.

**Caching:**
- 인메모리 6종 `backend/services/cache.py`: snapshot(LRU 200), list(TTL 5s), dashboard(300s), correlation(300s), sector(300s), macro(300s). 종목 변동 시 자동 무효화.
- PWA 클라이언트 캐시: 서비스워커 NetworkFirst(`/api/*`, auth 제외, 5분), Google/CDN 폰트 CacheFirst (`frontend/vite.config.js`).

## Authentication & Identity

**자체 인증:**
- JWT HS256 — access/refresh 토큰. 발급·검증 `backend/services/auth_service.py`(python-jose), 의존성 `backend/auth.py` `get_current_user`. 서명키 `JWT_SECRET`.
- bcrypt 비밀번호 해시 (`backend/services/auth_service.py`).
- 세션: Starlette `SessionMiddleware`(OAuth state), 서명키 `SESSION_SECRET`(`backend/main.py`).

**OAuth 공급자 (`backend/routers/auth.py`):**
- Google — `GET /oauth/google` → `https://accounts.google.com/o/oauth2/v2/auth`, 콜백 토큰교환 `https://oauth2.googleapis.com/token`. Gated by `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. 리다이렉트 URI는 `FRONTEND_URL` 기반.
- GitHub — `GET /oauth/github` → `https://github.com/login/oauth/authorize`, 토큰교환 `https://github.com/login/oauth/access_token`, 프로필 `https://api.github.com/user`(+`/emails`). Gated by `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`.
- OAuth 사용자 upsert `backend/services/auth_service.py` `upsert_oauth_user`(provider 연결).

**역할/권한:**
- `users.role`(user|admin) — admin만 리포트 생성·Guru 크롤·관리 엔드포인트. 설정은 DB 직접 `UPDATE users SET role='admin'`.
- 메뉴 권한 `user_menu_permissions` — `PUT /api/admin/users/:id/permissions`, 프론트 `AuthContext`가 로그인 시 로드해 nav 필터.

## External Cowork API

- 외부 Claude Cowork 클라이언트가 종목 분석을 읽기/쓰기. 명세 `CLAUDE_COWORK_API.md`(+ `API_SPEC.md`).
- 인증: `X-API-Key` 헤더. 검증 `backend/auth.py` `get_current_user_or_api_key` — 헤더 값이 `COWORK_API_KEY` env와 일치하면 sentinel user(`__api_key__`)로 인증, 불일치 시 401. JWT Bearer와 양자택일.
- 용도: enrich API(AI 분석 텍스트·insights·수주잔고 pending 채움 등). 백엔드는 LLM 미호출 — Cowork가 작성 측.

## Monitoring & Observability

**Error Tracking:**
- 외부 에러 트래커 미연동. 외부 fetch 실패는 print/로깅(silent except 금지 규약). 배치 실행이력 `job_runs` 테이블(`backend/services/job_runs.py`).

**Logs:**
- 로컬 개발: `/tmp/portfolion-backend.log`, `/tmp/portfolion-frontend.log` (`start.sh`).
- 배포 폴러: `~/Library/Logs/com.portfolion.auto-deploy-poll.log` (`scripts/auto-deploy-poll.sh`).

## CI/CD & Deployment

**Hosting:**
- Mac 로컬 Docker(`docker-compose.yml` 4-컨테이너: postgres·backend·nginx·certbot). 외부 노출은 Cloudflare Tunnel(`portfolion.taebro.com` → localhost:80).

**CI Pipeline:**
- 정식 CI 러너 없음(워크플로 미관찰). 배포는 `git push origin main` → launchd 폴러 `scripts/auto-deploy-poll.sh`(2분 주기)가 `origin/main` 변경 감지 시 `deploy.sh` 실행. concurrency lock `/tmp/portfolion-deploy.lock`.

## Environment Configuration

**필수/주요 env 키 NAME (값 미기재, gating용):**
- 인프라: `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `FRONTEND_URL`.
- OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
- 외부 데이터: `FRED_API_KEY`, `KITA_API_KEY`(관세청), `KOFIA_API_KEY`(신용/대차 공용), `DART_API_KEY`.
- 시세: `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIWOOM_BASE_URL`(옵션), `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_BASE_URL`(옵션).
- Cowork: `COWORK_API_KEY`.
- 미사용 잔존: `ANTHROPIC_API_KEY`(백엔드 미호출), `SUPABASE_*`(레거시, 현 인프라 미사용).

**Secrets location:**
- `backend/.env.docker`(Docker 백엔드, gitignore), 루트 `.env`(compose 보간), `backend/.env`(로컬). DDNS는 launchd env(`CF_ZONE_ID`/`CF_API_TOKEN`, `scripts/ddns_update.sh`).

**Graceful degradation 요약:**
- 시세: 키움/KIS는 키 없으면 휴면·폴백(앱 정상). yfinance·Naver·FnGuide는 키 불요.
- FRED/DART/KOFIA: 키 없으면 해당 지표 수집 실패(error dict 또는 빈 결과)하되 앱 본체는 동작. 저장값(market_cache/테이블)이 있으면 그대로 서빙.
- KITA(관세청): 키 없으면 UN Comtrade 공개 API로 자동 폴백.

## Webhooks & Callbacks

**Incoming:**
- OAuth 콜백 `/api/auth/oauth/google/callback`, `/api/auth/oauth/github/callback` (`backend/routers/auth.py`). 그 외 외부 웹훅 수신 엔드포인트 없음.

**Outgoing:**
- 외부 webhook 발신 없음. 모든 외부 호출은 polling/배치 기반 fetch.

---

*Integration audit: 2026-06-17*
