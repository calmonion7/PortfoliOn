---
last_mapped_commit: c482aa6811262685f424cb8fb871e8121cf438c6
mapped: 2026-07-02
---

# CONCERNS — 기술 부채·알려진 버그·보안·성능·취약 영역

PortfoliOn 백엔드(FastAPI)·프론트엔드(React)의 구현 레벨 우려 지도. 각 항목은 실제 `file:line`과 관련 회고/ADR을 인용한다. *어디가 취약한가*의 지도이며 용어 사전이 아니다(용어는 `CONTEXT.md`).

---

## §1. DB NUMERIC ↔ float 산술 — `float`/`Decimal` TypeError → per-card throw → enrichment 전멸 (수정됨, 클래스로 일반화)

**위치:** `backend/routers/stocks.py:382-388` (카드 빌더의 배당 수익 계산).

`avg_cost`/`quantity`는 PostgreSQL **NUMERIC** → Python `Decimal`, `annual_div`는 배당 스토어의 `float`. 직접 나누면 `TypeError` → per-card enrichment 내부 throw → `_safe` 래퍼(`backend/routers/stocks.py:494`)가 잡아 `_minimal_card`(`:465`) 폴백 → **모든 보유 카드가 조용히 enrichment를 잃는다**(200 응답·형태 유효라 500도 토스트도 없음, task#102 증상의 근본).

**수정(회귀 금지):** 양변 `float(...)` 강제(`backend/routers/stocks.py:385-388`). **진단:** `docker logs portfolion-backend-1 | grep '최소카드 폴백'`(`:499`). **일반화:** NUMERIC 컬럼 값(`Decimal`)과 외부/계산 `float`(yfinance·배당·FX·컨센서스)을 섞는 산술은 어디든 재발 지점 — 경계에서 강제 변환할 것. §3 NaN 트랩과 같은 가족(외부 float가 엄격한 소비자를 만남).

## §2. yfinance 퍼센트 필드 = *소수분수* — 표시 ×100 스케일 (재발성: #122 short%, #123 pct_buy)

yfinance는 퍼센트류를 0~1 분수로 반환(`info.shortPercentOfFloat` 0.0098=0.98%, `pctHeld`/`pctChange`, `% Buy/Sell Shares`, `dividendYield`). 백엔드는 raw 저장(`backend/services/us_supply.py:78,81,119,131`), **프론트가 ×100 표시** 필수.

**방어 지점:** `frontend/src/components/reports/UsSupplySection.jsx:80,123,127`, `UsInsiderSection.jsx:106,112`. 단위테스트는 렌더 %를 단언 안 해 fixture로는 안 보임(§5의 프론트 표시판). 한 필드만 놓치기 쉬움(task#122 short% `0.01%` 실버그, task#123 doc/fixture 퍼센트 오기). **규칙:** % 표시 필드는 *필드별* 스케일 검증 + API_SPEC 예시·fixture도 분수 스케일. 회고: `.forge/retro/2026-06-29-us-supply-demand-signals-1of3.md`, `-2of3.md`.

## §3. 콜드 `/api/stocks/dashboard` DB 풀 경합 — 가드됨, sizing은 미해결

**위치:** 풀 설정 `backend/services/db.py:16-28`; 대시보드 빌드 `backend/routers/stocks.py:484-506`.

카드를 `ThreadPoolExecutor(max_workers=min(len(holdings), 10))`(`:502`)로 fan-out하고 카드당 다중 DB read. psycopg2 `ThreadedConnectionPool`은 고갈 시 **블로킹 대신 `PoolError` throw** → 콜드 첫 호출에 500.

**가드(회귀 금지):** ① 풀 `maxconn=20`(`backend/services/db.py:25`, 최대 동시 워커 수 초과로 상향 — 주석 `:23-24`). ② per-card `_safe`→`_minimal_card`(holdings=N→항상 N카드 불변식, task#102 — §1 마스킹 주의). ③ 응답 전체 `sanitize`(`:506`, §4). ④ 일괄시세 try/except→`{}`(`:486-490`, 이제 로깅). ⑤ 프론트 bounded 재시도 3회+Skeleton(`frontend/src/pages/Portfolio.jsx`).

**미해결:** 풀-동시성 *sizing* 튜닝은 명시적 유예 — 대형 포트폴리오 콜드 스타트 풀 압박은 남아 있다. 같은 공유 풀을 치는 독립 fan-out: 캘린더 15워커(`backend/routers/calendar.py`), `enrich/batch` 8워커(`backend/routers/stocks.py:279`).

## §4. NaN/inf → JSON 500 (starlette `allow_nan=False`) — 재발성 클래스

응답 dict에 NaN/inf가 있으면 직렬화 500. 함정: PostgreSQL `json` 컬럼은 NaN 거부(저장 실패)인데 파일 폴백 `json.dumps`는 통과 → 증상 엇갈림. 외부 시세(yfinance Close, FX usdkrw, 상관계수, CAPE 크롤)가 전형적 소스.

**방어 지점("소스 가드 + sanitize 그물" 2중):** `_usdkrw_rate` isfinite(`backend/routers/stocks.py:322-337`, task#104); `services.utils.sanitize` 그물 — `_build_all`(`stocks.py:506`)·리포트 박제(`backend/services/report_generator.py:328,497`); indices/CAPE(`backend/services/market_indicators/indices.py:25,35,83,89,137-138`); 매크로상관·추천(task#109, 회고 `.forge/retro/2026-06-27-nan-serialization-500-guards.md`).

**규칙:** 외부 시세 float·합산값을 싣는 *모든* 엔드포인트는 소스 isfinite + 응답 sanitize 둘 다(소스 가드만이 행 격리를 보장 — sanitize만으론 NaN 하나가 `total_krw`를 오염). 신규 float 응답 필드는 전부 이 리스크의 새 인스턴스.

## §5. 외부소스 파싱 — fixture-pass / live-fail (최다 재발 클래스, DoD에 라이브 대조 필수)

목킹 단위테스트 전부 green인데 실데이터에서 깨지는 패턴이 가장 신뢰성 있게 반복되는 버그 클래스다.

- **DART `fnlttSinglAcntAll`** (`backend/services/market/kr.py:373-509`): `fs_div` 요청 필수(CFS→OFS 폴백 `:462-470`); 응답은 행별 `fs_div` 미echo라 필터 금지(`:380-395`); 매칭은 `account_id`(`:384-386`), 이자보상 분모는 `이자의 지급`(`_DART_INT`, `:376`). 라이브 UAT에서만 발견(task#117) — silent except가 이 버그를 숨겼었고 지금은 `logger.warning`(`:502,507`).
- **yfinance 라벨 관례** (`backend/services/market/us.py`): `get_*()` 메서드=무공백 라벨 vs 프로퍼티=공백 라벨 — 섞으면 `_yf_val` exact-match가 조용히 None(`us.py:15-16,27`, task#117). `info` 키도 비직관(`priceToSalesTrailing12Months`, task#112). 퍼센트 *스케일*은 §2.
- **Shiller CAPE 크롤** (`backend/services/market_indicators/indices.py:42-108`): FRED에 CAPE 없음 → multpl.com 크롤(`html.parser` — 로컬 `.venv`에 lxml 부재). 레이아웃 드리프트 시 graceful None + 로깅(`:93-94,107-108`).
- **KR backlog `document.xml`** (`backend/services/backlog.py`): 단위 캡션 파싱 실패는 pending 처리("wrong < missing" — 억원 기본값 폴백은 ×100 오저장). ADR-0002/0003.
- **DART list.json 유형 사각** — AGM 공시는 no-type 호출만 발견(`backend/services/disclosures.py`의 유형별 루프는 놓침; task#120).

**규칙:** 외부소스 파싱 슬라이스 DoD에 **라이브 1종목 추출 대조** 포함. 외부데이터 증상은 라이브 프로브 선행(task#126 — RSI 빈 것을 fetch 실패로 오진, 실제는 상장 <14거래일 히스토리 부족).

## §6. KR 시세 소스 글리치 (NXT `_AL` 일시 이상체결) — 방어됨, 구조적으로 취약

키움 SOR 통합코드(`_AL`)가 간헐 이상체결(005930 ~70k vs 실 ~354k)을 반환하고 무가드면 일배치 스냅샷에 박제된다(근본=일시 글리치의 동결, task#94). 2중 가드 존재, 어느 쪽도 완전하진 않다:

- **가드 A(라이브 대시보드 다수결):** `_corroborated_pick`(`backend/services/market/kr.py:131`) 2-of-N 합의(±2x), `_kr_pick_basic`(`:185`) lazy escalation(불일치 시 KIS·Naver 추가 최대 4피드), degenerate `_kr_pick_degenerate_lazy`(`:166`)·`_price_sane`(`:113`). 리포트 경로 `_kr_pick_regular`(`:144`)는 다수결 미적용.
- **가드 B(리포트 박제 게이트):** `backend/services/report_generator.py:285-325` — 박제 전 독립 ref 피드(Naver retry-once `:298-307` → KIS 폴백 `:309-313`)와 2x 교차검증. **ref 전무 시 박제 스킵**(`:315-318`, task#118 — "검증 생략·진행" 구멍 봉합).

**잔존 취약성:** ① 가드 B는 KRX 두 TR 동시 글리치(자기일관 오염)에 비면역 — 독립 ref만이 잡는다(task#101, `:323`). ② 배포된 fix는 이미 박제된 stale 스냅샷을 소급 치료 못 함(재생성 필요, 재생성 전 라이브 프로브). ③ `kr.py`는 ~15 except 깊이의 정교한 기계 — 피드 우선순위 편집이 조용히 회귀 가능(task#96→98 사례). ADR-0020, 회고 `.forge/retro/2026-06-28-report-bake-gate-multifeed.md` 등.

## §7. FOMC `_FOMC_DATES` — 정적 하드코딩, 연 1회 수동 갱신, 소진 시 무음 미표시

**위치:** `backend/routers/calendar.py:27-35`(목록), `:201-202`(`_get_econ_events` 소비).

커버리지가 ~2027-12에서 끝난다(주석 `:27`). 소진 시 크래시 없이 FOMC 이벤트가 그냥 사라진다(graceful missing — 아무도 눈치 못 채는 실패 모드). 2027 날짜는 잠정치(`:33-34`) — 연준 공식 공표 시 대조 필요. 연례 수동 TODO.

## §8. KOSDAQ yfinance 커버리지 patchy + `_yf_sym`의 KOSDAQ `.KS` 기본값

**위치:** `backend/services/market/format.py:68-72`.

`exchange` 빈 값이면 `.KS` 기본(`:70`) — KOSDAQ 종목이 `.KS`로 잘못 붙어 404 가능. 올바른 `.KQ`여도 yfinance KOSDAQ 커버리지 자체가 patchy. KR 실적 캘린더(task#121, `backend/routers/calendar.py:115-117`)는 yfinance가 *유일한* forward 소스라 폴백 없음 — 일부 KOSDAQ 보유는 실적일 미표시. 잠재 wrong-symbol 소스로 잔존.

## §9. Broad `except` 무음 삼킴 — 백엔드·프론트 모두 대부분 로깅화, 잔재 있음

**백엔드(commit `40662f15`, task#127/#128):** 28파일 ~77개 broad except가 `logger.warning` 후 폴백으로 전환(LOG-ONLY, 제어 흐름 불변). `routers/{analytics,batches,events,report,stocks}.py`, `services/market/{__init__,kr,us}.py`, `market_indicators/*` 8종, `report_generator.py`(9), `us_supply.py` 등. 이 파일들의 외부 fetch/파싱 실패는 이제 로그로 진단 가능.

**프론트(commit `1f7de649`, task#129):** 실패-은폐 7건에 `console.warn` — `usePortfolioData.js`의 dashboard(`:40`)·초기시세(`:28`)·FX(`:84`)·digest(`:89`) 등. task#102의 "헤더 N·그리드 빈" silent catch가 이제 로깅된다.

**여전히 무음(의도 포함):**
- `usePortfolioData.js:62` `refreshLivePrices` catch — 폴링이라 다음 틱 재시도 전제의 의도적 무음(주석 있음). `.catch(() => {})` 잔존: `App.jsx`, `utils/analytics.js`, `usePortfolioData.js:34`(캐시 삭제), `Calendar.jsx`, `Ranking.jsx`.
- `backend/main.py:35-36` `_warm_market_cache` 기동 warm — `except: pass` 잔존(28파일 목록 외).
- 스윕 목록 외 broad except 보유 백엔드 파일: `services/{kr_sector_service,insider_trades,backlog,agm,dividends,ranking_service,leverage_service,disclosures,guru_scraper,job_runs}.py`(job_runs는 텔레메트리 설계상 허용).
- **신규 추천 엔진은 다른 관례** — `services/recommendation/funnel.py`·`universe.py`는 `logger.warning`이 아니라 `print(..., file=sys.stderr)`로 로깅(무음은 아니나 §9 스윕 컨벤션과 불일치; `scheduler/jobs.py:343-344` 래퍼도 동일).
- 의도적 narrow except(`except (ValueError, TypeError, KeyError)`)·재raise(`db.py:37-39`)·retry 블록은 설계상 유지.

**배치-fetch 안티패턴(별도):** 배치-백킹 뷰는 fetch 실패 무음 삼킴 금지 + 빈/all-None 결과 캐시 박제 금지(task#48→49→50, `CLAUDE.md`).

## §10. 추천 깔때기 (ADR-0021 개정) — 러닝타임·초회 비용·사이드이펙트 미문서·테스트 위생

**Stage-1 개정으로 배치 러닝타임 수 배 증가 리스크.** `_screen_candidates`(`backend/services/recommendation/funnel.py:40-83`)가 US 전량(S&P500 ~503) + 추적종목 무조건 통과로 개정돼 Stage-2 후보 **~250→~700**(ADR-0021 트레이드오프 명시 수용). 후보당 히스토리 fetch + 결측분 목표가 fetch가 붙으므로 `recommendation_us` 러닝타임이 수 배로 는다. **관찰:** `run_recommendation_batch`의 elapsed 로그(`funnel.py:461-466`, `universe=/candidates=/scored=/low_liquidity=/elapsed=`). **롤백 다이얼:** 허용 불가 수준이면 K 컷 재도입(`CANDIDATE_TOP_K`, `funnel.py:28` — 현재 KR 비추적에만 적용). 근거: `.forge/adr/0021-recommendation-funnel-coverage-repair.md`.

**첫 US 재계산의 초회 fetch 비용.** ① 이름: `_fetch_yf_name`(`funnel.py:273-285`)이 후보당 `yf.Ticker(t).info`로 shortName 1회 fetch — `_load_stored_names` carry(`:262-270`) 덕에 사실상 첫 배치에만 발생하나, 첫 배치는 미확보 US 전량이라 느릴 수 있다(주석 `:277` "필요 시 batch Ticker([...])" 업그레이드 경로). ② 목표가: `_backfill_us_consensus`(`:311-336`)가 정본 없는 US 후보마다 yfinance 목표가 fetch+mart 재계산 — 역시 초회 재계산에 집중.

**`batch_registry`의 `recommendation_us`에 mart-write 사이드이펙트 미문서.** `_backfill_us_consensus`가 `consensus_pipeline.upsert_raw_reports`+`refresh_mart`로 **`daily_consensus_mart`에 쓴다**(ADR-0021 §3 "정본 일원화의 의도된 효과" — 리포트 등 다른 mart 소비처가 미추적 US 목표가를 보게 됨). 그러나 `backend/services/batch_registry.py:388-402`의 `recommendation_us` 항목은 `source: ["yfinance", "dataroma"]`·`usage: ["추천 탭"]`뿐 — 쓰기 사이드이펙트가 배치 현황 표면에 드러나지 않는다. 문서화 부채(registry 필드 또는 label/desc에 반영할 것).

**테스트 위생 잔재물:**
- `backend/tests/test_recommendation_universe.py:162-184` `test_fetch_guru_tickers_returns_name_map` — **dead test**: `patch.object(..., wraps=lambda: {...})`로 대상 자체를 람다로 치환 후 호출 → mock 자신의 반환값을 단언(실 구현 검증 0, `managers` fixture도 미사용).
- `backend/tests/test_recommendation_funnel.py:380-383` — **noop `with patch.object(F, "_backfill_us_consensus") as _spy: pass` 블록**(폐기된 접근의 잔해; 실검증은 `:389-395`에서 별도 수행, `_spy` 미사용).
- `_backfill_us_consensus` docstring-구현 미세 불일치: docstring(`funnel.py:317`)은 "실패는 stderr 로깅 후 결측 유지(graceful)"라 하나 `consensus.get_asof` 호출(`:327`)은 try 밖 — get_asof 예외는 외부 핸들러(`_enrich_one`의 outer catch `:361-363`)에 의존. outer catch는 그 외 경로에선 도달 불가(inner catch `:334-336`와 중복)라 미세 redundancy.

## §11. 기타 취약/부채 지점

- **`_get_econ_events` 인라인 FRED fetch** (`backend/routers/calendar.py:193-197,219-222`) — 캐시 미스마다 라이브 FRED. docstring이 업그레이드 경로 명시(rate-limit 문제화 시 market_cache 배치화).
- **계절성 배치 재발 트랩** — AGM 배치가 "해결된 주총 하나라도 있으면 스킵"이었으면 이듬해 주총이 영영 미fetch(task#120에서 최신 rcept_no 기준으로 수정). 시계열/계절 배치는 "시즌 2에도 도는가" 렌즈로 리뷰(§7 FOMC 소진과 같은 모양).
- **종목명 dual-source 캐시 결합** — `tickers.name` vs `snapshots.data.name` 둘 다 갱신 + `cache.invalidate(ticker)`/`invalidate_list()` 필수(`CLAUDE.md` Gotchas).
- **이름 백필 무재시도 스킵** — `POST /api/stocks/names/backfill`은 일시 시세 실패 시 조용히 스킵(`updated:0`이면 재실행, task#77/#88).
- **테스트 import 경로 불일치** — `from backend.services...` vs `from services...` 혼재 footgun(대부분 `be9ae946`서 수정, 재발성).
- **기동 인라인 마이그레이션** — `backend/main.py` `_migrate`가 부팅마다 idempotent DDL(ADR-0006; 실패는 print — 로그 안 읽으면 스키마 드리프트 마스킹). 신규 DB 컬럼은 `app_schema.sql`+`_migrate` 쌍 필수(task#130 회고, commit `c482aa68`).
- **KIS 백업 시세 소스는 config-휴면** — `backend/services/kis/`는 키 미주입 시 `configured()` False로 전체 폴백 체인 비활성(ADR-0011 의도) — 키 주입 전까지 프로덕션 미검증 경로.
- **US 수급/내부자 스냅샷은 배치로만 채워짐** — `us_supply_fetch` 실행 전 해당 섹션 빈 렌더(검증 유예-by-design).
