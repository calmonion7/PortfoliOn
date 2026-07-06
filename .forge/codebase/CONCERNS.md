---
last_mapped_commit: e12f17d5c4a2f0cf9c1ed030a4b867aa207afdcc
mapped: 2026-07-06
---

# CONCERNS — 기술부채·버그·보안·성능·취약지점

PortfoliOn의 LIVE 관심사항을 구체 파일경로와 함께 정리한다. 근거는 `CLAUDE.md` gotchas 절, `.forge/adr/` ADR들, `.forge/retro/` 회고. 각 항목은 "왜 위험한지 + 어디를 봐야 하는지 + 대응"으로 구성.

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
  - 주의: **text/varchar 컬럼의 `= ANY(%s)`는 안전**(암묵 text[] 매칭). 예: `backend/routers/portfolio.py:124`의 `SELECT ... FROM stock_beta WHERE ticker = ANY(%s)`는 `ticker`가 text라 무해. uuid 컬럼(`user_id` 등)에만 캐스트가 필요.
- **VALUES 행 나열을 바깥 괄호로 감싸면(`VALUES ((a,b),(c,d))`) N행이 아니라 record 1행** → `AS v(ticker,d)` 컬럼 매핑 에러. 행별 `(a,b),(c,d)` 나열만.
- 정본/가드: `backend/services/consensus.py` `_values_placeholder`, 형태 고정 테스트 `backend/tests/test_consensus_asof_batch.py`(`test_values_placeholder_shape`). 둘 다 query-mock pytest green 상태의 배포-즉사 버그였음(ADR-0008 관련).

### 1d. 키움 tz-naive ↔ yfinance tz-aware concat — **쌍둥이 갭 (부분 해소, task#116·#150)**
- **근본 성질**: 키움 daily_df 인덱스는 tz-naive, yfinance(`^KS11` 등)는 tz-aware(Asia/Seoul) → `pd.concat([naive, aware], axis=1)`가 `TypeError`. `indicators.calc_beta`(`backend/services/indicators.py:108`)가 바로 이 concat을 하므로, KR 종목 series를 ^KS11과 정렬하는 모든 계산(베타·상관·상대강도)이 위험. broad `try/except`가 삼키면 **조용히 None**(graceful이나 커버리지 손실, 라이브 전용 — fixture는 ^KS11 라이브 미모킹이라 미포착).
- **✅ 가드 있음**: `backend/services/beta.py`는 `_ks11_returns`(ret 인덱스 strip)와 `fetch_kr_beta`(daily_df 인덱스 strip, 두 series 모두)에서 양쪽을 `tz_localize(None)`으로 벗긴다. beta 백필 배치(task#150)는 안전.
- **⚠️ 잔존 갭(쌍둥이 원본)**: `backend/services/report_generator.py` `generate_report` KR beta(147-163행)는 **`ks11_ret`만 tz-strip(157-159행)하고 `daily_df`/`_daily_returns`(147행)는 안 벗긴다**. 키움 실패→yfinance 폴백으로 `daily_df`가 tz-aware가 되면 `calc_beta(_daily_returns, ks11_ret)` 내부 concat이 TypeError→broad except(161-163행)가 삼켜 **리포트 스냅샷 beta가 조용히 None**. `beta.py`가 재사용 원본에서 파생됐는데 원본만 미수정 → **통일 필요(fg-quick 감)**. 정합 패턴은 `beta.py`처럼 양쪽 series를 모두 strip.

### 1e. dual-store 혼동 — `enriched_at`는 `tickers` 컬럼, 스냅샷 JSON 아님 (task#132)
- AI 분석 존재 판정 정본은 `tickers` 테이블 컬럼. 스냅샷 `data` JSON에서 읽도록 가정하면 fixture green·라이브 항상 False. 소비처 확인: `backend/routers/report.py`(약 447행 부근).
- 종목명 dual-source도 같은 가족: `tickers.name`(공유 마스터) vs `snapshots.data.name`(리포트 박제). 이름 변경 시 둘 다 갱신(`storage.refresh_snapshot_names`/`reconcile_snapshot_names`) + `cache.invalidate(ticker)`+`invalidate_list()` 필수. `backend/services/storage.py`.

---

## 2. NaN/inf → JSON 직렬화 500 (starlette `allow_nan=False`)

응답 dict에 `NaN`/`inf`가 있으면 starlette `JSONResponse`가 직렬화에서 **500**(`Out of range float values are not JSON compliant`). 외부시세(yfinance Close NaN, FX/usdkrw NaN)에서 흘러든 NaN이 합산값을 오염시키는 게 전형.

- **가림 함정**: PostgreSQL은 `json` 컬럼에 NaN을 거부(저장 실패)하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 **파일 폴백은 통과** → DB저장 실패·파일 성공·응답 직렬화 실패로 증상이 엇갈려 진단 지연.
- 대응 위치:
  - `backend/routers/stocks.py` `_usdkrw_rate` — `math.isfinite` 가드(비유한→None). NaN≠None이라 `if fx is None` 가드를 통과해버리던 게 US totals=NaN→500의 근본(task#104). **노출 엔드포인트도 이 `_usdkrw_rate`를 재사용**(`backend/routers/portfolio.py:129`)하고 결과를 `sanitize`로 감싼다(130행).
  - `backend/services/utils.py` `sanitize` — NaN/inf→None 안전망. `_build_all`·exposure 반환을 감쌈.
  - `backend/services/beta.py` `_fin_num` — `math.isfinite` 통과 못하면 None(저장 안 함) → `stock_beta.beta`에 NaN 유입 차단.
- **규칙: 시세/합산을 응답에 싣는 엔드포인트는 소스 `isfinite` 가드 또는 `sanitize` 필수.** 가드는 소스에서 하는 게 출력 일괄 sanitize보다 깨끗(다이제스트 생성 500 사례 8cd70a42).

---

## 3. 대시보드 빌드 불변식 (holdings=N → 항상 N카드, 500-to-empty 금지)

`GET /api/stocks/dashboard`의 `_build_all`(`backend/routers/stocks.py`)은 `get_quotes_batch`(try/except→{}) + 카드당 `_safe`(throw→`_minimal_card`)로 감싸 부분실패에도 전체 500을 안 낸다. 세 가지 다른 트리거가 이 불변식을 위협했음:

1. **풀 경합(cold-start)** — 콜드 첫 호출에 10-워커 ThreadPool×카드당 다중 DB read가 풀 경합(PoolError)→throw→500→프론트 `usePortfolioData.fetchDashboard` catch가 silent로 삼킴→빈 그리드. 헤더(`/api/portfolio`=단일 쿼리)는 N 정상이라 "헤더 N·그리드 빈"(task#102).
2. **NaN 직렬화 500**(§2, task#104) — cold/warm 무관 결정적, per-card 가드 *위* 단계라 task#102 가드가 못 막음.
3. **배당 `float/Decimal` TypeError**(commit d666cdd2) — `_build_card`의 `yield_on_cost = annual_div / avg_cost`에서 `avg_cost`/`qty`는 DB NUMERIC→**Decimal**, `annual_div`(stock_dividends)는 **float** → `float/Decimal` TypeError → 배당 있는 모든 보유카드가 `_minimal_card` 폴백(RSI·컨센서스·매물대·배당 통째 blank, **500도 안 나서 더 은밀**). 수정: 양변 `float()` 정규화. 회귀 테스트는 **Decimal** avg_cost fixture로.

- 프론트 방어: `frontend/src/pages/Portfolio.jsx` `DashboardGrid`는 `stocks>0`이면 Skeleton, self-heal은 one-shot이 아니라 **bounded 재시도(최대 3)**.
- **진단**: 헤더/시세 정상인데 enrichment만 일괄 blank면 `docker logs portfolion-backend-1 | grep '최소카드 폴백'`로 per-card 예외 확인(minimal-card 가드가 근본원인을 마스킹).
- **DB NUMERIC(avg_cost·quantity)을 float·외부값과 산술하는 경로는 어디든 동일 위험** — 노출/리밸런싱/베타 파생계산도 `Decimal↔float` 혼산에 주의. `services/rebalance.py value_holdings_krw`(KRW 환산)를 `services/exposure.py`가 공유하며 Decimal/fx≤0/None 가드를 이미 반영(task#149 회고: 계획 단계에서 경계값 선반영해 적대적 리뷰 findings 0).

---

## 4. KR 시세 글리치 (005930 ~70k 박제) — 다피드 교차검증

**근본원인(task#94)**: 005930 ~70k는 영속 버그가 아니라 **키움 NXT `_AL`(SOR 통합코드) 순간 이상체결**이 일배치에 박제된 *일시적* 값. "영속 소스 버그로 단정해 소스부터 고치려 들지 말 것."

- **시세 기준 이원화(ADR-0020, task#95)**: 리포트 스냅샷=KRX 정규장 / 라이브 대시보드=NXT. 단일 분기점 `client.integrated_code(stk_cd, regular=False)`(`backend/services/kiwoom/client.py`). 기본 False=`_AL`(NXT), `regular=True`=평문 KRX. 리포트 writer만 opt-in(`report_generator`·`report.py:refresh_analyst`). **beta 백필(`beta.py fetch_kr_beta`)도 `get_history_df(..., regular=True)`로 KRX 정규장 일봉 사용.**
- **라이브(NXT) 백스톱 — 2-of-N 다수결 corroboration(task#98, ADR-0010)**: `backend/services/market/kr.py` `_corroborated_pick`/`_kr_pick_basic` — 어떤 현재가 피드가 다른 독립 피드 ≥1개와 ±2x([0.5,2.0]) 이내 합의해야 신뢰, 우선순위 최상위(키움 NXT→KIS→Naver→키움 KRX) 반환. lazy escalation(불일치 시에만 KIS/Naver 추가). degenerate(단일 피드)는 prev_close ±30% 자가검증(`_kr_pick_degenerate_lazy`).
- **리포트 박제-시 독립피드 게이트(task#101/#118)**: `backend/services/report_generator.py` `generate_report`(KR만) — 저장 직전 KRX와 독립인 ref 피드(네이버 retry-once → KIS 폴백)로 price·일봉 기준종가 2x 교차검증, 어긋나면 그 종목 박제 **스킵**(직전 양호 스냅샷 유지, wrong<missing). **ref 전무면 박제 스킵 + loud print 로그**(기존 "검증 생략·진행"이 게이트를 무력화하던 구멍 정정). `backfill_ticker`(과거 날짜)는 미적용.
- **regular=True도 근본해결 아님**: 같은 KRX 두 TR(quote ka10001·일봉 ka10081)이 동시 글리치하는 KRX 자기일관 오염엔 면역 아님 → 위 박제 게이트가 막음.
- **⚠️ fix 배포는 이미 박제된 스냅샷을 소급 치료 안 함** — stale 70k는 *재생성*해야 KRX로 덮인다. 재생성 전 라이브 프로브로 소스 깨끗 확인(transient 글리치 재박제 방지).
- 진단: 네이버 공개 API(`m.stock.naver.com/api/stock/{code}/basic`) 실값 대조 + `docker exec -i portfolion-backend-1 python - < probe.py`로 KRX(`005930`) vs SOR(`005930_AL`) 원값 비교.

---

## 5. 포트폴리오 베타·노출 관심사 (신규, task#149·#150)

### 5a. 포트폴리오 베타 커버리지는 `stock_beta` 백필에 의존 (graceful 빈값)
- `GET /api/portfolio/exposure`의 `portfolio_beta`는 `compute_exposure`(`backend/services/exposure.py:70-77`)가 **저장값 `stock_beta`만** 읽어 Σ(w×β)/Σw로 커버된 보유만 재정규화한다(요청경로 라이브 계산 0 — 배치-백킹 뷰 라이브금지 가토). 조회는 `backend/routers/portfolio.py:121-127`.
- **백필(admin `POST /api/stocks/beta/refresh` 또는 주간 배치 `beta_fetch`, 매주 일 05:30) 전이면 `beta_coverage_pct`=0%·`portfolio_beta`=None**(graceful). 리포트 freshness와 무관하나 **백필 미실행 시 노출 탭 베타 카드가 빈 값**. 신규 보유 추가 후에도 다음 배치/수동 백필 전까지 그 종목은 `beta_missing`에 남아 커버리지가 부분값.
- admin-게이트 write라 자율(테스트계정) UAT로 "채워진 값 렌더"를 확인 못 함(403) — 실값 확인은 사용자(admin) 백필 트리거로 위임(task#150 회고, reference-prod-writes-need-user 계열).

### 5b. `stock_beta.source` 라벨 부정확 (정보성, 낮은 우선순위)
- `backend/services/beta.py` `fetch_all_betas`는 KR 종목을 무조건 `source="kiwoom"`으로 하드코딩(루프 내 `market == "KR"` 분기)하나, KR 일봉을 주는 `get_history_df`는 **키움 실패 시 yfinance로 폴백**할 수 있다 → 실제 데이터 출처가 yfinance인데 `stock_beta.source`엔 "kiwoom"으로 기록되어 **어긋날 수 있음**. `stock_beta.source`를 신뢰해 출처 판정/디버깅하면 오인 가능. 파생값 정확도엔 무영향(정보성 컬럼). task#150 적대적 검토 minor #3(보류).

### 5c. beta.py ↔ report_generator tz-strip 쌍둥이 갭
- §1d 참조 — beta 백필은 가드됐으나 리포트 스냅샷 KR beta(`report_generator.generate_report` 147행)는 미가드. 통일 전까지 리포트 스냅샷의 KR beta는 키움 폴백 시 조용히 None 가능.

---

## 6. 배포 footgun

### 6a. 2분 자동배포 폴러가 로컬 편집·미푸시 커밋 삭제
- launchd `com.portfolion.auto-deploy-poll` → `scripts/auto-deploy-poll.sh` 2분마다. **`LOCAL != origin/main`이면(양방향) `git reset --hard origin/main` 후 `deploy.sh`**.
- **커밋 안 한 tracked 편집뿐 아니라 push 안 한 로컬 커밋(로컬이 앞선 경우)도 다음 폴(≤2분)에 reset으로 소실**(task#106 실사례, fg-map 지도 커밋 소실→cherry-pick 복구). **코드/문서 변경은 commit+`git push origin main`을 묶어 즉시.** `.forge/` 등 untracked는 reset 대상 아님(안전).

### 6b. self-hosted 러너 격리
- 자동배포 주 경로 = self-hosted GH Actions 러너(`deploy.yml`, `runs-on: self-hosted`). PortfoliOn 전용 러너 = `~/actions-runner-portfolion`(launchd `actions.runner.calmonion7-PortfoliOn.macbook-portfolion`).
- **러너가 다른 repo로 재등록되면 조용히 사라져** 잡이 `queued→24h cancelled` **무음 미배포**(06-22~06-27 lab-taebro 세팅 때 실사례, task#105). **새 프로젝트가 기존 러너 디렉터리에 `config.sh` 재등록 금지**(전역 `~/.claude/CLAUDE.md` "멀티 프로젝트 인프라 격리").

### 6c. "백엔드가 옛 코드"일 때 진단 순서
1. **도커 churn 먼저**: `docker ps`로 uptime 확인(backend는 `docker run`이라 `docker compose ps`엔 안 잡힘). 필요 시 `bash deploy.sh` 1회로 백엔드 컨테이너 재생성(ad-hoc `docker compose` 금지).
2. **러너**: `gh run list`(잡이 queued/cancelled면 러너 부재)·`gh api repos/calmonion7/PortfoliOn/actions/runners --jq '.runners[]|{name,status}'`.
3. 그 다음에 폴러 footgun 의심.
- 프론트는 nginx가 `frontend/dist` 직접 서빙 → `npm run build`로 즉시 라이브(배포 무관). **백엔드 변경은 폴러/러너 재배포 후에야 라이브.**

---

## 7. 다중표면 변경 위험 (grep로 전수 감사할 것)

- **배치 id 은퇴 시 전수 grep**(`backend/services/batch_registry.py` — CLAUDE.md의 `scheduler/batch_registry.py` 경로는 stale, 실제는 services 하위): ① 데이터 read(스케줄 소비처) ② 표시 문자열(`schedule_desc`) ③ **`job_runs.record(id,...)` 모든 lane(auto·manual·backfill)** ④ id 단언 테스트. 한 곳이라도 옛 id면 stale read·배치 현황 실행이력 증발·고아 run 누적. 단 옛 id를 *읽는* 시드 마이그레이션은 정당한 잔존. (ADR-0001 job_runs, daily_report-market-split 재발)
- **배치 id 추가 시 exact-count/exact-set 단언이 여러 테스트 파일에 흩어짐**(task#136·#150): `beta_fetch` 추가 때 `test_scheduler_seed.py`의 2곳이 계획 grep에서 누락돼 27→28 갱신 확대. `grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS\|== 27\|== 28" backend/tests/`로 전수(`test_batches_router.py`·`test_batch_market_split.py`·`test_macro_signals_batch.py`·`test_scheduler_seed.py` 등).
- **`scheduler/`는 명시 재export 패키지 — 신규 잡 함수는 `scheduler/__init__.py`에도 재export 필요**(task#150 divergence). `scheduler/jobs.py`에 `_fetch_betas` 정의 + `_JOB_FUNCS` 등록(484행) + `__init__.py`에 재export(30행). 한 곳 빠뜨리면 배선 미완.
- **심볼 제거/개명이 mock patch 타깃을 파일 불문 깨뜨림**(task#136): `grep -rn "모듈경로.심볼" backend/tests/`. 예: digest_service에서 `yf` import 제거 시 다른 파일(`test_disclosure_endpoint_digest`)의 `services.digest_service.yf.Ticker` patch가 `ModuleNotFoundError`.
- **비-additive 응답 reshape(배열→객체)는 모든 프론트 소비처 전수 grep**: `grep -rn '<엔드포인트>' frontend/src/`. 독립 fetcher(예: `Analytics.jsx`가 훅과 별개로 `/api/stocks/dashboard` 직접 fetch)까지. 가능하면 additive 선호(task#52).
- **additive read 추가가 `mock.call_args`(마지막 호출) 오염**(task#66/#67): 기존 단언을 `call_args_list[i].kwargs`로 마이그레이션, 신규 호출은 `if <조건>:`로 입력 비면 생략, 신규 테스트는 `call_count`로 시퀀스 고정.
- **auth `Depends` 추가가 자체-app 테스트 401/403로 깨뜨림**(task#108): 다수 테스트가 conftest `client`가 아니라 모듈 상단 `FastAPI()`를 직접 만들어 `app.dependency_overrides`로 우회(`test_stocks_router.py`·`test_consensus_router.py`). 새 의존성 override 추가 + 무인증 거부는 override 없는 fresh app으로 별도 검증(`backend/tests/test_security_auth_gaps.py` 패턴).
- **엔드포인트 존재 drift는 자동검출**: `backend/tests/test_api_doc_sync.py`(라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md` 헤더 대조, task#99). 단 요청/응답 스키마·인증 게이팅 동기는 수동 DoD.
- **`PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 *먼저* 등록**(FastAPI가 `enrich`를 ticker로 라우팅 방지).

---

## 8. 신규 DB 컬럼/테이블 배포 함정 (ADR-0006)

- **`app_schema.sql`만 고치면 라이브 DB에 반영 안 됨** — 스키마 파일은 신규 설치용, 라이브는 기동 idempotent 마이그레이션만 탐. **`backend/main.py` `_migrate`에 `ADD COLUMN IF NOT EXISTS`(또는 `CREATE TABLE IF NOT EXISTS`)를 쌍으로 추가 필수**. 한쪽만 고치면 배포 직후 그 컬럼/테이블 INSERT/SELECT가 부재로 깨짐(`stock_recommendations.name` 파손 직전, task#130). 완료기준에 두 파일 쌍 명시.
- **최근 준수 사례**: `stock_beta` 테이블은 `app_schema.sql:283` + `main.py:84`(`CREATE TABLE IF NOT EXISTS stock_beta`)에 **쌍으로** 추가됨(task#150, dividends 패턴 미러). 이 쌍 규율이 정착 중.

---

## 9. 로컬 `.venv` ≠ Docker 의존성

- **`lxml`은 `requirements.txt`·Docker엔 있지만 로컬 `backend/.venv`엔 없다.** 로컬 pytest로 검증할 HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 stdlib **`BeautifulSoup(html, "html.parser")`**. 해당 코드: `backend/services/market_indicators/indices.py`(Shiller CAPE multpl.com 크롤), `backend/services/backlog.py`(document.xml), `backend/services/agm.py`.

---

## 10. 문서 동기화 부채 (DoD)

- **API 변경 시 `API_SPEC.md` + `CLAUDE_COWORK_API.md`** — 단, **`CLAUDE_COWORK_API.md`는 외부 Cowork(enrich/backlog) 전용 스코프**라 사용자 대면 read 엔드포인트(`/portfolio/*` 등)는 `API_SPEC.md`에만 넣는다(task#149 회고: `/rebalance`·`/exposure` 모두 Cowork 문서 대상 아님). doc-sync 테스트는 Cowork 문서엔 *stale*만 검출하므로 green 유지. 신규 엔드포인트가 Cowork 소비 대상인지 먼저 판별해 DoD를 좁힐 것(기계적 "둘 다"는 과함).
- **기능 표면 변경 시 `README.md` 해당 절도** 같은 PR에서(화면구성·env·스택·아키텍처·배치). README는 overview 레벨 — 엔드포인트 세부는 명세서에만.

---

## 11. 배치/성능 관심사

- **배치-백킹 뷰(랭킹·KR 업종 모멘텀·베타·노출)는 외부 API를 요청·기동 경로에서 라이브 호출 금지** — 배치가 사전계산해 `market_cache`/테이블(`stock_beta` 등) 저장, 요청은 저장값만 read(요청당 N콜 직렬=수초 지연, task#50). `compute_exposure`도 순수함수(DB/외부 호출 0)로 `beta_map`/`sector_map`을 인자로 받는다.
- **외부 fetch 실패를 조용히 삼키지 말 것**(silent except는 진단 불가, task#48 `_fetch_one_sector` all-None 박제). **빈/all-None을 캐시에 박제 금지**(전부 None이면 save 생략·직전값 유지). *실패 클래스(all-None)*를 가드해야 근본원인 미상이어도 재발 차단. 기동 시드: `_seed_*_if_empty`(랭킹·kr_sector).
- **배치 ThreadPool 워커 ≤ DB 풀 사이즈**(수급 스크리닝 교훈) — 대시보드 콜드 풀 경합(§3)의 근원. `report_generator.generate_report`는 `max_workers=8` ThreadPool(112행) 사용.
- **캘린더 KR 실적발표일은 yfinance `.KS`/`.KQ`가 유일 forward 소스** — `backend/routers/calendar.py` `_collect_earnings`는 `_yf_sym(ticker, market, exchange)`로 접미사 붙여야 함(raw ticker면 KR 0건). Naver·DART 모두 forward 미제공(task#121).
- **배치 fetch 소스 변경 시 `batch_registry`의 `source` 갱신**(DoD) — `source`=fetch 출처(예: `beta_fetch` = `["yfinance","키움"]`) ≠ `usage`=소비 UI(예: `["포트폴리오 노출 탭(포트 베타)"]`).

---

## 12. 보안·인증 관심사

- **admin `scope=all` 리포트 목록은 비소유 종목에도 `category`를 붙임**(`backend/routers/report.py` `_mk_entry`) — category로만 게이트된 관리 버튼(수정·승격·삭제)이 남의 종목에 노출되면 user-scoped 핸들러가 **404로 조용히 깨짐**. **액션 버튼 가시성은 category가 아니라 `is_mine`으로 게이트**(`frontend/src/components/reports/StockActions.jsx` — 단일 컴포넌트로 통합, 두 렌더러 중복 제거 task#103). 교차-사용자 동작은 `/api/admin/*` 전용(`require_admin`).
- **mutation POST 엔드포인트를 거부(403/401) 예상으로 프로브하지 말 것 — 실행될 수 있다**(task#148 회고): `POST /consensus/{ticker}/backfill?force=true`는 `require_admin`이 아니라 `get_current_user` 게이트라 user 토큰으로 200=실제 backfill 실행됨(멱등이라 무해했으나 의도치 않은 프로덕션 mutation). auth 상태는 코드 grep(Depends 확인)으로 먼저 볼 것.
- **auth 의존성**: `get_current_user`/`require_admin`/`require_admin_or_api_key`. admin만 리포트 생성·Guru 크롤·백필(beta/dividends/consensus 등 `POST /api/stocks/beta/refresh` 포함). `user_menu_permissions`로 메뉴 표시 제어(`admin.py` `ALL_MENUS`).
- **API 키 env**(값 인용 금지, 이름만): `.env.docker`에 `POSTGRES_PASSWORD`·`JWT_SECRET`·`SESSION_SECRET`·OAuth·`FRED_API_KEY`·`KOFIA_API_KEY`·`DART_API_KEY`·`KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`·`KIS_APP_KEY`/`KIS_APP_SECRET`. `KITA_API_KEY`는 실제로 **관세청** 키(미설정 시 UN Comtrade 폴백). `ANTHROPIC_API_KEY`는 남아있으나 현재 백엔드 미사용(백엔드에 LLM 호출 없음 — AI 분석은 외부 Cowork).
- **키 미설정 = 안전 기본값(휴면)**: KIS `configured()` False면 dormant, KOFIA/DART 미설정 시 해당 수집 실패지만 무해. KIS는 발급 1분당 1회(EGW00133) 강제 재발급 60s 가드(`backend/services/kis/client.py`).

---

## 13. KR UI 색 관례 함정

- 이 앱은 `--up`=빨강(상승)·`--down`=파랑(하락, `frontend/src/styles/tokens.css`)이라 `.badge--success`=빨강·`.badge--danger`=파랑(`frontend/src/components/ui/Badge.css`). **의미 상태 배지(수급 밴드·노출 경고 등)에 success/danger 쓰면 KR 가격색으로 박혀 Western 의도와 반전**(수급 배지 우호=빨·경계=파 버그, b288f394). 의미 배지는 `frontend/src/components/ui/SupplyBadge.jsx`처럼 전용 색 명시. 노출/베타 경고 배지도 caution 전용색 사용(task#149·#150). `warning` 변형은 토큰 미정의로 현재 깨져 있음.
- **KR 단위 포매팅**: `frontend/src/components/market/marketUtils.jsx` `krFmt`는 입력을 '억원' 단위 가정 — 원은 `/1e8` 변환 후, 주(count)엔 부적합. raw 원/주를 그대로 넘기면 1e8배 오표기(공매도 "35조경원" 사례 f9594f2b).
- **yfinance 퍼센트는 소수분수**(`shortPercentOfFloat` 0.0098=0.98%, `pctHeld`, `dividendYield` 등) — 표시 ×100, API_SPEC 예시·fixture도 분수 스케일로(task#122/#123).

---

## 14. 외부데이터 증상은 라이브 프로브 선행 (오진 방지)

- **"다른 지표는 다 나오는데 RSI만 빈" = fetch 실패가 아니라 히스토리 부족일 수 있다**(task#126): RSI(14봉)는 상장 <14거래일 신규 종목에서 전부 NaN(EMA·52주·HV·매물대는 짧은 히스토리서도 값 나옴). **자연 해소**이므로 코드 버그 단정 금지. 진단: `docker exec -i portfolion-backend-1 python -`로 `yf.Ticker(t).history(period="1y")` 행수 + `indicators.calc_rsi(...).notna().sum()` 확인(행수<14=히스토리 부족 vs 0행=fetch 실패). 프론트: RSI 전무 시 `VolumeRsiSnapshot` 폴백, 생기면 `RsiTable`(`ReportDetailTabs` `hasRsi` 분기).
- **compute/파생계산 슬라이스는 스냅샷 결측을 프로브로 선확인**(task#150): "스냅샷 저장 beta 읽기"만으론 테스트계정 커버리지 0%(스냅샷이 beta 컬럼 추가 이전)임을 프로브로 확인 → read-stored 대신 **백필 방식** 채택. read-stored였으면 빈 기능이 됐을 것. 신규 파생지표를 기존 스냅샷/테이블에서 읽으려면 그 저장소에 값이 실제로 있는지 먼저 프로브.
- **KR 시세/차트 소스 스케일 어긋남**: 리포트 현재가 마커는 `get_quote_kr`(키움 ka10001), 매물대/RSI는 `get_history_df`(키움 ka10081 일봉) — 다른 TR이라 한쪽만 액면조정되면 최대 5배 어긋나 "차트 깨짐"처럼 보임. 표시 버그가 아니라 박제 price 값 자체를 의심(`backend/services/market/kr.py`).

---

## 15. 파싱/재적재 UAT 관심사

- **수주잔고/데이터 파싱 변경은 배포 후 전 종목 재적재 UAT 필수** — fixture 전부 통과해도 운영 재적재가 fixture에 없던 케이스(외화 `(단위:USD천)`, 단위 캡션 줄바꿈 분리, 회사컬럼 표)를 잡음. **단위 캡션 파싱 실패 시 '기본값(억원) 폴백'은 ×100 대형 오저장** → 추출 실패는 기본값이 아니라 pending(누락)으로('wrong < missing'). `backend/services/backlog.py`(ADR-0002/0003/0004/0005).
- **DART list.json은 `pblntf_ty`를 echo 안 함** → "단일 호출 후 필터" 불가, 유형 A·B·C·D 개별 호출(종목당 4콜). AGM은 반대로 `pblntf_ty` *미지정* 호출로만 발견(`backend/services/agm.py` self-insert). 주총 회의일은 filing date가 아니라 document.xml 본문(2전략 파싱). 증분은 최신 AGM rcept_no 해결 시에만 fetch 스킵(티커당 스킵으로 만들면 연례 주총 영영 재fetch 안 됨, task#120).

---

## 16. 해소된 관심사 (히스토리)

- **버그 리포트(task#107) 42건 전부 해소 완료**(task#148, 2026-07-05). 마지막 잔존 #28(consensus backfill force 경로) = `POST /consensus/{ticker}/backfill?force=true`의 DELETE+재적재를 단일 `get_connection()` 트랜잭션으로 원자화(중단 시 롤백→기존 mart 보존, non-force 무변경). ADR-0008(마트 정본) 무변경. `.forge/bug-report.md`가 이 이력의 정본.

---

## 부록: CLAUDE.md 경로 정정

- CLAUDE.md는 `backend/scheduler/batch_registry.py`로 표기하나 **실제 위치는 `backend/services/batch_registry.py`**. `backend/scheduler/`는 `__init__.py`(잡 배선·재export·`_JOB_FUNCS`)·`jobs.py`(잡 함수)·`schedule.py`·`_state.py`만 존재.
