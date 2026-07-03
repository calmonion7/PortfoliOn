---
last_mapped_commit: 9de05a1ee9f11c92f58807adeff3dcc2cab63550
mapped: 2026-07-03
---

# CONCERNS — 기술 부채·알려진 버그·보안·성능·취약 영역

PortfoliOn 백엔드(FastAPI)·프론트엔드(React)의 구현 레벨 우려 지도. 각 항목은 실제 `file:line`과 관련 회고/ADR을 인용한다. *어디가 취약한가*의 지도이며 용어 사전이 아니다(용어는 `CONTEXT.md`).

> **이번 사이클(c482aa68→9de05a1, task#132~138)에서 해소된 항목**: 추천 enriched 판정 라이브 버그(#132, `backend/routers/recommendations.py:26-37` — 정본을 `tickers.enriched_at`으로 교체), US 랭킹 wipe-on-empty·escalation eager 호출 비격리·공공데이터 빈응답 AttributeError·mutation 후 live_prices stale·OAuth 코드 누수·수동 job_runs 시장 오기록(#133), 프론트 무한 스피너·재시도 소진 영구 Skeleton·유령 폴링·pwaAssets 잔재(#134), upsert/조회 N+1 8곳(#135, `db.execute_many`·`consensus.get_asof_batch`), 요청경로 라이브 외부호출 2곳(#136, US 섹터 배치-백킹·다이제스트 시세 배치화+저장 FX), degenerate 중복 HTTP 2콜(#137), 빈이름 클로버·마트 0덮어쓰기·Analytics 고정환율·외화 unit 오라벨·consensus_pipeline print(#138). 버그리포트(`.forge/bug-report.md`) 42건 중 41건 소진 — **잔존 1건은 §11의 #28**.

---

## §1. DB NUMERIC ↔ float 산술 — `float`/`Decimal` TypeError → per-card throw → enrichment 전멸 (수정됨, 클래스로 일반화)

**위치:** `backend/routers/stocks.py:382-388` (카드 빌더의 배당 수익 계산).

`avg_cost`/`quantity`는 PostgreSQL **NUMERIC** → Python `Decimal`, `annual_div`는 배당 스토어의 `float`. 직접 나누면 `TypeError` → per-card enrichment 내부 throw → `_safe` 래퍼(`backend/routers/stocks.py:494`)가 잡아 `_minimal_card`(`:465`) 폴백 → **모든 보유 카드가 조용히 enrichment를 잃는다**(200 응답·형태 유효라 500도 토스트도 없음, task#102 증상의 근본).

**수정(회귀 금지):** 양변 `float(...)` 강제. **진단:** `docker logs portfolion-backend-1 | grep '최소카드 폴백'`(`:499` — 이 stderr print가 유일한 단서; minimal-card 가드가 근본원인을 마스킹). **일반화:** NUMERIC 컬럼 값(`Decimal`)과 외부/계산 `float`(yfinance·배당·FX·컨센서스)을 섞는 산술은 어디든 재발 지점 — 경계에서 강제 변환할 것. §4 NaN 트랩과 같은 가족(외부 float가 엄격한 소비자를 만남). 회귀 테스트는 반드시 **Decimal** fixture로(float fixture는 통과해버림).

## §2. yfinance 퍼센트 필드 = *소수분수* — 표시 ×100 스케일 (재발성: #122 short%, #123 pct_buy)

yfinance는 퍼센트류를 0~1 분수로 반환(`info.shortPercentOfFloat` 0.0098=0.98%, `pctHeld`/`pctChange`, `% Buy/Sell Shares`, `dividendYield`). 백엔드는 raw 저장(`backend/services/us_supply.py:80,83,119,129,131`), **프론트가 ×100 표시** 필수.

**방어 지점:** `frontend/src/components/reports/UsSupplySection.jsx:80,123,127`, `UsInsiderSection.jsx:106,112`. 단위테스트는 렌더 %를 단언 안 해 fixture로는 안 보임(§5의 프론트 표시판). 한 필드만 놓치기 쉬움(task#122 short% `0.01%` 실버그, task#123 doc/fixture 퍼센트 오기). **규칙:** % 표시 필드는 *필드별* 스케일 검증 + API_SPEC 예시·fixture도 분수 스케일.

## §3. 콜드 `/api/stocks/dashboard` DB 풀 경합 — 가드됨, sizing은 미해결 + 주석 드리프트

**위치:** 풀 설정 `backend/services/db.py:22-25`(minconn=1, maxconn=20); 대시보드 빌드 `backend/routers/stocks.py:484-506`.

카드를 `ThreadPoolExecutor(max_workers=min(len(holdings), 10))`(`:502`)로 fan-out하고 카드당 다중 DB read. psycopg2 `ThreadedConnectionPool`은 고갈 시 **블로킹 대신 `PoolError` throw** → 콜드 첫 호출에 500이던 이력(task#102).

**가드(회귀 금지):** ① 풀 `maxconn=20`. ② per-card `_safe`→`_minimal_card`(holdings=N→항상 N카드 불변식 — §1 마스킹 주의). ③ 응답 전체 `sanitize`(`:506`, §4). ④ 일괄시세 try/except→`{}` 로깅. ⑤ 프론트: bounded 재시도 3회+Skeleton에 더해 **재시도 소진 시 에러 안내+「다시 시도」 버튼**(task#134, `frontend/src/pages/Portfolio.jsx:50-60,85-94` — heal 카운터 ref→state 전환으로 소진 판정 레이스 제거).

**미해결/신규:** ① 풀-동시성 *sizing* 튜닝은 명시적 유예 — 같은 공유 풀을 치는 독립 fan-out: 캘린더 15워커(`backend/routers/calendar.py:93`), `enrich/batch` 8워커(`backend/routers/stocks.py:279`). ② **주석 드리프트:** `backend/routers/stocks.py:278` 주석이 "DB 풀(maxconn=10)"이라 하나 실제는 `db.py:25` maxconn=20 — 풀 재튜닝 시 오판 소지. ③ task#135의 `db.execute_many`(`backend/services/db.py:60-69`, psycopg2 `execute_batch` 단일 커넥션)가 upsert 4곳(investor/short_sell/disclosures/insider)의 행별 커넥션 회전을 제거해 배치 경로의 풀 압박은 완화됨.

## §4. NaN/inf → JSON 500 (starlette `allow_nan=False`) — 재발성 클래스

응답 dict에 NaN/inf가 있으면 직렬화 500. 함정: PostgreSQL `json` 컬럼은 NaN 거부(저장 실패)인데 파일 폴백 `json.dumps`는 통과 → 증상 엇갈림. 외부 시세(yfinance Close, FX usdkrw, 상관계수, CAPE 크롤)가 전형적 소스.

**방어 지점("소스 가드 + sanitize 그물" 2중):** `_usdkrw_rate` isfinite(`backend/routers/stocks.py:322-337`, task#104); `services.utils.sanitize` 그물 — `_build_all`(`stocks.py:506`)·리포트 박제(`backend/services/report_generator.py`); indices/CAPE(`backend/services/market_indicators/indices.py`); 매크로상관·추천(task#109); 다이제스트 시세 배치화 시에도 유지(`backend/services/digest_service.py:65,74` isfinite — task#136 개작에도 가드 보존됨).

**규칙:** 외부 시세 float·합산값을 싣는 *모든* 엔드포인트는 소스 isfinite + 응답 sanitize 둘 다(소스 가드만이 행 격리를 보장 — sanitize만으론 NaN 하나가 `total_krw`를 오염). 신규 float 응답 필드는 전부 이 리스크의 새 인스턴스.

## §5. 외부소스 파싱·신규 SQL — fixture-pass / live-fail (최다 재발 클래스, DoD에 라이브 대조 필수)

목킹 단위테스트 전부 green인데 실데이터/라이브 DB에서 깨지는 패턴이 가장 신뢰성 있게 반복되는 버그 클래스다.

- **DART `fnlttSinglAcntAll`** (`backend/services/market/kr.py:393-`): `fs_div` 요청 필수(CFS→OFS 폴백); 응답은 행별 `fs_div` 미echo라 필터 금지; 매칭은 `account_id`, 이자보상 분모는 `이자의 지급`. 라이브 UAT에서만 발견(task#117).
- **yfinance 라벨 관례** (`backend/services/market/us.py`): `get_*()` 메서드=무공백 라벨 vs 프로퍼티=공백 라벨 — 섞으면 `_yf_val` exact-match가 조용히 None(task#117). 현금흐름은 반드시 `t.get_cashflow()` 메서드로. `info` 키도 비직관(`priceToSalesTrailing12Months`). 퍼센트 *스케일*은 §2.
- **신규/개작 SQL의 query-mock 블라인드 (task#135, 신규 멤버):** ① uuid 컬럼 `= ANY(%s)`에 str 리스트 → text[] → `operator does not exist: uuid = text` 라이브 즉사(단건 `= %s`는 암묵 캐스트로 *동작하던* 것이 배열화에서 깨짐) — `ANY(%s::uuid[])` 명시(`backend/routers/admin.py:32`). ② VALUES 행 나열을 바깥 괄호로 감싸면 record 1행화 — `backend/services/consensus.py:81` `_values_placeholder` 주석+`test_values_placeholder_shape`가 형태를 못박음. 둘 다 pytest green 상태의 배포-즉사 버그였다. **SQL 신설/단건→배치 개작 슬라이스는 배포 후 라이브 스모크를 DoD에.**
- **Shiller CAPE 크롤** (`backend/services/market_indicators/indices.py`): multpl.com 크롤(`html.parser` — 로컬 `.venv`에 lxml 부재). 레이아웃 드리프트 시 graceful None + 로깅.
- **KR backlog `document.xml`** (`backend/services/backlog.py`·`backlog_parser.py`): 단위 캡션 파싱 실패는 pending 처리("wrong < missing" — 억원 기본값 폴백은 ×100 오저장). 외화/비KRW 캡션은 `_table_unit`이 `'기타'` 반환(`backlog_parser.py:211-219`, task#138 #29 — pending unit '억원' 오라벨 수정). ADR-0002/0003.
- **DART list.json 유형 사각** — AGM 공시는 no-type 호출만 발견(`backend/services/disclosures.py`의 유형별 루프는 놓침; task#120).
- **tz-naive/aware 정렬** — 키움 daily_df(tz-naive) ↔ yfinance `^KS11`(tz-aware) `pd.concat` TypeError → broad except가 삼키면 KR beta가 조용히 None(task#116). KR series×yfinance series 계산은 한쪽 `tz_localize(None)` 필수.

**규칙:** 외부소스 파싱 슬라이스 DoD에 **라이브 1종목 추출 대조** 포함. 외부데이터 증상은 라이브 프로브 선행(task#126 — RSI 빈 것을 fetch 실패로 오진, 실제는 상장 <14거래일 히스토리 부족).

## §6. KR 시세 소스 글리치 (NXT `_AL` 일시 이상체결) — 방어 강화됨, 구조적으로 취약

키움 SOR 통합코드(`_AL`)가 간헐 이상체결(005930 ~70k vs 실 ~354k)을 반환하고 무가드면 일배치 스냅샷에 박제된다(근본=일시 글리치의 동결, task#94). 2중 가드, 어느 쪽도 완전하진 않다:

- **가드 A(라이브 대시보드 다수결):** `_corroborated_pick`(`backend/services/market/kr.py:131`) 2-of-N 합의(±2x), `_kr_pick_basic`(`:190`) lazy escalation(불일치 시 KIS·Naver 추가 최대 4피드). **task#133:** escalation의 KIS/Naver 호출이 per-feed try/except로 격리(`:218-226`) — 한 피드 예외가 4피드 합의를 중단시키던 eager 튜플 리터럴 수정. **task#137:** 합의 불가 → degenerate 폴백 시 escalation이 이미 받은 KIS/Naver 결과를 재사용(`:235`, `_kr_pick_degenerate_lazy(:166)`의 kis/naver 파라미터) — 중복 HTTP 2콜 제거, outage 경로(kfeeds<2)는 기존 lazy 유지. 리포트 경로 `_kr_pick_regular`(`:144`)는 다수결 미적용(`_price_sane(:113)` self-check만).
- **가드 B(리포트 박제 게이트):** `backend/services/report_generator.py:289-326` — 박제 전 독립 ref 피드(Naver retry-once → KIS 폴백)와 2x 교차검증. **ref 전무 시 박제 스킵**(`:314-318`, task#118 — "검증 생략·진행" 구멍 봉합).

**잔존 취약성:** ① 가드 B는 KRX 두 TR 동시 글리치(자기일관 오염)에 비면역 — 독립 ref만이 잡는다(task#101). ② 배포된 fix는 이미 박제된 stale 스냅샷을 소급 치료 못 함(재생성 필요, 재생성 전 라이브 프로브). ③ `kr.py`는 다층 except·우선순위 체인의 정교한 기계 — 피드 우선순위 편집이 조용히 회귀 가능(task#96→98→133→137 누적 개보수 이력 자체가 증거). ADR-0020.

## §7. FOMC `_FOMC_DATES` — 정적 하드코딩, 연 1회 수동 갱신, 소진 시 무음 미표시

**위치:** `backend/routers/calendar.py:27-35`(목록), `:193-202`(`_get_econ_events` 소비).

커버리지가 ~2027-12에서 끝난다(주석 `:27`). 소진 시 크래시 없이 FOMC 이벤트가 그냥 사라진다(graceful missing — 아무도 눈치 못 채는 실패 모드). 2027 날짜는 잠정치 — 연준 공식 공표 시 대조 필요. 연례 수동 TODO.

## §8. KOSDAQ yfinance 커버리지 patchy + `_yf_sym`의 KOSDAQ `.KS` 기본값

**위치:** `backend/services/market/format.py:68-72`.

`exchange` 빈 값이면 `.KS` 기본(`:70`) — KOSDAQ 종목이 `.KS`로 잘못 붙어 404 가능. 올바른 `.KQ`여도 yfinance KOSDAQ 커버리지 자체가 patchy. KR 실적 캘린더(task#121)는 yfinance가 *유일한* forward 소스라 폴백 없음 — 일부 KOSDAQ 보유는 실적일 미표시. 잠재 wrong-symbol 소스로 잔존.

## §9. 무음 삼킴·로깅 컨벤션 — 대부분 로깅화, `print` 관례 혼재 잔존

**백엔드 broad except(task#127/#128):** 28파일 ~77개가 `logger.warning` 후 폴백으로 전환. **task#138 #40:** `backend/services/consensus_pipeline.py`의 print 6곳도 logger화. **task#133:** 공공데이터 빈응답(`{"items": ""}`) AttributeError를 lending/leverage에서 가드(`backend/services/lending_service.py:19-20`·`leverage_service.py:38-39`), US 랭킹 빈 quotes는 RuntimeError raise로 wipe-on-empty 차단(`backend/services/ranking_service.py:142-143` — KR 미러).

**프론트(task#129·#134):** 실패-은폐에 `console.warn`(`frontend/src/hooks/usePortfolioData.js:30,32,48,93,98`) + `fetchAll` try/finally로 `/api/portfolio` 실패 시 무한 스피너 차단(hasFetched는 성공 시에만, `:25,33`). **여전히 무음(대부분 의도):** `refreshLivePrices` catch(`:71-73`, 폴링 다음 틱 재시도 — 주석 있음), `.catch(() => {})` 잔존 5곳 — `App.jsx:27`, `utils/analytics.js:11`, `usePortfolioData.js:41`(캐시 삭제), `Calendar.jsx:211`(인접월 프리페치), `Ranking.jsx:157`.

**`print` 관례 혼재(부채):** 백엔드에 여전히 **~118개 print / 20파일** — `backend/scheduler/jobs.py`(전 배치 성공/실패 로그), `backend/services/report_generator.py`(박제 게이트 loud print), `backend/routers/stocks.py:499`(최소카드 폴백), `backend/services/recommendation/{funnel,universe}.py`(stderr print 관례), `backend/main.py:45-147`(`_migrate` 실패 print — 로그 안 읽으면 스키마 드리프트 마스킹), 신규 `backend/services/us_sector_service.py:28`. 무음은 아니나 logger 스윕 컨벤션과 불일치 — 일괄 전환은 미착수. `backend/main.py:35` `_warm_market_cache`의 `except: pass`도 잔존.

**배치-fetch 안티패턴(확립된 규칙):** 배치-백킹 뷰는 fetch 실패 무음 삼킴 금지 + 빈/all-None 결과 캐시 박제 금지(task#48→50). 신규 `us_sector_service.refresh()`(`backend/services/us_sector_service.py:15-30`)는 all-None 시 save 생략으로 이 규칙 준수.

## §10. 추천 깔때기 (ADR-0021) — 러닝타임·스로틀 트레이드오프·사이드이펙트 미문서·테스트 위생

**Stage-1 개정 + yfinance 직렬 스로틀로 배치 러닝타임 리스크 중첩.** `_screen_candidates`(`backend/services/recommendation/funnel.py:45`)가 US 전량(S&P500 ~503)+추적종목 무조건 통과로 Stage-2 후보 ~700(ADR-0021 수용). 여기에 **task#132가 `_YF_THROTTLE_S=0.35s` 직렬 스로틀 추가**(`funnel.py:38,283,336` — 이름·목표가 *결측분에만*): rate-limit 방어와 러닝타임의 트레이드오프로, **첫 US 배치(전량 결측)는 이름+목표가 fetch에 수 분 단위 추가** 가능. carry(`_load_stored_names`, `:267`)와 mart 정본 덕에 이후 배치는 결측분만. **관찰:** `run_recommendation_batch` elapsed 로그(`funnel.py:467-471`). **롤백 다이얼:** `CANDIDATE_TOP_K`(`funnel.py:28`, 현재 KR 비추적에만 적용).

**`batch_registry`의 `recommendation_us`에 mart-write 사이드이펙트 여전히 미문서.** `_backfill_us_consensus`(`funnel.py:317`)가 `daily_consensus_mart`에 쓴다(ADR-0021 의도된 효과 — 다른 mart 소비처가 미추적 US 목표가를 보게 됨). 그러나 `backend/services/batch_registry.py:404-417`은 `usage: ["추천 탭"]`·`source: ["yfinance","dataroma"]`뿐 — 배치 현황 표면에 안 드러남. 문서화 부채 잔존.

**enriched 판정은 해소(task#132):** `backend/routers/recommendations.py:26-37`이 `tickers.enriched_at` 배치 1콜로 판정(구 스냅샷 JSON 판정은 항상 False이던 라이브 버그). '이중 저장소 혼동' 클래스의 대표 사례 — 신규 판정 필드는 정본 저장 위치를 기존 소비처 grep으로 확정할 것.

**테스트 위생 잔재(여전):**
- `backend/tests/test_recommendation_universe.py:162-184` — **dead test**: `patch.object(..., wraps=lambda: {...})`로 대상 자체를 치환 후 호출 → mock 자신의 반환값 단언(실 구현 검증 0, `managers` fixture 미사용).
- `backend/tests/test_recommendation_funnel.py:380-383` — **noop `with patch.object(...) as _spy: pass` 블록**(폐기된 접근의 잔해; 실검증은 `:389-395`에서 별도 수행).

## §11. 기타 취약/부채 지점

- **버그리포트 잔존 1건 — #28 (의도적 non-goal, task#138):** `consensus_pipeline.backfill(force=True)`가 DELETE 자동커밋 후 INSERT 루프 — 중단 시 mart 부분 소실 가능(`.forge/bug-report.md` #28). conf=medium·트리거 드묾·backfill 재실행으로 복구 가능해 미수정. 트랜잭션 묶음이 정공법.
- **다이제스트/Analytics FX 폴백 하드코딩 1380** — `backend/services/digest_service.py:34`·`frontend/src/pages/Analytics.jsx`(라이브 `/api/market/fx` 실패 시 1380 폴백, task#136/#138). 저장 FX+라이브 둘 다 실패하는 드문 경우 환율 드리프트 — 크래시보단 낫다는 설계지만 폴백 상수 갱신은 아무도 안 한다.
- **`us_sector_service.py` docstring stale** — `backend/services/us_sector_service.py:5` "요청경로는 후속 슬라이스 소관"이라 하나 `analysis_service.get_sector_momentum`(`backend/services/analysis_service.py:56-66`)이 이미 `load_momentum()` read로 구현됨(같은 task#136 내 완료). 순환참조 회피용 지연 import 쌍(`analysis_service.py:58-60` ↔ `us_sector_service.py:22-24`)은 편집 시 주의.
- **`_get_econ_events` 인라인 FRED fetch** (`backend/routers/calendar.py:193-`) — 캐시 미스마다 라이브 FRED. rate-limit 문제화 시 market_cache 배치화가 업그레이드 경로(요청경로 라이브 외부호출 제거의 마지막 잔존 중 하나).
- **OAuth 코드 저장이 인메모리 dict** — `backend/routers/auth.py:24` `_oauth_codes`. task#133이 만료 sweep 추가(삽입마다 O(n), `:27-31`)로 누수는 막았으나 단일 프로세스 전제(멀티 워커/재기동 시 교환 실패)는 그대로 — 현 배포(단일 uvicorn)에선 문제없음.
- **계절성 배치 재발 트랩** — AGM 배치가 "해결된 주총 하나라도 있으면 스킵"이었으면 이듬해 미fetch(task#120에서 최신 rcept_no 기준으로 수정). 시계열/계절 배치는 "시즌 2에도 도는가" 렌즈로 리뷰(§7 FOMC 소진과 같은 모양).
- **종목명 dual-source 캐시 결합** — `tickers.name` vs `snapshots.data.name` 둘 다 갱신 + `cache.invalidate(ticker)`/`invalidate_list()` 필수. task#138 #2로 `update_ticker_meta`(`backend/services/storage/names.py:61-65`)가 빈/공백/티커동일 이름이면 name 갱신·스냅샷 전파를 생략(클로버 가드의 enrich판).
- **이름 백필 무재시도 스킵** — `POST /api/stocks/names/backfill`은 일시 시세 실패 시 조용히 스킵(`updated:0`이면 재실행, task#77/#88).
- **기동 인라인 마이그레이션** — `backend/main.py:39-152` `_migrate`가 부팅마다 idempotent DDL(ADR-0006; 실패는 print — §9). 신규 DB 컬럼은 `app_schema.sql`+`_migrate` 쌍 필수(task#130).
- **배포 footgun 3종(운영, `CLAUDE.md` 상세):** ① 2분 폴러(`scripts/auto-deploy-poll.sh`)가 `LOCAL != origin/main`이면 양방향 `git reset --hard` — **push 안 한 로컬 커밋도 소실**(task#106 실사례; commit+push 묶음 필수, untracked `.forge/`는 안전). ② self-hosted 러너 재등록 하이잭 — 러너가 타 repo로 넘어가면 잡 `queued→24h cancelled` 무음 미배포(task#105; `gh run list`·runners API로 진단). ③ 백엔드 변경은 폴러/러너 재배포 후에야 라이브(프론트만 `npm run build` 즉시 반영 — 백엔드 의존 기능 시차 주의).
- **모듈 심볼 제거/개명 시 테스트 patch 타깃 전수 grep** — mock 타깃은 주 테스트 파일 밖에도 있다(task#136: digest_service `yf` 제거 시 `test_disclosure_endpoint_digest`가 `services.digest_service.yf.Ticker` patch로 파손). 배치 id *추가* 시에도 count/set 하드코딩 단언 4파일 전수 grep(`test_scheduler_seed`·`test_batch_market_split`·`test_batches_router`·`test_macro_signals_batch`).
- **KIS 백업 시세 소스는 config-휴면** — `backend/services/kis/`는 키 미주입 시 `configured()` False로 폴백 체인 비활성(ADR-0011 의도) — 키 주입 전까지 프로덕션 미검증 경로.
- **US 수급/내부자/섹터 스냅샷은 배치로만 채워짐** — `us_supply_fetch`·`us_sector_fetch`(07:20, task#136 신설) 실행 전 해당 섹션 빈 렌더(검증 유예-by-design; us_sector는 기동 시드 `test_scheduler_us_sector_seed` 참조).
