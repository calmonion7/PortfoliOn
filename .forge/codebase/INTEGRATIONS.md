---
last_mapped_commit: 9de05a1ee9f11c92f58807adeff3dcc2cab63550
mapped: 2026-07-03
---

# INTEGRATIONS

모든 외부 API/서비스 연동 목록 — 용도, 진입 모듈 경로, 필수 env 키, 폴백 동작. HTTP는 대부분 `requests`, OAuth 토큰 교환만 `httpx`. 키 이름 목록은 STACK.md 참조 (값은 절대 기재하지 않음).

## yfinance (Yahoo Finance)

라이브러리 (`import yfinance as yf`), 직접 HTTP 아님. **US 1차 소스**. env 키 불필요.

- **US 시세/히스토리/재무** — `backend/services/market/us.py`. `yf.Ticker(yf_sym)`, `.history(period=...)`, `get_income_stmt()`/`get_balance_sheet()`/`get_cashflow()` **메서드** 사용 (무공백 index 라벨 — `.income_stmt` 프로퍼티의 공백 라벨과 다름, CLAUDE.md 가토). 실패 시 KIS 폴백.
- **US 수급/소유** — `backend/services/us_supply.py`. `fetch_us_supply(ticker, exchange)`가 `t.institutional_holders`, `t.insider_transactions`, `info["shortPercentOfFloat"]` 읽어 (`_finite` NaN/inf 가드) `us_supply_snapshot` 테이블에 저장. 조회는 `get_us_supply` / `get_us_insider`.
- **US 섹터 모멘텀 (배치-백킹, task#136 신설)** — `backend/services/us_sector_service.py`. `us_sector_fetch` 일배치(매일 07:20 KST, `backend/scheduler/jobs.py` `_fetch_us_sector`)가 `analysis_service.SECTOR_ETFS`(XLK 등 11종 ETF)의 1주/1개월/3개월 수익률을 사전계산해 `market_cache`(key `us_sector_momentum`)에 저장. 요청경로(`GET /api/analysis/sector?market=US` → `analysis_service.get_sector_momentum`)는 `load_momentum()` **저장값만 읽음** (라이브 yfinance 0콜). 전 섹터 all-None이면 save 생략(직전 양호값 유지). 수동 `POST /api/analysis/sector/refresh-us`(admin). 기동 시드 `_seed_us_sector_if_empty` (`backend/scheduler/__init__.py`).
- **캘린더 실적/배당 이벤트** — `backend/routers/calendar.py`. 종목별 `yf.Ticker(sym).calendar`를 `ThreadPoolExecutor`로 병렬 fetch. KR은 `.KS`/`.KQ` 접미사 필수 (`_yf_sym`).
- **다이제스트 시세 (배치화, task#136)** — `backend/services/digest_service.py`. 종목별 `yf.Ticker` 개별 호출을 제거하고 `services.market.get_quotes_batch` 1회 배치 호출로 교체 (`digest_service`에서 `yf` import 자체가 사라짐 — 이 심볼을 patch하던 테스트도 함께 마이그레이션됨, CLAUDE.md 가토). USD/KRW 환율도 라이브 fetch 대신 저장 FX 우선: `_get_usdkrw()`가 `_mc_load("fx")` 저장값 → 없으면 `market_indicators.fx._fetch_usdkrw_current()` → 최종 폴백 1380 (isfinite 가드 포함).
- **추천 깔때기 US 컨센서스 백필** — `backend/services/recommendation/funnel.py` `_backfill_us_consensus(cand)`. 당일 `daily_consensus_mart` 부재 US 후보만 `t.upgrades_downgrades` fetch → `consensus_pipeline.upsert_raw_reports` → `refresh_mart`.
- **종목명 해석/백필** — `backend/services/market/__init__.py` `resolve_name(ticker, market, ...)`. US는 `info.get("shortName")`, KR은 키움 `stk_nm`/Naver. `POST /api/stocks/names/backfill`이 이 경로 사용.
- **매크로 상관/상관관계 분석** — `backend/services/analysis_service.py` (`MACRO_TICKERS` TLT/UUP/USO/^VIX, 보유종목 90일 히스토리), `backend/routers/analytics.py` 상관관계.
- **시장지수/FX/VIX/원자재/국채** — `backend/services/market_indicators/` 각 서브모듈 (`fx.py`, `commodities.py`, `indices.py` 등)이 `_yf_close_history` 증분 fetch → `market_cache` 저장.

## Naver (m.stock.naver.com / api.stock.naver.com / finance.naver.com)

무인증 공개 JSON/HTML 엔드포인트 (커스텀 `User-Agent` + `Referer: https://m.stock.naver.com/`). env 키 불필요.

- **KR 시세 (폴백)** — `backend/services/market/kr.py`. `_NAVER_BASE = "https://m.stock.naver.com/api/stock"`; KR 시세 합의 체인(키움 → KIS → Naver)의 일원. 리포트 박제 게이트의 독립 ref 피드(`_kr_basic_naver`, 실패 시 0.5s retry-once).
- **컨센서스/리서치 리포트** — `backend/services/consensus_pipeline.py`. `https://m.stock.naver.com/api/research/stock/{ticker}?pageSize=200` + `/{rid}` 상세.
- **뉴스 스크레이핑** — `backend/services/scraper.py`. `https://m.stock.naver.com/api/news/stock/{ticker}` + 기사 페이지 `https://n.news.naver.com/mnews/article/{office_id}/{article_id}`.
- **구루 (US 보유)** — `backend/services/guru_scraper.py`. `_NAVER_US_BASE = "https://api.stock.naver.com/stock"`.
- **랭킹 (시가총액)** — `backend/services/ranking_service.py`. `_NAVER_MARKETVALUE = "https://m.stock.naver.com/api/stocks/marketValue"`. 빈 응답 시 기존 랭킹 wipe 금지 가드 (task#133).
- **KR 실적/시총 목록** — `backend/services/market_indicators/earnings.py`. `_NAVER_BASE` + `https://finance.naver.com/sise/sise_market_sum.naver`.

## 키움 (Kiwoom) REST API

**KR 시세 1차 소스**. 읽기전용 조회 TR만 (계좌·주문 미연동 — ADR-0009). 클라이언트 `backend/services/kiwoom/client.py`.

- 베이스 URL: `KIWOOM_BASE_URL` env (기본 `https://api.kiwoom.com`). 키: `KIWOOM_APP_KEY` / `KIWOOM_SECRET_KEY`. 미설정 시 Naver 폴백으로 동작.
- 토큰: `POST {base}/oauth2/token` (`client_credentials`; 인프로세스 싱글톤, 401 시 재발급 재시도).
- TR 요청: `POST {base}/api/dostk/{category}` — `api-id`/`authorization` 헤더, 직렬 throttle, `return_code != 0` 예외.
- 서브모듈: `quote.py` (ka10001 현재가), `chart.py` (ka10081 일봉), `sector.py` (ka20006 업종일봉 / ka20002 업종별주가), `investor.py` (투자자 수급), `shortsell.py` (공매도).
- 소비처: `backend/services/market/kr.py` (KR 시세 — 아래 합의 체인), `backend/services/kr_sector_service.py` (KRX 업종 모멘텀 사전계산, `kr_sector_fetch` 일배치 16:00 KST + `POST /api/analysis/sector/refresh-kr`). 코드 선택 `integrated_code(stk_cd, regular=)` — 기본 NXT `_AL`, `regular=True`면 KRX 평문 코드 (리포트 스냅샷 writer만 opt-in, ADR-0020).
- **KR 시세 합의 체인** (`backend/services/market/kr.py`): `regular=False`는 2-of-N 다수결(`_kr_pick_basic`/`_corroborated_pick`) — 키움 NXT+KRX 2콜 합의 → 불일치 시 KIS·Naver escalation (피드별 try/except 격리, task#133) → 그래도 합의 불가면 degenerate self-check(`_kr_pick_degenerate_lazy`). **degenerate는 escalation이 이미 받은 KIS/Naver 결과를 인자로 재사용** — 4피드 합의 실패 시 중복 HTTP 2콜 제거 (task#137).

## KIS (한국투자증권)

**백업 시세 소스** (KR은 키움 다음, US는 yfinance 다음 폴백). 읽기전용 (ADR-0011). 클라이언트 `backend/services/kis/client.py`.

- 베이스 URL: `KIS_BASE_URL` env (기본 실전 `https://openapi.koreainvestment.com:9443`). 키: `KIS_APP_KEY` / `KIS_APP_SECRET`. **키 미설정 시 휴면** (`configured()` False — 기존 체인 무변화가 안전 기본값).
- 토큰: `POST {base}/oauth2/tokenP` (인프로세스 싱글톤; EGW00133 방어로 강제 재발급 60s 가드; 401 재시도).
- 요청: `GET {base}/uapi/...` — `tr_id`/`appkey`/`appsecret`/`custtype=P` 헤더, 직렬 throttle, `rt_cd != "0"` 예외.
- `backend/services/kis/quote.py`: KR `FHKST01010100` (현재가/기준가/등락율/시총 억원→원 정규화), US price `HHDFS00000300` + dailyprice `HHDFS76240000` (EXCD NAS→NYS→AMS probe).

## DART (OpenDART, opendart.fss.or.kr)

KR 전용, `DART_API_KEY` 필수 (미설정 시 각 서비스 휴면/graceful 빈 결과). 베이스 `https://opendart.fss.or.kr/api`. status 013(무데이터)은 graceful 처리.

- **수주잔고** — `backend/services/backlog.py` (+ 파서 `backend/services/backlog_parser.py`). 구조화 API 부재 → `list.json`으로 `rcept_no` 확보 후 `document.xml`(ZIP → 전 멤버 디코드) 원문 파싱. 검산 실패/다중엔티티/외화는 `source='pending'` (Cowork가 채움). 외화 표는 unit 전파 지원 (task#138). `_get_corp_code_map`이 ticker→corp_code 매핑 (타 DART 서비스가 재사용). 배치 `backlog_fetch`(주간 일 04:00) + `POST /api/report/backlog/refresh-all`(admin).
- **공시 피드** — `backend/services/disclosures.py`. `list.json`을 핵심유형 A/B/C/D **별도 호출** (응답이 `pblntf_ty`를 echo 안 하므로 질의 유형을 stamp). `rcept_no` dedup으로 `stock_disclosures` upsert (execute_many 배치화, task#135). 배치 `disclosure_fetch`(매일 07:30).
- **주총(AGM) 일정** — `backend/services/agm.py`. `list.json`을 `pblntf_ty` **미지정**으로 호출해야 주총 공시가 잡힘 → `report_nm` "주주총회" 필터 → `document.xml` 본문에서 회의일 2전략 파싱 (`소집결의` 테이블 / `소집공고` 자유텍스트). 직렬 throttle 0.3s. 배치 `agm_fetch`(매일 08:00) → `stock_disclosures.meeting_date`.
- **내부자 거래** — `backend/services/insider_trades.py`. `elestock.json`(임원·주요주주) + `majorstock.json`(5% rule); `row_hash` 결정적 idempotent upsert → `stock_insider_trades` (배치화, task#135).
- **KR 배당** — `backend/services/dividends.py` KR 분기. `alotMatter.json` (보통주 주당 현금배당금·수익률 당기값). 배치 `dividend_fetch`(매주 일 05:00).
- **KR 재무** — `backend/services/market/kr.py`. `fnlttSinglAcntAll` (전체 재무제표 — 요청에 `fs_div` 필수, CFS→OFS 폴백, `account_id` XBRL 매칭) + `fnlttSinglAcnt` (주요계정).

## FRED (세인트루이스 연은) — 엔드포인트 2종

`FRED_API_KEY` 필수; 미설정 시 수집 실패(저장값 무변경) graceful.

- **`series/observations`** — 경제/매크로 시계열.
  - `backend/services/market_indicators/econ.py`: 경제지표 (`_fetch_series(series_id, start)`), 배치 `monthly_us`.
  - `backend/services/market_indicators/macro.py`: 매크로 신호 4종 (`T10Y2Y`·`BAMLH0A0HYM2`·`M2SL`·`DFF`) → `market_cache`(key `macro_signals`) 증분 저장 + `evaluate_signals` 플래그. 배치 `macro_signals_fetch`(매일 06:00) + `POST /api/market/refresh-macro-signals`(admin). GET은 저장값만 반환.
- **`releases/dates`** — 캘린더 경제 릴리즈 이벤트. `backend/routers/calendar.py` `_get_econ_events`. **FOMC 일정은 같은 파일의 정적 `_FOMC_DATES` 리스트** (키 무관 항상 포함, ~2027-12 커버, 수동 갱신).

## multpl.com (Shiller CAPE 크롤)

`backend/services/market_indicators/indices.py`. **FRED엔 S&P CAPE 시리즈가 없어** `https://www.multpl.com/shiller-pe`를 `requests` + `BeautifulSoup(html, "html.parser")`(로컬 lxml 부재)로 크롤 — `_parse_multpl_cape(html)`가 현재값+통계 테이블(mean/median/min/max) 파싱. 파싱 실패는 `logger.warning` 후 None graceful. `GET /api/market/indices` 응답의 `valuation.sp500_cape`에 포함 (시장지수 레벨 `^GSPC`/`^KS11`/`^KQ11`은 yfinance). fx 패턴 요청경로 증분(TTL캐시→`_mc_load`→라이브→`_mc_save`)이라 스케줄 배치 없음. env 키 불필요.

## KOFIA / data.go.kr (공공데이터포털)

`KOFIA_API_KEY` 필수 (두 서비스 공유). `requests.get` + `User-Agent: Mozilla/5.0`. 미설정 시 요청 실패.

- **수급지표** (신용잔고·반대매매·시총) — `backend/services/leverage_service.py`. `_KOFIA_BASE = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService"` + `_INDEX_BASE = ".../GetMarketIndexInfoService"`; 전 페이지 페이지네이션 → `market_leverage_indicators` 테이블. 빈 items 응답 가드 (task#133).
- **대차잔고** (내외국인) — `backend/services/lending_service.py`. `_BASE = "https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2"` → `market_lending_balance` 테이블. `GET /api/market-indicators/lending`, `POST /api/market-indicators/lending/sync`(admin).

## 관세청 / UN Comtrade (KR 수출)

`backend/services/market_indicators/exports.py`. 배치 `monthly_kr`.

- 1차 (`KITA_API_KEY` 설정 시): 관세청 `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList` (`_fetch_customs_exports`). **env 이름은 KITA지만 실제 관세청 키** (CLAUDE.md 가토).
- 폴백 (키 없음/실패): UN Comtrade `_COMTRADE_URL = "https://comtradeapi.un.org/public/v1/preview/C/M/HS"` (`_fetch_comtrade_exports`, 무인증).

## PostgreSQL (Docker)

`backend/services/db.py`. `psycopg2` + `RealDictCursor` + 모듈 레벨 `ThreadedConnectionPool` (`_get_pool()`, DSN은 `os.environ["DATABASE_URL"]`). 커넥션은 `get_connection()` (getconn/putconn). **`execute_many(sql, params_list)` 배치 헬퍼** (task#135) — 단일 커넥션에서 `psycopg2.extras.execute_batch` 실행, 빈 리스트는 no-op(커넥션 미획득); disclosures/insider_trades/investor/short_sell/digest/admin 등 8곳의 N+1 행별 execute를 대체. 컨테이너 `postgres:16-alpine` (`docker-compose.yml`); 스키마 `backend/auth_schema.sql` → `backend/app_schema.sql` 순서 (라이브 DB는 `backend/main.py` `_migrate` idempotent 마이그레이션만 탐 — ADR-0006). uuid 컬럼 `= ANY(%s)`는 `::uuid[]` 명시 캐스트 필수 (CLAUDE.md 가토).

## Google & GitHub OAuth + JWT

`backend/routers/auth.py` (플로우) + `backend/services/auth_service.py` (토큰/유저).

- **Google OAuth**: authorize `https://accounts.google.com/o/oauth2/v2/auth`, 토큰 교환 `https://oauth2.googleapis.com/token` (`httpx`). 리다이렉트 URI `{FRONTEND_URL}/api/auth/oauth/google/callback`. 키 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. (at_hash는 jose 검증 대신 base64 직접 디코딩.)
- **GitHub OAuth**: authorize `https://github.com/login/oauth/authorize`, 토큰 `https://github.com/login/oauth/access_token`, 프로필 `https://api.github.com/user`. 키 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
- **JWT**: `from jose import jwt`; HS256, `JWT_SECRET` (`auth_service.py` `create_token`/`decode`). OAuth 유저는 `(oauth_provider, oauth_sub)`로 `users` upsert. 단명 OAuth 코드는 인프로세스 `_oauth_codes` dict (120s TTL, 만료 sweep — task#133).

## Cowork enrich API (외부 소비자)

역방향 연동 — 외부 Claude Cowork 클라이언트가 백엔드의 enrich API를 호출해 AI 분석 텍스트를 써넣는다 (백엔드에 LLM 호출 없음). 명세 `CLAUDE_COWORK_API.md`, 인증 `COWORK_API_KEY` (`require_admin_or_api_key` 의존성).

## Cloudflare Tunnel (인프라)

코드 연동 아님. `portfolion.taebro.com` → `localhost:80`, launchd로 실행 (compose 컨테이너 아님 — `README.md`/`CLAUDE.md`). 별도 DDNS 갱신 스크립트 `scripts/ddns_update.sh`가 Cloudflare API 사용 (`CF_ZONE_ID`/`CF_API_TOKEN`, `.env.docker` 밖에서 설정).

## GitHub Actions self-hosted 러너 + 배포 폴러 (인프라)

배포 경로 = **러너(주) + 폴러(폴백)** 이중화.

- **러너**: `.github/workflows/deploy.yml` — `on: push: branches: [main]`, `runs-on: self-hosted`. 스텝은 체크아웃 디렉터리에서 `git fetch origin && git reset --hard origin/main && bash deploy.sh`. PortfoliOn 전용 러너 = `~/actions-runner-portfolion` (launchd `actions.runner.calmonion7-PortfoliOn.macbook-portfolion`). 러너 부재 시 잡이 `queued → 24h cancelled`로 **무음 미배포** (진단: `gh run list`, `gh api repos/calmonion7/PortfoliOn/actions/runners`).
- **폴러**: `scripts/auto-deploy-poll.sh` — launchd `com.portfolion.auto-deploy-poll`이 2분마다 실행. `/tmp/portfolion-deploy.lock` 존재 시 skip; `git fetch` 후 **`LOCAL != origin/main`이면(양방향) `git reset --hard origin/main` + `bash deploy.sh`**. 같으면 exit 0 (러너가 처리한 경우). ⚠️ push 안 한 로컬 커밋/편집은 다음 폴(≤2분)에 reset으로 소실 — commit+push 묶어서 필수. 로그 `~/Library/Logs/com.portfolion.auto-deploy-poll.log`.
- **`deploy.sh`**: working tree 기준 백엔드 이미지 rebuild + 컨테이너 stop/rm/`docker run` (그래서 backend가 `docker compose ps`에 안 잡힘) + 프론트 빌드.
