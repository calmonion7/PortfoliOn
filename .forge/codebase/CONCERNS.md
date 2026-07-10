---
last_mapped_commit: 1e8da3bc525d61545c6c374b1f91a04238dabf30
mapped: 2026-07-10
---

# CONCERNS — 기술부채·버그·보안·성능·취약지점

PortfoliOn의 LIVE 관심사항을 구체 파일경로와 함께 정리한다. 근거는 `CLAUDE.md` gotchas 절, `.forge/adr/`, `.forge/retro/`, 그리고 실제 코드 재확인. 각 항목은 "왜 위험한지 + 어디를 봐야 하는지 + 대응"으로 구성. (이번 재매핑: 헌트164 2배치(task#165 ecbe39c·task#166 db7d95e)와 캘린더 dead 파일캐시 제거(task#167 1e8da3b), 로깅 스윕(task#162·163)을 반영해 해소분을 §17로 이동.)

---

## 1. fixture-pass-live-fail 가족 (반복 재발) — 최상위 관심사

**공통 성질**: 단위테스트(mock/fixture)는 green인데 라이브에서 깨진다. 외부소스 실데이터·라이브 DB 타입·라이브 인덱스 정렬을 mock이 재현하지 못하기 때문. **대응 원칙: 외부소스 파싱·신규/개작 SQL 슬라이스는 배포 후 "라이브 스모크(1종목 추출 대조 / 엔드포인트 실호출)"를 DoD에 포함.**

### 1a. yfinance 라벨 불일치 — get_* 메서드 vs 프로퍼티
- `backend/services/market/us.py` — income/balance는 `get_income_stmt()`/`get_balance_sheet()`(무공백 라벨 `OperatingCashFlow`·`TotalRevenue`), **현금흐름도 반드시 `t.get_cashflow(freq='yearly', as_dict=False)` 메서드로** 받아야 한다. `t.cash_flow` 프로퍼티는 공백 라벨(`Operating Cash Flow`)이라 `format._yf_val`의 exact 매칭이 어긋나 **예외 없이 조용히 None** → FCF·CapEx 전부 None.
- 파서: `backend/services/market/format.py` `_yf_val`(exact 인덱스 매칭 `key not in src.index`). (task#117)

### 1b. KR Naver row / DART account_id 파싱
- `backend/services/market/kr.py` `get_annual_financials_kr` — DART `fnlttSinglAcntAll`(전체 재무제표)는 `fs_div`를 **요청 필수값**으로 받고(누락 시 status 100), **응답을 행별 `fs_div`로 재필터하면 안 된다**(단일 fs 응답은 `fs_div`를 echo 안 함 → 전 행 스킵). 계정은 표기 변동하는 `account_nm`이 아니라 XBRL 표준 `account_id`로 매칭. 이자보상 분모는 `금융비용`(과대)이 아니라 `이자의 지급`(`ifrs-full_InterestPaidClassifiedAsOperatingActivities`). (task#117)
- 주요계정 `fnlttSinglAcnt`(`backlog.get_financials`)은 반대로 fs_div 없이 호출 후 행별 필터 — 둘을 헷갈려 복붙하면 깨짐.

### 1c. 신규/개작 SQL — uuid ANY 캐스트 & VALUES 행중첩 (task#135)
- **uuid 컬럼 `= ANY(%s)`에 파이썬 str 리스트 → text[]가 돼 `operator does not exist: uuid = text` 라이브 즉사.** 단건 `WHERE user_id = %s`는 암묵 캐스트로 동작하던 게 배열화에서 깨짐. **`ANY(%s::uuid[])` 명시 캐스트 필수.**
  - 주의: **text/varchar 컬럼의 `= ANY(%s)`는 안전**(암묵 text[] 매칭). 예: `backend/services/dividends.py` `get_schedule_batch`의 `WHERE ticker IN (...)`, `backend/routers/portfolio.py`의 `stock_beta WHERE ticker = ANY(%s)`는 `ticker`가 text라 무해. uuid 컬럼(`user_id` 등)에만 캐스트가 필요.
- **VALUES 행 나열을 바깥 괄호로 감싸면(`VALUES ((a,b),(c,d))`) N행이 아니라 record 1행** → `AS v(ticker,d)` 컬럼 매핑 에러. 행별 `(a,b),(c,d)` 나열만.
- 정본/가드: `backend/services/consensus.py` `_values_placeholder`, 형태 고정 테스트 `backend/tests/test_consensus_asof_batch.py`(`test_values_placeholder_shape`). 둘 다 query-mock pytest green 상태의 배포-즉사 버그였음(ADR-0008 관련).

### 1d. 키움 tz-naive ↔ yfinance tz-aware concat — **✅ 통일 완료 (task#116·#150·86b714e)**
- **근본 성질**: 키움 daily_df 인덱스는 tz-naive, yfinance(`^KS11` 등)는 tz-aware(Asia/Seoul) → `pd.concat([naive, aware], axis=1)`가 `TypeError`. `indicators.calc_beta`(`backend/services/indicators.py`)가 바로 이 concat을 하므로, KR series를 ^KS11과 정렬하는 모든 계산(베타·상관·상대강도)이 위험. broad `try/except`가 삼키면 **조용히 None**(라이브 전용 — fixture는 ^KS11 라이브 미모킹이라 미포착).
- **✅ 세 소비처 모두 가드됨**: `backend/services/beta.py`(`_ks11_returns`·`fetch_kr_beta` 양쪽 strip), `backend/services/report_generator.py` `generate_report` KR beta(`ks11_ret`+`_daily_returns` 둘 다 tz-strip).
- **남는 원칙(패턴 리스크)**: 앞으로 KR series를 yfinance 지수/자산과 정렬하는 *새* 계산을 추가하면 동일하게 양쪽 series를 `tz_localize(None)`으로 벗겨야 한다(fixture가 못 잡음). broad `except: pass`는 진단 로그를 남기거나 좁은 예외만.

### 1e. dual-store 혼동 — `enriched_at`는 `tickers` 컬럼, 스냅샷 JSON 아님 (task#132)
- AI 분석 존재 판정 정본은 `tickers` 테이블 컬럼. 스냅샷 `data` JSON에서 읽도록 가정하면 fixture green·라이브 항상 False. 소비처 확인: `backend/routers/report.py`.
- 종목명 dual-source도 같은 가족: `tickers.name`(공유 마스터) vs `snapshots.data.name`(리포트 박제). 이름 변경 시 둘 다 갱신(`storage.refresh_snapshot_names`/`reconcile_snapshot_names`) + `cache.invalidate(ticker)`+`invalidate_list()` 필수. `backend/services/storage/`.
- **뉴스도 dual-path(task#152)**: 리포트 상세는 `/api/stocks/{ticker}/news` **라이브 fetch**(`scraper.get_news`) + **스냅샷 폴백**, 다이제스트 `_recent_news`는 스냅샷(`_latest_snapshots`)만 읽어 종목당 top2(스크레이프 0). 저장·라이브 경로가 갈리므로 뉴스 형태/필드 변경 시 둘 다 확인. `backend/services/scraper.py`(`_dedup_sort_limit` 10건 dedup/최신순)·`backend/services/digest_service.py`.
- **배당도 dual-store(task#158, ADR-0023)**: 연 예상배당은 `stock_dividends`(`GET /api/stocks/dashboard` totals), 배당 *타임라인*은 신규 `stock_dividend_schedule`(`GET /api/portfolio/dividends`, `Dividends.jsx`). 둘은 목적이 달라(합계 vs 타임라인) 공존 — 한쪽 변경이 다른쪽을 자동 반영 안 함.

---

## 2. NaN/inf → JSON 직렬화 500 (starlette `allow_nan=False`)

응답 dict에 `NaN`/`inf`가 있으면 starlette `JSONResponse`가 직렬화에서 **500**(`Out of range float values are not JSON compliant`). 외부시세(yfinance Close NaN, FX/usdkrw NaN)에서 흘러든 NaN이 합산값을 오염시키는 게 전형.

- **가림 함정**: PostgreSQL은 `json` 컬럼에 NaN을 거부(저장 실패)하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 **파일 폴백은 통과** → DB저장 실패·파일 성공·응답 직렬화 실패로 증상이 엇갈려 진단 지연.
- 대응 위치:
  - `backend/routers/stocks.py` `_usdkrw_rate` — `math.isfinite` 가드(비유한→None). NaN≠None이라 `if fx is None` 가드를 통과해버리던 게 US totals=NaN→500의 근본(task#104). **노출/리밸런싱 엔드포인트도 이 `_usdkrw_rate`를 재사용**(`backend/routers/portfolio.py`)하고 결과를 `sanitize`로 감싼다(TTL 캐시 진입 전 `sanitize(cache_svc.get_rebalance(...))` 형태).
  - `backend/services/utils.py` `sanitize` — NaN/inf→None 안전망. `_build_all`·rebalance/exposure 반환·F&G(`sentiment.get_fear_greed`)·코스피선물(`kospi_futures` 저장 직전)을 감쌈.
  - `backend/services/beta.py` `_fin_num` — `math.isfinite` 통과 못하면 None(저장 안 함) → `stock_beta.beta`에 NaN 유입 차단. `sentiment.py` `_num`도 동일.
  - **리포트 US price(task#161 #1)**: `backend/services/report_generator.py` `generate_report` — `quote.price`가 NaN/inf면 `math.isfinite` 실패→일봉 종가로, 그것도 비유한이면 None. NaN을 그대로 두면 `if summary["price"] is None` 가드를 통과(NaN≠None)해 US에서 `price:null` 스냅샷이 박제되던 것(KR은 박제게이트가 잡지만 US는 이 isfinite 가드가 유일).
- **규칙: 시세/합산을 응답에 싣는 엔드포인트는 소스 `isfinite` 가드 또는 `sanitize` 필수.** 가드는 소스에서 하는 게 출력 일괄 sanitize보다 깨끗(다이제스트 생성 500 사례 8cd70a42).

---

## 3. 대시보드 빌드 불변식 (holdings=N → 항상 N카드, 500-to-empty 금지)

`GET /api/stocks/dashboard`의 `_build_all`(`backend/routers/stocks.py`)은 `get_quotes_batch`(try/except→{}) + 카드당 `_safe`(throw→`_minimal_card`)로 감싸 부분실패에도 전체 500을 안 낸다. 세 가지 다른 트리거가 이 불변식을 위협했음:

1. **풀 경합(cold-start)** — 콜드 첫 호출에 워커 ThreadPool×카드당 다중 DB read가 풀 경합(PoolError)→throw→500→프론트 `usePortfolioData.fetchDashboard` catch가 silent로 삼킴→빈 그리드. 헤더(`/api/portfolio`=단일 쿼리)는 N 정상이라 "헤더 N·그리드 빈"(task#102). `_build_all`의 ThreadPool은 `max_workers=min(len(holdings), 10)`.
2. **NaN 직렬화 500**(§2, task#104) — cold/warm 무관 결정적, per-card 가드 *위* 단계라 task#102 가드가 못 막음.
3. **배당 `float/Decimal` TypeError**(commit d666cdd2) — `_build_card`의 `yield_on_cost = annual_div / avg_cost`에서 `avg_cost`/`qty`는 DB NUMERIC→**Decimal**, `annual_div`(stock_dividends)는 **float** → `float/Decimal` TypeError → 배당 있는 모든 보유카드가 `_minimal_card` 폴백(RSI·컨센서스·매물대·배당 통째 blank, **500도 안 나서 더 은밀**). ✅ 수정 잔존: 양변 `float()` 정규화. 회귀 테스트는 **Decimal** avg_cost fixture로.

- 프론트 방어: `frontend/src/pages/Portfolio.jsx` `DashboardGrid`는 `stocks>0`이면 Skeleton, self-heal은 one-shot이 아니라 **bounded 재시도(최대 3)**.
- **진단**: 헤더/시세 정상인데 enrichment만 일괄 blank면 `docker logs portfolion-backend-1 | grep '최소카드 폴백'`로 per-card 예외 확인(minimal-card 가드가 근본원인을 마스킹).
- **DB NUMERIC(avg_cost·quantity)을 float·외부값과 산술하는 경로는 어디든 동일 위험** — 노출/리밸런싱/베타 파생계산도 `Decimal↔float` 혼산 주의. `services/rebalance.py value_holdings_krw`(KRW 환산)를 `services/exposure.py`가 공유하며 Decimal/fx≤0/None 가드 반영(task#149).

---

## 4. KR 시세 글리치 (005930 ~70k 박제) — 다피드 교차검증

**근본원인(task#94)**: 005930 ~70k는 영속 버그가 아니라 **키움 NXT `_AL`(SOR 통합코드) 순간 이상체결**이 일배치에 박제된 *일시적* 값. "영속 소스 버그로 단정해 소스부터 고치려 들지 말 것."

- **시세 기준 이원화(ADR-0020, task#95)**: 리포트 스냅샷=KRX 정규장 / 라이브 대시보드=NXT. 단일 분기점 `client.integrated_code(stk_cd, regular=False)`(`backend/services/kiwoom/client.py`). 기본 False=`_AL`(NXT), `regular=True`=평문 KRX. 리포트 writer만 opt-in(`report_generator`·`report.py:refresh_analyst`). **beta 백필(`beta.py fetch_kr_beta`)도 `get_history_df(..., regular=True)`로 KRX 정규장 일봉 사용.**
- **✅ RSI 타점도 KRX 기준으로 통일(ADR-0020 amendment, task#161 #2 + task#166 backfill 누락분)**: RSI *값*은 NXT/KRX 무관(정규화)이나 **RSI 타점(`cur_price+delta`)은 절대가**라 시세 기준 의존. `backend/services/indicators.py` `get_timeframe_rsi(..., regular: bool=False)` + `report_generator.generate_report`가 KR일 때 `regular=(market=="KR")`. **`backfill_ticker`의 daily/weekly/monthly 3봉 모두 `regular=True`로 통일**(약 417–419행 — task#161 #2가 당일 생성만 고치고 backfill 주/월봉을 빠뜨렸던 것을 task#166이 마감). 원칙: **정규화 지표에서 절대가/금액을 파생하면 시세 기준(KRX)을 따르는지 점검**.
- **라이브(NXT) 백스톱 — 2-of-N 다수결 corroboration(task#98, ADR-0010)**: `backend/services/market/kr.py` `_corroborated_pick`/`_kr_pick_basic` — 어떤 현재가 피드가 다른 독립 피드 ≥1개와 ±2x([0.5,2.0]) 이내 합의해야 신뢰, 우선순위 최상위(키움 NXT→KIS→Naver→키움 KRX) 반환. lazy escalation(불일치 시에만 KIS/Naver 추가). degenerate(단일 피드)는 prev_close ±30% 자가검증(`_kr_pick_degenerate_lazy`).
- **리포트 박제-시 독립피드 게이트(task#101/#118)**: `backend/services/report_generator.py` `generate_report`(KR만, 약 314–341행) — 저장 직전 KRX와 독립인 ref 피드(네이버 retry-once → KIS 폴백)로 price·일봉 기준종가 2x 교차검증, 어긋나면 그 종목 박제 **스킵**(직전 양호 스냅샷 유지, wrong<missing). **ref 전무면 박제 스킵 + loud `logger.warning("[Report] ... 박제 스킵")`**(기존 "검증 생략·진행"이 게이트를 무력화하던 구멍 정정; print→logger 스윕은 task#163). `backfill_ticker`(과거 날짜)는 현재가 대조 불가라 게이트 미적용 — 대신 `ts.date() < _today` 가드로 오늘자 ungated 박제 차단(task#161 #4).
- **regular=True도 근본해결 아님**: 같은 KRX 두 TR(quote ka10001·일봉 ka10081)이 동시 글리치하는 KRX 자기일관 오염엔 면역 아님 → 위 박제 게이트가 막음.
- **⚠️ fix 배포는 이미 박제된 스냅샷을 소급 치료 안 함** — stale 70k는 *재생성*해야 KRX로 덮인다. 재생성 전 라이브 프로브로 소스 깨끗 확인(transient 글리치 재박제 방지).
- 진단: 네이버 공개 API(`m.stock.naver.com/api/stock/{code}/basic`) 실값 대조 + `docker exec -i portfolion-backend-1 python - < probe.py`로 KRX(`005930`) vs SOR(`005930_AL`) 원값 비교.

---

## 5. 포트폴리오 베타·노출 관심사 (task#149·#150·#166)

### 5a. 배치-백킹/저장값 뷰는 백필·재생성 전 빈값(graceful)
- **포트폴리오 베타**: `GET /api/portfolio/exposure`의 `portfolio_beta`는 `compute_exposure`(`backend/services/exposure.py`, 순수함수)가 **저장값 `stock_beta`만** 읽어 Σ(w×β)/Σw로 커버된 보유만 재정규화한다(요청경로 라이브 계산 0). 조회 배선은 `backend/routers/portfolio.py`.
  - **백필(admin `POST /api/stocks/beta/refresh` 또는 주간 배치 `beta_fetch`) 전이면 `beta_coverage_pct`=0%·`portfolio_beta`=None**(graceful). 신규 보유 추가 후에도 다음 배치/수동 백필 전까지 그 종목은 `beta_missing`에 남아 커버리지 부분값.
- **rebalance/exposure는 user_id 키 TTL 캐시(300s)를 탄다(task#166)**: `backend/services/cache.py` `get_rebalance`/`get_exposure`. 종목 변경(`invalidate_portfolio_caches`)·타깃 설정(`invalidate_rebalance(user_id)`, `backend/routers/portfolio.py`)이 무효화 — **그 외 경로로 저장값이 바뀌면 최대 300s stale**(§8 무효화 허브 규율 참조).
- **일반화**: 저장값/배치-백킹 기능(랭킹·KR 업종 모멘텀·포트 베타·시장지표 캐시·배당 스케줄)은 **백필/재생성 전 빈값**이 정상 동작(graceful). "값이 안 나온다"를 코드 버그로 단정하기 전에 저장소에 값이 실제로 있는지 프로브(§15).
- **admin-게이트 write라 자율(테스트계정) UAT로 "채워진 값 렌더"를 확인 못 함(403)** — 실값 확인은 사용자(admin) 백필 트리거로 위임(task#150 회고, reference-prod-writes-need-user 계열).

### 5b. `stock_beta.source` 라벨 부정확 (정보성, 낮은 우선순위)
- `backend/services/beta.py` `fetch_all_betas`는 KR 종목을 무조건 `source="kiwoom"`으로 하드코딩(루프 내 `market == "KR"` 분기)하나, KR 일봉을 주는 `get_history_df`는 **키움 실패 시 yfinance로 폴백**할 수 있다 → 실제 데이터 출처가 yfinance인데 `stock_beta.source`엔 "kiwoom"으로 기록되어 **어긋날 수 있음**. 파생값 정확도엔 무영향(정보성 컬럼). task#150 적대적 검토 minor(보류).

---

## 6. 외부소스 stale 폴백 & 취약 엔드포인트 (task#151·#157·#165)

### 6a. `get_or_refresh`는 "fetch 실패→직전 저장값 stale 폴백"을 안 함
- `backend/services/market_indicators/cache.py` `get_or_refresh(key, fetch_fn, ttl, force)` — 인메모리 캐시 hit → `_mc_load`(DB 저장값) hit → **둘 다 없을 때만** `fetch_fn()` 호출. **`fetch_fn`이 throw하거나 빈/None을 반환해도 직전 저장값으로 되돌리지 않는다**(그대로 반환/전파). 특히 `force=True`(배치/수동 갱신)면 저장값 무시하고 강제 호출하므로 그 시점에 소스가 죽어 있으면 보호가 없다.
- **대응: 취약 외부소스는 수동 폴백을 각자 구현할 것.** 정합 패턴 3종:
  - `backend/services/market_indicators/fx.py` `get_vix` — `_mc_load` stored_history를 base로 fetch, 실패 시 graceful(기존 저장 history 보존).
  - **`fx.py` `get_fx` 부분 실패 last-good 머지(task#165)** — 심볼별 fetch 결과에서 빠진 심볼을 `stored_rates`(직전 저장 rates)로 채우고 `logger.warning("[FX] 갱신 실패, 직전 저장값 유지")`. 일부 심볼만 실패해도 rates dict가 부분 클로버되지 않음. 회귀: `backend/tests/test_fx_partial_failure.py`.
  - `backend/services/market_indicators/sentiment.py` `get_fear_greed` — fetch 성공 시 저장+반환, **실패(None) 시 `_mc_load` 직전 저장값 반환**, 그것도 없으면 None. `get_or_refresh`를 의도적으로 안 씀(commit 6cd9d5c).
- 신규 외부소스 지표를 붙일 때 `get_or_refresh`만 믿고 stale 폴백을 생략하면, 소스 일시장애 시 값이 통째 사라진다(있던 저장값이 있어도).

### 6b. CNN F&G 비공식 엔드포인트 봇차단 취약성
- `backend/services/market_indicators/sentiment.py` — `https://production.dataviz.cnn.io/index/fearandgreed/graphdata`는 **CNN 비공식(문서화 안 된) 엔드포인트**로, 전체 브라우저 헤더(`_CNN_HEADERS`)를 실어 우회 fetch한다. **CNN이 봇차단(헤더 검사 강화·엔드포인트 이동)하면 fetch가 조용히 실패** → §6a 수동 폴백이 직전 저장값으로 graceful, 없으면 None. 요청경로 증분·**배치 없음**(`GET /api/market/fear-greed`, `batch_registry` 무등록). US 전용. 값이 stale/None으로 굳으면 이 취약성부터 의심.

### 6c. ⭐ "성공-but-빈응답"을 last-good에 박제 금지 (task#157·#165)
- **외부 API가 무예외 성공응답(`rt_cd=0`, yfinance `t.info=={}`)에 빈 데이터를 주면 `except` 가드를 통과한다** — 예외만 가드하고 값 None을 통과시키면 all-None dict를 저장소에 박제→직전 양호값 클로버('wrong<missing' 위반).
- **✅ 정합 패턴(요청경로 — 코스피200 선물)**: `backend/services/market_indicators/kospi_futures.py` — `_fetch()`가 **예외뿐 아니라 값 수준**(`front.price is None or not history`)도 가드해 None 반환, `get_kospi_futures()`는 fetch None이면 `_mc_load` 직전 저장값 폴백 → degenerate `_mc_save` 없음. 저장 직전 `sanitize`.
- **✅ 정합 패턴(배치 — US 수급, task#165)**: `backend/services/us_supply.py` `_is_all_empty(result)` — short 3필드 all-None AND institutional 빈 AND insider 빈이면 **upsert 스킵**(`logger.warning("[UsSupply] ... 저장 스킵(직전값 유지)")`, `fetch_all_us_supply` 약 256–262행). yfinance가 예외 없이 빈 `t.info`를 줄 때 직전 주 데이터를 보존. 회귀: `backend/tests/test_us_supply_empty_guard.py`.
- **정합 사촌**: `backend/services/market_indicators/indices.py`의 `if any(v is not None ...)` 지속 가드. 회귀 테스트는 저장 양호값 시드 후 빈응답이 save 미호출·last-good 반환을 단언(예외 side_effect가 아니라 *값이 빈 정상 반환*을 모킹해야 이 경로를 실제로 침).

---

## 7. 배포 footgun

### 7a. 2분 자동배포 폴러가 로컬 편집·미푸시 커밋 삭제
- launchd `com.portfolion.auto-deploy-poll` → `scripts/auto-deploy-poll.sh` 2분마다. **`LOCAL != origin/main`이면(양방향) `git reset --hard origin/main` 후 `deploy.sh`**.
- **커밋 안 한 tracked 편집뿐 아니라 push 안 한 로컬 커밋(로컬이 앞선 경우)도 다음 폴(≤2분)에 reset으로 소실**(task#106 실사례, fg-map 지도 커밋 소실→cherry-pick 복구). **코드/문서 변경은 commit+`git push origin main`을 묶어 즉시.** `.forge/` 등 untracked는 reset 대상 아님(안전).

### 7b. self-hosted 러너 격리 (무음 미배포)
- 자동배포 주 경로 = self-hosted GH Actions 러너(`deploy.yml`, `runs-on: self-hosted`). PortfoliOn 전용 러너 = `~/actions-runner-portfolion`(launchd `actions.runner.calmonion7-PortfoliOn.macbook-portfolion`).
- **러너가 다른 repo로 재등록되면 조용히 사라져** 잡이 `queued→24h cancelled` **무음 미배포**(06-22~06-27 lab-taebro 세팅 때 실사례, task#105). in-checkout 푸시는 러너에만 의존하므로 러너 부재 시 폴러도 스킵(`LOCAL==origin/main`이라 exit 0)해 통째 미배포. **새 프로젝트가 기존 러너 디렉터리에 `config.sh` 재등록 금지**(전역 `~/.claude/CLAUDE.md` "멀티 프로젝트 인프라 격리").

### 7c. "백엔드가 옛 코드"일 때 진단 순서
1. **도커 churn 먼저**: `docker ps`로 uptime 확인(backend는 `docker run`이라 `docker compose ps`엔 안 잡힘). 필요 시 `bash deploy.sh` 1회로 백엔드 컨테이너 재생성(ad-hoc `docker compose` 금지).
2. **러너**: `gh run list`(잡이 queued/cancelled면 러너 부재)·`gh api repos/calmonion7/PortfoliOn/actions/runners --jq '.runners[]|{name,status}'`.
3. 그 다음에 폴러 footgun 의심.
- 프론트는 nginx가 `frontend/dist` 직접 서빙 → `npm run build`로 즉시 라이브(배포 무관). **백엔드 변경은 폴러/러너 재배포 후에야 라이브.**

---

## 8. 다중표면 변경 위험 + 캐시 무효화 허브 (grep로 전수 감사할 것)

- **⭐ user-scoped 인메모리 캐시는 키에 user_id 필수 (보안, task#165)**: `GET /api/report/list` scope=mine 캐시가 전역 단일 키여서 **교차 사용자 유출(HIGH)** — A의 목록이 B에게 캐시로 서빙됐다. 수정: `backend/services/cache.py` `get_list(user_id, loader)` + `backend/routers/report.py:251`. 회귀: `backend/tests/test_report_list_user_cache.py`. **신규 TTL 캐시를 붙일 때 응답이 user-scoped면 반드시 user_id(필요시 `f"{user_id}:{market}"` 합성) 키로.** 참고: `scope=all`(admin)은 미캐시 — 매 호출 풀 빌드(성능은 admin 전용이라 용인).
- **⭐ `invalidate_portfolio_caches(user_id)`가 무효화 허브** (`backend/services/cache.py`) — 캘린더 DB 캐시(`calendar.clear_cache(user_id)`)·list·dashboard·sector·macro·correlation·live_prices·rebalance·exposure를 일괄 무효화하며 종목 추가/삭제/승격 시 호출된다(`routers/stocks.py`·`watchlist.py`·`portfolio.py`·`admin.py`). **user-scoped 파생 캐시를 새로 만들면 여기 등록을 잊지 말 것** — 빠뜨리면 종목 변경 후 최대 TTL(300s)만큼 stale(rebalance/exposure가 task#166에서 이 허브에 묶인 정합 사례). 캘린더 무효화는 task#166 전엔 dead 파일 캐시만 지워 DB가 stale였음(파일 캐시 코드는 task#167에서 제거).
- **⚠️ DB `execute`를 부르는 함수의 테스트는 execute를 patch할 것** — 로컬 pytest가 라이브 Docker postgres에 붙을 수 있어, `clear_cache` 테스트가 **라이브 `calendar_cache`에 실 DELETE**를 내보내던 것을 task#166 리뷰(HIGH)가 포착해 patch로 차단(`backend/tests/test_calendar_cache_invalidation.py`). 신규 DB-write 함수 테스트에서 반사 점검.
- **배치 id 은퇴 시 전수 grep**(`backend/services/batch_registry.py`): ① 데이터 read(스케줄 소비처) ② 표시 문자열(`schedule_desc`) ③ **`job_runs.record(id,...)` 모든 lane(auto·manual·backfill)** ④ id 단언 테스트. 한 곳이라도 옛 id면 stale read·배치 현황 실행이력 증발·고아 run 누적. 단 옛 id를 *읽는* 시드 마이그레이션은 정당한 잔존. (ADR-0001 job_runs, daily_report-market-split 재발)
- **배치 id 추가 시 exact-count/exact-set 단언이 여러 테스트 파일에 흩어짐**(task#136·#150): `grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/`로 전수(`test_batches_router.py`·`test_batch_market_split.py`·`test_macro_signals_batch.py`·`test_scheduler_seed.py` 등).
- **`scheduler/`는 명시 재export 패키지 — 신규 잡 함수는 `scheduler/__init__.py`에도 재export 필요**(task#150 divergence). `scheduler/jobs.py`에 잡 함수 정의 + `_JOB_FUNCS` 등록 + `__init__.py` 재export. 한 곳 빠뜨리면 배선 미완.
- **심볼 제거/개명·시그니처 변경이 mock patch 타깃을 파일 불문 깨뜨림**(task#136): `grep -rn "모듈경로.심볼" backend/tests/`. 예: digest_service `yf` import 제거 시 다른 파일의 `services.digest_service.yf.Ticker` patch가 `ModuleNotFoundError`. **파라미터 additive 추가도 사촌** — `get_quote(..., hist=None)` 추가(task#166)처럼 위치 인자를 단언하는 mock은 어긋날 수 있음(당시 테스트 8곳 동반 수정).
- **비-additive 응답 reshape(배열→객체)는 모든 프론트 소비처 전수 grep**: `grep -rn '<엔드포인트>' frontend/src/`. 독립 fetcher(예: `Analytics.jsx`가 훅과 별개로 `/api/stocks/dashboard` 직접 fetch)까지. 가능하면 additive 선호(task#52).
- **additive read 추가가 `mock.call_args`(마지막 호출) 오염**(task#66/#67): 기존 단언을 `call_args_list[i].kwargs`로 마이그레이션, 신규 호출은 `if <조건>:`로 입력 비면 생략, 신규 테스트는 `call_count`로 시퀀스 고정.
- **auth `Depends` 추가가 자체-app 테스트 401/403로 깨뜨림**(task#108): 다수 테스트가 conftest `client`가 아니라 모듈 상단 `FastAPI()`를 직접 만들어 `app.dependency_overrides`로 우회(`test_stocks_router.py`·`test_consensus_router.py`). 새 의존성 override 추가 + 무인증 거부는 override 없는 fresh app으로 별도 검증(`backend/tests/test_security_auth_gaps.py` 패턴).
- **엔드포인트 존재 drift는 자동검출**: `backend/tests/test_api_doc_sync.py`(라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md` 헤더 대조, task#99). 단 요청/응답 스키마·인증 게이팅 동기는 수동 DoD.
- **`PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 *먼저* 등록**(FastAPI가 `enrich`를 ticker로 라우팅 방지).
- **프론트 stale/race 패턴(task#166)**: ① 세션-수명 ref 캐시로 "추적 여부" 판정 금지 — 삭제 직후 stale 오판(`frontend/src/components/GlobalSearch.jsx`는 선택마다 재조회로 수정). ② 경쟁 fetch는 `cancelled` 가드(`frontend/src/pages/Compare.jsx` — 이전 선택의 늦은 응답이 최신 상태를 덮는 race 차단, 회귀 `frontend/src/test/compare-race.test.jsx`).

---

## 9. 신규 DB 컬럼/테이블 배포 함정 (ADR-0006)

- **`app_schema.sql`만 고치면 라이브 DB에 반영 안 됨** — 스키마 파일은 신규 설치용, 라이브는 기동 idempotent 마이그레이션만 탐. **`backend/main.py` `_migrate`에 `ADD COLUMN IF NOT EXISTS`(또는 `CREATE TABLE IF NOT EXISTS`)를 쌍으로 추가 필수**. 한쪽만 고치면 배포 직후 그 컬럼/테이블 INSERT/SELECT가 부재로 깨짐(`stock_recommendations.name` 파손 직전, task#130). 완료기준에 두 파일 쌍 명시.
- **최근 준수 사례**: `stock_dividend_schedule`(task#158)·`stock_beta`(task#150) 모두 `app_schema.sql`+`main.py _migrate` 쌍으로 추가됨. 이 쌍 규율이 정착됨.

---

## 10. 로컬 `.venv` ≠ Docker 의존성 + 로깅 방출

- **`lxml`은 `requirements.txt`·Docker엔 있지만 로컬 `backend/.venv`엔 없다.** 로컬 pytest로 검증할 HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 stdlib **`BeautifulSoup(html, "html.parser")`**. 해당 코드: `backend/services/market_indicators/indices.py`(Shiller CAPE), `backend/services/backlog.py`, `backend/services/agm.py`.
- **로깅 config는 `backend/main.py` `_configure_logging()`(기동 1회)에서만 배선**(task#162) — `basicConfig(level=INFO)` + urllib3/yfinance/apscheduler/asyncio WARNING 억제 + uvicorn `propagate=False`. **config 없으면 root lastResort=WARNING+라 `logger.info`가 안 보인다** — `backend/run_backfill.py` 같은 별도 entrypoint는 logging config가 없어 info 로그 미방출(warning/error만 보임). 신규 standalone 스크립트를 만들면 방출 필요 시 basicConfig를 자체 배선할 것.
- **`print` 신규 금지(zero-print 가드)**: `backend/tests/test_no_print.py`가 앱 코드(main/routers/services/scheduler/middleware) `print()` 호출 0건을 ast로 단언(task#163). 진단 로그는 모듈 `logger` + `[Component]` PascalCase 마커(규약: `.forge/codebase/CONVENTIONS.md` §4).

---

## 11. 문서 동기화 부채 (DoD)

- **API 변경 시 `API_SPEC.md` + `CLAUDE_COWORK_API.md`** — 단, **`CLAUDE_COWORK_API.md`는 외부 Cowork(enrich/backlog) 전용 스코프**라 사용자 대면 read 엔드포인트(`/portfolio/*`·`/market/fear-greed`·`/market/kospi-futures` 등)는 `API_SPEC.md`에만 넣는다(task#149 회고). doc-sync 테스트는 Cowork 문서엔 *stale*만 검출하므로 green 유지. 신규 엔드포인트가 Cowork 소비 대상인지 먼저 판별해 DoD를 좁힐 것(기계적 "둘 다"는 과함).
- **기능 표면 변경 시 `README.md` 해당 절도** 같은 PR에서(화면구성·env·스택·아키텍처·배치). README는 overview 레벨 — 엔드포인트 세부는 명세서에만.

---

## 12. 배치/성능 관심사

- **배치-백킹 뷰(랭킹·KR 업종 모멘텀·베타·노출·추천)는 외부 API를 요청·기동 경로에서 라이브 호출 금지** — 배치가 사전계산해 `market_cache`/테이블 저장, 요청은 저장값만 read(task#50). `compute_exposure`도 순수함수(DB/외부 호출 0). 추천 universe는 `build_universe(market)`(`backend/services/recommendation/universe.py`)로 **시장 분리** — US 배치가 KR 전수 스캔(Naver 페이지네이션)을 스킵, 대칭으로 KR도(task#166).
  - 예외(의도된 요청경로 증분): fx/vix/commodities/indices/**fear-greed**/**kospi-futures**는 배치 없이 요청경로에서 증분 fetch(TTL캐시→`_mc_load`→라이브→저장). §6a stale 폴백 + §6c 빈응답 가드가 이들에 적용. (⚠️ `kospi_signal_fetch`는 별개 배치 — 오버나잇 방향신호. `kospi_futures`(선물차트)와 혼동 금지.)
- **⭐ 배치 delete-rewrite(replace) store는 "빈 결과 박제 금지"보다 한 단계 위험 (task#160 #2·#165)** — 통째 교체 store는 fetch 실패를 genuine-empty와 구분해 **실패 시 delete 자체를 스킵**해야 한다(안 그러면 직전 양호값을 *파괴*). 정합 패턴 2종:
  - 배당 스케줄: `backend/services/dividends.py` `_dividend_history`가 예외를 []로 삼키지 않고 **전파** → `fetch_all_dividends`의 try/except가 `replace_schedule` 스킵→직전 스케줄 보존. genuine 무배당만 `replace_schedule([])` 정리. `replace_schedule`은 delete+insert **단일 `get_connection()` 트랜잭션**.
  - 추천 store: `backend/services/recommendation/store.py` `replace_recommendations`도 **단일 트랜잭션화**(task#165) — 중간 실패 시 rollback으로 부분/빈 상태 안 남김. 회귀: `backend/tests/test_rec_store_atomic.py`.
  - 신규 replace/upsert-by-delete 경로를 만들 때 반사 점검.
- **외부 fetch 실패를 조용히 삼키지 말 것**(silent except는 진단 불가, task#48 `_fetch_one_sector` all-None 박제). **빈/all-None을 캐시에 박제 금지**(전부 None이면 save 생략·직전값 유지, §6c). 기동 시드: `_seed_*_if_empty`(랭킹·kr_sector).
- **배치 ThreadPool 워커 ≤ DB 풀 사이즈**(수급 스크리닝 교훈) — 대시보드 콜드 풀 경합(§3)의 근원. DB 풀은 `backend/services/db.py` `ThreadedConnectionPool(minconn=1, maxconn=20)`(psycopg2 풀은 소진 시 PoolError를 던지므로 최대 워커 수 이상으로 둠). ⚠️ 정보성: `backend/routers/stocks.py:397` 이름-백필 주석은 아직 `maxconn=10` stale 표기 — 판단 근거로 삼지 말 것.
- **캘린더 KR 실적발표일은 yfinance `.KS`/`.KQ`가 유일 forward 소스** — `backend/routers/calendar.py` `_collect_earnings`는 `_yf_sym(ticker, market, exchange)`로 접미사 붙여야 함(raw ticker면 KR 0건). Naver·DART 모두 forward 미제공(task#121).
- **배치 fetch 소스 변경 시 `batch_registry`의 `source` 갱신**(DoD) — `source`=fetch 출처 ≠ `usage`=소비 UI.
- **KR 시장-날짜(최근월물/영업일 판정)는 KST — bare `date.today()`/`datetime.today()` 전면 금지·✅ 전수 스윕 완료(task#165)**: 컨테이너 UTC라 00~09시 KST에 하루 어긋남(task#157/#161). 정본 헬퍼는 `backend/services/utils.py` `today_kst()` — 앱 코드 ~30곳이 이걸로 교체됐고, **`backend/tests/test_no_bare_today.py`가 ast로 앱 코드(main/routers/services/scheduler/middleware) `.today()` 호출 0건을 단언**해 재발 차단. (`report_generator.py`엔 동일 구현 로컬 `_today_kst`가 잔존 — 동작 동일, 정보성.) naive↔aware series *정렬*용 `tz_localize(None)`(§1d)와는 별개 문제.
- **US 리포트 생성의 quote/history 중복 fetch 제거(task#166)**: `backend/services/market/__init__.py` `get_quote(..., hist=None)` — 호출부가 이미 받은 1y history를 재사용(캐시 미스 시만 사용, **캐시 키엔 hist 미포함**). `report_generator`가 daily_df를 넘겨 동일 티커 `t.history(period="1y")` 2회 호출 제거.

---

## 13. 보안·인증 관심사

- **✅ 교차 사용자 캐시 유출(HIGH) 수정 — 규율은 §8 첫 항목**: `GET /api/report/list` scope=mine 전역 단일 캐시 키 → user_id 키(task#165). user-scoped 응답을 캐시할 땐 항상 user_id 키.
- **admin `scope=all` 리포트 목록은 비소유 종목에도 `category`를 붙임**(`backend/routers/report.py` `_mk_entry`) — category로만 게이트된 관리 버튼(수정·승격·삭제)이 남의 종목에 노출되면 user-scoped 핸들러가 **404로 조용히 깨짐**. **액션 버튼 가시성은 category가 아니라 `is_mine`으로 게이트**(`frontend/src/components/reports/StockActions.jsx` — 단일 컴포넌트로 통합, task#103). 교차-사용자 동작은 `/api/admin/*` 전용(`require_admin`).
- **mutation POST 엔드포인트를 거부(403/401) 예상으로 프로브하지 말 것 — 실행될 수 있다**(task#148 회고): `POST /consensus/{ticker}/backfill?force=true`는 `require_admin`이 아니라 `get_current_user` 게이트라 user 토큰으로 200=실제 backfill 실행됨. auth 상태는 코드 grep(Depends 확인)으로 먼저 볼 것.
- **auth 의존성**: `get_current_user`/`require_admin`/`require_admin_or_api_key`. admin만 리포트 생성·Guru 크롤·백필(beta/dividends/consensus 등). `user_menu_permissions`로 메뉴 표시 제어(`admin.py` `ALL_MENUS`).
- **API 키 env**(값 인용 금지, 이름만): `.env.docker`에 `POSTGRES_PASSWORD`·`JWT_SECRET`·`SESSION_SECRET`·OAuth·`FRED_API_KEY`·`KOFIA_API_KEY`·`DART_API_KEY`·`KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`·`KIS_APP_KEY`/`KIS_APP_SECRET`. `KITA_API_KEY`는 실제로 **관세청** 키(미설정 시 UN Comtrade 폴백). `ANTHROPIC_API_KEY`는 남아있으나 현재 백엔드 미사용(백엔드에 LLM 호출 없음 — AI 분석은 외부 Cowork).
- **키 미설정 = 안전 기본값(휴면)**: KIS `configured()` False면 dormant(코스피 선물 포함 — `kospi_futures` 빈 응답), KOFIA/DART 미설정 시 해당 수집 실패지만 무해. KIS는 발급 1분당 1회(EGW00133) 강제 재발급 60s 가드(`backend/services/kis/client.py`).

---

## 14. KR UI 색 관례 함정

- 이 앱은 `--up`=빨강(상승)·`--down`=파랑(하락, `frontend/src/styles/tokens.css`)이라 `.badge--success`=빨강·`.badge--danger`=파랑(`frontend/src/components/ui/Badge.css`). **의미 상태 배지(수급 밴드·노출 경고·F&G·배당 status 등)에 success/danger 쓰면 KR 가격색으로 박혀 Western 의도와 반전**(수급 배지 우호=빨·경계=파 버그, b288f394). 의미 배지는 `frontend/src/components/ui/SupplyBadge.jsx`처럼 전용 색 명시. 노출/베타 경고 배지·F&G 게이지(`FearGreedSection.jsx`)·배당 뷰(`Dividends.jsx` confirmed/projected 전용색)도 전용색 사용. `warning` 변형은 토큰 미정의로 현재 깨져 있음.
- **KR 단위 포매팅**: `frontend/src/components/market/marketUtils.jsx` `krFmt`는 입력을 '억원' 단위 가정 — 원은 `/1e8` 변환 후, 주(count)엔 부적합. raw 원/주를 그대로 넘기면 1e8배 오표기(공매도 "35조경원" 사례 f9594f2b).
- **yfinance 퍼센트는 소수분수**(`shortPercentOfFloat` 0.0098=0.98%, `pctHeld`, `dividendYield` 등) — 표시 ×100, API_SPEC 예시·fixture도 분수 스케일로(task#122/#123).

---

## 15. 외부데이터 증상은 라이브 프로브 선행 (오진 방지)

- **"다른 지표는 다 나오는데 RSI만 빈" = fetch 실패가 아니라 히스토리 부족일 수 있다**(task#126): RSI(14봉)는 상장 <14거래일 신규 종목에서 전부 NaN(EMA·52주·HV·매물대는 짧은 히스토리서도 값 나옴). **자연 해소**이므로 코드 버그 단정 금지. 진단: `docker exec -i portfolion-backend-1 python -`로 `yf.Ticker(t).history(period="1y")` 행수 + `indicators.calc_rsi(...).notna().sum()` 확인(행수<14=히스토리 부족 vs 0행=fetch 실패). 프론트: RSI 전무 시 `VolumeRsiSnapshot` 폴백, 생기면 `RsiTable`(`ReportDetailTabs` `hasRsi` 분기).
- **"기능 오류" 신고도 라이브 프로브로 '기능 버그 vs 일시 인프라 blip' 선판별**(task#159): 컨센서스 차트 "데이터 없음" 신고가 실은 GET 일시 실패였음(터널·오리진 각 200 확인). 프론트가 fetch 실패와 빈 데이터를 구분(`ConsensusChart.jsx` `fetchFailed` + auto-retry 1회)해 오진 UX 제거.
- **compute/파생계산 슬라이스는 스냅샷/저장소 결측을 프로브로 선확인**(task#150): "스냅샷 저장 beta 읽기"만으론 테스트계정 커버리지 0%임을 프로브로 확인 → read-stored 대신 **백필 방식** 채택. 신규 파생지표를 기존 스냅샷/테이블에서 읽으려면 그 저장소에 값이 실제로 있는지 먼저 프로브(§5a graceful-빈값과 짝).
- **KIS output 봉투 파싱까지 프로브에 포함**(task#156/#157): KIS 국내선물 시세 TR은 주식 현재가(`output` 단수)와 달리 **output1/output2/output3** 분할이라, `output`만 읽으면 `rt_cd=0`인데도 늘 빈값 → "코드/파라미터 오류"로 오진. 라이브 프로브는 fetch 200뿐 아니라 **응답 봉투 파싱까지** 확인해야 완성. `backend/services/kis/futures.py`(ADR-0022). 표시 베이시스는 `mrkt_basis`(선물−현물), 이론 `basis` 아님.
- **KR 시세/차트 소스 스케일 어긋남**: 리포트 현재가 마커는 `get_quote_kr`(키움 ka10001), 매물대/RSI는 `get_history_df`(키움 ka10081 일봉) — 다른 TR이라 한쪽만 액면조정되면 최대 5배 어긋나 "차트 깨짐"처럼 보임. 표시 버그가 아니라 박제 price 값 자체를 의심(`backend/services/market/kr.py`). ✅ RSI 타점 스케일은 리포트·backfill 모두 `regular=True`로 KRX 정합(§4).

---

## 16. 파싱/재적재 UAT 관심사

- **수주잔고/데이터 파싱 변경은 배포 후 전 종목 재적재 UAT 필수** — fixture 전부 통과해도 운영 재적재가 fixture에 없던 케이스(외화 `(단위:USD천)`, 단위 캡션 줄바꿈 분리, 회사컬럼 표)를 잡음. **단위 캡션 파싱 실패 시 '기본값(억원) 폴백'은 ×100 대형 오저장** → 추출 실패는 기본값이 아니라 pending(누락)으로('wrong < missing'). `backend/services/backlog.py`(ADR-0002/0003/0004/0005).
- **DART list.json은 `pblntf_ty`를 echo 안 함** → "단일 호출 후 필터" 불가, 유형 A·B·C·D 개별 호출(종목당 4콜). AGM은 반대로 `pblntf_ty` *미지정* 호출로만 발견(`backend/services/agm.py` self-insert). 주총 회의일은 filing date가 아니라 document.xml 본문(2전략 파싱). 증분은 최신 AGM rcept_no 해결 시에만 fetch 스킵(티커당 스킵으로 만들면 연례 주총 영영 재fetch 안 됨, task#120).

---

## 17. 해소된 관심사 (히스토리 — 재-open 금지)

- **헌트164 상위 8건**(task#165, ecbe39c, 2026-07-10):
  - [보안 HIGH] `GET /api/report/list` scope=mine 전역 단일 캐시 키 → user_id 키(교차 사용자 유출 차단, §8·§13에 규율 잔존).
  - bare `date.today()`/`datetime.today()` ~30곳 → `services.utils.today_kst()` 전수 교체 + `tests/test_no_bare_today.py` ast 재발 가드(§12).
  - fx 부분 실패 시 직전 저장 rates 머지(last-good 클로버 방지, §6a).
  - recommendation store replace 단일 트랜잭션화(중간 실패 롤백, §12).
  - us_supply all-empty 응답 upsert 스킵(직전 주 데이터 보존, §6c).
- **헌트164 잔여 7건**(task#166, db7d95e, 2026-07-10):
  - 캘린더: 종목 변경 시 라이브 저장소(`calendar_cache` DB)를 user_id로 무효화 — 기존엔 dead 파일 캐시만 지워 DB가 stale(§8 허브 규율).
  - `backfill_ticker` KR daily/weekly/monthly `regular=True`(RSI 타점 KRX 통일, task#161 #2 누락분, §4).
  - `get_quote` 옵셔널 `hist` 파라미터 — US 리포트 1y history 중복 fetch 제거(§12).
  - rebalance/exposure user_id 키 TTL 캐시(300s) + 무효화 허브 등록(§5a·§8).
  - `build_universe(market)` 시장 분리 — US 배치가 KR 전수 스캔 스킵(§12).
  - 프론트: `GlobalSearch.jsx` 세션 캐시 제거(삭제 후 stale 오판)·`Compare.jsx` cancelled 가드(경쟁 fetch, §8).
  - 리뷰 HIGH: 테스트가 라이브 `calendar_cache`에 실 DELETE 나가던 것 patch 차단(§8).
- **캘린더 dead 파일 캐시 코드 제거**(task#167, 1e8da3b, 2026-07-10): `backend/routers/calendar.py`의 `_CACHE_DIR`/`_cache_path`·Path import·테스트 patch 10곳 제거. 라이브 캐시는 `calendar_cache` DB 테이블만.
- **로깅 방출 규약 배선 + print→logger 전수 스윕**(task#162·#163, 60c542d·d553942·ad7f85c, 2026-07-09): `main._configure_logging()` 루트 로거 1회 배선, 앱 코드 135 print→logger, `tests/test_no_print.py` zero-print 가드, `[Component]` PascalCase 마커(§10에 잔존 규율).
- **리포트 생성·시세 적대적 감사 버그 4종**(task#161, 5cccc45·78e6f09, 2026-07-08): US price NaN 박제→isfinite 가드(§2) / KR RSI 타점 스케일→`get_timeframe_rsi(regular=)`(§4, ADR-0020 amendment) / sub-TTM PER·PSR 부풀림→4분기 온전 시만 / backfill 오늘자 ungated 박제→`ts.date() < _today` 제외 / bare `date.today()`→`_today_kst()`.
- **배당/컨센서스 적대적 리뷰 버그 3종**(task#160, 35e3915·eeeaeb7): 12개월 예상배당 overcount→365일 컷오프(`backend/routers/portfolio.py`) / transient fetch 실패가 저장 스케줄 파괴→예외 전파+replace 스킵(§12) / 컨센서스 차트 stale 재시도 타이머→cleanup `clearTimeout`.
- **전용 배당 스케줄 뷰**(task#158, 954c413, ADR-0023) — `stock_dividend_schedule` 배치-백킹(§1e·§9에 잔존 규율).
- **컨센서스 fetch 복원력**(task#159, c1fd335·0331864) — `ConsensusChart.jsx` fetch 실패/빈 데이터 구분 + auto-retry(§15).
- **report_generator KR beta tz-strip 쌍둥이 갭**(86b714e, task#152 후속): `_daily_returns`도 tz-strip 통일(§1d).
- **버그 리포트(task#107) 42건 전부 해소**(task#148, 2026-07-05). `.forge/bug-report.md`가 이 이력의 정본.

---

## 부록: 경로 참고

- `batch_registry`의 실제 위치는 **`backend/services/batch_registry.py`**(scheduler 패키지 아님). `backend/scheduler/`는 `__init__.py`(잡 배선·재export·`_JOB_FUNCS`)·`jobs.py`·`schedule.py`·`_state.py`만 존재.
