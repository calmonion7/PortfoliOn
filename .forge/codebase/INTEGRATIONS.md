---
last_mapped_commit: 6d95dcb9610a1b3c68075b0f587169989f6d8e10
mapped: 2026-06-19
---

# INTEGRATIONS

PortfoliOn이 연동하는 외부 API·데이터 소스·DB·인증 제공자. 각 항목별로 용도, 코드 위치(`file_path`), 게이팅 환경변수 *이름*(값 미기재), 폴백 동작을 정리했다. 환경변수 키는 모두 `backend/.env.docker`에 둔다(gitignore).

## 시세 소스 — 시장별 폴백 체인

진입은 `backend/services/market/__init__.py` (`get_quote`, `resolve_name`, `get_quotes_batch`). `_get_quote_uncached`가 market으로 분기.

### KR 현재가: 키움 → KIS → Naver
`backend/services/market/kr.py` `get_quote_kr` (라인 104~):
- `_kr_basic_kiwoom(ticker) or _kr_basic_kis(ticker) or _kr_basic_naver(ticker)` 순 폴백.
- sector/industry는 키움에 TR이 없어 **yfinance 유지**(.forge/adr/0009).
- 상폐 종목은 Naver 409로 검출. KR 일봉 종가 시리즈는 키움 차트(`_kr_closes_kiwoom`), 실패 시 [].

### US 현재가: yfinance → KIS
`backend/services/market/us.py` `_us_quote_kis` (라인 101~): yfinance 1차, 실패 시 KIS 백업(.forge/adr/0011). 배치는 `get_quotes_batch`가 `yf.download` 1콜로 처리하고 실패 시 단건 `get_quote` 폴백.

## yfinance (Yahoo Finance)

- **용도**: US 시세/재무/시총/히스토리(1차 소스), KR sector/industry 보강, 캘린더 이벤트, 매크로 상관 자산(TLT/UUP/USO/^VIX), 섹터 ETF 모멘텀, 배당(US).
- **위치**: `backend/services/market/us.py`, `backend/services/market/__init__.py`, `backend/routers/calendar.py`(ThreadPoolExecutor max 30 병렬), `backend/routers/analysis.py`(`analysis_service.py` SECTOR_ETFS 11종·MACRO_TICKERS), `backend/services/dividends.py`(US 배당), `backend/services/market_indicators/fx.py`·`commodities.py`(FX/VIX/원자재/국채 incremental).
- **게이팅**: 없음(공개, 키 불필요).
- **폴백**: US 시세는 KIS가 백업. yfinance NaN `Close`가 합산값 오염 가능 → 소스에서 `math.isfinite` 가드 필요.

## Naver (m.stock.naver.com / api.stock.naver.com)

- **용도**: KR 현재가/재무(분기·연간) 폴백, US 구루 종목, 종목 뉴스, KR 랭킹(시총/거래대금), 투자자 수급 추이 폴백.
- **위치**: `backend/services/market/kr.py`(`_NAVER_BASE = https://m.stock.naver.com/api/stock`), `backend/services/guru_scraper.py`(`_NAVER_US_BASE = https://api.stock.naver.com/stock`), `backend/services/scraper.py`(뉴스 `m.stock.naver.com/api/news`, 기사 `n.news.naver.com`), `backend/services/ranking_service.py`(`https://m.stock.naver.com/api/stocks/marketValue`), `backend/services/investor_service.py`(`_fetch_trend_naver` 폴백), `backend/services/recommendation/universe.py`.
- **게이팅**: 없음(공개; `Referer: https://m.stock.naver.com/` 헤더 필요).
- **폴백**: KR 시세 체인의 최종 폴백. 키움 미설정/실패 시 사용.

## 키움증권 (Kiwoom REST API)

- **용도**: **KR 읽기전용 시세 소스(1차)** — 현재가, 일봉 차트, 업종 모멘텀, 투자자 수급, 공매도. 계좌·주문 미연동(경계 ADR-0009).
- **위치**: `backend/services/kiwoom/` 패키지 — `client.py`(토큰/요청), `quote.py`(현재가 ka10001), `chart.py`(일봉), `sector.py`(업종 ka20006 일봉종가 + ka20002 종목매핑), `investor.py`(수급), `shortsell.py`(공매도). 소비처: `market/kr.py`, `services/kr_sector_service.py`, `services/investor_service.py`, `services/short_sell_service.py`. 카탈로그: 루트 `KIWOOM_API.md`.
- **API**: `client.py` base URL `https://api.kiwoom.com`(override `KIWOOM_BASE_URL`), 토큰 `POST /oauth2/token`, TR 요청 `POST /api/dostk/{category}`(헤더 `api-id`/`authorization`, `return_code≠0`→예외, 인프로세스 싱글톤 토큰·401 재발급 재시도·직렬 throttle). 사용 TR: ka10001/10008/10014/10059/10081/10082/10083/10101/20002/20006.
- **게이팅**: `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY` (+ 선택 `KIWOOM_BASE_URL`). `configured()` False면 휴면.
- **폴백**: 미설정/실패 시 KR 체인이 KIS→Naver로 폴백.
- **주의**: 배치-백킹 뷰(랭킹·KR 업종 모멘텀)는 요청·기동 경로에서 키움을 라이브 호출하지 말 것 — 배치가 `market_cache`/테이블에 사전계산 저장, 요청은 저장값만 read.

## 한국투자증권 (KIS REST API)

- **용도**: **KR+US 읽기전용 *백업* 시세 소스** — 키움/yfinance 1차 실패 시 폴백. 주문·계좌 미연동(경계 ADR-0011).
- **위치**: `backend/services/kis/` 패키지 — `client.py`(토큰/요청), `quote.py`(국내 `get_quote_kr` FHKST01010100, 해외 `get_quote_us` price HHDFS00000300 + dailyprice HHDFS76240000, EXCD NAS→NYS→AMS probe). 소비처: `market/kr.py`(`_kr_basic_kis`), `market/us.py`(`_us_quote_kis`). 카탈로그: 루트 `KIS_API.md`.
- **API**: `client.py` base URL `https://openapi.koreainvestment.com:9443`(실전, override `KIS_BASE_URL`), 토큰 `POST /oauth2/tokenP`(EGW00133 방어로 강제 재발급 60s 가드 + 401 재시도), 요청 GET `/uapi/...`(헤더 `tr_id`/`appkey`/`appsecret`/`custtype=P`, `rt_cd≠"0"`→예외, 직렬 throttle).
- **게이팅**: `KIS_APP_KEY`, `KIS_APP_SECRET` (+ 선택 `KIS_BASE_URL`). `configured()` False면 휴면(키 미설정이 안전 기본값 — 코드 머지해도 무해).
- **폴백**: 자신이 폴백 계층. KR=키움 다음/Naver 앞, US=yfinance 다음.

## DART / OpenDART (전자공시, opendart.fss.or.kr)

- **용도**: KR 전용 공시 데이터 — 수주잔고 원문, 공시 피드, 배당(KR), 내부자·5%지분 공시. (요청경로 라이브 호출 0, 배치가 저장)
- **위치**:
  - `backend/services/backlog.py` + `backend/services/backlog_parser.py` — 수주잔고. DART 전용 API 부재로 **공시서류원본파일 `/api/document.xml`**(ZIP→디코드) 원문 파싱(`_expand_grid` 헤더매핑·검산·억원정규화). 검산 실패/다중엔티티/외화는 `source='pending'`로 두고 Cowork(`PUT /api/report/{ticker}/backlog`)가 채움. ADR-0002/0003/0005/0006.
  - `backend/services/disclosures.py` — 공시 피드. `_DART_BASE = https://opendart.fss.or.kr/api`, corp_code별 `list.json`을 핵심유형 A/B/C/D 각각 개별 호출(종목당 4콜; list.json이 `pblntf_ty`를 echo 안 함) → `stock_disclosures` 테이블 `rcept_no` dedup. 뷰어 `https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}`.
  - `backend/services/dividends.py` — KR 배당. `alotMatter.json`(보통주 주당현금배당금·현금배당수익률 당기값).
  - `backend/services/insider_trades.py` — 내부자·5%지분 소유상황보고.
  - 소비처: `backend/routers/report.py`, `backend/routers/stocks.py`, `backend/services/digest_service.py`.
- **게이팅**: `DART_API_KEY` 필수(`crtfc_key` 파라미터). 미설정 시 수집 실패.
- **폴백**: DART status 013(무데이터)은 graceful 빈 리스트. 공시 피드(`stock_disclosures`, 자동) ≠ `recent_disclosures`(Cowork 코멘터리, `tickers.recent_disclosures`) — 별도 store, 서로 덮지 않음.

## FRED (Federal Reserve, api.stlouisfed.org)

- **용도**: 경제지표(`econ.py`)와 매크로 신호 시계열(`macro.py`: T10Y2Y 금리차·BAMLH0A0HYM2 HY OAS·M2SL·DFF). market_cache에 증분 저장, GET은 저장값만 반환.
- **위치**: `backend/services/market_indicators/econ.py`, `backend/services/market_indicators/macro.py` (둘 다 `https://api.stlouisfed.org/fred/series/observations`). 소비처: `backend/routers/market_indicators.py`(`GET /api/market/macro-signals`, `POST /api/market/refresh-macro-signals` admin). 배치 `macro_signals_fetch`(매일 06:00 KST, market="US")·`monthly_us`.
- **게이팅**: `FRED_API_KEY` 필수(`api_key` 파라미터). 미설정 시 수집 실패(저장값 무변경), 응답 `{"error": "FRED_API_KEY 환경변수가 필요합니다."}`.
- **폴백**: 없음(키 없으면 수집 스킵).

## KOFIA / 공공데이터포털 (apis.data.go.kr/1160100)

- **용도**: 신용잔고·반대매매·시총(레버리지 지표), 내외국인 대차잔고.
- **위치**:
  - `backend/services/leverage_service.py` — `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService` + `GetMarketIndexInfoService` → `market_leverage_indicators` 테이블.
  - `backend/services/lending_service.py` — `https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2` → `market_lending_balance` 테이블. 엔드포인트 `GET /api/market-indicators/lending`, `POST .../lending/sync`(admin).
  - 백필 진입 `backend/run_backfill.py`.
- **게이팅**: `KOFIA_API_KEY` 필수(`serviceKey` 쿼리). 두 서비스 공유. 미설정 시 요청 실패.
- **폴백**: 없음.

## 관세청 (KITA_API_KEY) / UN Comtrade — KR 수출

- **용도**: KR 월별 수출 지표.
- **위치**: `backend/services/market_indicators/exports.py`. 관세청 `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`(`_fetch_customs_exports`), UN Comtrade `https://comtradeapi.un.org/public/v1/preview/C/M/HS`(`_fetch_comtrade_exports`).
- **게이팅**: `KITA_API_KEY` — 실제로는 **관세청(Korea Customs Service)** 키. 설정 시 관세청, 미설정 시 Comtrade.
- **폴백**: `KITA_API_KEY` 미설정 → UN Comtrade 공개 API. 관세청 호출 실패 시에도 Comtrade로 폴백(`exports.py` 라인 117~122).

## Google / GitHub OAuth

- **용도**: 소셜 로그인.
- **위치**: `backend/routers/auth.py`.
  - Google: authorize `https://accounts.google.com/o/oauth2/v2/auth`, 토큰 교환은 httpx로 직접(at_hash 검증은 base64 직접 디코딩 — bb56076 수정).
  - GitHub: authorize `https://github.com/login/oauth/authorize`, 토큰 `https://github.com/login/oauth/access_token`, 프로필 `https://api.github.com/user` + `/user/emails`.
- **게이팅**: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`. 리다이렉트 base는 `FRONTEND_URL`.
- **선언 의존성**: `authlib`가 requirements에 있으나 auth.py는 httpx/jose로 직접 흐름 구현.

## 자체 인증 — JWT / 세션 / Cowork API Key

- **JWT**: `backend/services/auth_service.py` — `python-jose` HS256 (`jwt.encode`/`jwt.decode`, `algorithms=["HS256"]`), 비밀번호 `bcrypt`. 게이팅 `JWT_SECRET`. 토큰 저장 `users`/`refresh_tokens` 테이블.
- **세션**: `backend/main.py` starlette `SessionMiddleware`, 게이팅 `SESSION_SECRET`(itsdangerous 서명). OAuth state/nonce용.
- **Cowork API Key**: `backend/auth.py` — 헤더 `X-API-Key`(상수 `_API_KEY_HEADER`)가 `COWORK_API_KEY`와 일치하면 인증(외부 Claude Cowork가 enrich API 호출). JWT Bearer 또는 X-API-Key 중 하나로 인증(`get_current_user_or_api_key`). 명세 `CLAUDE_COWORK_API.md`.
- **CORS**: `backend/main.py` allow_origins = `http://localhost:3000`, `http://localhost:5173`, `FRONTEND_URL`(비면 제외).

## 기타 외부 소스

- **FnGuide / Finviz / Dataroma**:
  - `backend/services/scraper.py` — Finviz `https://finviz.com/quote.ashx`(US 컨센서스/스크레이프), Naver 뉴스.
  - `backend/services/guru_scraper.py` — Dataroma `https://www.dataroma.com/m`(구루 13F 보유), Naver US.
  - 컨센서스/리포트 배치 `source`에 FnGuide 명시(`backend/services/batch_registry.py`).
  - 게이팅: 없음(공개 스크레이프). lxml 대신 html.parser 권장(로컬 .venv lxml 부재).

## Telegram (다이제스트 알림)

- **용도**: 일일 다이제스트 푸시 알림.
- **위치**: `backend/services/digest_service.py` `send_telegram` — `https://api.telegram.org/bot{token}/sendMessage`. 호출 `backend/routers/digest.py`.
- **게이팅**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`(둘 다 `os.getenv`, 미설정 시 전송 스킵). ⚠️ 이 두 키는 `.env.docker` 키 목록(POSTGRES_PASSWORD/JWT 등)에는 미열거 — 코드에서 참조하므로 운영 환경에 별도 주입 필요.

## PostgreSQL (기본 저장소)

- **용도**: 런타임 데이터 전부(users·tickers·snapshots·market_cache·digests·consensus_history 등; 전체 테이블은 `app_schema.sql`/`auth_schema.sql`).
- **위치**: `backend/services/db.py` — `psycopg2` `ThreadedConnectionPool`(`RealDictCursor`), DSN은 `DATABASE_URL`. 컨테이너 `postgres:16-alpine`(`docker-compose.yml`).
- **게이팅**: `DATABASE_URL`(연결), `POSTGRES_PASSWORD`(컨테이너 init).
- **로컬 파일 캐시(gitignored)**: `backend/data/consensus/`(per-ticker), `backend/data/calendar/`(월별), `backend/snapshots/` — DB가 1차, 파일은 런타임 캐시/폴백.

## 미사용 / 휴면

- **Anthropic / LLM**: `ANTHROPIC_API_KEY`가 `.env.docker`에 남아있으나 백엔드 미사용(requirements에 anthropic 없음). AI 분석은 외부 Cowork가 작성.
- **Supabase / Render / Vercel**: 제거됨(Mac 로컬 Docker로 전환). `frontend/vercel.json`은 레거시 잔존.
