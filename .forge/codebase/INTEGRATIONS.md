---
last_mapped_commit: 4bb49ff0402c150884f2fa9c80dfed8dff1945d5
mapped: 2026-07-29
---

# INTEGRATIONS — 외부 연동 · DB · 인증 · 외부 소비자

코드에 실제로 존재하는 외부 API 연동, 담당 모듈 경로, 필요 env 키 이름, 인증 방식, 실패 시 폴백/휴면 동작을 담는다.
런타임 버전·의존성·빌드·배포는 `.forge/codebase/STACK.md`.

**모든 env는 키 이름만 적는다. 값·토큰·시크릿은 절대 옮기지 않는다.**

---

## 0. 외부 호스트 → 담당 모듈 인덱스

| 호스트 | 담당 모듈 |
|---|---|
| `api.kiwoom.com` | `backend/services/kiwoom/client.py` |
| `openapi.koreainvestment.com:9443` | `backend/services/kis/client.py` |
| (yfinance — Yahoo, 라이브러리 경유) | `backend/services/market/us.py` 외 다수 (§3) |
| `m.stock.naver.com` | `backend/services/market/kr.py`, `backend/services/consensus_pipeline.py`, `backend/services/ranking_service.py`, `backend/services/scraper.py`, `backend/services/market_indicators/earnings.py`, `backend/services/guru_scraper.py`, `backend/services/investor_service.py` |
| `api.stock.naver.com` | `backend/services/guru_scraper.py` |
| `ac.stock.naver.com` | `backend/routers/stocks.py` |
| `finance.naver.com` | `backend/services/market_indicators/earnings.py` |
| `n.news.naver.com` | `backend/services/scraper.py` |
| `comp.fnguide.com` | `backend/services/market/kr.py`, `backend/services/consensus_pipeline.py` |
| `opendart.fss.or.kr` / `dart.fss.or.kr` | `backend/services/backlog.py`, `disclosures.py`, `agm.py`, `insider_trades.py`, `dividends.py`, `market/kr.py` |
| `api.stlouisfed.org` (FRED) | `backend/services/market_indicators/econ.py`, `macro.py`, `backend/routers/calendar.py` |
| `apis.data.go.kr` (공공데이터포털) | `backend/services/leverage_service.py`, `lending_service.py`, `backend/services/market_indicators/exports.py`, `backend/run_backfill.py` |
| `comtradeapi.un.org` | `backend/services/market_indicators/exports.py` |
| `www.dataroma.com` | `backend/services/guru_scraper.py` |
| `www.multpl.com` | `backend/services/market_indicators/indices.py` |
| `production.dataviz.cnn.io` / `edition.cnn.com` | `backend/services/market_indicators/sentiment.py` |
| `finviz.com` | `backend/services/scraper.py` |
| `en.wikipedia.org` | `backend/services/market_indicators/earnings.py` |
| `open.er-api.com` | `backend/services/market_indicators/fx.py` |
| `api.telegram.org` | `backend/services/digest_service.py` |
| `accounts.google.com` / `oauth2.googleapis.com` | `backend/routers/auth.py` |
| `github.com` / `api.github.com` | `backend/routers/auth.py` |
| (로컬 리스너 URL, env) | `backend/services/cowork_trigger.py` |

---

## 1. 키움증권 REST (KR 1차 시세 소스)

- **모듈**: `backend/services/kiwoom/` — `client.py`(토큰·요청·throttle), `quote.py`, `chart.py`, `investor.py`, `sector.py`, `shortsell.py`
- **env 키**: `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIWOOM_BASE_URL`(옵션, 기본 `https://api.kiwoom.com`)
- **인증**: `POST /oauth2/token`으로 앱키+시크릿 → 응답 `token`. 인프로세스 싱글톤(`_token_lock`/`_token_expiry`), 401 시 `_get_token(force=True)` 후 **1회 재시도**. 요청은 `POST /api/dostk/{category}` + 헤더 `api-id`, `authorization: Bearer`. `return_code != 0` → `KiwoomError`. 직렬 `_throttle()`. `request_paged()`가 `cont_yn`/`next_key` 커서 페이지네이션.
- **휴면**: `client.configured()`가 키 2개 유무를 보고, 미설정이면 `request()`가 즉시 빠진다 → 호출측이 폴백(Naver 등)으로 내려간다. 즉 **키 미설정이 안전 기본값**.
- **사용 TR**: `ka10001` 주식기본(`quote.py`), `ka10081/82/83` 일/주/월봉(`chart.py`), `ka10059`·`ka10008` 투자자별/외국인(`investor.py`), `ka10014` 공매도(`shortsell.py`), `ka20006` 업종일봉·`ka20002` 업종별주가(`sector.py`)
- **경계**: KR 읽기전용 시세만 — 계좌·주문 미연동(ADR-0009).
- **코드 선택**: `client.integrated_code(stk_cd, regular=False)`가 단일 분기점 — 기본 `_AL`(NXT SOR 통합코드), `regular=True`면 평문 KRX 코드. 리포트 스냅샷 writer만 `regular=True`로 opt-in(ADR-0020).
- **정규화 필수**: 값이 부호포함 문자열이고 시총은 억원 단위(`mac × 1e8`, `cur_prc` 절대값).
- **카탈로그**: 루트 `KIWOOM_API.md`.

## 2. 한국투자증권 KIS REST (KR/US 백업 시세 + 국내선물)

- **모듈**: `backend/services/kis/` — `client.py`, `quote.py`, `futures.py`
- **env 키**: `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_BASE_URL`(옵션, 기본 실전 `https://openapi.koreainvestment.com:9443`)
- **인증**: `POST /oauth2/tokenP` → `access_token`. 인프로세스 싱글톤 + **발급 1분당 1회 제한(EGW00133) 방어용 강제 재발급 60초 가드**(`_REISSUE_MIN_INTERVAL`), 401 시 1회 재발급 재시도. 요청은 `GET /uapi/...` + 헤더 `tr_id`/`appkey`/`appsecret`/`custtype=P`. `rt_cd != "0"` → `KisError`. 직렬 throttle.
- **휴면**: `client.configured()` False면 `request()`가 빠져 폴백 유지 — 코드를 머지해도 키 없으면 기존 동작 무변화.
- **사용 TR**: `FHKST01010100` 국내 현재가(`quote.py`), `HHDFS00000300` 해외 현재가 + `HHDFS76240000` 해외 일봉(EXCD NAS→NYS→AMS probe), `FHMIF10000000` 국내선물 현재가 + `FHKIF03020100` 선물 일봉(`futures.py`)
- **응답 봉투 함정**: 국내선물옵션 *시세* TR은 단수 `output`이 아니라 **`output1`(계약 quote)/`output2`(일봉 리스트)/`output3`(기초 KOSPI200)** 으로 분할된다. `d.get("output")`만 읽으면 `rt_cd=0`인데도 늘 빈값이라 "코드 오류"로 오진하게 된다.
- **경계**: 읽기전용 시세만, 주문·계좌 미연동(ADR-0011·0022).
- **카탈로그**: 루트 `KIS_API.md`.

## 3. yfinance (US 1차 소스, 시장지표 전반)

- **모듈**(비테스트, `yf` 사용): `backend/services/market/us.py`, `market/kr.py`, `market/__init__.py`, `backend/services/beta.py`, `indicators.py`, `dividends.py`, `consensus_pipeline.py`, `ranking_service.py`, `us_supply.py`, `us_sector_service.py`, `analysis_service.py`, `report_generator.py`, `scraper.py`, `cache.py`, `backend/services/market_indicators/`(`cache.py`, `earnings.py`, `fx.py`, `indices.py`, `kospi_signal.py`), `backend/services/kis/quote.py`, `backend/services/recommendation/funnel.py`, `backend/routers/`(`analysis.py`, `analytics.py`, `calendar.py`, `market_indicators.py`, `report.py`, `stocks.py`)
- **env 키**: 없음(공개 Yahoo 엔드포인트).
- **인증**: 없음. 그래서 rate-limit/418/스키마 변동이 상시 리스크 — 대부분의 호출이 try/except graceful.
- **폴백**: US 현재가는 `market/us.py`의 `_us_quote_kis`로 **yfinance → KIS**. `market/kr.py`의 KR 히스토리는 키움 실패 시 `[]` 반환 → 호출측 폴백.
- **라벨 함정**: `get_income_stmt()`/`get_balance_sheet()`/`get_cashflow()` **메서드**는 무공백 index 라벨(`OperatingCashFlow`)이고 `.income_stmt`/`.cash_flow` **프로퍼티**는 공백 라벨(`Operating Cash Flow`)이다. `market/format.py:_yf_val`은 exact 매칭이라 어긋나면 예외 없이 **조용히 None**. `market/us.py`는 get_* 메서드 계열로 통일할 것.
- **심볼 접미사**: `market/format.py:_yf_sym(ticker, market, exchange)` — US는 bare, KR은 `{ticker}.{exchange||KS}`. **raw ticker로 `yf.Ticker`를 부르면 KR은 0건**(캘린더 `_collect_earnings`의 실버그 이력).
- **퍼센트 스케일**: `info.shortPercentOfFloat`, `institutional_holders.pctHeld`/`pctChange`, `insider_purchases`의 `% Buy/Sell Shares`, `info.dividendYield` 등은 **0~1 소수분수** — 표시 시 ×100.
- **tz**: yfinance 인덱스는 tz-aware(예: `^KS11` Asia/Seoul), 키움 daily_df는 tz-naive → `pd.concat(axis=1)`이 `TypeError`. 한쪽을 `tz_localize(None)`으로 맞출 것.

## 4. Naver (KR 시세 폴백 · 컨센서스 · 랭킹 · 뉴스 · 검색 · 실적)

env 키 없음(공개/비공식 엔드포인트). 전부 `Referer: https://m.stock.naver.com/` 헤더를 붙인다.

| 용도 | 모듈 | 엔드포인트 계열 |
|---|---|---|
| KR 현재가 폴백 | `backend/services/market/kr.py` (`_naver_get`, `_kr_basic_naver`) | `m.stock.naver.com/api/stock/{code}/basic` — HTTP 오류(상폐 409)는 전파, 첫 호출 실패 시 0.5s 후 **retry-once** |
| 컨센서스(리서치) | `backend/services/consensus_pipeline.py` | `m.stock.naver.com/api/research/stock/{ticker}?pageSize=200`, `.../{rid}` — FnGuide 실패 시 폴백 |
| 랭킹(KR) | `backend/services/ranking_service.py` | `m.stock.naver.com/api/stocks/marketValue` (KOSPI+KOSDAQ, ThreadPool 페이지 병렬) |
| 수급 추이 폴백 | `backend/services/investor_service.py` | `_NAVER_BASE` `/trend` — 키움 미설정/실패/빈 결과 시 `_fetch_trend_naver` |
| 뉴스(KR) | `backend/services/scraper.py` | `m.stock.naver.com/api/news/stock/{ticker}` + 본문 링크 `n.news.naver.com/mnews/article/{office}/{article}` |
| 종목 검색(한글) | `backend/routers/stocks.py` | `ac.stock.naver.com/ac` autocomplete — Yahoo가 한글 미지원이라 대체 |
| KR 분기 순이익 / 시총 상위 | `backend/services/market_indicators/earnings.py` | `m.stock.naver.com/api/stock/...`, `finance.naver.com/sise/sise_market_sum.naver` |
| 구루 US 종목명 | `backend/services/guru_scraper.py` (`get_name_kr`) | `api.stock.naver.com/stock/{code}/basic` |

**Naver가 주지 않는 것**(라이브 확인): forward 실적일(`irScheduleInfo`=null, `/finance`·`/consensus` 404) — KR forward 실적일은 yfinance `.KS`/`.KQ`가 유일 소스.

## 5. FnGuide (KR 컨센서스 1차 · 시총 보완)

- **모듈**: `backend/services/consensus_pipeline.py` (`_fetch_kr_fnguide`), `backend/services/market/kr.py` (`_fnguide_market_cap`)
- **env 키**: 없음. `Referer: https://comp.fnguide.com/` 헤더 필요.
- **엔드포인트**: `comp.fnguide.com/SVO2/json/data/01_06/03_A{ticker}.json`(컨센서스), `comp.fnguide.com/SVO2/asp/SVD_main.asp?gicode=A{ticker}`(시총 HTML 파싱)
- **폴백**: 컨센서스는 **FnGuide 우선 → 결과 없으면 Naver Research**. 시총은 Naver `marketValue`가 비면 FnGuide로 보완.

## 6. DART / OpenDART (KR 공시 · 재무 · 수주잔고 · 배당 · 내부자 · 주총)

- **env 키**: `DART_API_KEY` — **미설정 시 전 기능 graceful skip(휴면)**, 로그만 남기고 빈 결과.
- **베이스**: `_DART_BASE = https://opendart.fss.or.kr/api`, 뷰어 링크 `_DART_VIEWER = https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}`
- **인증**: 쿼리스트링 `crtfc_key`. `status 013`(무데이터)는 정상 빈 응답으로 처리.

| 모듈 | 용도 | 특이사항 |
|---|---|---|
| `backend/services/backlog.py` | 수주잔고 | 전용 구조화 API가 없어 **공시서류원본 `/api/document.xml`**(ZIP→전 멤버 디코드) 원문 파싱. `_get_corp_code_map`/`_get_document_text`가 다른 모듈의 재사용 기반. 검산 통과 시 `source='dart'`, 실패·다중엔티티·외화는 `source='pending'`(amount=None)로 남겨 Cowork가 채움 |
| `backend/services/disclosures.py` | 공시 피드 | `list.json`을 핵심유형 **A·B·C·D 각각 개별 호출**(응답이 `pblntf_ty`를 echo하지 않아 단일 호출 후 필터가 불가) → 유형을 항목에 stamp |
| `backend/services/agm.py` | 주주총회 회의일 | `pblntf_ty` **미지정(no-type)** 호출로만 주총 공시가 발견된다(유형 지정 시 0건) → disclosures.py는 주총을 못 봄. 회의일은 filing date가 아니라 `document.xml` 본문(소집결의 XHTML `2. 일시 … YYYY-MM-DD` / 소집공고 자유텍스트 `일  시 : YYYY년 M월 D일`) 2전략 파싱, 실패는 None |
| `backend/services/insider_trades.py` | 내부자·5% 지분변동 | 행 dedup용 `_row_hash` |
| `backend/services/dividends.py` | KR 배당 | `alotMatter.json` 보통주 '주당 현금배당금(원)'·'현금배당수익률(%)' 당기값 |
| `backend/services/market/kr.py` | KR 연간 재무 | `fnlttSinglAcntAll`(현금흐름 포함)은 **`fs_div`를 요청 필수값**으로 받고(CFS 우선→OFS 폴백), fs_div를 요청한 응답은 **행에 `fs_div`를 echo하지 않으므로 행별 필터 금지**. 계정은 `account_nm`이 아니라 **`account_id`(XBRL 표준)** 로 매칭. 반면 `fnlttSinglAcnt`(주요계정, `backlog.get_financials`)는 fs_div 없이 호출해 행별로 필터 |

## 7. FRED (St. Louis Fed — 경제지표 · 매크로 신호 · 지표 발표일)

- **모듈**: `backend/services/market_indicators/econ.py`(경제지표), `macro.py`(매크로 신호 4종 시계열 `T10Y2Y`/`BAMLH0A0HYM2`/`M2SL`/`DFF` + `evaluate_signals`), `backend/routers/calendar.py`(`/releases/dates`로 market-wide `econ` 이벤트)
- **env 키**: `FRED_API_KEY` — 미설정 시 `{"error": "FRED_API_KEY 환경변수가 필요합니다."}` 반환(수집 실패, 저장값 무변경).
- **엔드포인트**: `api.stlouisfed.org/fred/series/observations`, `/fred/releases/dates`
- **인증**: 쿼리 `api_key`.
- **저장**: `market_cache` 키 `econ_indicators`·`macro_signals`(증분). GET은 저장값만 반환(요청경로 라이브 FRED 0).
- **주의**: FRED에 **S&P500 CAPE 시리즈는 없다**(FRED "Case-Shiller"는 *주택가격* 지수) → CAPE는 §11 multpl.com 크롤.

## 8. 공공데이터포털 `apis.data.go.kr` (KOFIA 통계 · 금융위 대차 · 관세청 수출)

`KOFIA_API_KEY`·`KITA_API_KEY`는 모두 공공데이터포털 발급 키이고 쿼리 `serviceKey`로 전달한다. 키 미설정 시 요청 실패(휴면).

| 모듈 | 서비스 | env 키 | 저장 |
|---|---|---|---|
| `backend/services/leverage_service.py` | `GetKofiaStatisticsInfoService`(`getGrantingOfCreditBalanceInfo` 신용잔고, `getSecuritiesMarketTotalCapitalInfo` 시장자금) + `GetMarketIndexInfoService/getStockMarketIndex`(시총) | `KOFIA_API_KEY` | `market_leverage_indicators` |
| `backend/services/lending_service.py` | 금융위 `GetStocLendBorrInfoService_V2` 내외국인 대차잔고 | `KOFIA_API_KEY`(동일 키) | `market_lending_balance` |
| `backend/services/market_indicators/exports.py` | **관세청** `1220000/Itemtrade/getItemtradeList` KR 수출 | `KITA_API_KEY` | `market_cache` 키 `kr_exports` |
| `backend/run_backfill.py` | 수급지표 과거 백필 CLI | `KOFIA_API_KEY` | 위와 동일 |

> `KITA_API_KEY`라는 이름이지만 실제로는 **관세청(Korea Customs Service)** 키다. 미설정 시 §9 UN Comtrade로 자동 폴백.

## 9. UN Comtrade (KR 수출 폴백)

- **모듈**: `backend/services/market_indicators/exports.py` (`_COMTRADE_URL = https://comtradeapi.un.org/public/v1/preview/C/M/HS`, `_fetch_comtrade_exports`)
- **env 키**: 없음(공개 preview API).
- **동작**: `KITA_API_KEY` 미설정 또는 관세청 실패 시 자동 폴백. 총수출 + 반도체 2콜.

## 10. dataroma (구루 포트폴리오 크롤)

- **모듈**: `backend/services/guru_scraper.py` (`_BASE = https://www.dataroma.com/m`)
- **env 키**: 없음. UA/`Referer` 헤더 세트로 크롤.
- **페이지**: `managers.php`(운용역 목록), `holdings.php?m={id}`(보유 — 4번째 칸이 증감 정본), `m_activity.php?m={id}&typ=a`(비중 pp·전량매도 보강)
- **배치**: `guru_crawl`. 종목명은 §4 Naver US basic로 보강.

## 11. multpl.com (S&P500 Shiller CAPE)

- **모듈**: `backend/services/market_indicators/indices.py` (`_fetch_cape`, `_parse_multpl_cape`)
- **env 키**: 없음. `www.multpl.com/shiller-pe` HTML 크롤(`BeautifulSoup(html, "html.parser")` — 로컬 lxml 부재 대응).
- **폴백**: 파싱/fetch 실패는 `logger.warning` + None → `market_cache` 키 `indices`의 직전 저장값 유지.

## 12. CNN Fear & Greed

- **모듈**: `backend/services/market_indicators/sentiment.py` (`_CNN_URL = https://production.dataviz.cnn.io/index/fearandgreed/graphdata`, `Origin`/`Referer`=`edition.cnn.com`)
- **env 키**: 없음.
- **폴백**: 언제든 막힐 수 있는 비공식 소스이므로 **`get_or_refresh`를 쓰지 않고 VIX식 수동 폴백** — `_get_cache` → try fetch → 성공 시 `_mc_save("fear_greed")` + 반환, 실패 시 `_mc_load` 직전값 반환, 그것도 없으면 None. (`cache.get_or_refresh`는 "저장값 있으면 fetch 스킵"일 뿐 **fetch 실패 시 직전값 폴백을 하지 않고 실패를 전파**한다.)

## 13. Finviz (US 컨센서스 보조)

- **모듈**: `backend/services/scraper.py` (`scrape_finviz_consensus`, `finviz.com/quote.ashx?t={ticker}`)
- **env 키**: 없음. 실패는 graceful.

## 14. Wikipedia (S&P500 구성종목 시드)

- **모듈**: `backend/services/market_indicators/earnings.py` — `en.wikipedia.org/wiki/List_of_S%26P_500_companies`
- **env 키**: 없음.
- **저장**: 티커 목록 7일 캐시는 **`market_cache` 키 `sp500_tickers`/`kospi_tickers`**(task#234에서 파일 캐시 → DB로 이전). `backend/data/sp500_tickers.json`·`kospi_tickers.json`은 이제 **read-only 시드**이고 write 경로가 없다.

## 15. exchangerate-api (USD/KRW 현재가)

- **모듈**: `backend/services/market_indicators/fx.py` (`_fetch_usdkrw_current` → `https://open.er-api.com/v6/latest/USD`, timeout 5s)
- **env 키**: 없음(공개 v6 latest).
- **폴백**: 실패 시 `logger` + None → yfinance 히스토리 기반 값/`_mc_load("fx")` 직전값. `_usdkrw_rate()`는 저장 FX의 **비유한값(NaN)을 `math.isfinite`로 가드**해야 한다(NaN ≠ None이라 `if fx is None` 가드를 통과해 US totals를 오염시키고 starlette `allow_nan=False`로 500이 난 이력).

## 16. Telegram Bot (다이제스트 발송)

- **모듈**: `backend/services/digest_service.py` (`send_telegram`, `https://api.telegram.org/bot{token}/sendMessage`)
- **env 키**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — **둘 중 하나라도 없으면 휴면**(현재 `backend/.env.docker`에 미기재).

## 17. Claude Code 루틴 fire (이벤트 구동 분석 파이프라인 — outbound)

- **모듈**: `backend/services/cowork_trigger.py`
- **env 키**: `COWORK_ROUTINE_FIRE_URL`, `COWORK_ROUTINE_FIRE_TOKEN` — `configured()`가 둘 다 있어야 True, 아니면 **휴면(dormant-safe)**.
- **인증**: `Authorization: Bearer <FIRE_TOKEN>`, body `{"text": ...}`, timeout 15s.
- **실패 처리**: **best-effort** — HTTP ≥300이나 예외는 `logger.warning` 후 `False` 반환, 예외 전파 없음(배치 본문을 깨뜨리지 않는다).
- **호출처**: `backend/scheduler/jobs.py:_generate_all`(일일 리포트 배치 완료 직후) + `backend/routers/admin.py:cowork_fire`(admin 수동, `require_admin_or_api_key`).
- **수신측**: 클라우드 루틴이 아니라 **호스트 로컬 리스너**(launchd `com.portfolion.cowork-fire-listener` → `scripts/cowork-fire-listener.py` → headless `claude -p`). 정책 프롬프트는 `scripts/cowork-routine-prompt.md`로 버전관리. 클라우드 샌드박스가 외부망(portfolion.taebro.com)에 도달하지 못함이 실측돼 로컬로 전환됨(ADR-0028 개정).
- **백엔드는 LLM을 호출하지 않는다** — fire는 트리거 POST 1개뿐.

---

## 18. 데이터베이스 — PostgreSQL 16

- **접속**: `backend/services/db.py` — `psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=20, dsn=os.environ["DATABASE_URL"])`. API: `query`/`execute`/`execute_many`/`get_connection`.
- **env 키**: `DATABASE_URL`. compose 보간용 `POSTGRES_PASSWORD`.
- **스키마 적용 순서**: `backend/auth_schema.sql` → `backend/app_schema.sql` (compose가 각각 `01-auth.sql`/`02-app.sql`로 initdb.d 마운트). 라이브 DB는 기동 시 `backend/main.py:_migrate()`(idempotent, ADR-0006)만 탄다.
- **로컬 테스트 차단**: 로컬 `DATABASE_URL`이 라이브 도커 postgres(5432 노출)를 가리키므로 `backend/tests/conftest.py`의 `_block_real_db` autouse 가드가 실 DB 접근을 raise한다.

### 인증 스키마 (`backend/auth_schema.sql`)

| 테이블 | 용도 |
|---|---|
| `users` | 이메일/OAuth 계정, `role` (`user`\|`admin`) |
| `refresh_tokens` | JWT 리프레시 토큰(해시 저장·소비) |

### 앱 스키마 (`backend/app_schema.sql`)

| 테이블 | 용도 | 주 담당 모듈 |
|---|---|---|
| `tickers` | 공유 종목 마스터(ticker, name, market, moat, `enriched_at`, enrich 필드) | `backend/services/storage/` |
| `user_stocks` | user_id별 보유/관심(`type: holding\|watchlist`) | `backend/services/storage/portfolio.py` |
| `snapshots` | per-ticker/date 리포트 JSON(공유) | `backend/services/report_generator.py` |
| `raw_reports` | 종목별 원본 AI 리포트 텍스트 | `backend/routers/report.py` |
| `analyst_reports` | 애널리스트 리포트 발행물(ADR-0027) | `backend/services/analyst_reports.py` |
| `schedules` | 리포트 자동 생성 스케줄(전역 단일 행, 레거시) | `backend/services/storage/schedule.py` |
| `batch_schedules` | 통합 배치 스케줄(ADR-0007) | `backend/scheduler/schedule.py`, `backend/services/batch_registry.py` |
| `job_runs` | 배치 실행 이력(ADR-0001) | `backend/services/job_runs.py` |
| `guru_schedules` / `guru_managers` | 구루 크롤 스케줄 / 운용역 데이터 캐시(각 전역 단일 행) | `backend/services/guru_scraper.py`, `guru_stats.py` |
| `digests` | user_id+date 일일 다이제스트 | `backend/services/digest_service.py` |
| `consensus_history` | ticker+date 컨센서스 히스토리 | `backend/services/consensus_pipeline.py` |
| `daily_consensus_mart` | 컨센서스 일일 집계 마트(목표가 정본, ADR-0008) | `backend/services/consensus_pipeline.py` |
| `calendar_cache` | user_id+month 캘린더 이벤트 캐시 | `backend/routers/calendar.py` |
| `market_cache` | 시장지표 영구 캐시(키-값 JSON, §19) | `backend/services/market_indicators/cache.py` |
| `user_menu_permissions` / `default_menu_permissions` | 사용자별 메뉴 접근 권한 / 신규 사용자 기본값 | `backend/routers/admin.py`, `backend/services/auth_service.py` |
| `user_events` | user_id+event_name+properties 행동 로그 | `backend/routers/events.py`, `backend/middleware/event_tracker.py` |
| `market_leverage_indicators` | 신용잔고·반대매매·시총 시계열(base_date) | `backend/services/leverage_service.py` |
| `market_lending_balance` | 내외국인 대차잔고 시계열(base_date) | `backend/services/lending_service.py` |
| `market_rankings` | 거래대금·거래량·등락률 랭킹 스냅샷 | `backend/services/ranking_service.py` |
| `market_investor_trend` | 외국인/기관/개인 수급 추이 | `backend/services/investor_service.py` |
| `market_short_sell` | KR 공매도 시계열 | `backend/services/short_sell_service.py` |
| `backlog_history` | 수주잔고 분기 시계열 + `segments` JSONB(ADR-0005) | `backend/services/backlog.py` |
| `stock_disclosures` | DART 공시 목록(`rcept_no` dedup) + `meeting_date`(주총) | `backend/services/disclosures.py`, `agm.py` |
| `stock_dividends` | 종목별 연 주당배당·배당수익률(ticker PK upsert) | `backend/services/dividends.py` |
| `stock_dividend_schedule` | 배당 스케줄 투영(ADR-0023, delete-rewrite) | `backend/services/dividends.py` |
| `stock_beta` | 종목 베타 | `backend/services/beta.py` |
| `stock_supply_score` | 종목 수급 점수·플래그(ADR-0014) | `backend/services/supply_score.py` |
| `stock_insider_trades` | 내부자·5% 지분변동 | `backend/services/insider_trades.py` |
| `stock_recommendations` | 추천 퍼널 결과(ADR-0015·0016·0021) | `backend/services/recommendation/store.py` |
| `us_supply_snapshot` | US 공매도·기관보유·내부자 스냅샷 | `backend/services/us_supply.py` |

`backend/supabase_schema.sql`은 레거시(미사용).

### `market_cache` 키 목록

`fx`, `vix`, `commodities`, `treasury`, `econ_indicators`, `macro_signals`, `indices`, `kospi_futures`, `kospi_signal`, `m7_earnings`, `kr_top2_earnings`, `kr_exports`, `fear_greed`, `sp500_tickers`, `kospi_tickers`, `kr_sector_momentum`(`backend/services/kr_sector_service.py:CACHE_KEY`), `us_sector_momentum`(`backend/services/us_sector_service.py:CACHE_KEY`).

### 인메모리 캐시 (`backend/services/cache.py`)

6종: snapshot(LRU 200), list(TTL 5s), dashboard(TTL 300s), correlation(300s), sector(300s), macro(300s). 종목 추가/수정/삭제 시 dashboard·correlation·sector·macro 자동 무효화 + `calendar.clear_cache(user_id)`로 `calendar_cache` DB 행 삭제(`invalidate_portfolio_caches`).

---

## 19. 외부 소스 실패 규율 (연동 코드 작성 시 준수)

1. **빈/all-None 결과를 캐시에 박제 금지** — 전부 None이면 `_mc_save`를 생략해 직전 양호값을 유지. 의심 트리거가 아니라 **실패 클래스(all-None)** 를 가드해야 근본원인 미상이어도 재발이 막힌다.
2. **성공-but-빈응답도 실패로 취급** — 외부 API가 `rt_cd=0`/HTTP 200에 빈 output을 주면 예외 가드를 통과한다. `backend/services/market_indicators/kospi_futures.py`가 값 수준 가드 없이 all-None을 박제했던 이력 → `indices.py`의 `if any(v is not None ...)` 지속 가드 패턴을 쓸 것.
3. **delete-rewrite store는 fetch 실패 시 delete를 스킵** — `backend/services/dividends.py:replace_schedule` 같은 `DELETE+INSERT` 갱신은 fetch 실패를 빈 결과로 삼키면 저장을 *생략*하는 게 아니라 직전 양호값을 **파괴**한다. fetch 함수가 예외를 전파해 호출측이 replace를 통째 스킵하게 하고, genuine-empty만 clear. delete+insert는 단일 트랜잭션.
4. **배치-백킹 뷰는 요청·기동 경로에서 외부 API를 라이브 호출하지 않는다** — 배치가 사전계산해 `market_cache`/테이블에 저장하고 요청은 저장값만 읽는다. 실패는 조용히 삼키지 말고 로깅.
5. **NaN/inf 가드** — starlette `JSONResponse`는 `allow_nan=False`라 응답 dict의 NaN이 500이 된다. 소스에서 `math.isfinite` 가드가 우선이고, 출처 불문 안전망으로 `services/utils.sanitize`. 입력 쪽은 Pydantic float 필드에 **`allow_inf_nan=False` 명시**(기본 True) + 범위 검증 전 NaN 배제(NaN 비교는 항상 False), 그리고 `backend/main.py`의 `RequestValidationError` 핸들러가 detail의 NaN echo로 인한 422→500 전이를 막는다.
6. **KR 시장-날짜 판정은 `datetime.now(ZoneInfo("Asia/Seoul")).date()`** — 컨테이너에 TZ env가 없어 bare `date.today()`는 UTC다(00:00~09:00 KST에 하루 뒤처짐). `backend/services/market_indicators/kospi_signal.py`·`backend/scheduler/schedule.py`의 `_KST` 패턴 재사용.
7. **`source` 메타 동기** — 배치의 fetch 소스를 바꾸면 `backend/services/batch_registry.py`의 그 배치 `source`도 갱신(DoD). `source`=fetch 출처, `usage`=소비 UI로 방향이 반대다.

---

## 20. KR 현재가 다중 피드 합의 (교차 검증 구조)

`backend/services/market/kr.py`가 4개 독립 현재가 피드를 가진다: 키움 NXT(`_AL`) → KIS → Naver → 키움 KRX.

- **`get_quote_kr(regular=False)`** (라이브 대시보드): `_kr_pick_basic`/`_corroborated_pick`이 **2-of-N 다수결** — 어떤 피드가 다른 독립 피드 ≥1개와 ±2x([0.5, 2.0]) 이내로 합의해야 신뢰하고, trusted 중 우선순위 최상위를 반환. lazy escalation으로 평소엔 키움 NXT+KRX 2콜로 끝나고, 불일치 시에만 KIS(설정 시)·Naver를 추가 호출해 최대 4피드로 outlier를 폐기.
- **degenerate**: 키움 부재/단일(outage)·전 피드 합의 불가 시 `_kr_pick_degenerate_lazy`가 우선순위 첫 피드를 자기 `prev_close` ±30%로만 자가검증(wrong < missing).
- **`regular=True`** (리포트 스냅샷, KRX 정규장): `_kr_pick_regular` — 키움(KRX)→KIS→Naver 첫 유효 + prev ±30%/일봉 2x. 다수결 미적용.
- **박제-시 독립피드 게이트** (`backend/services/report_generator.py`, KR만): 저장 직전 KRX와 독립인 ref 피드(① Naver retry-once → ② KIS 폴백)로 `price`·일봉 기준종가를 2x 교차검증, 어긋나면 그 종목 박제를 **스킵**(직전 스냅샷 유지). **ref 전무 시에도 스킵** + loud 로그. `backfill_ticker`(과거 날짜)는 미적용.
- ADR-0009·0010·0011·0020.

> **정정(task#170, ADR-0020 amendment)**: 과거 "005930이 *정확히* 70000.0으로 박제"된 사례들의 원인은 피드 글리치가 아니라 **로컬 pytest가 prod DB에 fixture를 직접 쓴 오염**이 유력하며, 실제로 멈춘 것은 `conftest._block_real_db` 가드(task#169)다. 위 다수결/게이트 자체는 진짜 글리치 방어로 유효하나 "그것이 70k를 해결했다"로 읽지 말 것. 라운드 값이 또 보이면 **테스트 오염부터** 의심.

---

## 21. 인증 · 인가

### 로컬 계정 (JWT)

- **모듈**: `backend/services/auth_service.py`, `backend/routers/auth.py`(prefix `/api/auth`), `backend/auth.py`(의존성)
- **env 키**: `JWT_SECRET`(HS256 서명), `SESSION_SECRET`(starlette `SessionMiddleware`)
- **비밀번호**: `bcrypt.hashpw`/`checkpw` (`backend/services/auth_service.py`)
- **토큰**: `python-jose` HS256. access `{"sub": user_id, "exp"}` **1시간**(`_ACCESS_EXPIRE = timedelta(hours=1)`), refresh **30일**(`_REFRESH_EXPIRE`) → `refresh_tokens` 테이블 저장, `consume_refresh_token`/`revoke_refresh_token`.
- **엔드포인트**: `POST /register`(201), `POST /login`, `POST /refresh`, `POST /logout`, `GET /me`
- **프론트**: `frontend/src/api.js`가 `localStorage.access_token`을 `Authorization: Bearer`로 붙이고 401에 토큰 삭제 + `/` 리다이렉트. 권한은 `frontend/src/contexts/AuthContext.jsx`가 로그인 시 로드해 nav 필터링.

### OAuth

| 제공자 | env 키 | 흐름 |
|---|---|---|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `GET /api/auth/oauth/google` → `accounts.google.com/o/oauth2/v2/auth` → `GET /oauth/google/callback` → `oauth2.googleapis.com/token`(httpx) → `auth_service.upsert_oauth_user(email,"google",sub)` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `GET /api/auth/oauth/github` → `github.com/login/oauth/authorize` → 콜백 → `github.com/login/oauth/access_token` → `api.github.com` 프로필 → `upsert_oauth_user(email,"github",id)` |

redirect_uri는 두 경우 모두 `os.environ["FRONTEND_URL"] + "/api/auth/oauth/{provider}/callback"`. 콜백은 프론트로 **`?oauth=<code>`** 로 돌아가고(`_no_cache_redirect`), 프론트가 `GET /api/auth/oauth/token?code=`로 실토큰을 교환한다(임시 코드 `_oauth_codes`, TTL 120초, 1회 소비). state는 `_make_state`/`_verify_state`(세션 기반). SW가 콜백 내비게이션을 가로채지 않도록 `vite.config.js`의 `navigateFallback: null` + `/api/auth/*` 런타임 캐시 제외가 짝을 이룬다.

### 인증 의존성 (`backend/auth.py`)

| 의존성 | 허용 |
|---|---|
| `get_current_user` | JWT Bearer만 |
| `get_current_user_or_api_key` | JWT Bearer **또는** `X-API-Key`(= `COWORK_API_KEY`) |
| `require_admin` | JWT Bearer + `users.role == 'admin'` — **API 키를 거부**한다 |
| `require_admin_or_api_key` | admin JWT 또는 `X-API-Key` |

- `_API_KEY_HEADER = "X-API-Key"`, 기대값은 `os.environ.get("COWORK_API_KEY", "")`.
- **공개(무인증) read 엔드포인트를 새로 만들지 않는다**(ADR-0029). `API_SPEC.md`에 남아도 되는 `**Auth:** 불필요`는 `backend/routers/auth.py`의 공개 엔드포인트(`GET /api/auth/oauth/token` 등)뿐. 인증 게이팅을 바꾸는 작업은 착수 시 `grep -n '\*\*Auth:\*\* 불필요' API_SPEC.md`로 곧 틀릴 표기를 먼저 셀 것(doc-sync 테스트는 엔드포인트 *존재*만 검증하므로 auth 산문 drift를 못 잡는다).
- **admin 역할 부여**: `UPDATE users SET role='admin' WHERE email='...'`(도커 postgres 직접). 허용 메뉴 목록은 `backend/routers/admin.py`의 `ALL_MENUS`.
- **테스트 함정**: 다수 테스트가 `conftest`의 `client`가 아니라 모듈 상단에서 `FastAPI()`를 직접 만들어 `app.dependency_overrides`로 auth를 우회한다(`backend/tests/test_stocks_router.py`, `test_consensus_router.py`, `test_report_router.py` 등). 의존성을 붙였으면 **전체 스위트를 먼저 돌리고 실제로 깨지는 것만** 고칠 것(형제 read가 이미 override를 등록해 둔 경우가 많아 선제 추가는 중복이 된다). 무인증 거부(401/403)는 override 없는 fresh app으로 별도 검증(`backend/tests/test_security_auth_gaps.py`).

---

## 22. 외부 소비자 · 웹훅

### Claude Cowork API (inbound 쓰기)

- **문서**: 루트 `CLAUDE_COWORK_API.md` (base `https://portfolion.taebro.com`)
- **인증**: 헤더 `X-API-Key: {COWORK_API_KEY}` — 누락/불일치는 401.
- **엔드포인트**(문서 기재): `GET /api/stocks`, `GET /api/report/list`, `GET /api/report/{ticker}/{date_str}`, `PUT /api/stocks/{ticker}/enrich`, `PUT /api/stocks/enrich/batch`, `GET /api/report/backlog/pending`, `PUT /api/report/{ticker}/backlog`, `POST /api/report/generate`, `POST /api/analyst-reports/{ticker}`
- **라우팅 주의**: `PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 **먼저** 등록해야 한다(FastAPI가 `enrich`를 ticker 값으로 라우팅하지 않도록).
- **발행물 삭제는 admin 세션 전용**(API 키 불가) — Cowork/루틴은 삭제하지 않는다(ADR-0027).
- **문서 동기 DoD**: `CLAUDE_COWORK_API.md`는 **Cowork enrich/backlog/발행 워크플로우 전용 스코프**다. 사용자 대면 read나 admin 배치 refresh 같은 비-Cowork 엔드포인트는 `API_SPEC.md`에만 넣는다("기계적으로 둘 다"는 과함). 루틴 프롬프트(`scripts/cowork-routine-prompt.md`)도 박제본이라 API 계약 변경 시 함께 갱신 대상(ADR-0028).

### outbound 웹훅

§17의 루틴 fire(`backend/services/cowork_trigger.py`) 1건 + §16 Telegram sendMessage. 그 외 outbound 웹훅 없음.

### 인바운드 자동화 트리거

`.github/workflows/deploy.yml`(push[main] → self-hosted 러너 → `deploy.sh`)와 `scripts/auto-deploy-poll.sh`(launchd 2분 폴러). 자세한 배포 경로는 `STACK.md` §7.
