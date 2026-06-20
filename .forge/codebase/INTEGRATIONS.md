---
last_mapped_commit: 53b30e71425b810f8ce3edc33b2767b1be2e242c
mapped: 2026-06-20
---

# INTEGRATIONS

PortfoliOn이 연동하는 외부 API·데이터 소스·DB·인증 제공자·배포 인프라. 각 항목별로 용도, 코드 위치(`file_path`), 게이팅 환경변수 *이름*(값 미기재), 폴백 동작을 정리했다. 환경변수 키는 모두 `backend/.env.docker`에 둔다(gitignore). 키 미설정이 안전 기본값(휴면) — 외부 키가 없어도 코드는 무해.

## 시세 소스 — 시장별 폴백 체인

진입은 `backend/services/market/__init__.py` (`get_quote`, `resolve_name`, `get_quotes_batch`). `_get_quote_uncached`가 market으로 분기. 종목 단위 TTL 캐시(`cache.get_quote_cached`)로 외부 호출을 종목당 TTL당 1회로 상한(rate-limit 방어).

### KR 현재가: 키움 → KIS → Naver
`backend/services/market/kr.py` `get_quote_kr`:
- `_kr_basic_kiwoom(ticker) or _kr_basic_kis(ticker) or _kr_basic_naver(ticker)` 순 폴백. 각 단계는 미설정/실패/빈 price면 None을 돌려 다음 단계로.
- sector/industry는 키움에 TR이 없어 **yfinance 유지**(ADR-0009).
- KR 시총 보강은 Naver `marketValue` 또는 FnGuide(`comp.fnguide.com/SVO2/asp/SVD_main.asp`) 정규식.
- 상폐 종목은 Naver 409로 검출. KR 일봉 종가 시리즈는 키움 차트(`_kr_closes_kiwoom`), 실패 시 [].

### US 현재가: yfinance → KIS
`backend/services/market/us.py` `_us_quote_kis`: yfinance 1차, 실패/빈 시세 시 KIS 백업(ADR-0011). 배치는 `get_quotes_batch`가 `yf.download` 1콜로 처리하고 실패 시 단건 `get_quote` 폴백.

## yfinance (Yahoo Finance)

- **용도**: US 시세/재무/시총/히스토리(1차 소스), KR sector/industry 보강, 캘린더 이벤트, 매크로 상관 자산(TLT/UUP/USO/^VIX), 섹터 ETF 모멘텀(11종), 배당(US), FX/VIX/원자재/국채 시계열, M7 실적, 다이제스트 시세.
- **위치**: `backend/services/market/us.py`, `backend/services/market/__init__.py`, `backend/routers/calendar.py`(ThreadPoolExecutor max 30 병렬), `backend/routers/analysis.py`(`analysis_service.py` SECTOR_ETFS·MACRO_TICKERS), `backend/services/dividends.py`(US `t.info` dividendRate/dividendYield), `backend/services/market_indicators/fx.py`·`commodities.py`·`earnings.py`(US).
- **게이팅**: 없음(공개, 키 불필요).
- **폴백**: US 시세는 KIS가 백업. FX 현재가는 `https://open.er-api.com/v6/latest/USD`로 폴백. yfinance NaN `Close`가 합산값 오염 가능 → 소스에서 `math.isfinite` 가드 필요.

## Naver (m.stock.naver.com / api.stock.naver.com / finance.naver.com)

- **용도**: KR 현재가/재무(분기·연간) 폴백, US 구루 종목명, 종목 뉴스, KR 랭킹(시총/거래대금), 투자자 수급 추이 폴백, KR Top2 실적, KOSPI 종목 리스트.
- **위치**: `backend/services/market/kr.py`(`_NAVER_BASE = https://m.stock.naver.com/api/stock`), `backend/services/guru_scraper.py`(`https://api.stock.naver.com/stock`), `backend/services/scraper.py`(뉴스), `backend/services/ranking_service.py`(`https://m.stock.naver.com/api/stocks/marketValue`), `backend/services/investor_service.py`(`_fetch_trend_naver` 폴백), `backend/services/market_indicators/earnings.py`(KR 재무·KOSPI 리스트), `backend/services/recommendation/`.
- **게이팅**: 없음(공개; `Referer: https://m.stock.naver.com/` 헤더 필요).
- **폴백**: KR 시세 체인의 최종 폴백. 키움/KIS 미설정·실패 시 사용.

## 키움증권 (Kiwoom REST API)

- **용도**: **KR 읽기전용 시세 소스(1차)** — 현재가, 일봉 차트, 업종 모멘텀, 투자자 수급, 공매도. 계좌·주문 미연동(경계 ADR-0009).
- **위치**: `backend/services/kiwoom/` 패키지 — `client.py`(토큰/요청), `quote.py`(현재가 ka10001), `chart.py`(일봉), `sector.py`(업종 ka20006 일봉종가 + ka20002 종목매핑), `investor.py`(수급), `shortsell.py`(공매도). 소비처: `market/kr.py`, `services/kr_sector_service.py`, `services/investor_service.py`, `services/short_sell_service.py`. 카탈로그: 루트 `KIWOOM_API.md`.
- **API**: `client.py` base URL `https://api.kiwoom.com`(override `KIWOOM_BASE_URL`), 토큰 `POST /oauth2/token`(client_credentials), TR 요청 `POST /api/dostk/{category}`(헤더 `api-id`/`authorization`, `return_code≠0`→`KiwoomError`). 인프로세스 싱글톤 토큰(캐시 12h, 401 재발급 재시도), 직렬 throttle(최소 0.25초 간격). `integrated_code`로 종목코드→통합거래소(`_AL`, NXT 확장시간 포착). 사용 TR: ka10001/10008/10014/10059/10081/10082/10083/10101/20002/20006.
- **게이팅**: `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY` (+ 선택 `KIWOOM_BASE_URL`). `configured()` False면 휴면.
- **폴백**: 미설정/실패 시 KR 체인이 KIS→Naver로 폴백.
- **주의**: 배치-백킹 뷰(랭킹·KR 업종 모멘텀)는 요청·기동 경로에서 키움을 라이브 호출하지 말 것 — 배치가 `market_cache`/테이블에 사전계산 저장, 요청은 저장값만 read. 빈/all-None 결과는 캐시에 박제 금지.

## 한국투자증권 (KIS REST API)

- **용도**: **KR+US 읽기전용 *백업* 시세 소스** — 키움/yfinance 1차 실패 시 폴백. 주문·계좌 미연동(경계 ADR-0011).
- **위치**: `backend/services/kis/` 패키지 — `client.py`(토큰/요청), `quote.py`(국내 `get_quote_kr` FHKST01010100, 해외 `get_quote_us` price HHDFS00000300 + dailyprice HHDFS76240000, EXCD NAS→NYS→AMS probe). 소비처: `market/kr.py`(`_kr_basic_kis`), `market/us.py`(`_us_quote_kis`). 카탈로그: 루트 `KIS_API.md`.
- **API**: `client.py` base URL `https://openapi.koreainvestment.com:9443`(실전 기본, override `KIS_BASE_URL`), 토큰 `POST /oauth2/tokenP`(발급 1분당 1회 EGW00133 방어로 강제 재발급 60s 가드 + 401 재시도, 캐시 23h), 요청 GET `/uapi/...`(헤더 `tr_id`/`appkey`/`appsecret`/`custtype=P`, `rt_cd≠"0"`→`KisError`), 직렬 throttle(최소 0.05초).
- **게이팅**: `KIS_APP_KEY`, `KIS_APP_SECRET` (+ 선택 `KIS_BASE_URL`). `configured()` False면 휴면(키 미설정이 안전 기본값 — 코드 머지해도 무해; 사용자가 포털 발급키를 `.env.docker`에 직접 주입하면 활성화).
- **폴백**: 자신이 폴백 계층. KR=키움 다음/Naver 앞, US=yfinance 다음. KIS US는 가격만·주요지수 구성종목 위주·15분 지연 → 백업으로만.

## DART / OpenDART (전자공시, opendart.fss.or.kr)

- **용도**: KR 전용 공시 데이터 — 수주잔고 원문, 공시 피드, 배당(KR), 내부자·5%지분 공시. (요청경로 라이브 호출 0, 배치가 저장)
- **위치**:
  - `backend/services/backlog.py` + `backend/services/backlog_parser.py` — 수주잔고. DART 전용 API 부재로 **공시서류원본파일 `/api/document.xml`**(ZIP→전 멤버 디코드) 원문 파싱(`_expand_grid` 헤더매핑 rowspan/colspan 전개·1% 검산·억원정규화). 검산 실패/다중엔티티/외화는 `source='pending'`(amount=None)로 두고 Cowork(`PUT /api/report/{ticker}/backlog`)가 채움. ADR-0002/0003/0005/0006.
  - `backend/services/disclosures.py` — 공시 피드. `https://opendart.fss.or.kr/api`, corp_code별 `list.json`을 핵심유형 A(정기)/B(주요사항)/C(발행)/D(지분) 각각 개별 호출(종목당 4콜; list.json이 `pblntf_ty`를 echo 안 함) → `stock_disclosures` 테이블 `rcept_no` dedup upsert.
  - `backend/services/dividends.py` — KR 배당. `alotMatter.json`(보통주 주당현금배당금(원)·현금배당수익률(%) 당기값).
  - `backend/services/insider_trades.py` — 내부자·5%지분 소유상황보고 → `stock_insider_trades`.
  - 소비처: `backend/routers/report.py`, `backend/routers/stocks.py`, `backend/services/digest_service.py`. corp_code 매핑은 `backlog._get_corp_code_map` 재사용.
- **게이팅**: `DART_API_KEY` 필수(`crtfc_key` 파라미터). 미설정 시 수집 실패.
- **폴백**: DART status 013(무데이터)은 graceful 빈 리스트. 공시 피드(`stock_disclosures`, 자동) ≠ `recent_disclosures`(Cowork 코멘터리, `tickers.recent_disclosures`) — 별도 store, 서로 덮지 않음.

## FRED (Federal Reserve, api.stlouisfed.org)

- **용도**: 경제지표(`econ.py`: CPI·실업률)와 매크로 신호 시계열(`macro.py`: T10Y2Y 금리차·BAMLH0A0HYM2 HY OAS·M2SL·DFF + 신호 판정). market_cache에 증분 저장, GET은 저장값만 반환.
- **위치**: `backend/services/market_indicators/econ.py`, `backend/services/market_indicators/macro.py` (둘 다 `https://api.stlouisfed.org/fred/series/observations`). 소비처: `backend/routers/market_indicators.py`(`GET /api/market/macro-signals`, `POST /api/market/refresh-macro-signals` admin). 배치 `macro_signals_fetch`(매일 06:00 KST, market="US")·`monthly_us`.
- **게이팅**: `FRED_API_KEY` 필수(`api_key` 파라미터). 미설정 시 수집 실패(저장값 무변경) — 캐시/저장값 또는 빈 구조 반환.
- **폴백**: 없음(키 없으면 수집 스킵).

## KOFIA / 공공데이터포털 (apis.data.go.kr/1160100)

- **용도**: 신용잔고·반대매매·시총(레버리지 지표), 내외국인 대차잔고.
- **위치**:
  - `backend/services/leverage_service.py` — `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService` + `GetMarketIndexInfoService` → `market_leverage_indicators` 테이블.
  - `backend/services/lending_service.py` — `https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2`(금융위) → `market_lending_balance` 테이블. 엔드포인트 `GET /api/market-indicators/lending`, `POST .../lending/sync`(admin).
- **게이팅**: `KOFIA_API_KEY` 필수(`serviceKey` 쿼리). 두 서비스 공유. 미설정 시 요청 실패.
- **폴백**: 없음(HTTP 오류 시 예외 전파).

## 관세청 (KITA_API_KEY) / UN Comtrade — KR 수출

- **용도**: KR 월별 수출 지표.
- **위치**: `backend/services/market_indicators/exports.py`. 관세청 `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`(`_fetch_customs_exports`), UN Comtrade `https://comtradeapi.un.org/public/v1/preview/C/M/HS`(`_fetch_comtrade_exports`).
- **게이팅**: `KITA_API_KEY` — 실제로는 **관세청(Korea Customs Service)** 키. 설정 시 관세청, 미설정 시 Comtrade.
- **폴백**: `KITA_API_KEY` 미설정 → UN Comtrade 공개 API(키 불필요). 관세청 호출 실패 시에도 Comtrade로 폴백. 둘 다 실패 시 캐시 파일 또는 `{"months": [], "error": ...}`.

## Google / GitHub OAuth

- **용도**: 소셜 로그인.
- **위치**: `backend/routers/auth.py` (httpx로 직접 토큰 교환, authlib 미사용). state는 `SESSION_SECRET` 기반 HMAC(SHA256 nonce 서명)으로 검증.
  - Google: authorize `https://accounts.google.com/o/oauth2/v2/auth`, 토큰 `https://oauth2.googleapis.com/token`, `id_token` payload를 base64 직접 디코딩(at_hash 검증 우회 — bb56076 수정). 진입 `/api/auth/oauth/google`, 콜백 `/api/auth/oauth/google/callback`.
  - GitHub: authorize `https://github.com/login/oauth/authorize`, 토큰 `https://github.com/login/oauth/access_token`, 프로필 `https://api.github.com/user` + `/user/emails`. 진입 `/api/auth/oauth/github`, 콜백 `/api/auth/oauth/github/callback`.
  - 사용자 매핑: `auth_service.upsert_oauth_user(email, provider, sub)`.
- **게이팅**: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`. 리다이렉트 base는 `FRONTEND_URL`.
- **선언 의존성**: `authlib`가 requirements에 있으나 auth.py는 httpx/jose로 직접 흐름 구현.

## 자체 인증 — JWT / 세션 / Cowork API Key

- **JWT**: `backend/services/auth_service.py` — `python-jose` HS256. 액세스 토큰 1시간 만료, 리프레시 토큰 30일(`refresh_tokens` 테이블, `secrets.token_urlsafe(64)`). 비밀번호 `bcrypt`(`hash_password`/`verify_password`). 게이팅 `JWT_SECRET`. 사용자 저장 `users` 테이블(role `user`|`admin`).
- **세션**: `backend/main.py` starlette `SessionMiddleware`, 게이팅 `SESSION_SECRET`(itsdangerous 서명; 미설정 시 코드상 `os.environ["SESSION_SECRET"]` 필수). OAuth state/nonce용.
- **Cowork API Key**: `backend/auth.py` — 헤더 `X-API-Key`가 `COWORK_API_KEY`와 일치하면 인증(외부 Claude Cowork가 enrich API 호출, 센티넬 user_id `"__api_key__"`). JWT Bearer 또는 X-API-Key 중 하나로 인증(`get_current_user_or_api_key`), admin 게이트는 `require_admin_or_api_key`. 명세 `CLAUDE_COWORK_API.md`.
- **CORS**: `backend/main.py` allow_origins = `http://localhost:3000`, `http://localhost:5173`, `FRONTEND_URL`(비면 제외).

## 기타 외부 스크레이프 소스 (FnGuide / Finviz / Dataroma / Wikipedia)

- `backend/services/scraper.py` — Finviz `https://finviz.com/quote.ashx`(US 스크레이프), Naver 뉴스.
- `backend/services/guru_scraper.py` — Dataroma `https://www.dataroma.com/m`(구루 13F 보유; managers.php/holdings.php), Naver US 종목명.
- `backend/services/market_indicators/earnings.py` — S&P 500 구성종목 리스트 `https://en.wikipedia.org/wiki/List_of_S%26P_500_companies`(7일 캐시).
- FnGuide(`comp.fnguide.com`) — KR 시총 보강(`market/kr.py`), 컨센서스/리포트 배치 `source`에 명시.
- **게이팅**: 없음(공개 스크레이프). lxml 대신 html.parser 권장(로컬 .venv lxml 부재).

## Telegram (다이제스트 알림)

- **용도**: 일일 다이제스트 푸시 알림.
- **위치**: `backend/services/digest_service.py` — `https://api.telegram.org/bot{token}/sendMessage`. 호출 `backend/routers/digest.py`, 배치 `daily_digest`(매일 08:00 KST).
- **게이팅**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`(둘 다 `os.getenv`, 미설정 시 전송 스킵·로그 후 계속). ⚠️ 이 두 키는 `.env.docker` 샘플 키 목록에는 미열거 — 코드에서 참조하므로 운영 환경에 별도 주입 필요.

## PostgreSQL 16 (기본 저장소)

- **용도**: 런타임 데이터 전부. 로컬 JSON 파일은 캐시/폴백 용도.
- **위치**: `backend/services/db.py` — `psycopg2` `ThreadedConnectionPool`(minconn=1, maxconn=20, `RealDictCursor`), DSN은 `DATABASE_URL`. 컨테이너 `postgres:16-alpine`(`docker-compose.yml`).
- **게이팅**: `DATABASE_URL`(연결), `POSTGRES_PASSWORD`(컨테이너 init).
- **스키마 위치**: `backend/auth_schema.sql`(users, refresh_tokens) → `backend/app_schema.sql`. 신규 테이블은 `main._migrate()`의 `CREATE TABLE IF NOT EXISTS`가 정본.
- **테이블** (스키마 + 기동 마이그레이션 종합):
  - 인증: `users`, `refresh_tokens`
  - 종목/배당/수급: `tickers`, `user_stocks`, `stock_dividends`, `stock_supply_score`
  - 리포트/공시/내부자: `snapshots`, `raw_reports`, `stock_disclosures`, `stock_insider_trades`, `backlog_history`(segments JSONB)
  - 스케줄/구루: `schedules`, `guru_schedules`, `guru_managers`, `batch_schedules`, `job_runs`
  - 다이제스트/컨센서스: `digests`, `consensus_history`, `daily_consensus_mart`
  - 캐시: `calendar_cache`, `market_cache`, `market_rankings`, `market_investor_trend`, `market_short_sell`
  - 권한/행동: `user_menu_permissions`, `default_menu_permissions`, `user_events`
  - 수급지표: `market_leverage_indicators`, `market_lending_balance`
  - 추천: `stock_recommendations`
- **로컬 파일 캐시(gitignored)**: `backend/data/consensus/`(per-ticker), `backend/data/calendar/`(월별), `backend/snapshots/`, `backend/reports/`(레거시 읽기전용).

## APScheduler 배치 (26개)

`backend/scheduler/`(잡 함수)와 `backend/services/batch_registry.py`(메타데이터)가 정의. `GET /api/batches`가 노출. 출처국 기준 market 분류(KR/US/공통, ADR-0013). 각 배치의 `source`는 위 외부 소스 절과 매핑된다.

| 배치 id | 주기(기본) | source | market |
|---------|-----------|--------|--------|
| `daily_report_kr` / `daily_report_us` | 20:30 / 07:00 KST | 키움·KIS·Naver·FnGuide / yfinance·Finviz | KR / US |
| `consensus` | 리포트 생성 내장 | FnGuide·Naver·yfinance | 공통 |
| `daily_digest` | 매일 08:00 | 보유종목 시세 + Telegram 발송 | 공통 |
| `backlog_fetch` | 주 일 04:00 | DART | KR |
| `dividend_fetch` | 주 일 05:00 | yfinance·DART | 공통 |
| `disclosure_fetch` | 매일 07:30 | DART | KR |
| `insider_fetch` | 매일 07:45 | DART | KR |
| `earnings_kr` / `earnings_us` | 주 일 03:00 | Naver / yfinance | KR / US |
| `monthly_kr` / `monthly_us` | 월 1일 02:00 | 관세청·UN Comtrade / FRED | KR / US |
| `macro_signals_fetch` | 매일 06:00 | FRED | US |
| `leverage_fetch` | 매일 07:00 | KOFIA | KR |
| `lending_fetch` | 월 5일 08:00 | 금융위 | KR |
| `kr_rankings_fetch` / `us_rankings_fetch` | 장중 10분마다 | Naver / yfinance | KR / US |
| `investor_trend_fetch` | 매일 18:00 | 키움·Naver | KR |
| `short_sell_fetch` | 매일 18:30 | 키움 | KR |
| `supply_score_fetch` | 매일 19:00 | 키움·Naver | KR |
| `kr_sector_fetch` | 매일 16:00 | 키움 | KR |
| `guru_crawl` | 설정(주 일 03:00) | dataroma | 공통 |
| `recommendation_kr` / `recommendation_us` | 20:30 / 07:00 | Naver·키움·yfinance·DART / yfinance·dataroma | KR / US |

## 배포 인프라 연동

- **nginx** (`nginx/nginx.conf`, `nginx:alpine`): HTTP(80)/443 컨테이너, `/api/`·`/health` → `backend:8000` 프록시, `frontend/dist` 정적 서빙, `/.well-known/acme-challenge/` → certbot.
- **Cloudflare Tunnel**: `portfolion.taebro.com` → `localhost:80`. cloudflared는 launchd 실행(compose 컨테이너 아님).
- **certbot** (`certbot/certbot`): HTTPS 인증서 12h 자동 갱신 루프. 인증서 볼륨 `./certbot/conf`·`./certbot/www`.
- **자동 배포 폴러**: launchd `com.portfolion.auto-deploy-poll` 2분 주기(`scripts/auto-deploy-poll.sh`), `git push origin main`으로 트리거.

## 미사용 / 휴면

- **Anthropic / LLM**: `ANTHROPIC_API_KEY`가 `.env.docker`에 남아있으나 백엔드 미사용(requirements에 anthropic 없음). AI 분석은 외부 Cowork가 작성.
- **authlib**: requirements 선언만, auth.py는 httpx/jose로 직접 구현.
- **Supabase / Render / Vercel**: 제거됨(Mac 로컬 Docker로 전환).
