---
last_mapped_commit: e815fb8e452f74713f9082fafeeb9e7d60334d0e
mapped: 2026-07-26
---

# PortfoliOn — 기술부채·리스크 지도 (CONCERNS)

**취약 영역 지도**입니다. 도메인 용어 정의는 `.forge/CONTEXT.md`, 코딩 규약은 `CONVENTIONS.md`가 다루며, 여기서는 **무엇이 깨지는가 · 어떻게 드러나는가 · 어디에 있는가**만 구현 사실로 기록합니다.

전건 HEAD(`e815fb8`) 코드 직독으로 검증했습니다. **[열림]** = 현재 코드에 미수정 상태로 존재 / **[닫힘]** = 가드가 실재하며 그 가드가 재발 방지 앵커. `CLAUDE.md`·`.forge/bug-report.md`·ADR의 서술 중 코드와 어긋난 것은 §9에 정정으로 분리했습니다.

성격 태그: **[live-fail]** fixture 통과·라이브 실패 / **[footgun]** 절차·인프라 / **[data]** 캐시·저장 오염 / **[test]** 안전망 결함 / **[sec]** 노출면 / **[doc]** 문서 드리프트.

---

## 0. 지금 열려 있는 것 (미수정 확인분)

5차 헌트(`.forge/bug-report.md`, task#221) 8건은 **전건 미수정**입니다(리포트 이후 커밋 `938c345`·`e815fb8`은 task#222 발행물 목록 작업이라 이 8건을 손대지 않음). 여기에 이번 매핑에서 새로 확인한 건을 병합했습니다.

| # | 증상 | 위치 | 등급 |
|---|---|---|---|
| H1 | `change_pct`를 명시적 JSON `null`로 보내면 **발행 요청 전체가 422** — 타입이 `Optional[float]`이 아니라 `float` | `backend/routers/analyst_reports.py:29` | HIGH |
| N1 | API key 보유자가 **임의 프롬프트 텍스트**를 `claude -p`(allowedTools `Bash,Write` 포함)에 주입 가능 → 로컬 임의 실행 경로 | `backend/routers/admin.py:229,234` → `scripts/cowork-fire-listener.py:37,43` | HIGH(구조) |
| N2 | 시장지표 5종 응답이 `sanitize`·`isfinite` 무가드 + `if prev` 진위판정이 NaN을 통과 → NaN 직렬화 500 소지 | `commodities.py:23,65,91`·`fx.py:28,102`·`earnings.py:127`·`macro.py`·`econ.py` | MED |
| N3 | 로그인만 하면 **전역** 대시보드 캐시 flush / **전역** 수주잔고 데이터 쓰기 가능(admin 게이트 없음) | `backend/routers/stocks.py:405-407`, `backend/routers/report.py:581-585` | MED |
| M1 | 발행물 상세(`/analyst-report/…` 단수)에서 마스트헤드 서브바 소실 — items는 `/analyst-reports`(복수)뿐 | `frontend/src/components/Masthead.jsx:19,74` | MED |
| M2 | 같은 초 fire 2회 → workdir 충돌로 실행 중 프로세스의 `run.log` truncate + cwd 공유 | `scripts/cowork-fire-listener.py:38-41,45` | MED |
| M3 | 모바일 탭바가 심층 리포트 라우트 2종을 인식 못 함 | `frontend/src/components/MobileNav.jsx:10,14` | MED |
| M4 | '상승여력' 색이 항상 무채색 — `ui/Stat.css`에 `--up`/`--down` 클래스 없음(`success`/`danger`만) | `frontend/src/pages/AnalystReport.jsx:332` + `ui/Stat.css:16-17` | MED |
| N4 | `_migrate`가 `backlog_history`를 **생성하지 않고** `ALTER … ADD COLUMN segments`만 실행 → 테이블 부재 시 warning만 남고 조용히 통과 | `backend/main.py:64-66` | MED |
| L1 | 루틴이 호출하는 `GET /api/analyst-reports`가 Cowork 문서에 **전용 절 없음**(워크플로우 0단계 언급만, 스키마·인증 미기재) | `CLAUDE_COWORK_API.md:35` vs `:565` | LOW |
| L2 | `COWORK_API_KEY` 실값이 `claude -p` **argv**에 치환 → 같은 사용자의 `ps -ww`로 관측 + `run.log`에도 잔존 | `scripts/cowork-fire-listener.py:34-35,43` | LOW |
| L3 | `size_*.year`가 명시적 `null`이면 `(0)`으로 오표시(`Number(null)===0`이 `isFinite` 통과) | `frontend/src/components/reports/MarketOutlookSection.jsx:17` | LOW |

---

## 1. 외부 데이터 소스 취약성 [live-fail]

이 코드베이스의 **최다 재발 버그 클래스**. 단위테스트가 외부 응답을 mock하므로 라벨·봉투·스케일 편차를 못 잡고 라이브에서만 드러납니다. 파싱 슬라이스의 DoD에 **라이브 1종목 추출 대조**가 필요합니다.

| 함정 | 무엇이 깨지는가 | 어디 |
|---|---|---|
| yfinance 메서드 vs 프로퍼티 라벨 | `get_cashflow()`=무공백(`OperatingCashFlow`) / `.cash_flow`=공백(`Operating Cash Flow`). `_yf_val`이 exact 매칭이라 어긋나면 **예외 없이 None** | `backend/services/market/us.py`, `market/format.py` |
| DART `fnlttSinglAcntAll` | `fs_div`가 요청 필수값이고, 요청에 넣으면 응답 행이 `fs_div`를 echo하지 않아 `row.get("fs_div")` 필터가 **전 행 스킵**. 계정은 `account_nm`(회사별 표기 변동) 아닌 `account_id`(XBRL)로 매칭 | `backend/services/market/kr.py` |
| DART `list.json` | `pblntf_ty`를 echo하지 않아 유형별 개별 호출 필요(종목당 4콜). **AGM은 반대로 `pblntf_ty` 미지정 호출로만 발견** | `backend/services/disclosures.py`, `backend/services/agm.py` |
| DART `document.xml` 표 | 회사별 구조 편차(단위 캡션·연결/별도·분모 라벨 `매출액`/`매출`/`영업수익`). 단위 캡션 파싱 실패 시 '기본값 억원' 폴백은 **×100 오저장** → 실패는 pending으로 | `backend/services/backlog.py`, `market/kr.py:539` `get_rd_intensity_kr` |
| KIS 선물 응답 봉투 | 시세 TR은 단수 `output`이 아니라 `output1/2/3`. `d.get("output")`만 읽으면 `rt_cd=0`인데 늘 빈값 → "코드 오류"로 오진 | `backend/services/kis/futures.py` |
| 퍼센트 소수분수 | `shortPercentOfFloat`·`pctHeld`·`dividendYield` 등은 0~1 분수. 프론트 ×100 누락·fixture를 %로 적는 실수 반복 | 프론트 표시 계층 전반 |
| tz naive ↔ aware | 키움 일봉=naive / yfinance(`^KS11`)=aware → `pd.concat`가 TypeError, broad except가 삼키면 계산이 **조용히 None** | `report_generator.py:237,243` (`tz_localize(None)` 적용됨) |
| KST 달력일 | 컨테이너에 TZ env 없어 bare `date.today()`=UTC → 00:00~09:00 KST에 하루 뒤처짐 | `market_indicators/kospi_signal.py`, `scheduler/schedule.py` (`_KST` 패턴) |

### 1.1 캐시 박제·클로버 계열 [data]

- **[닫힘] "성공-but-빈응답" 박제 금지** — 외부 API `rt_cd=0` 빈 output은 예외 가드를 통과하므로 **값 수준** 가드가 필요. 현재 앵커: `market_indicators/indices.py:143` `if any(v is not None …)` 후에만 `_mc_save`, `kospi_futures.py:21` `if front.get("price") is None or not history:` → last-good 반환.
- **[닫힘] delete-rewrite store의 fetch 실패 파괴** — `dividends.replace_schedule`(`backend/services/dividends.py:308-314`)은 DELETE+INSERT를 **단일 트랜잭션**으로 묶고, `_dividend_history`(`:228-233`)가 예외를 **전파**해 호출측이 replace를 통째 스킵한다(빈 결과로 삼키면 직전 양호값을 DELETE로 파괴).
- **[닫힘] `get_or_refresh`는 fetch 실패 시 직전값 폴백을 하지 않는다** — "저장값 있으면 fetch 스킵"일 뿐 실패는 전파(`market_indicators/cache.py:111`). 취약 소스(CNN F&G)는 `sentiment.py:56,70,75`의 수동 폴백(try→성공 시 `_mc_save`, 실패 시 `_mc_load`) 사용. FRED/yfinance는 `get_or_refresh`로 충분.
- **[열림] 5배 median 이상치 필터가 광폭 시계열의 진짜 스파이크를 버린다** — `market_indicators/cache.py:75-82` `_filter_outliers(max_ratio=5.0)`이 366일 창(`:105-107`)에 **일괄** 적용된다. VIX(`fx.py:99`가 같은 `_yf_close_history` 사용)는 1년 median ~15 대비 위기 스파이크가 5배를 넘어 **가장 정보량 큰 점이 조용히 탈락**할 수 있다. 시리즈별 예외 장치 없음.
- **[열림] S&P500 전 종목 20-워커 외부 fetch** — `market_indicators/earnings.py:142,164`가 `max_workers=20`으로 S&P500/KOSPI 전 리스트를 훑는다. DB는 안 타지만(풀 무관) yfinance/Naver rate-limit·장시간 배치 리스크. 워커 수가 풀 크기(20)와 같아, 워커 본문에 DB read가 추가되는 순간 즉시 풀 포화.

### 1.2 시세 정합성 게이트 [닫힘, 유지 필요]

- **KR 다피드 다수결** — `get_quote_kr(regular=False)`가 독립 피드 2-of-N 합의(`_kr_pick_basic`/`_corroborated_pick`, `backend/services/market/kr.py`)로 단일 피드 글리치를 폐기. 합의 불가·outage는 degenerate 자가검증(±30%). ADR-0010.
- **박제-시 독립피드 게이트(KR)** — `report_generator.py:396-433`이 저장 직전 Naver retry-once→KIS 폴백 ref로 2x 교차검증, **ref 전무 시 박제 스킵**(직전 스냅샷 유지 + loud warning `:427`).
- **[부분 열림] US는 게이트가 없다** — `report_generator.py:307-314`의 `math.isfinite` 단일 가드가 유일(코드 주석 `:309`가 "US는 이 가드가 유일"이라 명시). US 스냅샷의 자기일관 글리치는 잡히지 않는다.
- **시세 기준 이원화** — 리포트 스냅샷=KRX 정규장(`regular=True`), 라이브 대시보드=NXT. 같은 종목이 두 화면에 ~1% 다른 건 **의도된 기준 차**(ADR-0020), 버그가 아니다.

---

## 2. DB·풀·직렬화

### 2.1 커넥션 풀 [열림: 상한 없음·재시도 없음]

- `backend/services/db.py:21-27` — `ThreadedConnectionPool(minconn=1, maxconn=20, dsn=os.environ["DATABASE_URL"])`. **하드코딩 리터럴이며 풀 크기를 조정하는 env var가 없다.**
- **재시도·PoolError 처리 전무** — `db.py` 전체에 `PoolError`/`OperationalError`/dead-connection 검사가 없다(`:24` 주석에만 언급). psycopg2 풀은 소진 시 블록이 아니라 **예외**를 던진다.
- 워커 수 vs 풀(20): DB를 타는 것만 발췌 —

| 지점 | 워커 | 워커당 DB |
|---|---|---|
| `routers/stocks.py:669` 대시보드 빌드 | `min(len(holdings), 10)` | 카드당 **최대 5회 순차 query**(스냅샷·컨센서스·배당·수급·내부자) |
| `scheduler/jobs.py:297`, `:425` | `min(len(tickers), 8)` | `upsert_trend`·`oldest_date` 최대 3회 |
| `routers/stocks.py:428` 이름 백필 | `min(len(candidates), 8)` | `set_ticker_name` 2 writes |
| `routers/report.py:142` | 5 | **중첩 풀**: 내부에 `report_generator.py:186`(8) + `consensus_pipeline.py:107`(5) → 피크 스레드 ≈40 |

- **구조적 공백**: 상한은 *엔드포인트별로* 계산됐고 **전역 세마포어가 없다**. 대시보드(10) + 캘린더(15, DB 무접촉) + 배치(8) 같은 동시 조합의 합산 상한을 아무도 보장하지 않는다.
- **N+1 잔존** — 대시보드는 카드별 단건 query를 쓰는데, 배치 변형(`stocks.py:60` `_latest_snapshots`, `services/consensus.py:42` `get_asof_batch`, `services/insider_trades.py:186` `compute_net_signals_batch`)이 이미 존재하며 `/compare`(`stocks.py:290,298`)만 쓴다.
- **[doc] 코드 주석 드리프트** — `routers/stocks.py:427`·`scheduler/jobs.py:296`·`:424`가 아직 "DB 풀(maxconn=10)"이라 적고 있다(실제 20).
- **[열림] 풀 우회** — `backend/run_backfill.py:139`가 `psycopg2.connect(DB_DSN)`으로 직접 연결(풀 회계 밖, 테스트 가드 밖).

### 2.2 NUMERIC(Decimal) ↔ float 산술 [부분 열림]

DB NUMERIC은 `Decimal`, 외부 store(`stock_dividends` 등)는 `float`이라 혼합 산술이 `TypeError` → 대시보드는 `_minimal_card` 폴백으로 **500도 안 내고 enrichment만 통째 blank**(가장 은밀한 실패 형태).

- **[닫힘] 정규화 앵커** — `routers/stocks.py:233-239` `_f()`, `:546-552`(배당 양변 `float()`, task#102 실트리거), `:493-498` `_usdkrw_rate`+`isfinite`, `routers/portfolio.py:72-78` `_qty()`, `services/rebalance.py:15-23` `_finite_float()`.
- **[열림] 암묵 의존 지점** — 상류 캐스트에 기대는 무-로컬캐스트 산술: `routers/portfolio.py:108,122,124`(`amt * qty`), `routers/stocks.py:620`(`inc * fx`), `services/exposure.py:74`(`beta_map` 값은 `exposure.py` 안에서 정규화되지 않음 — 호출측 `portfolio.py:205`가 캐스트).
- **[열림] `isfinite` 누락 정규화** — `routers/rankings.py:13-14`·`investor.py:9-10`·`short_sell.py:9-10`의 `_to_float`는 Decimal→float 캐스트만 하고 유한성 검사를 뺐다 → PostgreSQL `NUMERIC 'NaN'`이 응답까지 통과.
- 회귀 테스트는 반드시 **Decimal** fixture로. float만 쓰는 fixture는 이 계열을 원리적으로 못 잡는다.

### 2.3 NaN/inf 직렬화 500 [부분 열림]

starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 **500**(`Out of range float values`). PostgreSQL은 `json` 컬럼에 NaN을 거부하지만 파이썬 `json.dumps`는 기본 통과라 **DB 저장 실패 / 파일 폴백 성공 / 응답 직렬화 실패**로 증상이 엇갈린다.

- `services/utils.py:36-43` `sanitize` — 재귀적으로 비유한 `float`→None. **`Decimal('NaN')`은 처리하지 않고**(isinstance float만), 튜플도 재귀하지 않는다.
- 적용됨: `main.py:259`(422 핸들러), `stocks.py:317,673`, `portfolio.py:131,164,208`, `report.py:43,152,157`, `analyst_reports.py:67,85,105,118`, `recommendations.py:210` + 서비스 측 `indices.py:138`·`kospi_futures.py:50`·`kospi_signal.py:248,278`·`sentiment.py:70`·`report_generator.py:439,615`·`lending_service.py:152`·`leverage_service.py:349`.
- **[열림] `sanitize` 참조가 0인 라우터**: `admin.py`·`analysis.py`·`analytics.py`·`batches.py`·`calendar.py`·`digest.py`·`events.py`·`guru.py`·`investor.py`·`market_indicators.py`·`rankings.py`·`short_sell.py`·`watchlist.py`.
- **[열림] 대표 노출 패턴** — `change_pct = round((cur-prev)/prev*100, 2) if prev else 0.0`에서 `if prev`는 **NaN에 대해 참**이라 NaN이 그대로 전파된다: `commodities.py:23-25,65-67,91,101`(commodities/treasury), `fx.py:28-30,37-39`(fx), `fx.py:102-104`(vix), `exports.py:72-79`, `earnings.py:127`, `macro.py`·`econ.py`(파일 전체에 `isfinite`/`sanitize` 없음), `portfolio.py:134-148`(`/api/portfolio/prices` 원값 통과).
- 로컬 가드로 대신 막는 곳: `analytics.py:47-49`, `analysis_service.py:124,127`, `digest_service.py:33,67,76`.

### 2.4 스키마 이중(사실은 삼중) 관리 [열림]

라이브 DB는 기동 idempotent 마이그레이션(ADR-0006)만 탄다. `app_schema.sql`은 **빈 pgdata 초기 마운트 전용**이다.

- `main.py:60-238` `_migrate()` = `execute()` 31회 / 17개 독립 try-except(실패는 **warning 로깅만**): `CREATE TABLE IF NOT EXISTS` 11 + `CREATE INDEX IF NOT EXISTS` 5 + `ADD COLUMN IF NOT EXISTS` 15.
- **컬럼 DoD는 현재 지켜지고 있다** — 15개 ALTER 컬럼 전부 `app_schema.sql`에 쌍이 존재(검증 완료). 최신 예: `tickers.analyst_target`(`main.py:218` ↔ `app_schema.sql:22`).
- **[열림] 테이블은 쌍이 없다** — `app_schema.sql`에만 있고 `_migrate`에 없는 표(=기존 DB에 **자동 생성되지 않음**, 수동 적용 의존): `market_lending_balance`(`:190`)·`backlog_history`(`:202`)·`market_rankings`(`:215`)·`market_investor_trend`(`:234`)·`job_runs`(`:364`).
- **[열림, N4] 최악의 조합** — `_migrate`는 `backlog_history`를 **만들지 않으면서** `ALTER TABLE backlog_history ADD COLUMN … segments`(`main.py:64`)를 돌린다. 테이블 부재 시 ALTER가 실패하고 `:65-66`이 warning만 남겨 기동은 성공한다(무음 미적용).
- **[열림] 삼중 관리** — `backend/migrations/002_backlog_history.sql`은 `backlog_history`를 **`segments` 없이** 생성하고, `001_user_events.sql`은 `app_schema.sql:158-173`과 `user_events`+인덱스를 중복 정의한다. 정본이 셋으로 갈려 있다.
- `users.role`은 `auth_schema.sql:24`에 **주석 처리된 ALTER**로만 존재.

---

## 3. 테스트가 라이브 DB·디스크를 오염시킬 수 있는 구조 [test]

로컬 `DATABASE_URL`이 도커 postgres(=라이브 DB, 5432 노출)를 가리킨다. 가드 이전엔 `generate_report` e2e 테스트의 INSERT가 **prod `snapshots`에 커밋**됐고(005930이 fixture price로 클로버), admin 삭제 테스트가 prod `calendar_cache`를 전삭제했다(task#169).

### 3.1 `_block_real_db` 가드의 실제 범위 [닫힘, 단 경계 명확히]

`backend/tests/conftest.py:26-37` — autouse로 **정확히 한 속성**만 패치: `monkeypatch.setattr(db_svc, "_get_pool", _no_real_db)`. `get_connection`이 `_get_pool`을 모듈 글로벌로 조회하므로 `query`/`execute`/`execute_many`와 `from services.db import query` 형태 호출까지 전이 차단된다.

**막지 못하는 것 (그대로 라이브로 나감):**

| 경로 | 근거 |
|---|---|
| 직접 psycopg 연결 | `backend/run_backfill.py:139` `psycopg2.connect(DB_DSN)` — `psycopg2.connect` 자체는 패치되지 않음 |
| **파일 쓰기** | `report_generator.py:441,617` `write_text`, `digest_service.py:164`, `earnings.py:65,90` `open(...,"w")`, 임포트 시 `mkdir`(`main.py:48`, `digest_service.py:38`) — 가드 docstring이 지목한 사고("스냅샷을 fixture로 덮음")의 **파일 절반은 무방비** |
| 네트워크 | `requests`/`yfinance`/socket 무패치. `backend/tests/` 8+ 파일이 `requests.get`/`yf.Ticker` 참조 |
| subprocess | 무가드 |
| **가드의 무음 degrade** | 가드는 예외를 *던질 뿐*이고, 다수 호출처가 broad except로 삼켜 warning만 남긴다: `stocks.py:41-43`, `market_indicators/cache.py:38-39,52-53`, `job_runs.py:38-40`, `scheduler/jobs.py:271,410,438`, `main._migrate` 전 블록 → **DB를 안 탔다는 착각** |
| reload 무효화 | `importlib.reload` 사용 테스트 3종(`test_report_price_gate.py`·`test_report_generator.py`·`test_market.py`) — 모듈 자체 정의 심볼 patch가 reload로 풀리므로 **하위 모듈 속성**(`services.db.execute`·`_naver_get`)을 patch할 것 |

가드가 raise하면 그 테스트가 실 DB를 타고 있다는 뜻이다 — **가드를 풀지 말고 mock을 추가**한다.

### 3.2 자체-app 테스트의 구조적 사각 [열림]

- `backend/tests/*.py` **123개 중 37개**가 모듈 상단에서 `FastAPI()`를 직접 만들고 `app.dependency_overrides`로 auth를 우회한다.
- 이들이 우회하는 것: `main.py`의 실제 배선 — `SessionMiddleware`(`:262`)·`EventTrackerMiddleware`(`:263`)·`CORSMiddleware`(`:266-271`), 그리고 **`sanitize`가 422 본문에 적용되는 유일한 지점인 `RequestValidationError` 핸들러(`:253-259`)**. → 422-NaN 회귀는 이 37개 앱으로는 **관측 불가**.
- `conftest.py:13-15`의 `client`는 TestClient를 컨텍스트 매니저로 쓰지 않아 **lifespan이 안 돈다** → `_migrate()`·스케줄러·`_warm_market_cache`가 테스트에서 전혀 실행되지 않는다(§2.4 마이그레이션 결함이 스위트로 안 잡히는 이유).
- `conftest.py:10`의 `app.dependency_overrides[get_current_user]`는 모듈 레벨 변형이며 **아무 fixture도 되돌리지 않는다**.
- **엔드포인트에 auth `Depends`를 추가/변경하면** 그 경로를 호출하는 자체-app 테스트가 401/403으로 깨진다 → 전수 grep해 새 의존성 override 추가, 무인증 거부는 override 없는 fresh app으로 별도 검증(`test_security_auth_gaps.py` 패턴).
- 401/403 단언 커버리지: 인증 게이트가 걸린 **약 91개 중 ~27개**만 어딘가에서 단언된다(`test_security_auth_gaps.py`는 6개). 미커버 ~64개에는 `/api/admin/*` 쓰기 대부분(`delete_user`·`users/{id}/permissions`·`bulk-permissions`·`default-permissions`), `report.py` 벌크 refresh 전부, `PUT /api/report/{ticker}/backlog`, `stocks.py` 백필 4종, `market_indicators.py` 갱신 4종, `portfolio.py`/`watchlist.py` 전 라우트가 포함된다.

### 3.3 그 외 안전망 결함 [열림/주의]

- **exact-count/set 하드코딩 단언 분산** — batch id 추가·제거 시 4파일(`test_scheduler_seed`·`test_batch_market_split`·`test_batches_router`·`test_macro_signals_batch`)에 흩어진 count/set 단언이 함께 깨진다. 현재 `batch_registry.BATCHES` = 29종.
- **심볼 제거·개명 시 patch 타깃 전수 grep** — mock 타깃은 주 테스트 파일에만 있지 않다(`digest_service`의 `yf` 제거 시 **다른 파일**이 patch 중이라 `ModuleNotFoundError`).
- **additive 추가가 `mock.call_args` 오염** — 응답 shape뿐 아니라 *호출 시퀀스*가 늘어 마지막 호출 단언이 거짓통과. `call_args_list[i].kwargs` + `call_count`로 못박기.
- **query-mock은 라이브 SQL 정합을 못 잡는다** — uuid에 `= ANY(%s)`로 str 리스트 → `uuid = text` 즉사(`::uuid[]` 명시 필요), `VALUES ((a,b),(c,d))` 바깥괄호 → record 1행. 신규·배치화 SQL은 **라이브 스모크**를 DoD에.
- `backend/pytest.ini`는 `testpaths`·`pythonpath` 2줄뿐 — 마커도, 플러그인 수준 network/DB 차단도 없다.
- 프론트: 테스트 19파일. `no-empty`(allowEmptyCatch:false)를 포함하는 `js.configs.recommended`를 쓰는데도 bare `catch {}`가 트리에 남아 있다 → **`npm run lint`가 커밋을 게이팅하지 않는다**(`frontend/eslint.config.js:7-20`).

---

## 4. 배포·인프라 footgun [footgun]

- **폴러가 로컬 변경을 삭제** — launchd `com.portfolion.auto-deploy-poll`이 2분마다 `scripts/auto-deploy-poll.sh`를 돌려 `LOCAL != origin/main`이면(양방향) `git reset --hard origin/main` 후 `deploy.sh`(`:24-25,27,35-36`). 메인 체크아웃의 **커밋 안 한 tracked 편집 + push 안 한 로컬 커밋이 ≤2분에 소실**된다. 실증: `~/Library/Logs/com.portfolion.auto-deploy-poll.log`에 `HEAD is now at …` reset 기록 다수. `.forge/` 등 untracked는 대상 아님(안전). **코드·문서 변경은 commit과 `git push origin main`을 묶어서.**
- **폴러의 무음 스킵 모드** — 같은 로그에 `git fetch failed, skipping.`이 연속 수십 회(2026-07-11, 07-25). 네트워크 실패 시 배포가 조용히 멈춘다.
- **러너 격리** — 배포 주 경로는 self-hosted 러너(`deploy.yml`), 폴러는 폴백. PortfoliOn 전용 러너는 `~/actions-runner-portfolion`(launchd `actions.runner.calmonion7-PortfoliOn.macbook-portfolion`, 현재 online). 이 디렉터리가 타 repo로 재등록되면 잡이 `queued→24h cancelled`가 되고 in-checkout 푸시는 **무음 미배포**(06-22~06-27 5일 실사례). 같은 머신에 `lab-taebro`·`BibleMap` 러너 plist가 공존하므로 재발 토양이 실재한다. 백엔드가 옛 코드면 폴러를 단정하기 전에 `gh run list` / `gh api …/actions/runners`로 **러너부터** 확인.
- **launchd keychain 무음 실패** — `claude -p`는 keychain OAuth를 쓰므로 plist에 `HOME`/`USER`/`LOGNAME`/`PATH`가 없으면 조용히 죽는다. 현재 `~/Library/LaunchAgents/com.portfolion.cowork-fire-listener.plist`는 4개를 모두 명시하고 있다(가드 실재). `.credentials.json`이 있어도 stale이면 keychain을 읽으므로 '파일 있음'으로 기각 금지.
- **프론트/백엔드 반영 시점 비대칭** — nginx가 `./frontend/dist`를 `:ro`로 직접 서빙(`docker-compose.yml:37`, `deploy.sh:52`)해 로컬 `npm run build`가 **즉시 라이브**. 반면 **백엔드는 러너·폴러 재배포 후에야** 반영된다. 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작(`frontend/dist/`는 gitignore `:46`).
- **[열림] `deploy.sh`와 `docker-compose.yml`의 nginx 정의가 갈렸다** — compose는 `./certbot/conf`·`./certbot/www`를 마운트(`:39-40`)하지만 `deploy.sh:50-56`의 `docker run`은 **두 마운트를 뺐다**. `nginx/nginx.conf:13`이 ACME 웹루트 `/var/www/certbot`을 참조하므로, deploy.sh가 nginx를 재생성한 뒤에는 webroot 갱신 경로가 끊긴다. 더불어 TLS server 블록은 **전부 주석 처리**(`nginx.conf:59-63`)돼 있어 443은 publish만 되고 실제 TLS는 Cloudflare Tunnel이 종단한다 → **certbot 컨테이너·마운트는 사실상 유휴 자산**.
- **[열림] `com.portfolion.docker-compose` launchd 서비스의 마지막 종료코드가 127**(command not found). backend·nginx는 `deploy.sh`가 `docker run`으로 직접 띄우므로(그래서 `docker compose ps`에 안 잡힌다) 즉시 장애는 아니지만, postgres·certbot의 부팅 시 자동 기동 경로가 신뢰 불가 상태다.
- **배포 중 짧은 다운타임** — `deploy.sh:35-37,48-50`이 backend·nginx를 `stop`+`rm`+`run`으로 교체(무중단 아님).
- **[열림] 배치 misfire 유예가 사실상 1초** — `scheduler/schedule.py:30-34`는 `misfire_grace_time` 미지정 시 인자를 빼서 APScheduler 기본값(1초)을 쓴다. `batch_registry.BATCHES` 29종 중 값이 실제 설정된 것은 2종(82800초)뿐이고 4종은 명시적 `None` → **컨테이너 재기동이 크론 순간과 겹치면 그날 배치가 조용히 스킵**된다.
- **[열림] 워킹트리 잡음이 실변경을 가린다** — `git status --porcelain` untracked 112건, `screenshots-uat*` 35디렉터리, `scripts/` UAT 스크립트 69개. `.gitignore:59`는 `screenshots/`(단수)만 무시한다. 다수 UAT 스크립트에 **테스트 계정 비밀번호가 평문**으로 박혀 있어 `git add -A` 한 번이면 커밋된다. 폴러 footgun 상황에서 "무엇이 진짜 수정인가"를 판별하기 어렵게 만드는 2차 리스크.

---

## 5. 인증·권한 노출면 [sec]

게이트는 **엔드포인트별**로만 걸린다 — `include_router(dependencies=...)`나 미들웨어 수준 인증은 없다. 라우트 137개 분포: 무게이트 46(전부 GET·공개 read + OAuth 리다이렉트) / `require_admin` 41 / `get_current_user` 35 / `get_current_user_or_api_key` 9 / `require_admin_or_api_key` 6.

### 5.1 API key(`COWORK_API_KEY`)의 실제 권한 반경

`backend/auth.py:68-78` `require_admin_or_api_key`는 센티넬 분기(`:73-74` `if user_id == _API_KEY_USER_ID: return user_id`)로 **DB role 조회 없이 admin 등가**를 부여한다. `auth.py:44-47`의 비교는 평문 `==`(**상수시간 아님**)이고, `X-API-Key` 헤더가 존재하면 JWT 경로는 아예 시도되지 않는다(short-circuit).

| 성격 | 엔드포인트 | 위치 |
|---|---|---|
| 쓰기(admin 등가) | `PUT /api/stocks/enrich/batch` | `routers/stocks.py:379` |
| 쓰기 | `PUT /api/stocks/{ticker}/enrich` | `routers/stocks.py:394` |
| 쓰기 | `POST /api/analyst-reports/{ticker}` | `routers/analyst_reports.py:57` |
| 쓰기 | `POST /api/report/generate` (전역 포트폴리오 대상) | `routers/report.py:89` |
| 쓰기 | `PUT /api/admin/analyst-targets/{ticker}` (전역 플래그) | `routers/admin.py:214` |
| 쓰기 | `POST /api/admin/cowork/fire` | `routers/admin.py:228` |
| 쓰기(**더 약한 게이트**) | `PUT /api/report/{ticker}/backlog` — `get_current_user_or_api_key`, **admin 검사도 소유권 검사도 없음** | `routers/report.py:581-585` |
| read | `GET /api/stocks`·`GET /api/report/list` — 센티넬이면 **전역 교차사용자 포트폴리오** 반환 | `stocks.py:363-365`, `report.py:161,175-178` |
| read | backlog pending·us-supply·us-insider·analyst-reports 3종 | `report.py:329,398,445`, `analyst_reports.py:78,102,108` |

키가 **닿지 못하는** 것: `DELETE /api/analyst-reports/{ticker}`는 의도적으로 `require_admin`(`analyst_reports.py:88-90`, ADR-0027 개정) — 루틴에 삭제 권한을 주지 않는 설계.

### 5.2 fire 파이프라인이 만드는 escalation 경로 [열림, N1]

1. `POST /api/admin/cowork/fire`는 `require_admin_or_api_key`이고 본문 `text`를 그대로 받는다(`routers/admin.py:224-237`).
2. `services/cowork_trigger.py:33`이 그 text를 `127.0.0.1:8787`로 전달.
3. `scripts/cowork-fire-listener.py:37`이 `[트리거 지시]`로 프롬프트에 append하고 `:43-44`에서 `claude -p <prompt> --allowedTools Bash,WebSearch,WebFetch,Read,Write`로 스폰.

→ **API key(=admin 등가) 하나로 로컬 머신에 임의 프롬프트를 주입해 `Bash`/`Write` 도구를 가진 에이전트를 돌릴 수 있다.** 리스너는 loopback 바인드(`:83`)이고 자체 bearer 토큰(`COWORK_ROUTINE_FIRE_TOKEN`, `:55-58`, 평문 `!=` 비교·rate limit 없음)이 있으나, 위 경로는 **정상 API 표면을 통과**하므로 이 방어를 우회한다. 부수 위생 문제: 키가 argv로 노출(L2), workdir 충돌로 `run.log` truncate(M2), 로그 파일 핸들 미close.

### 5.3 파괴적 admin 엔드포인트

- **전 사용자 대상 단일 삭제** — `DELETE /api/admin/stocks/{ticker}`(`routers/admin.py:123-127`): `DELETE FROM user_stocks WHERE UPPER(ticker) = %s`에 **user_id 술어가 없다**. 한 번 호출로 모든 사용자의 그 종목 행이 사라진다(스냅샷은 고아로 유지 = 설계).
- 사용자 삭제 캐스케이드 — `DELETE /api/admin/users/{user_id}`(`admin.py:102-119`): `user_stocks`·`user_menu_permissions`·`refresh_tokens`·`digests`·`calendar_cache`→`users`. 가드: admin role·OAuth 계정은 403.
- 권한 일괄 변경 — `admin.py:64`(단일), `:78`(bulk 다중 사용자), `:131`(`default_menu_permissions`, 이후 전 신규 사용자 영향), `routers/batches.py:74`(크론 변경).
- 벌크 refresh/backfill 20+종(`report.py:59,335,347,359,371,383,485,588`, `stocks.py:411,447,459,471`, `digest.py:28`, `guru.py:46`, `investor.py:60`, `short_sell.py:45`, `rankings.py:37`, `recommendations.py:213`, `analysis.py:42,54`, `market_indicators.py:131,152,165,182,193,226,254,264`) — 전부 `require_admin`이며 전역 테이블에 쓴다.
- **[열림, N3] admin이 아닌데 전역 영향** — `DELETE /api/stocks/dashboard/cache`(`stocks.py:405-407`)는 `get_current_user`만 요구하는데 `cache_svc.invalidate_dashboard()`로 **프로세스 전역** 캐시를 비운다(임의 로그인 사용자가 반복 호출 시 콜드 빌드 유발). `DELETE /api/calendar/cache`(`calendar.py:71-73`)는 호출자 스코프라 안전.
- 무게이트 쓰기는 `routers/auth.py:75,84,94,102`(register/login/refresh/logout) 4개뿐 — 의도적 공개.
- 토큰 위생 [닫힘]: refresh 토큰은 사용 시 DELETE되는 one-time 회전(`services/auth_service.py:115-130`), access 1h/refresh 30d(`:14-15`). 쿠키 경로는 없다(Bearer 전용).

---

## 6. 프론트엔드 [열림 다수]

### 6.1 silent catch — 실패가 "데이터 없음"으로 위장

`frontend/src/` 전체 `catch` 121곳. 최악군(로그·토스트·UI 없음):

| 위치 | 삼켜지는 것 |
|---|---|
| `hooks/usePortfolioData.js:41` | 대시보드 캐시 무효화 실패 → 직후 GET이 **stale 캐시**로 수행(§6.2 재시도 경로가 바로 이 호출) |
| `hooks/usePortfolioData.js:71-73` | 라이브 시세 폴(KR 15s/US 60s) 전 실패 → `lastUpdated`가 조용히 정지, staleness 신호 없음 |
| `hooks/useReportGeneration.js:22`, `pages/ReportManualGen.jsx:98,136`, `pages/ConsensusSettings.jsx:28`, `pages/GuruCrawlNow.jsx:28` | 진행률 폴 실패 → **스피너 영구 stuck**, 토스트 없음 |
| `components/GlobalSearch.jsx:23-25` | `/api/stocks` 실패 → 모든 티커가 '미보유'로 보여 검색 선택이 리포트 대신 **관심추가 프리필**로 라우팅(`:31-36`) |
| `contexts/AuthContext.jsx:23-26` | `auth/me` 실패 → `menuPermissions=[]` → Masthead·MobileNav가 필터링해 **빈 앱 셸**이 에러 대신 표시 |
| `pages/Ranking.jsx:157,179`, `Calendar.jsx:201`, `Settings.jsx:179`, `components/reports/ReportDetailTabs.jsx:61` | 관심 별표 미표시·500을 404와 동일 취급·프리페치·FOMC 경고 미발화·뉴스 폴백 |
| 섹션 blank 계열 | `reports/DetailTab.jsx:666`, `reports/SupplySection.jsx:17`, `reports/HistoryTab.jsx:36,43`, `StockSearchBox.jsx:38`, `pages/Recommendations.jsx:83,85` — 실패 시 `[]`/`null` → 상위 가드가 섹션을 통째 미렌더 |

`console.warn` 12·`console.error` 6, `console.log` 0. **lint 규칙 없음**(`no-console` 미설정). `api.js:15-25`의 axios 인터셉터는 로깅 없이 401만 하드 리다이렉트하므로 **삼켜진 요청 실패가 드러나는 중앙 지점이 없다**.

### 6.2 대시보드 빈 그리드 계열 [부분 닫힘]

- 가드 실재: `pages/Portfolio.jsx:54-67` — `loading`→Skeleton, `!cards.length && hasHoldings && retriesExhausted`→복구 CTA, `hasHoldings`면 빈 상태 대신 Skeleton(헤더 N ↔ 그리드 빈 모순 제거, task#102).
- bounded 재시도 **최대 3**: `Portfolio.jsx:99-112`. 단 리터럴 `3`이 `:104`·`:110` 두 곳에 중복.
- **[열림] `dashboardError`가 소비되지 않는다** — 훅은 노출하지만(`usePortfolioData.js:101`) `Portfolio.jsx:95`에서 구조분해하지 않아, 진짜 에러와 "서버가 정당하게 `holdings:[]`를 반환" 상황이 **동일한 3회 재시도 + 동일한 카드**로 귀결된다.
- **[열림] `Portfolio.jsx`에 테스트가 없다** — 스켈레톤/빈상태 분기와 재시도 캡을 소유한 파일이 미테스트. `hooks/usePortfolioData.test.js`는 4케이스(list reject·dashboardError set/clear)만 보고 캡·`retriesExhausted`·폴 루프 silent catch를 단언하지 않는다.

### 6.3 경로 목록 3중 복제 [열림 — 현재 실드리프트 존재]

`frontend/src/routes.js`는 **리다이렉트 맵만** 갖고 nav IA는 갖지 않는다. 같은 경로 목록이 네 곳에 흩어져 있다.

- 진실: `App.jsx:85-100` `<Route path>` 16개
- `components/Masthead.jsx:11-45` `SECTIONS`
- `pages/ResearchShell.jsx:10-22` — Masthead의 research/schedule 섹션을 **label·evt까지 라인 단위로 복제**
- `components/MobileNav.jsx:10-19` — 세 번째 사본
- `components/MobileTopActions.jsx:14-15` — `/settings`·`/admin-analytics` + 이벤트명 복제

현재 드리프트: `MobileNav.jsx:10`에 `/analyst-report*`가 없고(M3), `Masthead.jsx:74`의 `startsWith('/analyst-reports')`가 단수 상세 경로와 매칭되지 않는다(M1). 4차 헌트 M4(라우트 테스트 수기 복제)와 **같은 가족**이며, `routes.js`로의 통합은 리다이렉트에만 적용된 상태다.

### 6.4 번들 [열림]

| asset | 크기 |
|---|---|
| `index-C6cyxoUn.js` (앱 엔트리) | ~470 KB |
| `charts-CtpqJ98B.js` | ~415 KB |
| `vendor-C4GJnovt.js` | ~255 KB |
| `index-BSa-zzDu.css` | ~49 KB |

- `frontend/vite.config.js:99-110` — `manualChunks`는 **함수 형식**(Vite 8 rolldown 필수 조건 충족). `recharts`/`/d3-`/`victory-vendor`→`charts`, 나머지 `node_modules`→`vendor`.
- **`React.lazy`/`Suspense` 사용 0** — `App.jsx:5-29`가 19개 라우트 컴포넌트를 전부 정적 import하므로 `Showcase`·`AdminAnalytics`·`Settings`까지 단일 엔트리에 실린다. `charts`도 `Portfolio→Analytics→recharts` 정적 엣지 때문에 첫 페인트에 끌려온다. 총 JS ≈1.17 MB(비압축).

### 6.5 색 관례 [부분 열림]

- 가격 방향은 `.badge--up`/`.badge--down`(`ui/Badge.css`), 의미 상태는 `.badge--success`/`danger`/`warning`. 교차 사용 금지.
- **[열림, M4] `ui/Stat.css:16-17`은 `--success`/`--danger`만 정의**하고 `--up`/`--down`이 없는데 `pages/AnalystReport.jsx:332`가 `'up'`/`'down'`을 넘긴다 → 무스타일.
- 공용 배지 variant의 **색 의미를 바꿀 땐 소비처 전수 grep 선행** — vitest·빌드는 색 의미에 블라인드하고, 과거 success/danger 의미 교체가 ChangeBadge 가격색을 반전시킨 차단급 회귀를 냈다(스팟 시각 재캡처만이 포착).

---

## 7. 미구현·보류 (의도적 non-goal)

버그가 아니라 기록된 트레이드오프입니다. 재발견해서 결함으로 올리지 않도록 명시합니다.

| 항목 | 상태·근거 |
|---|---|
| 루틴 실행 결과 실시간 콜백·**재시도 큐** | 없음(fire-and-forget). 관측은 `enriched_at`·발행물 생성 여부로 사후. ADR-0028:31 YAGNI. `cowork_trigger.fire`의 "성공" 로그는 **HTTP 전달 성공**만 의미한다 |
| 발행물 **판 단위** 삭제 | 만들지 않음 — 잘못된 판은 새 판 발행으로 덮는다. 종목 단위 삭제만(ADR-0027 개정) |
| KR 지수 밸류에이션(KOSPI/KOSDAQ PER) | 무료 공식 소스 부재로 미구현. `market_indicators/indices.py`는 `valuation.sp500_cape`만(`:132-140`) |
| 실시간 WS 시세 | 키움 `wss://…/websocket`(`KIWOOM_API.md:32-37`)·KIS `H0STCNT0` 등(`KIS_API.md:37-41`) 모두 후속 Phase 미착수 |
| 키움 KR 호가·공매도·수급 TR 대체 | `KIWOOM_API.md:45,48,50` "계획(Phase 2/3)" |
| KIS 주문·계좌 | 경계 밖(읽기전용 시세만, ADR-0009/0011/0022) |
| 백엔드 LLM 호출 | 없음. AI 텍스트는 외부 Cowork가 enrich API로 작성(`ANTHROPIC_API_KEY`는 `.env.docker`에 남아 있으나 미사용) |
| US 시세 실시간 | KIS US는 기본 15분 지연·주요지수 구성종목 중심 → 백업 용도로만 수용(`KIS_API.md:81`) |

---

## 8. 문서 드리프트 [doc]

- **`GET /api/report/list` 응답 shape** — 코드는 `{"stocks": {...}, "last_scheduled_date": {...}}`(`routers/report.py:255`)를 반환하지만 `API_SPEC.md:1596-1620` 예시는 티커 맵을 **최상위**에 보여준다. 프론트는 `data.stocks ?? data`로 양쪽을 받는 방어 코드(`hooks/useReportList.js:22`, `pages/Reports.jsx:101`)를 유지 중.
- **엔트리 필드 미문서화** — `pinned`(`report.py:220`)·`is_mine`(`:222`)이 `API_SPEC.md`의 해당 절에 없다.
- **Cowork 문서 부분 갱신** — `CLAUDE_COWORK_API.md:35`가 워크플로우 0단계로 `GET /api/analyst-reports`를 넣었으나 **전용 절(스키마·인증)은 여전히 POST뿐**(`:565`). 2문서 동기 DoD의 잔여 위반(L1).
- **doc-sync 테스트 베이스라인이 비었다** — `backend/tests/test_api_doc_sync.py:49` `KNOWN_UNDOCUMENTED = frozenset()`. 즉 **라이브 엔드포인트 전건이 `API_SPEC.md`에 문서화**된 상태이며, `CLAUDE.md`의 "미문서화 기존 23개 동결" 서술은 **stale**이다. 단 테스트는 method+path **존재**만 검증하므로 요청/응답 스키마·인증 게이팅 동기는 여전히 수동 DoD.
- 코드 주석 드리프트: `stocks.py:427`·`jobs.py:296,424`의 "maxconn=10"(실제 20).
- 유지해야 할 DoD: `batch_registry`의 `source`(fetch 출처) ↔ `usage`(소비 UI) 방향 혼동 금지 / 기능 표면 변경 시 `README.md` 해당 절 동시 갱신 / 신규 컬럼은 `main._migrate` + `app_schema.sql` **쌍**.

---

## 9. 이미 닫힌 항목 — 가드 위치와 정정

"열린 문제"로 다시 올리지 않기 위한 목록입니다.

| 과거 이슈 | 현재 상태 · 가드 |
|---|---|
| consensus backfill `force` DELETE 비원자(1차 헌트 #28, 마지막 잔존건) | **해소** — `services/consensus_pipeline.py:349-363`이 DELETE+전체 재적재를 단일 `get_connection()` 트랜잭션으로 묶음(중단 시 롤백) |
| 대시보드 500-to-empty | `routers/stocks.py` per-card `_safe`→`_minimal_card` + 반환 `sanitize(:673)` + `_usdkrw_rate` `isfinite`(`:493-498`) + 배당 양변 `float()`(`:546-552`) |
| 앱 코드 `print` 방출 | `backend/tests/test_no_print.py`가 ast로 `main.py`·`routers`·`services`·`scheduler`·`middleware`를 단언(현재 0건). `scripts/`·`tests/`는 대상 외이므로 `cowork-fire-listener.py:77`의 print는 규약 위반 아님 |
| 컬럼 추가 시 마이그레이션 쌍 누락 | 15개 ALTER 컬럼 전부 `app_schema.sql` 쌍 존재(검증 완료). **테이블 쪽은 여전히 열림 — §2.4** |
| 스냅샷 delete-rewrite·빈 결과 박제 | §1.1의 4개 가드(indices·kospi_futures·dividends·sentiment) |
| 라우트 리다이렉트 테스트 수기 복제(4차 M4) | `frontend/src/routes.js` `REDIRECTS`를 `App.jsx:82-84`와 테스트가 함께 import |
| **"005930이 정확히 70000.0으로 박제"의 원인 귀속** | **정정(task#170, ADR-0020 amendment)** — 피드 글리치가 아니라 **로컬 pytest가 prod DB에 fixture를 쓴 오염**이 유력. 실제로 멈춘 것은 `_block_real_db`(task#169)이며, 다수결·박제 게이트는 **미래 글리치 보험**으로 유효하되 관측된 70k엔 발동한 적이 없다. **라운드 값(70000·정확히 400조)이 보이면 피드보다 테스트 오염을 먼저 의심** |

### 최근 버그 헌트 이력

| 사이클 | 결과 |
|---|---|
| 5차 (task#221, `44629f2`~`4393dde`) | 8건 CONFIRMED(HIGH 1·MED 4·LOW 3) + 1건 refuted. **8건 전부 미수정 — §0** |
| 4차 (task#207) | 5건(MED 4·LOW 1) → task#208·#209로 5/5 수정·배포 |
| 3차 (task#168) | 원시 1건 → 적대 검증 refuted → confirmed 0 |
| 2차 (task#164) | 15건(HIGH 1·MED 11·LOW 3) → task#165·#166으로 15/15 수정 |
| 1차 (task#107) | 42건 → 41건 해소. 잔존 1건(#28)도 이제 해소(§9) |
