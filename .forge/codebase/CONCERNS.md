---
last_mapped_commit: 3aa35ba7b754566835ea9a21f7076a5f4450789a
mapped: 2026-07-17
---

# CONCERNS — 기술부채·알려진 버그·취약 영역

PortfoliOn의 tech debt / known bugs / security / performance / fragile areas 지도.
출처: `CLAUDE.md` Gotchas + `.forge/adr/` + `.forge/retro/` + `.forge/done/` + `.forge/bug-report.md` + 코드 직독.
아래 영역은 대부분 *이미 방어 코드가 들어간 뒤*의 잔존 취약성이다 — "고쳐졌으니 안심"이 아니라
"이 경로를 건드릴 때 재발 토양이 여기 있다"는 지도로 읽을 것.

이번 갱신 범위: 8e37e2c 이후 `git diff --stat 8e37e2c..HEAD`로 확인한 변경은 **전부 프론트엔드**
(에디토리얼 전면개편 task#190~195, 커밋 cb4d71a~3aa35ba) — 백엔드 파일은 무변경이라 §1~10·12(폴러/러너)·
13~16의 백엔드 관련 서술은 그대로 유효하다. 이번 개편으로 **해소된 것**(문서에 별도 기재 불필요, 확인만 됨):
`.cal-event`/`.settings-nav` 계열 죽은 CSS 삭제(task#194, grep 0건 확인), `ui/Button.css` 다크 하드코딩
hex 토큰화(2026-07-11 design-renewal-5of5, 8e37e2c 이전에 이미 해소), vite `sw-cache-bust` 플러그인의
`outDir` 하드코딩(`frontend/vite.config.js:68-69`에서 `configResolved`로 실제 `config.build.outDir` 사용 —
과거엔 `--outDir <throwaway>` 검증 빌드에도 플러그인이 무조건 `dist/index.html`을 덮어써 §12 "throwaway
빌드가 라이브 dist를 오염" 계열 footgun의 절반이 남아있었음, task#191 발견·수정).

---

## 1. KR 시세 정확성 — 다피드 합의·기준 이원화·자기일관 글리치 (HIGH, 완화됨)

가장 오래·반복적으로 데인 영역. 005930이 반복적으로 `70000.0`(실값 354k의 1/5)으로 박제된
"70k saga"가 task#93·94·96·98·101·118·169·170에 걸쳐 이어졌다.

### 1.1 다피드 합의(corroboration) — 라이브 대시보드(NXT)
- `backend/services/market/kr.py:131` `_corroborated_pick(feeds)` — 어떤 현재가 피드가 다른
  독립 피드 ≥1개와 ±2x([0.5,2.0]) 이내로 **합의**해야 신뢰. lazy escalation(평소 키움 NXT+키움
  KRX 2콜, 불일치 시에만 KIS·Naver 추가 호출 최대 4피드 다수결).
- `kr.py:113` `_price_sane` — 단일피드 self-check(전일종가±30%/일봉2x). `regular=True`(리포트)와
  degenerate 경로 전용. 단일피드 self-check만으로는 자기일관 오염을 못 잡는다.
- `kr.py:190` `_kr_pick_basic`, `:166` `_kr_pick_degenerate_lazy`, `:144` `_kr_pick_regular`.
- **취약점**: 대시보드 핫패스(`get_quotes_batch`/`_changes_from_closes`)는 이 가드를 안 탄다
  (ephemeral 용인). 새 KR 시세 소비처를 추가할 때 어느 경로를 타는지 확인 필요.

### 1.2 리포트 스냅샷(KRX 정규장) vs 라이브 대시보드(NXT) 기준 이원화
- ADR-0020. 단일 분기점 `client.integrated_code(stk_cd, regular=False)`. 기본 False=`_AL`(NXT
  시간외), `regular=True`=평문 KRX 코드(정규장 종가).
- 리포트 writer만 opt-in: `report_generator.py:152-154`(daily_df `regular=True`), `:160`·`:170`.
- **의도된 ~1% 불일치**: 같은 종목이 리포트(354k)와 대시보드(350.5k)에 다른 현재가를 보인다.
  NXT `_AL`은 평시에도 KRX 정규장과 ~1% 다른 시간외가를 반환(task#94/95, 실재 현상).
- `get_quote` TTL 캐시 키에 `regular` 포함(정규장/NXT quote 충돌 방지). 새 키움 fetch 추가 시
  호출 의도에 맞게 `regular` 명시 필수.

### 1.3 KRX 자기일관 오염 — regular=True는 완전 면역 아님
- KRX 두 TR(quote ka10001·일봉 ka10081)이 같은 배치 시점에 함께 글리치하면 서로 합의해
  동일피드 교차검증·`_price_sane`이 블라인드(ADR-0020 amendment task#101).
- 방어: **박제-시 독립피드 게이트**(`report_generator.generate_report`, KR만) — 저장 직전
  KRX와 독립인 ref 피드로 price·일봉 기준종가를 2x 교차검증, 어긋나면 그 종목 박제 스킵
  (wrong<missing). ref는 다중 독립피드: Naver retry-once → KIS 폴백 → 둘 다 실패면 스킵+loud 로그
  (ADR-0020 amendment task#118 — 단일 Naver ref가 rate-limit 시 게이트를 no-op으로 무력화하던 구멍 정정).
- **한계**: 이미 박제된 stale 70k는 fix 배포로 소급 치료 안 됨 — 스냅샷 *재생성* 필요.
  `backfill_ticker`(과거 날짜)는 현재가 대조 불가라 게이트 미적용.

### 1.4 ⚠️ 70k 원인 재판정 — 피드 글리치가 아니라 테스트 오염 (task#170)
- ADR-0020 amendment(2026-07-11, near-certain): "*정확히* 70000.0" 박제의 실제 원인은
  **로컬 pytest가 prod DB에 fixture 값을 직접 쓴 오염**. 근거 6종 — fixture 바이트 일치(70000.0·
  시총 400조), prod INSERT 미mock + reload footgun, 오염일=테스트 실행일(task#101·#118 당일 포함),
  당시 Naver 라이브=357.5k 정상.
- **함의**: 라운드 값(70000, 정확히 400조)이 또 보이면 피드 글리치보다 **테스트 오염을 먼저
  의심**. 게이트·다수결은 "미래의 진짜 글리치" 보험으로 유지하되 "과거 70k의 해결책"으로 읽지 말 것.

---

## 2. 테스트 → prod DB 오염 (HIGH, 가드됨)

- `backend/tests/conftest.py:27-37` `_block_real_db`(autouse) — `services.db._get_pool`을
  raise로 monkeypatch. 로컬 `DATABASE_URL`이 도커 postgres(=라이브 DB, 5432 노출)를 가리켜,
  가드 전엔 `generate_report` e2e 테스트의 스냅샷 INSERT가 **prod `snapshots`에 그대로 커밋**됐고
  (005930 fixture price 70000 클로버), admin 삭제 테스트가 **prod `calendar_cache` 전체 DELETE**를 실행.
- 오염이 **선택적**이라 격리된 듯 보였다 — 가짜 티커(TEST)는 FK로 실패해 무해해 *보이고* 실존
  티커만 오염(fixture-writes-live, task#169).
- **재발 토양**: `importlib.reload(report_generator)` reload 패턴은 모듈 자체 정의 심볼 patch를
  무효화(reload가 `from services.db import execute`를 재바인딩) — 하위 모듈 속성
  (`services.db.execute`·`_naver_get`)을 patch해야 한다. 가드가 raise하면 그 테스트가 실 DB에
  닿는 것 — 가드를 풀지 말고 mock을 추가하라.

---

## 3. 대시보드 빌드 3중 취약 — 불변식·NaN 500·Decimal TypeError

`GET /api/stocks/dashboard`(`backend/routers/stocks.py`)는 "holdings=N → 항상 N카드" 불변식을
지켜야 하는데 세 가지 서로 다른 실패 모드가 있었다(전부 방어 코드 존재).

### 3.1 500-to-empty / minimal-card 마스킹 (task#102)
- `_build_all`(`stocks.py:623`) — `get_quotes_batch` try/except→{} + 카드당 `_safe`→
  `_minimal_card`(`:603`). per-card throw 시 `stocks.py:638`이 `logger.warning("[Dashboard] ...
  최소카드 폴백")` 후 폴백.
- **은밀함**: minimal-card 폴백은 500을 안 내고 조용히 enrichment(RSI·컨센서스·매물대·배당)만
  blank. 진단은 `docker logs portfolion-backend-1 | grep '최소카드 폴백'`가 유일 단서.
- 프론트도 방어: `Portfolio.jsx` DashboardGrid는 `stocks>0`이면 Skeleton, self-heal은 bounded
  재시도(최대 3). 프론트 `usePortfolioData.fetchDashboard`의 silent catch가 500을 삼켜 빈 그리드가 됐던 게 근본.

### 3.2 NaN/inf 직렬화 500 (task#104) — per-card 가드 *위* 단계
- `_usdkrw_rate`(`stocks.py:455-470`)에 `math.isfinite` 가드 — 비유한 FX(nan)를 그대로 반환하면
  `if fx is None`(NaN≠None)을 통과해 US totals=NaN → starlette `allow_nan=False` 직렬화 500.
- `_build_all` 반환을 `services.utils.sanitize`(`stocks.py:6`, `:645`)로 감싸 NaN/inf→None
  (출처 불문 안전망). cold·warm 무관 결정적 500이라 task#102 per-card 가드가 못 막던 케이스.

### 3.3 Decimal/float 배당 TypeError (commit d666cdd2)
- `stocks.py:521-523` `yield_on_cost`·`expected_income` — `avg_cost`/`qty`(DB NUMERIC→**Decimal**)와
  `annual_div`(stock_dividends→**float**)의 `float/Decimal` 연산이 TypeError → 배당 있는 모든
  보유종목 카드가 throw→minimal-card. 수정: 양변 `float()` 정규화.
- **재발 토양**: DB NUMERIC 컬럼(avg_cost·quantity)을 float·외부값과 산술하는 경로는 어디든
  동일 위험. 회귀 테스트 fixture는 float만 쓰면 못 잡는다(Decimal avg_cost 필수).

---

## 4. 배치-백킹 뷰 빈-결과 오염 (HIGH-패턴)

랭킹·KR 업종 모멘텀·시장지표 등 "배치가 사전계산 → 요청은 저장값만 read" 구조의 공통 함정.
근본 신호는 **의심 트리거(base_dt 등)가 아니라 실패 클래스(all-None/빈응답)를 가드**하는 것.

### 4.1 all-None 캐시 박제 금지 (task#48·49·50)
- 배치 외부 fetch는 ① 실패를 silent except로 삼키지 말고 로깅, ② 빈/all-None 결과를 캐시에
  save 금지(직전 양호값 유지). 기동 시 빈 캐시 적재는 `_seed_*_if_empty`(랭킹·kr_sector) 패턴.

### 4.2 요청경로 "성공-but-빈응답" 박제 (task#157)
- `backend/services/market_indicators/kospi_futures.py:21-22` — KIS `rt_cd=0`(무예외)이나
  output1/history 비면 `_fetch`가 `None` 반환(값 수준 가드), `get_kospi_futures`(`:47-59`)가
  `_mc_save` 스킵 후 `_mc_load` last-good 폴백. 예외만 가드하면 성공응답의 빈 output이 통과해
  last-good을 클로버('wrong<missing' 위반).
- 회귀는 저장 양호값 시드 후 *값이 None인 반환*을 모킹해야 이 경로를 실제로 침(예외 side_effect 아님).

### 4.3 delete-rewrite 데이터 손실 (task#160) — "빈 결과 박제 금지"의 파괴적 변형
- `backend/services/dividends.py:308-314` `replace_schedule` — `DELETE+INSERT`를 **단일
  트랜잭션**으로. fetch 실패를 빈 결과로 삼키면 save 생략이 아니라 **직전 양호값을 DELETE로 파괴**
  (박제보다 은밀 — 토스트도 없음).
- `dividends.py:228-233` `_dividend_history` — fetch 예외를 `[]`로 삼키지 말고 **전파**해야
  호출측(`fetch_all_dividends:388-392`)이 실패 시 replace를 스킵하고 직전 값 보존.
  genuine-empty(fetch 성공·무데이터)만 clear.

### 4.4 get_or_refresh는 stale-fallback 안 함 (task#151)
- `backend/services/market_indicators/cache.py:110` `get_or_refresh(key, fetch_fn, ttl)` — "저장값
  있으면 fetch 스킵"일 뿐, fetch 실패 시 직전값 폴백을 안 한다(실패 전파). CNN F&G(`sentiment.py`)·
  KOSPI 선물처럼 언제든 막히는 소스엔 `fx.py`의 VIX식 **수동 폴백**을 써야 stale 값이 뜬다.
  FRED/yfinance처럼 안정적 소스는 `get_or_refresh`로 충분.

---

## 5. 외부소스 파싱 fixture-pass-live-fail 가족 (HIGH-패턴)

단위테스트(응답 mock)는 라이브 정합을 못 잡는다 — 아래는 모두 fixture green·라이브 fail의 반복.
**외부소스 파싱 슬라이스는 라이브 1종목 추출 대조를 DoD에 포함**할 것.

- **yfinance 라벨 불일치**: `backend/services/market/us.py:24-27` — `get_cashflow()` *메서드*(무공백
  `OperatingCashFlow`)와 `.cash_flow` *프로퍼티*(공백 `Operating Cash Flow`)의 index 라벨 규칙이
  달라, `_yf_val` exact 매칭이 어긋나면 예외 없이 **조용히 None**. income/balance는 get_* 메서드
  이므로 현금흐름도 `t.get_cashflow(freq='yearly', as_dict=False)`로 통일 필수(task#117).
- **yfinance 퍼센트 = 소수분수**: `shortPercentOfFloat`(0.0098=0.98%)·`pctHeld`·`dividendYield` 등
  0~1 분수. 프론트 표시 ×100 + API_SPEC/fixture도 분수 스케일로(task#122·123).
- **DART fs_div**: `backend/services/market/kr.py:475-483` — `fnlttSinglAcntAll`은 `fs_div`를 요청
  필수값으로 받고(누락 시 status 100), 응답을 행별 fs_div로 필터하면 안 됨(단일 fs라 필드 echo 안 함
  →전 행 스킵). 계정 매칭은 `account_id`(XBRL, `kr.py:386-389`), 이자보상 분모는 `이자의 지급`
  (`ifrs-full_InterestPaidClassifiedAsOperatingActivities`)(task#117).
- **Kiwoom tz-naive ↔ yfinance tz-aware 정렬**: `backend/services/report_generator.py:206-209` —
  키움 일봉(tz-naive)과 yfinance `^KS11`(tz-aware) `pd.concat`이 TypeError, broad except가 삼키면
  KR beta가 조용히 None. `tz_localize(None)`로 정렬(task#116).
- **KIS output1/2/3 봉투**: `backend/services/kis/futures.py:45-54` — 국내선물옵션 시세 TR은 단수
  `output`이 아니라 output1(계약 quote)/output2(일봉 바)/output3(기초지수). `d.get("output")`만
  읽으면 rt_cd=0인데도 늘 빈값→"코드 오류"로 오진(task#155·156). 베이시스는 `mrkt_basis`(선물−현물)
  이지 이론 `basis` 아님. 라이브 프로브는 fetch 200뿐 아니라 응답 봉투 파싱까지 확인해야 완성.
- **KR quote vs chart 스케일 어긋남**: `get_quote_kr`(키움 ka10001)와 `get_history_df`(ka10081
  일봉)는 다른 TR이라 한쪽만 액면/병합 조정되면 최대 5배 어긋나 매물대/RSI가 "깨져" 보인다 —
  표시 버그가 아니라 박제된 price 값 자체를 의심.
- **수주잔고 파싱**: 배포 후 전 종목 재적재 UAT 필수. 단위 캡션 파싱 실패 시 '안전한 기본값(억원)'
  폴백은 ×100 대형 오저장 — 추출 실패는 기본값이 아니라 pending(누락)으로('wrong < missing').

---

## 6. SQL single→batch 개작 함정 (task#135)

query-mock 테스트가 라이브 정합을 못 잡는 배포-즉사 버그 2종.

- **uuid `= ANY(%s)` 캐스트**: `backend/routers/admin.py:32`는 `= ANY(%s::uuid[])` 명시 캐스트.
  파이썬 str 리스트를 `ANY(%s)`로 넘기면 text[]가 돼 `operator does not exist: uuid = text`
  라이브 즉사. 단건 `WHERE user_id = %s`(str→unknown 암묵 캐스트)가 동작하던 게 배열화에서 깨진다.
  (다른 `ANY(%s)` 사용처는 대부분 ticker=text 컬럼이라 무해 — uuid 컬럼만 명시 캐스트 필요.)
- **VALUES 플레이스홀더**: `backend/services/consensus.py:81-85` `_values_placeholder` — 행별
  `(%s,%s::date), ...` 나열만. 바깥 괄호로 감싸면(`VALUES ((a,b),(c,d))`) N행이 아니라 record
  1행이 돼 `AS v(ticker,d)` 매핑 에러. `test_values_placeholder_shape`가 형태 못박음.
- **DoD**: 새 SQL·단건→배치 개작 슬라이스는 mock 테스트 외에 **배포 후 라이브 스모크**를 DoD에 포함.

---

## 7. 컨테이너 UTC vs KST 날짜 (task#157)

- 백엔드 컨테이너에 TZ env가 없어 bare `date.today()`=UTC. 00:00~09:00 KST(UTC 전일)엔 하루
  뒤처져 최근월물 휴리스틱·영업일 판정이 어긋난다.
- KR 시장-날짜는 `datetime.now(ZoneInfo("Asia/Seoul")).date()` — `backend/services/market_indicators/
  kospi_signal.py:18,114`(`_KST`), `backend/scheduler/schedule.py`의 `_KST` 패턴 재사용.
- 정렬용 `tz_localize(None)`(§5 Kiwoom)과는 다른 문제 — 이건 *어느 달력일이냐* 판정용.

---

## 8. Pool contention — cold 대시보드 (PERFORMANCE)

- `backend/services/db.py:21-25` `ThreadedConnectionPool(minconn=1, maxconn=20)` — psycopg2 풀은
  소진 시 **블록이 아니라 PoolError를 throw**하므로 워커 수 이상으로 둔다. 콜드 첫 호출에
  10-워커 ThreadPool×카드당 다중 DB read가 풀 경합→PoolError→throw→500(§3.1 minimal-card 마스킹의
  원 트리거였음).
- ThreadPool 동시성 상한: calendar 15·analysis 11·dashboard 10(`stocks.py:641`)·이름백필 8(`:400`).
- ⚠️ **문서 드리프트**: `stocks.py:399` 주석은 "DB 풀(maxconn=10)"이라 하나 실제 `db.py`는
  maxconn=20. 코드는 20이 맞고 주석이 stale.

---

## 9. 스키마 마이그레이션 부채 (ADR-0006)

- 별도 마이그레이션 프레임워크 없음. `app_schema.sql`은 빈 pgdata 최초 초기화(docker-entrypoint-
  initdb.d) 때만 실행 → **이미 채워진 운영 DB엔 절대 반영 안 됨**.
- 신규 컬럼/테이블은 `main.py:_migrate()`에 `ADD COLUMN IF NOT EXISTS`/`CREATE TABLE IF NOT
  EXISTS`로 넣는 게 **정본**, `app_schema.sql`은 신규 DB 미러일 뿐(DoD: 두 파일 쌍).
- **취약점**: 한쪽만 고치면 배포 직후 그 컬럼을 쓰는 INSERT/SELECT가 컬럼 부재로 깨지거나
  (task#130 `stock_recommendations.name`), 신규 테이블 SELECT가 `relation does not exist`로
  lifespan startup 실패→백엔드 부팅 차단(task#16 `batch_schedules`). additive·idempotent DDL에만
  한정 — 파괴적 변경(drop/rename/type/백필)은 이 경로 금지.

---

## 10. NaN/inf 직렬화 500 일반 (DATA)

- starlette `JSONResponse`는 `allow_nan=False` — 응답 dict에 NaN/inf가 있으면 500
  (`Out of range float values are not JSON compliant`). `backend/services/utils.py:36` `sanitize`가
  NaN/inf→None.
- **은밀함**: PostgreSQL은 `json` 컬럼에 NaN 거부(저장 실패)하지만 파이썬 `json.dumps`는 기본
  `allow_nan=True`라 파일 폴백은 통과 → DB저장 실패·파일 성공·응답 직렬화 실패로 증상이 엇갈려
  진단이 늦어진다(다이제스트 500 사례 8cd70a42).
- 가드는 **소스에서**(`math.isfinite` 후 "시세 없음") 하는 게 출력 일괄 sanitize보다 깨끗.
  시세/합산을 응답에 싣는 엔드포인트는 sanitize 또는 소스 isfinite 가드 필수.

---

## 11. Silent-catch / 로깅 취약성

- 프론트 silent catch가 500을 삼켜 증상을 가림(`usePortfolioData.fetchDashboard`, §3.1).
- broad `except: pass`가 라이브 정렬 실패를 삼켜 "기능이 조용히 꺼짐"(§5 KR beta). 적어도 진단
  로그를 남기거나 좁은 예외만 잡을 것.
- 로깅 규약(task#162/163/185): 백엔드는 모듈 `logger`(앱 코드 `print`=0, `tests/test_no_print.py`
  단언), 루트 로거는 `main.py:_configure_logging()`이 1회 배선 — config 없으면 lastResort=WARNING
  이라 `logger.info`가 docker logs에 안 뜬다. 프론트 `console.*`는 자동 가드 없음(lint 미연결).
  전체: `.forge/codebase/CONVENTIONS.md` §4.
- **프론트 이벤트 트래킹도 같은 계열의 무음 실패 표면 — §17 참조**(events.py `VALID_EVENTS`
  화이트리스트 미스매치는 200 OK를 반환하면서 저장을 스킵해 콘솔에도 안 남는다).

---

## 12. 배포·인프라 취약성 (OPERATIONAL)

- **폴러 hard reset**: launchd `com.portfolion.auto-deploy-poll`이 2분마다 `LOCAL != origin/main`
  이면(양방향) `git reset --hard origin/main` → 커밋 안 한 tracked 편집뿐 아니라 **push 안 한 로컬
  커밋도 소실**(task#106). 코드/문서 변경은 commit+push 묶어서. `.forge/` 등 untracked는 안전.
- **러너 격리**: 자동배포 주 경로 = self-hosted 러너(`~/actions-runner-portfolion`). 타 프로젝트
  세팅 때 재등록되면 사라져 잡이 `queued→24h cancelled` 무음 미배포(06-22~06-27 실사례, task#105).
  백엔드가 옛 코드면 폴러 footgun 단정 전 `gh run list`/`gh api .../actions/runners`로 러너부터 확인.
- **프론트/백엔드 배포 비대칭**: nginx가 `frontend/dist` 직접 서빙이라 `npm run build`로 즉시 라이브,
  **백엔드 변경은 폴러 재배포 후에야 라이브** — 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작.
- **UI 리스타일 서브에이전트의 조기 라이브 반영**(task#175): fix/review 서브에이전트가 컴파일
  검증차 `npm run build`를 그대로 실행하면 `frontend/dist`를 직접 덮어 중간본이 조기 라이브된다
  (메인 세션 프롬프트엔 "빌드는 최종 1회"가 반영돼도 서브에이전트 프롬프트엔 명시 없으면 뚫림).
  대응: fix/review 프롬프트에 "`npm run build`·`frontend/dist` 쓰기 금지, 컴파일 검증은 throwaway
  `--outDir`만" 명문화(task#194 감사에서도 재확인·유지). **`sw-cache-bust` 플러그인 자체의 outDir
  하드코딩 절반**(throwaway 빌드에도 `dist/index.html`을 덮어쓰던 부분)은 `frontend/vite.config.js:68-69`
  `configResolved`에서 실제 `config.build.outDir`을 읽도록 수정됨(task#191) — 단 이 수정은 플러그인
  레벨 안전망일 뿐, 서브에이전트가 애초에 `--outDir` 없이 기본 빌드를 돌리는 실수는 여전히 막지 못하므로
  프롬프트 명문화 규율은 계속 필요.

---

## 13. 문서 드리프트 (DOC DEBT)

- **API 명세 2문서 동기**: `API_SPEC.md` + `CLAUDE_COWORK_API.md`. 엔드포인트 존재 drift는
  `backend/tests/test_api_doc_sync.py`가 자동검출(미문서화 23개는 `KNOWN_UNDOCUMENTED` 베이스라인
  동결). 단 요청/응답 스키마·인증 게이팅 동기는 수동 DoD. "2문서 모두"는 Cowork 관련 엔드포인트에
  한함 — 사용자 대면 read는 `API_SPEC.md`에만.
- **README 동기**: 화면구성·env·스택·아키텍처·배치 표면 변경 시 README 해당 절 같은 PR 갱신(DoD).
- **배치 id/source drift**: `batch_registry.BATCHES`의 id를 빼면 read·표시문자열·`job_runs.record`
  모든 lane(auto/manual/backfill)·테스트를 전수 grep(옛 id로 record하면 배치 현황에서 증발).
  id 추가 시 count/set 하드코딩 단언 4파일(test_scheduler_seed·test_batch_market_split·
  test_batches_router·test_macro_signals_batch) 전수 grep(task#136). fetch 소스 변경 시 `source` 갱신.
- **심볼 제거/개명**: patch하는 테스트를 파일 불문 전수 grep(`services.digest_service.yf`가 다른
  파일에서 patch돼 ModuleNotFoundError, task#136).
- **`CONVENTIONS.md`의 배지 색 서술 잠재 stale**: `.forge/codebase/CONVENTIONS.md:81`은 "의미
  배지에 success/danger 쓰면 가격색(빨강/파랑)과 반전"이라고 서술하는데, task#194 감사(커밋
  1e686cf)에서 `ChangeBadge`(`ui/Badge.jsx:35`, 가격 등락 배지)가 `.badge--up`/`.badge--down`
  전용 변형(`ui/Badge.css:41-49`)으로 분리됐다 — 의미 배지 규칙 자체(success/danger 금지)는 여전히
  유효하나, "가격색과 반전"이라던 success/danger의 실제 정의가 지금도 그대로인지는 이번 매핑에서
  재확인하지 않았다(범위 밖, §14 참조). 배지 관련 작업 시 문서 문구보다 **코드 실측**을 우선할 것.

---

## 14. 계약 변경 blast radius 취약성

- **비-additive reshape**: 엔드포인트 응답을 배열→객체 등으로 바꾸면 그걸 fetch하는 *모든* 프론트
  소비처 전수 grep(task52: 대시보드 배열→객체 시 Analytics.jsx 독립 fetcher가 조용히 깨짐). additive 선호.
- **additive read/외부호출 추가**: `mock.call_args`(마지막 호출)를 단언하는 기존 테스트가 조용히
  오염 — `call_args_list[i].kwargs`로 마이그레이션, 빈 입력이면 호출 생략, `call_count`로 시퀀스 못박음(task#66/67).
- **auth Depends 추가**: 모듈 상단에서 `FastAPI()`를 직접 만들어 `dependency_overrides`로 auth
  우회하는 자체-app 테스트(test_stocks_router 등)가 401/403로 깨짐 — 새 의존성 override 전수 추가.
  무인증 거부는 override 없는 fresh app으로 별도 검증(task#108).
- **enrich 필드 정본 위치 혼동**: `enriched_at` 정본은 `tickers` 테이블 컬럼이지 스냅샷 `data` JSON이
  아님 — 스냅샷에서 읽도록 가정하면 fixture green·라이브 항상 False(task#132). 종목명도 dual-source
  (`tickers.name` vs `snapshots.data.name`) — 이름 변경 시 둘 다 + 캐시 무효화 필수(task#77).
- **admin scope=all 리포트의 category vs is_mine**: 비소유 종목에도 category가 붙어, category로만
  게이트한 액션 버튼이 남의 종목에 노출→user-scoped 핸들러가 404. 가시성은 `is_mine`으로 게이트,
  액션 버튼은 단일 `StockActions.jsx`로 통합(task#97·103).
- **공용 UI킷 변형의 색 의미 교체 시 소비처 전수 grep 누락**(task#194 감사 사례): "의미 배지에
  success/danger 쓰지 말 것" 규칙 위반처럼 보인다고 `ui/Badge.css`의 success/danger 변형을 가격
  토큰에서 떼어내며, 실소비처인 `ChangeBadge`(`frontend/src/components/ui/Badge.jsx:35`, 가격 등락
  배지·`value>=0→success` 변형)가 그 변형을 의도적으로 써 온 사실을 grep하지 않고 함께 뒤집어버려
  상승=초록/하락=빨강(서구식)으로 앱 전역 가격색이 반전됐다. vitest·빌드는 통과(색 의미는 테스트
  밖)했고 **감사 게이트의 스팟 재캡처**(수정 후 라이브 스크린샷 재확인 단계)만이 유일하게 포착해
  메인 세션이 `Badge.css:41-49`에 `.badge--up`/`--down` 전용 변형(주석: "ChangeBadge 전용. 의미
  상태는 success/danger를 쓸 것")을 신설하고 `ChangeBadge`를 `up`/`down`으로 전환해 교정(커밋
  1e686cf). 위 "비-additive reshape 소비처 grep" 가토의 *CSS 변형판* — API 응답 shape뿐 아니라
  공유 스타일 프리미티브의 색 의미를 바꿀 때도 "규칙 위반처럼 보이는 배선"이 실은 의도된 소비(가격
  배지)일 수 있으므로 소비처 전수 확인이 선행돼야 하고, 시각적 회귀는 단위테스트가 못 잡으니 fix 후
  스팟 시각 재검증이 최후 방어선이라는 교훈.

---

## 15. 프론트 애니메이션 — transform 래퍼가 fixed 자손을 가두는 함정 (task#195)

- CSS에서 `transform`이 `none`이 아닌 요소는 그 자손 중 `position: fixed`인 요소의 **컨테이닝
  블록이 된다**(뷰포트가 아니라 그 요소 기준으로 고정) — `animation: ... fill-mode: both/forwards`로
  transform 애니메이션을 걸면 애니메이션이 끝난 뒤에도 computed transform matrix가 요소에 남아
  이 효과가 영구화된다.
- 실사례: `frontend/src/App.jsx:75-76`의 라우트 전환 래퍼(`<div key={location.pathname}>`)가
  `.anim-fade-up`(`transform: translateY(12px)→none`, `frontend/src/styles/motion.css:6-9`)을 쓰던
  당시, 그 자손인 `.fab`(플로팅 액션 버튼, `frontend/src/styles/mobile.css:277-283`)·`.tabbar`
  (모바일 하단 탭바, `mobile.css:61-69`)·`.modal-overlay`(`frontend/src/styles/pc.css:404-408`) 같은
  `position: fixed` 요소들이 뷰포트가 아니라 라우트 래퍼에 갇혀 스크롤 시 밀려나거나 뷰포트를 완전히
  덮지 못했다.
- **수정**(task#195, 커밋 c469f0b): 라우트 래퍼 전용으로 `transform` 없는 `.anim-fade`(opacity만,
  `motion.css:12-19`)를 신설해 `App.jsx:76`이 이걸로 교체. `motion.css:14-16` 주석이 이 규약을 명문화.
- **재발 토양**: `.anim-fade-up`은 여전히 카드·리스트 아이템 등 다수 컴포넌트(`StockCard.jsx`·
  `TickerListItem.jsx`·`DashboardCard.jsx`·`Masthead.jsx`(마스트헤드 자체)·`HistoryTab.jsx`·
  `ReportDetailTabs.jsx` 등 15+ 파일)에서 쓰인다 — 이 자체는 안전(그 자손에 `fixed` 요소가 없는 한).
  **위험한 건 "새 레이아웃/라우트 수준 래퍼"에 transform 애니메이션을 다는 경우**: 그 래퍼가
  `.fab`·`.tabbar`·`.modal-overlay`·`.more-backdrop`(`mobile.css:44`) 같은 `position: fixed` 요소의
  조상이 되면 동일 버그가 재발한다. 신규 페이지/레이아웃 래퍼 애니메이션은 그 서브트리에 `fixed`
  자손이 있는지 먼저 확인하고, 있으면 `.anim-fade`(또는 transform 없는 별도 클래스)를 쓸 것.
  회귀 프로브 패턴(task#195에서 표준화): 스크롤 전후 fixed 요소 rect 불변·모달이 뷰포트 전체를
  커버·래퍼의 computed `transform`이 `none`인지 3종 확인.

---

## 16. 사용자 행동 이벤트 트래킹 — 화이트리스트/전송 경로 드리프트

프론트 `trackEvent`(`frontend/src/utils/analytics.js`)와 백엔드 `VALID_EVENTS`
(`backend/routers/events.py:11-18`) 화이트리스트가 서로 grep 없이 늘어나며 최소 두 이벤트가
드리프트했고, 전송 경로 자체도 배포 환경 가정이 다른 소비처와 어긋난다.

### 16.1 VALID_EVENTS 미등록 이벤트 — 200 OK인데 저장 안 됨(무음 스킵)
- `backend/routers/events.py:45-46` `track_event` — `body.event_name not in VALID_EVENTS`면
  `{"ok": True}`만 반환하고 `_persist`(INSERT)를 아예 스킵. 로그도 없고 프론트도 `.catch(() => {})`
  라 **성공처럼 보이면서 조용히 미수집**.
- 확인된 누락 2건(코드 grep, `grep -rn "trackEvent(" frontend/src`):
  - `nav_analytics` — `frontend/src/components/Masthead.jsx:110`(admin 전용 "행동" 링크)·
    `frontend/src/components/MobileTopActions.jsx:15`(모바일 더보기 메뉴)에서 발화하지만
    `VALID_EVENTS`엔 `nav_portfolio`/`nav_research`/`nav_market`/`nav_guru`/`nav_settings`만 있고
    `nav_analytics`는 없다.
  - `ranking_watch_toggle` — `frontend/src/pages/Ranking.jsx:233`(랭킹 행에서 관심종목 토글)에서
    발화하지만 `VALID_EVENTS`엔 `ranking_row_click`만 있다.
- **재발 토양**: 새 `trackEvent('이벤트명', ...)` 호출을 프론트에 추가할 때 `backend/routers/
  events.py`의 `VALID_EVENTS` 갱신을 잊기 쉽다(컴파일/테스트가 안 잡음 — 런타임에 조용히 스킵될
  뿐). admin 분석 대시보드(`GET /api/admin/analytics`)에서 그 이벤트가 영원히 0으로 보이는 형태로만
  드러난다.

### 16.2 trackEvent가 VITE_API_BASE_URL을 무시 — 로컬 preview UAT에서만 502
- `frontend/src/utils/analytics.js` — `fetch('/api/events', ...)`로 **상대경로 하드코딩**. 반면
  `frontend/src/api.js:4`(`axios baseURL`)·`frontend/src/App.jsx:32,127`·`frontend/src/pages/
  LoginPage.jsx:8`은 전부 `import.meta.env.VITE_API_BASE_URL || ''`를 접두어로 쓴다.
- **영향 범위는 한정적**: 정식 배포(nginx가 `/api/*`를 백엔드로 프록시)에선 상대경로가 정상 동작
  하므로 프로덕션에서 깨지지 않는다. `.forge/codebase/CONCERNS.md` §12의 "로컬 preview + prod API
  베이크" 무배포 검증 기법(`VITE_API_BASE_URL=<prod> npx vite build --outDir <throwaway>` →
  `npx vite preview`)을 쓸 때만 노출된다 — `vite preview`는 dev 서버의 `/api` 프록시(`vite.config.js`
  의 `server.proxy`)를 적용하지 않으므로, 이때 발화되는 이벤트 트래킹 호출만 로컬 preview 서버로
  가서 404/502가 난다(다른 API 호출은 `VITE_API_BASE_URL`로 prod를 직접 때려 정상).
- **재발 토양**: 신규 fetch 유틸을 추가할 때 `api.js`/`App.jsx` 패턴(`VITE_API_BASE_URL` 접두어)을
  따르지 않으면 이런 환경별 비대칭이 반복된다. 프로덕션 영향은 없으나, 무배포 UAT 기법으로 이벤트
  트래킹 관련 화면을 검증할 때 이 502를 실제 버그로 오인하지 않도록 주의.

---

## 17. 에디토리얼 전면개편 감사 이월 5건 (task#194 defer, 백로그 후보)

`.forge/done/2026-07-17-editorial-redesign-5of5-audit/run.md`(원시 발견 28건 → fix 15/defer 5/drop 4
판정) 기준. defer는 "결함이 아니라고 확정"이 아니라 **라이브 확인/디자인 판단이 선행돼야 하는 미결정**
항목 — fix 여부를 지금 단정하지 말 것.

1. **경쟁사 카드명 클리핑**(R3) — `frontend/src/components/reports/Sections.jsx:22`
   `ReportSectionCompetitors`. 원본 `name` 필드 자체가 긴/이상 값인지(데이터 원본 의심) 확인 선행.
2. **히스토리 목표가 고립 점선**(R5) — `frontend/src/components/reports/HistoryTab.jsx`
   (`GET /api/report/{ticker}/history` 응답 소비). 라이브 응답의 null 패턴(스냅샷 공백 구간)이
   의도된 데이터 부재인지 렌더 결함인지 확인 선행.
3. **모바일 탭바 콘텐츠 비침**(F3, task#188과 병합 논의) — `.tabbar`(`frontend/src/styles/
   mobile.css:61-69`, `backdrop-filter`+반투명 배경). task#188에서 정적 스크린샷만으로 "레이어 가려짐"
   을 오판했던 선례가 있어, 실기기 `elementFromPoint` 확인 없이는 fix 판정을 유보.
4. **로그인 보조 버튼·Showcase 버튼 터치타겟** — `frontend/src/pages/LoginPage.jsx`·
   `frontend/src/pages/Showcase.jsx`. 기존 사이즈 체계(`ui/Button.jsx`)가 있어 lg 사이즈 채택
   여부는 디자인 판단 필요.
5. **다크 테마 Elevated 카드 구분 강화** — `border` 보강 등 다크 테마 일반 특성(그림자 대비 저하)에
   대한 디자인 판단 필요.

---

## 18. 알려진 미해결 / 의도적 미수정

- **backfill force DELETE 비원자** (`.forge/bug-report.md`, task#28) — 1차 버그헌트 42건 중 유일
  잔존, 의도적 미수정.
- **KR 지수 밸류에이션 미구현** (ADR 관련) — KOSPI/KOSDAQ PER 무료 공식소스 부재로 미구현(후속).
  US S&P500 Shiller CAPE는 `multpl.com` 크롤(FRED엔 CAPE 시리즈 없음, `indices.py`).
- **KOSDAQ 실적일 커버리지 patchy** — yfinance가 일부 `.KQ`에 404, best-effort 빈 결과 graceful.
- **discovery 저유동성 필터 라이브 행동 확인 미완**(task#68, MEMORY) — 배치 재계산 선행 필요.
- **버그헌트 현황**: 2차(task#164) 15/15 수정 완료, 3차(task#168) 수정분 잔존 버그 0건.
- **§17의 감사 defer 5건** — 위와 동일, 중복 기재 방지 위해 여기서는 참조만.

---

## 19. Security / 접근 경계 (요약)

- prod DB/컨테이너 쓰기·읽기·settings 자가권한은 에이전트 분류기가 하드 차단 — 사용자 `!` 실행
  또는 admin 엔드포인트 경유(`reference-prod-writes-need-user`).
- 외부 시세 소스(키움/KIS)는 **읽기전용·서버측 단일키 경계**(ADR-0009/0011/0022) — 계좌·주문 미연동.
  키 미설정이 안전 기본값(`configured()` False면 휴면).
- 시크릿은 `backend/.env.docker`(gitignore) — 키 이름만: POSTGRES_PASSWORD, JWT_SECRET,
  SESSION_SECRET, OAuth, FRED_API_KEY, KOFIA_API_KEY, DART_API_KEY, KIWOOM_APP/SECRET_KEY,
  KIS_APP_KEY/APP_SECRET. `ANTHROPIC_API_KEY`는 남아있으나 현재 백엔드 미사용(LLM 호출 없음).
- 메뉴 접근은 `user_menu_permissions` + `AuthContext` nav 필터, admin만 리포트 생성·Guru 크롤.
