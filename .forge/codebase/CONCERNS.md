---
last_mapped_commit: 739c39c3f628376219789fb8b7850076941dc69c
mapped: 2026-07-04
---

# CONCERNS — 기술부채·버그·보안·성능·취약지점

PortfoliOn의 LIVE 관심사항을 구체 파일경로와 함께 정리한다. 근거는 `CLAUDE.md` gotchas 절과 `.forge/adr/` ADR들. 각 항목은 "왜 위험한지 + 어디를 봐야 하는지 + 대응"으로 구성.

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
- **VALUES 행 나열을 바깥 괄호로 감싸면(`VALUES ((a,b),(c,d))`) N행이 아니라 record 1행** → `AS v(ticker,d)` 컬럼 매핑 에러. 행별 `(a,b),(c,d)` 나열만.
- 정본/가드: `backend/services/consensus.py` `_values_placeholder`, 형태 고정 테스트 `backend/tests/test_consensus_asof_batch.py`(`test_values_placeholder_shape`). 둘 다 query-mock pytest green 상태의 배포-즉사 버그였음(ADR-0008 관련).

### 1d. 키움 tz-naive ↔ yfinance tz-aware concat (task#116)
- 키움 daily_df 인덱스는 tz-naive, yfinance(`^KS11` 등)는 tz-aware(Asia/Seoul) → `pd.concat([naive, aware], axis=1)`가 `TypeError`. broad `try/except`가 삼키면 KR beta·상관 등이 **조용히 None**.
- 위치: `backend/services/report_generator.py` `generate_report`의 KR beta. **KR series를 yfinance 지수/자산과 정렬하는 모든 계산(베타·상관·상대강도)은 한쪽을 `tz_localize(None)`으로 맞출 것.** 라이브 전용 버그(fixture는 ^KS11 라이브 미모킹이라 미포착).

### 1e. dual-store 혼동 — `enriched_at`는 `tickers` 컬럼, 스냅샷 JSON 아님 (task#132)
- AI 분석 존재 판정 정본은 `tickers` 테이블 컬럼. 스냅샷 `data` JSON에서 읽도록 가정하면 fixture green·라이브 항상 False. 소비처 확인: `backend/routers/report.py`(약 447행 부근).
- 종목명 dual-source도 같은 가족: `tickers.name`(공유 마스터) vs `snapshots.data.name`(리포트 박제). 이름 변경 시 둘 다 갱신(`storage.refresh_snapshot_names`/`reconcile_snapshot_names`) + `cache.invalidate(ticker)`+`invalidate_list()` 필수. `backend/services/storage.py`.

---

## 2. NaN/inf → JSON 직렬화 500 (starlette `allow_nan=False`)

응답 dict에 `NaN`/`inf`가 있으면 starlette `JSONResponse`가 직렬화에서 **500**(`Out of range float values are not JSON compliant`). 외부시세(yfinance Close NaN, FX/usdkrw NaN)에서 흘러든 NaN이 합산값을 오염시키는 게 전형.

- **가림 함정**: PostgreSQL은 `json` 컬럼에 NaN을 거부(저장 실패)하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 **파일 폴백은 통과** → DB저장 실패·파일 성공·응답 직렬화 실패로 증상이 엇갈려 진단 지연.
- 대응 위치:
  - `backend/routers/stocks.py` `_usdkrw_rate` — `math.isfinite` 가드(비유한→None). NaN≠None이라 `if fx is None` 가드를 통과해버리던 게 US totals=NaN→500의 근본(task#104).
  - `backend/services/utils.py` `sanitize` — NaN/inf→None 안전망. `_build_all` 반환을 감쌈.
- **규칙: 시세/합산을 응답에 싣는 엔드포인트는 소스 `isfinite` 가드 또는 `sanitize` 필수.** 가드는 소스에서 하는 게 출력 일괄 sanitize보다 깨끗(다이제스트 생성 500 사례 8cd70a42).

---

## 3. 대시보드 빌드 불변식 (holdings=N → 항상 N카드, 500-to-empty 금지)

`GET /api/stocks/dashboard`의 `_build_all`(`backend/routers/stocks.py`)은 `get_quotes_batch`(try/except→{}) + 카드당 `_safe`(throw→`_minimal_card`)로 감싸 부분실패에도 전체 500을 안 낸다. 세 가지 다른 트리거가 이 불변식을 위협했음:

1. **풀 경합(cold-start)** — 콜드 첫 호출에 10-워커 ThreadPool×카드당 다중 DB read가 풀 경합(PoolError)→throw→500→프론트 `usePortfolioData.fetchDashboard` catch가 silent로 삼킴→빈 그리드. 헤더(`/api/portfolio`=단일 쿼리)는 N 정상이라 "헤더 N·그리드 빈"(task#102).
2. **NaN 직렬화 500**(§2, task#104) — cold/warm 무관 결정적, per-card 가드 *위* 단계라 task#102 가드가 못 막음.
3. **배당 `float/Decimal` TypeError**(commit d666cdd2) — `_build_card`의 `yield_on_cost = annual_div / avg_cost`에서 `avg_cost`/`qty`는 DB NUMERIC→**Decimal**, `annual_div`(stock_dividends)는 **float** → `float/Decimal` TypeError → 배당 있는 모든 보유카드가 `_minimal_card` 폴백(RSI·컨센서스·매물대·배당 통째 blank, **500도 안 나서 더 은밀**). 수정: 양변 `float()` 정규화. 회귀 테스트는 **Decimal** avg_cost fixture로.

- 프론트 방어: `frontend/src/pages/Portfolio.jsx` `DashboardGrid`는 `stocks>0`이면 Skeleton, self-heal은 one-shot이 아니라 **bounded 재시도(최대 3)**.
- **진단**: 헤더/시세 정상인데 enrichment만 일괄 blank면 `docker logs portfolion-backend-1 | grep '최소카드 폴백'`로 per-card 예외 확인(minimal-card 가드가 근본원인을 마스킹).
- **DB NUMERIC(avg_cost·quantity)을 float·외부값과 산술하는 경로는 어디든 동일 위험.**

---

## 4. KR 시세 글리치 (005930 ~70k 박제) — 다피드 교차검증

**근본원인(task#94)**: 005930 ~70k는 영속 버그가 아니라 **키움 NXT `_AL`(SOR 통합코드) 순간 이상체결**이 일배치에 박제된 *일시적* 값. "영속 소스 버그로 단정해 소스부터 고치려 들지 말 것."

- **시세 기준 이원화(ADR-0020, task#95)**: 리포트 스냅샷=KRX 정규장 / 라이브 대시보드=NXT. 단일 분기점 `client.integrated_code(stk_cd, regular=False)`(`backend/services/kiwoom/client.py`). 기본 False=`_AL`(NXT), `regular=True`=평문 KRX. 리포트 writer만 opt-in(`report_generator`·`report.py:refresh_analyst`).
- **라이브(NXT) 백스톱 — 2-of-N 다수결 corroboration(task#98, ADR-0010)**: `backend/services/market/kr.py` `_corroborated_pick`/`_kr_pick_basic` — 어떤 현재가 피드가 다른 독립 피드 ≥1개와 ±2x([0.5,2.0]) 이내 합의해야 신뢰, 우선순위 최상위(키움 NXT→KIS→Naver→키움 KRX) 반환. lazy escalation(불일치 시에만 KIS/Naver 추가). degenerate(단일 피드)는 prev_close ±30% 자가검증(`_kr_pick_degenerate_lazy`).
- **리포트 박제-시 독립피드 게이트(task#101/#118)**: `backend/services/report_generator.py` `generate_report`(KR만) — 저장 직전 KRX와 독립인 ref 피드(네이버 retry-once → KIS 폴백)로 price·일봉 기준종가 2x 교차검증, 어긋나면 그 종목 박제 **스킵**(직전 양호 스냅샷 유지, wrong<missing). **ref 전무면 박제 스킵 + loud print 로그**(기존 "검증 생략·진행"이 게이트를 무력화하던 구멍 정정). `backfill_ticker`(과거 날짜)는 미적용.
- **regular=True도 근본해결 아님**: 같은 KRX 두 TR(quote ka10001·일봉 ka10081)이 동시 글리치하는 KRX 자기일관 오염엔 면역 아님 → 위 박제 게이트가 막음.
- **⚠️ fix 배포는 이미 박제된 스냅샷을 소급 치료 안 함** — stale 70k는 *재생성*해야 KRX로 덮인다. 재생성 전 라이브 프로브로 소스 깨끗 확인(transient 글리치 재박제 방지).
- 진단: 네이버 공개 API(`m.stock.naver.com/api/stock/{code}/basic`) 실값 대조 + `docker exec -i portfolion-backend-1 python - < probe.py`로 KRX(`005930`) vs SOR(`005930_AL`) 원값 비교.

---

## 5. 배포 footgun

### 5a. 2분 자동배포 폴러가 로컬 편집·미푸시 커밋 삭제
- launchd `com.portfolion.auto-deploy-poll` → `scripts/auto-deploy-poll.sh` 2분마다. **`LOCAL != origin/main`이면(양방향) `git reset --hard origin/main` 후 `deploy.sh`**(스크립트 24~35행 직접 확인).
- **커밋 안 한 tracked 편집뿐 아니라 push 안 한 로컬 커밋(로컬이 앞선 경우)도 다음 폴(≤2분)에 reset으로 소실**(task#106 실사례, fg-map 지도 커밋 소실→cherry-pick 복구). **코드/문서 변경은 commit+`git push origin main`을 묶어 즉시.** `.forge/` 등 untracked는 reset 대상 아님(안전).

### 5b. self-hosted 러너 격리
- 자동배포 주 경로 = self-hosted GH Actions 러너(`deploy.yml`, `runs-on: self-hosted`). PortfoliOn 전용 러너 = `~/actions-runner-portfolion`(launchd `actions.runner.calmonion7-PortfoliOn.macbook-portfolion`).
- **러너가 다른 repo로 재등록되면 조용히 사라져** 잡이 `queued→24h cancelled` **무음 미배포**(06-22~06-27 lab-taebro 세팅 때 실사례, task#105). **새 프로젝트가 기존 러너 디렉터리에 `config.sh` 재등록 금지**(전역 `~/.claude/CLAUDE.md` "멀티 프로젝트 인프라 격리").

### 5c. "백엔드가 옛 코드"일 때 진단 순서
1. **도커 churn 먼저**: `docker ps`로 uptime 확인(backend는 `docker run`이라 `docker compose ps`엔 안 잡힘). 필요 시 `bash deploy.sh` 1회로 백엔드 컨테이너 재생성(ad-hoc `docker compose` 금지).
2. **러너**: `gh run list`(잡이 queued/cancelled면 러너 부재)·`gh api repos/calmonion7/PortfoliOn/actions/runners --jq '.runners[]|{name,status}'`.
3. 그 다음에 폴러 footgun 의심.
- 프론트는 nginx가 `frontend/dist` 직접 서빙 → `npm run build`로 즉시 라이브(배포 무관). **백엔드 변경은 폴러/러너 재배포 후에야 라이브.**

---

## 6. 다중표면 변경 위험 (grep로 전수 감사할 것)

- **배치 id 은퇴 시 전수 grep**(`backend/services/batch_registry.py` — CLAUDE.md의 `scheduler/batch_registry.py` 경로는 stale, 실제는 services 하위): ① 데이터 read(스케줄 소비처) ② 표시 문자열(`schedule_desc`) ③ **`job_runs.record(id,...)` 모든 lane(auto·manual·backfill)** ④ id 단언 테스트. 한 곳이라도 옛 id면 stale read·배치 현황 실행이력 증발·고아 run 누적. 단 옛 id를 *읽는* 시드 마이그레이션은 정당한 잔존. (ADR-0001 job_runs, daily_report-market-split 재발)
- **exact-count 배치 단언이 여러 테스트 파일에 흩어짐**(task#136): `backend/tests/test_batches_router.py`, `test_batch_market_split.py`, `test_macro_signals_batch.py`, `test_report_router.py`, `test_stocks_router.py`, `test_admin_router.py`, `test_admin_users_perms_batch.py`. id 추가/제거 시 `grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/`로 전수.
- **심볼 제거/개명이 mock patch 타깃을 파일 불문 깨뜨림**(task#136): `grep -rn "모듈경로.심볼" backend/tests/`. 예: digest_service에서 `yf` import 제거 시 다른 파일(`test_disclosure_endpoint_digest`)의 `services.digest_service.yf.Ticker` patch가 `ModuleNotFoundError`.
- **비-additive 응답 reshape(배열→객체)는 모든 프론트 소비처 전수 grep**: `grep -rn '<엔드포인트>' frontend/src/`. 독립 fetcher(예: `Analytics.jsx`가 훅과 별개로 `/api/stocks/dashboard` 직접 fetch)까지. 가능하면 additive 선호(task#52).
- **additive read 추가가 `mock.call_args`(마지막 호출) 오염**(task#66/#67): 기존 단언을 `call_args_list[i].kwargs`로 마이그레이션, 신규 호출은 `if <조건>:`로 입력 비면 생략, 신규 테스트는 `call_count`로 시퀀스 고정.
- **auth `Depends` 추가가 자체-app 테스트 401/403로 깨뜨림**(task#108): 다수 테스트가 conftest `client`가 아니라 모듈 상단 `FastAPI()`를 직접 만들어 `app.dependency_overrides`로 우회(`test_stocks_router.py`·`test_consensus_router.py`). 새 의존성 override 추가 + 무인증 거부는 override 없는 fresh app으로 별도 검증(`backend/tests/test_security_auth_gaps.py` 패턴).
- **엔드포인트 존재 drift는 자동검출**: `backend/tests/test_api_doc_sync.py`(라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md` 헤더 대조, task#99). 단 요청/응답 스키마·인증 게이팅 동기는 수동 DoD.
- **`PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 *먼저* 등록**(FastAPI가 `enrich`를 ticker로 라우팅 방지).

---

## 7. 신규 DB 컬럼 배포 함정 (ADR-0006)

- **`app_schema.sql`만 고치면 라이브 DB에 반영 안 됨** — 스키마 파일은 신규 설치용, 라이브는 기동 idempotent 마이그레이션만 탐. **`backend/main.py` `_migrate`에 `ADD COLUMN IF NOT EXISTS`를 쌍으로 추가 필수**(약 39행부터). 한쪽만 고치면 배포 직후 그 컬럼 INSERT/SELECT가 컬럼 부재로 깨짐(`stock_recommendations.name` 파손 직전, task#130). 완료기준에 두 파일 쌍 명시.

---

## 8. 로컬 `.venv` ≠ Docker 의존성

- **`lxml`은 `requirements.txt`·Docker엔 있지만 로컬 `backend/.venv`엔 없다.** 로컬 pytest로 검증할 HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 stdlib **`BeautifulSoup(html, "html.parser")`**. 해당 코드: `backend/services/market_indicators/indices.py`(Shiller CAPE multpl.com 크롤), `backend/services/backlog.py`(document.xml), `backend/services/agm.py`.

---

## 9. 문서 동기화 부채 (DoD)

- **API 변경 시 `API_SPEC.md` + `CLAUDE_COWORK_API.md` 둘 다** 갱신. 한쪽만 고치면 Cowork/소비자가 stale 명세로 호출.
- **기능 표면 변경 시 `README.md` 해당 절도** 같은 PR에서(화면구성·env·스택·아키텍처·배치). README는 overview 레벨 — 엔드포인트 세부는 명세서 2개에만.

---

## 10. 배치/성능 관심사

- **배치-백킹 뷰(랭킹·KR 업종 모멘텀)는 외부 API를 요청·기동 경로에서 라이브 호출 금지** — 배치가 사전계산해 `market_cache`/테이블 저장, 요청은 저장값만 read(요청당 N콜 직렬=수초 지연, task#50).
- **외부 fetch 실패를 조용히 삼키지 말 것**(silent except는 진단 불가, task#48 `_fetch_one_sector` all-None 박제). **빈/all-None을 캐시에 박제 금지**(전부 None이면 save 생략·직전값 유지). *실패 클래스(all-None)*를 가드해야 근본원인 미상이어도 재발 차단. 기동 시드: `_seed_*_if_empty`(랭킹·kr_sector).
- **배치 ThreadPool 워커 ≤ DB 풀 사이즈**(수급 스크리닝 교훈) — 대시보드 콜드 풀 경합(§3)의 근원.
- **캘린더 KR 실적발표일은 yfinance `.KS`/`.KQ`가 유일 forward 소스** — `backend/routers/calendar.py` `_collect_earnings`는 `_yf_sym(ticker, market, exchange)`로 접미사 붙여야 함(raw ticker면 KR 0건). Naver·DART 모두 forward 미제공(task#121).
- **배치 fetch 소스 변경 시 `batch_registry`의 `source` 갱신**(DoD) — `source`=fetch 출처 ≠ `usage`=소비 UI.

---

## 11. 보안·인증 관심사

- **admin `scope=all` 리포트 목록은 비소유 종목에도 `category`를 붙임**(`backend/routers/report.py` `_mk_entry`) — category로만 게이트된 관리 버튼(수정·승격·삭제)이 남의 종목에 노출되면 user-scoped 핸들러가 **404로 조용히 깨짐**. **액션 버튼 가시성은 category가 아니라 `is_mine`으로 게이트**(`frontend/src/components/reports/StockActions.jsx` — 단일 컴포넌트로 통합, 두 렌더러 중복 제거 task#103). 교차-사용자 동작은 `/api/admin/*` 전용(`require_admin`).
- **auth 의존성**: `get_current_user`/`require_admin`/`require_admin_or_api_key`. admin만 리포트 생성·Guru 크롤·백필. `user_menu_permissions`로 메뉴 표시 제어(`admin.py` `ALL_MENUS`).
- **API 키 env**(값 인용 금지, 이름만): `.env.docker`에 `POSTGRES_PASSWORD`·`JWT_SECRET`·`SESSION_SECRET`·OAuth·`FRED_API_KEY`·`KOFIA_API_KEY`·`DART_API_KEY`·`KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`·`KIS_APP_KEY`/`KIS_APP_SECRET`. `KITA_API_KEY`는 실제로 **관세청** 키(미설정 시 UN Comtrade 폴백). `ANTHROPIC_API_KEY`는 남아있으나 현재 백엔드 미사용(백엔드에 LLM 호출 없음 — AI 분석은 외부 Cowork).
- **키 미설정 = 안전 기본값(휴면)**: KIS `configured()` False면 dormant, KOFIA/DART 미설정 시 해당 수집 실패지만 무해. KIS는 발급 1분당 1회(EGW00133) 강제 재발급 60s 가드(`backend/services/kis/client.py`).

---

## 12. KR UI 색 관례 함정

- 이 앱은 `--up`=빨강(상승)·`--down`=파랑(하락, `frontend/src/styles/tokens.css`)이라 `.badge--success`=빨강·`.badge--danger`=파랑(`frontend/src/components/ui/Badge.css`). **의미 상태 배지(수급 밴드 등)에 success/danger 쓰면 KR 가격색으로 박혀 Western 의도와 반전**(수급 배지 우호=빨·경계=파 버그, b288f394). 의미 배지는 `frontend/src/components/ui/SupplyBadge.jsx`처럼 전용 색 명시. `warning` 변형은 토큰 미정의로 현재 깨져 있음.
- **KR 단위 포매팅**: `frontend/src/components/market/marketUtils.jsx` `krFmt`는 입력을 '억원' 단위 가정 — 원은 `/1e8` 변환 후, 주(count)엔 부적합. raw 원/주를 그대로 넘기면 1e8배 오표기(공매도 "35조경원" 사례 f9594f2b).
- **yfinance 퍼센트는 소수분수**(`shortPercentOfFloat` 0.0098=0.98%, `pctHeld`, `dividendYield` 등) — 표시 ×100, API_SPEC 예시·fixture도 분수 스케일로(task#122/#123).

---

## 13. 외부데이터 증상은 라이브 프로브 선행 (오진 방지)

- **"다른 지표는 다 나오는데 RSI만 빈" = fetch 실패가 아니라 히스토리 부족일 수 있다**(task#126): RSI(14봉)는 상장 <14거래일 신규 종목에서 전부 NaN(EMA·52주·HV·매물대는 짧은 히스토리서도 값 나옴). **자연 해소**이므로 코드 버그 단정 금지. 진단: `docker exec -i portfolion-backend-1 python -`로 `yf.Ticker(t).history(period="1y")` 행수 + `indicators.calc_rsi(...).notna().sum()` 확인(행수<14=히스토리 부족 vs 0행=fetch 실패). 프론트: RSI 전무 시 `VolumeRsiSnapshot` 폴백, 생기면 `RsiTable`(`ReportDetailTabs` `hasRsi` 분기).
- **KR 시세/차트 소스 스케일 어긋남**: 리포트 현재가 마커는 `get_quote_kr`(키움 ka10001), 매물대/RSI는 `get_history_df`(키움 ka10081 일봉) — 다른 TR이라 한쪽만 액면조정되면 최대 5배 어긋나 "차트 깨짐"처럼 보임. 표시 버그가 아니라 박제 price 값 자체를 의심(`backend/services/market/kr.py`).

---

## 14. 파싱/재적재 UAT 관심사

- **수주잔고/데이터 파싱 변경은 배포 후 전 종목 재적재 UAT 필수** — fixture 전부 통과해도 운영 재적재가 fixture에 없던 케이스(외화 `(단위:USD천)`, 단위 캡션 줄바꿈 분리, 회사컬럼 표)를 잡음. **단위 캡션 파싱 실패 시 '기본값(억원) 폴백'은 ×100 대형 오저장** → 추출 실패는 기본값이 아니라 pending(누락)으로('wrong < missing'). `backend/services/backlog.py`(ADR-0002/0003/0004/0005).
- **DART list.json은 `pblntf_ty`를 echo 안 함** → "단일 호출 후 필터" 불가, 유형 A·B·C·D 개별 호출(종목당 4콜). AGM은 반대로 `pblntf_ty` *미지정* 호출로만 발견(`backend/services/agm.py` self-insert). 주총 회의일은 filing date가 아니라 document.xml 본문(2전략 파싱). 증분은 최신 AGM rcept_no 해결 시에만 fetch 스킵(티커당 스킵으로 만들면 연례 주총 영영 재fetch 안 됨, task#120).

---

## 부록: CLAUDE.md 경로 정정

- CLAUDE.md는 `backend/scheduler/batch_registry.py`로 표기하나 **실제 위치는 `backend/services/batch_registry.py`**. `backend/scheduler/`는 `__init__.py`·`jobs.py`·`schedule.py`·`_state.py`만 존재.
