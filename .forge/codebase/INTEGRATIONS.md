---
last_mapped_commit: a5fb8bc8fbb92ec9155e7bc20ba681388786bfcd
mapped: 2026-07-07
---

# INTEGRATIONS

PortfoliOn의 외부 API·데이터베이스·인증 공급자·외부 쓰기 API 지도. 각 통합의 파일 경로·필요 env 키 이름 명시. (env 값은 절대 미인용 — 키 이름만.)

## Database — PostgreSQL 16 (Docker)

- 엔진: `postgres:16-alpine` (`docker-compose.yml`), 볼륨 `pgdata`, 포트 5432. 접속: env `DATABASE_URL`.
- 드라이버/풀: `psycopg2-binary` + `psycopg2.pool.ThreadedConnectionPool` (`backend/services/db.py` — `_get_pool()` minconn=1/maxconn=20, `RealDictCursor`, `execute_batch`). 헬퍼 `get_connection()`/쿼리 함수.
- 스키마 실행 순서: `backend/auth_schema.sql`(01) → `backend/app_schema.sql`(02), INITDB 마운트. 라이브 DB는 기동 idempotent 마이그레이션(`backend/main.py:_migrate`)도 탐 — 신규 컬럼/테이블은 app_schema + `_migrate` 둘 다 필요.
- `auth_schema.sql` 테이블: `users`(id UUID, email, password_hash, oauth_provider, oauth_sub, role `user`|`admin`), `refresh_tokens`. `pgcrypto` 확장(gen_random_uuid).
- `app_schema.sql` 주요 테이블: `tickers`(공유 종목 마스터, `name`=종목명 정본·`enriched_at`), `snapshots`(per-ticker/date 리포트 JSON, `data.name`=박제 종목명), `user_stocks`(user별 holding/watchlist), `schedules`, `guru_managers`, `guru_schedules`, `batch_schedules`, `digests`, `consensus_history`, `calendar_cache`, `market_cache`(시장지표 영구 캐시), `user_menu_permissions`, `default_menu_permissions`, `raw_reports`, `daily_consensus_mart`(목표가 정본), `user_events`, `market_leverage_indicators`, `market_lending_balance`, `backlog_history`(segments JSONB), `market_rankings`, `market_investor_trend`, `market_short_sell`, `stock_disclosures`(meeting_date=AGM), `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`, `job_runs`(배치 실행 이력), `us_supply_snapshot`.
- `market_cache` 저장 키(시장지표 영구 캐시): fx/vix/commodities/treasury/econ/m7/krtop2/krexports/macro_signals/indices/kr_sector/**fear_greed**.
- 로컬 파일 캐시 (gitignored, 런타임 캐시 전용): `backend/data/consensus/`(per-ticker 컨센서스), `backend/data/calendar/`(월별 이벤트 `YYYY-MM.json`), `backend/snapshots/`(생성 JSON). `backend/data/`엔 정적 참조 데이터(`sp500_tickers.json`, `kospi_tickers.json`)만.

## 외부 데이터 소스 (시세·재무·시장지표·심리)

- **yfinance** (`yfinance` 패키지) — US 1차 시세/재무/히스토리·배당·내부자·기관보유, 캘린더 실적/배당일. 구현: `backend/services/market/us.py`, `backend/services/market_indicators/`(fx·vix·commodities·earnings 등 `_yf_close_history` 증분 fetch), `backend/routers/calendar.py`. 시장지수 `^GSPC`/`^KS11`/`^KQ11`(`indices.py`). 키 불필요. KR 실적일 forward는 `.KS`/`.KQ` 접미사가 유일 소스.
- **Naver 모바일** (`https://m.stock.naver.com/api/stock/{code}/...`, `backend/services/market/kr.py`) — KR 시세 폴백/독립 corroboration 피드. 키 불필요(공개 API).
- **키움증권 Kiwoom REST** (`backend/services/kiwoom/`: client·quote·chart·investor·sector·shortsell) — **KR 1차 읽기전용 시세**(계좌·주문 미연동, ADR-0009). 베이스 `https://api.kiwoom.com` (env `KIWOOM_BASE_URL` override). 토큰: env `KIWOOM_APP_KEY` + `KIWOOM_SECRET_KEY`. `client.py`가 인프로세스 싱글톤 토큰(401 재발급) + `request(api_id, body, category)`(`POST /api/dostk/{category}`). ka10001(현재가)·ka10081(일봉)·ka20006/ka20002(업종)·투자자/공매도 TR. `client.integrated_code(stk_cd, regular=)` — False=`_AL`(NXT), True=KRX 평문. 미설정 시 휴면(Naver 폴백).
- **한국투자증권 KIS REST** (`backend/services/kis/`: client·quote) — **KR+US 읽기전용 백업 시세**(키움/yfinance 실패 시, ADR-0011). 베이스 `https://openapi.koreainvestment.com:9443`(`kis/client.py` 하드코딩 기본, env `KIS_BASE_URL` override — 모의투자용). 토큰: env `KIS_APP_KEY` + `KIS_APP_SECRET` → `POST /oauth2/tokenP`(발급 60s 가드, EGW00133 방어). `request(tr_id, path, params)` GET. KR `FHKST01010100`, US `HHDFS00000300`/`HHDFS76240000`. 키 미설정=안전 기본값(휴면).
- **DART (금융감독원 오픈)** — 베이스 `https://opendart.fss.or.kr/api`, 뷰어 `https://dart.fss.or.kr/dsaf001/...`. env `DART_API_KEY`. 용도: 수주잔고(`backend/services/backlog.py` — `document.xml` 원문 파싱), 공시 피드(`backend/services/disclosures.py` — 유형별 A/B/C/D `list.json`), 주총 일정(`backend/services/agm.py` — no-type list + document 파싱), KR 재무(`backend/services/market/kr.py` — `fnlttSinglAcnt`/`fnlttSinglAcntAll`), KR 배당(`dividends.py` — `alotMatter.json`). KR 전용, 미설정 시 휴면. status 013(무데이터) graceful.
- **FRED (St. Louis Fed)** — 베이스 `https://api.stlouisfed.org/fred/series/observations`, `/releases/dates`(캘린더 econ 이벤트). env `FRED_API_KEY`. 용도: 경제지표(`backend/services/market_indicators/econ.py`), 매크로 신호 시계열 `T10Y2Y`/`BAMLH0A0HYM2`/`M2SL`/`DFF`(`macro.py`, `macro_signals` 캐시). 미설정 시 수집 실패(저장값 무변경). ⚠️ FRED엔 S&P CAPE 시리즈 없음.
- **multpl.com CAPE 크롤** — `https://www.multpl.com/shiller-pe` 페이지를 `requests`+`BeautifulSoup(html, "html.parser")`로 파싱(`backend/services/market_indicators/indices.py`). S&P500 Shiller CAPE(FRED 부재 대체). 키 불필요, 실패 graceful.
- **CNN Fear & Greed 지수** (신규) — `https://production.dataviz.cnn.io/index/fearandgreed/graphdata` (`backend/services/market_indicators/sentiment.py`). **비공식 API — 전체 브라우저 헤더(User-Agent/Origin/Referer/sec-ch-ua 등) 필수**. US 시장심리 score/rating + 최근 60일 히스토리. **요청경로 증분**(TTL 1h 인메모리 캐시 → 없으면 라이브 fetch → 성공 시 `sanitize` 후 `market_cache` key `fear_greed`로 저장; **실패 시 직전 저장값(`_mc_load`) graceful, 없으면 None**). 스케줄 배치 없음(fx/indices와 동일 패턴, `batch_registry` 무등록). 키 불필요. 조회 `GET /api/market/fear-greed`(`backend/routers/market_indicators.py`). 프론트 `frontend/src/components/market/FearGreedSection.jsx` → `frontend/src/pages/Market.jsx`.
- **공공데이터포털 (KOFIA/금융위 계열)** — 베이스 `https://apis.data.go.kr/1160100/...`. env `KOFIA_API_KEY`(leverage·lending 공용). 용도: 신용잔고·반대매매·시총(`backend/services/leverage_service.py` → `market_leverage_indicators`), 내외국인 대차잔고(`backend/services/lending_service.py`, `GetStocLendBorrInfoService_V2` → `market_lending_balance`). 미설정 시 요청 실패.
- **관세청 Korea Customs Service / UN Comtrade** — KR 수출 지표(`backend/services/market_indicators/exports.py`). 1차 관세청 `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`(env `KITA_API_KEY` — 실제로 관세청 키), 폴백 UN Comtrade 공개 API `https://comtradeapi.un.org/public/v1/preview/C/M/HS`(키 불필요). `KITA_API_KEY` 미설정 시 Comtrade 자동 폴백.

## 인증 (Auth)

- **JWT (HS256)** — `backend/services/auth_service.py` (`jwt.encode(..., algorithm="HS256")` / `jwt.decode(..., algorithms=["HS256"])`, `python-jose`). env `JWT_SECRET`. 리프레시 토큰은 `refresh_tokens` 테이블.
- **세션 서명** — starlette `SessionMiddleware`, env `SESSION_SECRET`(`itsdangerous`). `backend/main.py`.
- **OAuth** — `backend/routers/auth.py` (`authlib`). Google(env `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) + GitHub(env `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`). OAuth 토큰 교환은 임시 code(120s TTL, `_oauth_codes` 인메모리) → 프론트가 code로 교환. (Google at_hash는 base64 직접 디코딩 — jose 검증 우회.)
- **역할/권한** — `users.role`(`user`|`admin`, admin만 리포트 생성·Guru 크롤·admin 엔드포인트). 메뉴 권한 `user_menu_permissions`/`default_menu_permissions`, `PUT /api/admin/users/:id/permissions`, 허용 메뉴는 `backend/routers/admin.py:ALL_MENUS`. auth 의존성: `get_current_user`/`require_admin`/`require_admin_or_api_key`/`get_current_user_or_api_key`.

## Cowork 외부 쓰기 API

- 외부 Claude AI(Cowork 클라이언트)가 종목 AI 분석을 read/write하는 API. 명세 `CLAUDE_COWORK_API.md`(외부 소비자용) + `API_SPEC.md`(전체 REST 레퍼런스, source of truth).
- 인증: API 키 게이팅 — env `COWORK_API_KEY`, 의존성 `require_admin_or_api_key`/`get_current_user_or_api_key`(`backend/routers/report.py`, `_API_KEY_USER_ID`로 매핑). enrich API가 AI 분석 텍스트·insights·`tickers.enriched_at`를 씀. 백엔드 자체엔 LLM 호출 없음(`ANTHROPIC_API_KEY`는 `.env.docker`에 잔존하나 현재 미사용).
- 수주잔고 pending 채움: `PUT /api/report/{ticker}/backlog`(Cowork가 자동추출 실패분 수기 채움).
- ⚠️ API 변경 시 `API_SPEC.md` + `CLAUDE_COWORK_API.md` **둘 다** 갱신(DoD). 엔드포인트 존재 drift는 `backend/tests/test_api_doc_sync.py`가 자동 검출.

## FRONTEND_URL / CORS

- CORS origins (`backend/main.py`): `http://localhost:3000`, `http://localhost:5173`, env `FRONTEND_URL`(빈값이면 제외). 배포 시 `FRONTEND_URL`을 `.env.docker`에 설정.
- **Cloudflare Tunnel**로 `portfolion.taebro.com` → localhost:80 노출(`cloudflared` launchd 실행). nginx가 `/api/*` → `backend:8000` 프록시.
