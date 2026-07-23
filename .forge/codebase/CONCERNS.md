---
last_mapped_commit: 44629f27cfb796dbd2120b7002a99e3d82f7c725
mapped: 2026-07-24
---

# PortfoliOn — 기술부채·리스크 지도 (CONCERNS)

이 문서는 **취약 영역 지도**입니다. 도메인 용어 정의는 `CONTEXT.md`, 코딩 규약은 `CONVENTIONS.md`가 다루며, 여기서는 **어디가 잘 깨지는가·왜 깨지는가·재발 방지 앵커가 어디 있는가**만 구현 사실로 기록합니다. 근거는 프로젝트 `CLAUDE.md` Gotchas·`.forge/adr/`·`.forge/bug-report.md`이며, 파일 경로는 확인된 실경로입니다.

각 항목의 성격 태그: **[live-fail]** fixture 통과·라이브 실패 계열 / **[footgun]** 절차·인프라 함정 / **[data]** 캐시·저장 오염 계열 / **[test]** 테스트 안전망 결함 / **[doc]** 문서 드리프트.

---

## 1. 외부소스 파싱 취약성 (fixture-pass-live-fail) [live-fail]

이 코드베이스의 **최다 재발 버그 클래스**. 단위테스트가 외부 응답을 mock하므로 라벨/구조 편차를 못 잡고, 라이브에서만 드러난다. `CLAUDE.md`가 반복 경고하는 계열 — DoD에 **라이브 1종목 추출 대조**를 넣어야 잡힌다.

- **DART `document.xml` 표 파싱** — 회사별 표 구조 편차가 큼(단위 캡션 백만원/억원, 연결/별도, 라벨 편차: `매출액` vs `매출` vs `영업수익`). 취약 지점:
  - `backend/services/backlog.py` — 수주잔고. 검산(`수주총액−기납품≈잔고` 상대 1%) 실패는 `source='pending'`으로 두는 방어가 있으나, **단위 캡션 파싱 실패 시 '안전한 기본값(억원)' 폴백은 ×100 대형 오저장**을 만든다. 추출 실패는 기본값이 아니라 pending(누락)으로 — 'wrong < missing'.
  - `backend/services/market/kr.py:539` `get_rd_intensity_kr` — task#204에서 `fnlttSinglAcntAll` API로 R&D를 뽑으려다 **라이브 전 섹터 항상 None**(그 API는 4대 재무제표만 주고 판관비를 단일 합계로만 공시). task#209(hunt4 M3)에서 **사업보고서 `document.xml`의 '연구개발비용' 표 직접 파싱**으로 재구현·라이브 UAT 통과(5/5 sane). 분모 라벨은 회사별 상이(`매출액`/`매출`/`영업수익`)라 매칭 확장이 필요했다.
  - `backend/services/agm.py` — 주총 회의일은 filing date가 아니라 `document.xml` 본문에 있고, `소집결의`(XHTML 테이블)와 `소집공고`(자유텍스트, HTML 태그 섞임) 2전략 파싱 필요.
- **DART API 형태 함정** — `fnlttSinglAcntAll`은 `fs_div`가 요청 필수값이고, 요청에 fs_div를 넣으면 응답 행에 `fs_div`를 echo하지 않아 `row.get("fs_div")`로 필터하면 전 행 스킵. 계정은 `account_nm`(표기 변동)이 아닌 `account_id`(XBRL 표준)로 매칭. `list.json`은 `pblntf_ty`를 echo하지 않아 유형별 개별 호출 필요(AGM은 반대로 `pblntf_ty` 미지정 호출로만 발견).
- **yfinance 라벨 불일치** — `get_income_stmt()`/`get_cashflow()` *메서드*(무공백 라벨 `OperatingCashFlow`)와 `.cash_flow` *프로퍼티*(공백 라벨 `Operating Cash Flow`)의 index 라벨이 다르고, `format._yf_val`이 exact 매칭이라 어긋나면 **조용히 None**. `market/us.py`는 get_* 메서드로 통일해야 함.
- **퍼센트 소수분수 스케일** — yfinance `shortPercentOfFloat`·`pctHeld` 등은 0~1 분수(0.0098 = 0.98%). 프론트 ×100 표시 누락·fixture 예시값을 %로 적는 실수가 반복(task#122·#123).
- **재적재 UAT 필수** — 파싱 로직 변경은 배포 후 **전 종목 재적재 UAT**를 DoD에 넣을 것. fixture에 없던 실데이터 케이스(외화 `USD천`, 단위 캡션 줄바꿈 분리, 다중엔티티 표)가 라이브에서만 나온다.

## 2. 시세 정합성·글리치 방어 [live-fail][data]

- **KR 시세 다피드 다수결** — `backend/services/market/kr.py`의 `get_quote_kr(regular=False)`(NXT 라이브)는 독립 피드 2-of-N 다수결(`_kr_pick_basic`/`_corroborated_pick`)로 단일 피드 글리치를 폐기. 키움 NXT→KIS→Naver→키움 KRX 우선순위. 단일 피드 outage·전 피드 합의 불가는 degenerate 자가검증(±30%). ADR-0010.
- **시세 기준 이원화(ADR-0020)** — 리포트 스냅샷=KRX 정규장(`regular=True`), 라이브 대시보드=NXT(`regular=False`). 같은 종목이 리포트(354k)와 대시보드(350.5k)에 ~1% 다르게 보이는 건 **의도된 기준 차**. `client.integrated_code(stk_cd, regular=)` 단일 분기점.
- **박제-시 독립피드 게이트** — `report_generator.generate_report`(KR)가 저장 직전 KRX와 독립인 ref 피드(Naver retry-once→KIS 폴백)로 price·일봉 기준종가를 2x 교차검증, 어긋나거나 ref 전무면 **박제 스킵**(직전 양호 스냅샷 유지). KRX 자기일관 글리치 방어용(task#118).
- **⚠️ "정확히 70000.0" 오진 정정(task#170, ADR-0020 amendment)** — 005930이 *정확히* 70000.0(354k의 1/5)으로 박제된 극단 사례의 실제 원인은 피드 글리치가 아니라 **로컬 pytest가 prod DB에 fixture(`price:70000.0`)를 직접 쓴 오염**이었다. 다수결/박제 게이트 자체는 진짜 글리치 보험으로 유효하나, **라운드 70k가 또 보이면 피드 글리치 전에 테스트 오염부터 의심**하라. §5 참조.
- **KR 시세 소스 ≠ 차트 소스** — 현재가 마커(`get_quote_kr`)와 매물대/RSI(`get_history_df`)는 다른 TR이라 스케일이 어긋날 수 있다. 매물대가 "깨져" 보이면 표시 버그가 아니라 박제된 price 값을 의심.
- **대시보드 500-to-empty 불변식(task#102·#104)** — `GET /api/stocks/dashboard`의 `_build_all`(`backend/routers/stocks.py:627`)은 per-card `_safe`→`_minimal_card` 폴백(`stocks.py:607`,`637`) + 반환 `sanitize`(`stocks.py:649`)로 감싼다. 근본 500은 `_usdkrw_rate`의 NaN이 `if fx is None` 가드를 통과해 US totals=NaN→직렬화 500이었고, `stocks.py:474` `math.isfinite` 가드로 수정. **헤더 N인데 그리드 빈** 증상 → dashboard 빌드 throw + 프론트 silent catch 의심.
- **배당 `float/Decimal` TypeError** — DB NUMERIC(avg_cost·qty)은 Decimal, `stock_dividends`는 float이라 혼합 산술이 TypeError→minimal-card 폴백→enrichment 일괄 blank(500도 안 나 은밀). 회귀 테스트는 반드시 **Decimal** fixture로. DB NUMERIC을 외부 float와 산술하는 경로는 어디든 동일 위험.

## 3. 배포 인프라 푸트건 [footgun]

- **자동배포 폴러가 로컬 변경을 삭제** — `scripts/auto-deploy-poll.sh`가 2분마다 launchd로 돌며 `LOCAL != origin/main`이면(양방향) **`git reset --hard origin/main` 후 `deploy.sh`**(`auto-deploy-poll.sh:35-36` 확인). 메인 체크아웃에서 **커밋 안 한 tracked 편집뿐 아니라 push 안 한 로컬 커밋도 ≤2분에 소실**(task#106 실사례). 코드/문서 변경은 **commit + `git push origin main` 묶어서**. `.forge/` 등 untracked는 reset 대상 아님(안전).
- **러너 격리** — 배포 주 경로는 self-hosted GH Actions 러너(폴백=폴러). PortfoliOn 전용 러너(`~/actions-runner-portfolion`)가 타 repo로 재등록되면 잡이 queued→24h cancelled + in-checkout 푸시는 **무음 미배포**(06-22~06-27 5일 실사례, task#105). 백엔드가 옛 코드면 폴러 footgun 단정 전에 `gh run list`·`gh api .../actions/runners`로 **러너부터 확인**. 새 프로젝트가 기존 러너 재등록 금지(전역 CLAUDE.md).
- **신규 DB 컬럼은 app_schema.sql만으론 미반영** — 라이브 DB는 기동 idempotent 마이그레이션(ADR-0006)만 탄다. `backend/main.py`의 `_migrate`에 `ADD COLUMN IF NOT EXISTS`를 **쌍으로** 추가 필수(현재 15개 존재). 한쪽만 고치면 배포 직후 그 컬럼 INSERT/SELECT가 깨진다(task#130 배포 전 포착). 리뷰도 변경 파일 밖 배선 계층(main._migrate·include_router·batch_registry)까지 볼 것.
- **프론트/백엔드 배포 비대칭** — nginx가 `frontend/dist`를 직접 서빙해 `npm run build`는 즉시 라이브, 그러나 **백엔드 변경은 폴러 재배포/러너 후에야 라이브**. 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작.

## 4. 캐시·저장 박제·클로버 [data]

- **빈/all-None 결과 캐시 박제 금지** — 외부 fetch(키움 등)를 요청·기동 경로에서 라이브 호출하지 말고 배치가 `market_cache`/테이블에 사전계산, 요청은 저장값만 read. 실패를 silent except로 삼키지 말고 로깅하고, **전부 None이면 save 생략**(직전 양호값 유지). 의심 트리거(base_dt)가 아니라 실패 클래스(all-None)를 가드해야 재발 방지(task#48·49·50).
- **delete-rewrite store는 fetch 실패 시 delete 스킵** — `dividends.replace_schedule`처럼 `DELETE+INSERT`로 갱신하는 store는 fetch 실패를 빈 결과로 삼키면 save 생략이 아니라 **직전 양호값을 DELETE로 파괴**(박제보다 은밀). fetch 함수가 예외를 `[]`로 삼키지 말고 전파해 replace 통째 스킵, genuine-empty만 clear, delete+insert는 단일 트랜잭션(task#160).
- **`get_or_refresh`는 fetch 실패 시 직전값 폴백 안 함** — "캐시 있으면 fetch 스킵"일 뿐 fetch 실패(418/타임아웃)엔 실패를 전파. CNN F&G 등 취약 소스엔 `fx.py`의 VIX식 수동 폴백(성공 시 save+반환, 실패 시 `_mc_load` 직전값) 필요. FRED/yfinance 등 안정 소스는 `get_or_refresh`로 충분(task#151).
- **"성공-but-빈응답"을 last-good에 박제 금지** — 외부 API `rt_cd=0`(무예외) 빈 output은 예외 가드를 통과한다. 값 수준 가드(price None/빈 history면 fetch 실패 취급→last-good 폴백)가 필요. `indices.py`의 `if any(v is not None ...)` 패턴. 요청경로(`kospi_futures.py`, task#157)·배치 양쪽 위험.
- **KR 시장-날짜는 KST 명시** — 컨테이너가 UTC라 bare `date.today()`는 00:00~09:00 KST에 하루 뒤처짐. `datetime.now(ZoneInfo("Asia/Seoul")).date()` 사용(task#157).
- **키움 tz-naive ↔ yfinance tz-aware 정렬** — `pd.concat([naive, aware])`가 TypeError, broad except가 삼키면 계산이 조용히 None. KR series를 yfinance 지수와 정렬하는 계산(베타·상관)은 한쪽을 `tz_localize(None)`(task#116).

## 5. 테스트 오염·안전망 결함 [test]

- **`_block_real_db` 가드(task#169)** — 로컬 `DATABASE_URL`이 도커 postgres(=라이브 DB, 5432 노출)를 가리켜, 가드 전엔 `generate_report` end-to-end 테스트의 스냅샷 INSERT가 **prod `snapshots`에 커밋**됐다(005930 11일치+가 fixture price 70000으로 클로버, admin 삭제 테스트가 prod `calendar_cache` 전체 DELETE 실행). 오염이 **선택적**(가짜 티커는 FK 실패로 무해, 실존 티커만 오염)이라 격리된 듯 보인 게 함정 — fixture-writes-live. 현재 `backend/tests/conftest.py:27` `_block_real_db` autouse 가드가 실 DB 접근을 raise로 차단. **DB를 타는 테스트는 반드시 `services.db`(query/execute) 또는 상위를 mock**. 가드가 raise하면 mock을 추가하라(가드를 풀지 말 것). reload-패턴 테스트(`importlib.reload`)는 모듈 자체 심볼 patch가 무효화되니 하위 모듈 속성을 patch.
- **자체-app 테스트의 auth override 누락** — 다수 테스트가 conftest `client`가 아니라 모듈 상단에서 `FastAPI()`를 직접 만들어 `app.dependency_overrides`로 auth 우회. 엔드포인트에 auth `Depends`를 추가하면 **그 경로를 호출하는 자체-app 테스트가 401/403로 깨짐** — 전수 grep해 override 추가, 무인증 거부는 fresh app으로 별도 검증(task#108).
- **additive 추가가 `mock.call_args` 오염** — 응답 shape뿐 아니라 호출 시퀀스도 늘어 마지막 호출 단언이 거짓통과/오류. `call_args_list[i].kwargs`로 마이그레이션 + `call_count`로 시퀀스 못박기(task#66·67).
- **exact-count/set 하드코딩 단언 분산** — batch id 추가/제거 시 count/set 단언이 4파일(`test_scheduler_seed`·`test_batch_market_split`·`test_batches_router`·`test_macro_signals_batch`)에 흩어져 한 파일만 고치면 스위트가 깨짐. 전수 grep(task#136).
- **심볼 제거/개명 시 patch 타깃 전수 grep** — mock 타깃은 주 테스트 파일에만 있지 않다. `digest_service`의 `yf` import 제거 시 **다른 파일**이 patch 중이라 `ModuleNotFoundError`(task#136).
- **query-mock이 라이브 SQL 정합 못 잡음** — uuid에 `= ANY(%s)`로 str 리스트→`uuid = text` 라이브 즉사(`::uuid[]` 명시), `VALUES ((a,b),(c,d))` 바깥괄호→record 1행. 둘 다 pytest green 배포-즉사. 신규/배치화 SQL은 mock 외 **라이브 스모크 DoD**(task#135).

## 6. 미문서화 API 갭·문서 드리프트 [doc]

- **`GET /api/report/list` 응답 필드 갭** — `API_SPEC.md:1549`는 `last_scheduled_date`(시장별 객체)만 서술하고, entry의 `pinned`·`is_mine` 필드는 미문서화(기존 갭, hunt4 M2 확인). Cowork API-key 기본 호출 및 admin `scope=all`이 이 필드를 소비.
- **문서 동기 규칙(DoD)** — API 변경은 `API_SPEC.md`(전체) + `CLAUDE_COWORK_API.md`(Cowork 스코프 한정) 동기 갱신. 엔드포인트 존재 drift는 `test_api_doc_sync.py`가 자동검출하나 **요청/응답 스키마·인증 게이팅 동기는 수동 DoD**(테스트는 존재만 검증). 기능 표면(화면/env/스택/아키텍처/배치) 변경은 `README.md` 해당 절도 같은 PR에서.
- **batch_registry `source` drift** — 배치 fetch 소스 변경 시 `source` 필드도 갱신(DoD). 안 하면 배치 현황이 틀린 출처 표시.

## 7. 라우팅·프론트 상태 함정 [footgun][test]

- **동일 라우트 재네비게이션은 리마운트 안 됨** — 라우트 셸이 `<div key={location.pathname}>`(`App.jsx:77`)라 `/reports`→`/reports`는 리마운트 안 되고, `setDeepTicker(동일값)`은 React bail-out에 걸림. hunt4 M1에서 `App.jsx:51`이 `navKey={location.key}`를 Reports에 전달하는 방식으로 수정. 매 네비게이션 고유값이 필요한 패턴.
- **라우트 리다이렉트 테스트 거짓 안전감** — `route-redirects.test.jsx`가 과거 App.jsx 매핑을 **수기 복제**해 App.jsx가 라우트를 갈아엎어도 통과했다(구조적 결함). hunt4 M4에서 공유 `frontend/src/routes.js`의 `REDIRECTS`를 App.jsx·테스트가 함께 import하도록 추출해 수정.
- **enrich 빈 오브젝트 헤더-only 렌더** — `{}`로 저장된 enrich 필드(moat/growth_plan/risks)가 얕은 `if (!x) return null` 가드를 통과해 헤더만 렌더. hunt4 L1에서 실 필드 존재 검사로 가드 강화(`KeyResourceSection` 패턴).

## 8. 그 외 구조적 취약점

- **비-additive reshape 소비처 전수 grep** — 엔드포인트 응답을 배열→객체 등으로 바꾸면 독립 fetcher까지 전수 grep(`Analytics.jsx`가 훅과 별개로 `/api/stocks/dashboard` 직접 fetch한 사례 task52). additive 선호.
- **dual-source 저장소 혼동** — 종목명은 `tickers.name`(마스터) vs `snapshots.data.name`(박제), `enriched_at`은 `tickers` 컬럼(스냅샷 JSON 아님). 정본 위치를 가정하지 말고 소비처 grep으로 확정, 테스트가 실구조 단언(fixture-pass-live-fail 내부 저장판, task#132).
- **admin `scope=all` category vs is_mine 게이트** — 액션 버튼 가시성은 category가 아니라 `is_mine`으로 게이트(남의 종목 수정/승격은 user-scoped 404). 액션 버튼은 단일 `StockActions.jsx`로 통합(과거 두 렌더러 중복이 재발 토양, task#97·#103).
- **KR 색 관례 토큰** — 가격 방향(`.badge--up`/`.badge--down`)과 의미 상태(`.badge--success`/`danger`/`warning`)가 전용 변형으로 분리(에디토리얼 리디자인 task#194). 공용 배지 variant 색 의미 변경 시 소비처 전수 grep — vitest·빌드는 색 의미에 블라인드, 스팟 시각 재캡처가 유일 포착.
- **NaN/inf 직렬화 500** — starlette `JSONResponse`는 `allow_nan=False`. 외부 시세서 흘러든 NaN이 합산값 오염 → 500. 가드는 소스에서(`math.isfinite`) 하는 게 출력 일괄 sanitize보다 깨끗. PostgreSQL은 NaN 거부하나 `json.dumps`(파일 폴백)는 통과해 증상이 엇갈림.
- **로컬 `.venv` 제약** — Python 3.9.6(Docker 3.12). 런타임 평가 어노테이션에 PEP604 `X | None` 금지(`Optional[X]`, 단 `from __future__ import annotations`가 있으면 안전). `lxml` 미설치라 로컬 검증 HTML 파싱은 `BeautifulSoup(html, "html.parser")`.

---

## 최근 버그 헌트 이력

근거: `.forge/bug-report.md`, `.forge/done/2026-07-24-*`.

- **4차(task#207, HEAD 기준)** — finder 4렌즈 fan-out → 적대적 검증 → **5건 CONFIRMED**(HIGH 0·MED 4·LOW 1). **5건 전부 수정·배포 완료**(현재 코드로 재확인):
  - M1 동일 티커 재선택 stale — `App.jsx:51` `navKey={location.key}` 전달 (fixed)
  - M2 `pinned` 임의 사용자값 오염 — `storage/portfolio.py:246` `get_global_portfolio`에서 pinned 제거, `report.py:174/220`이 요청자 본인 `get_all_stocks(user_id)`의 pinned로 덮어씀 (fixed)
  - M3 KR 경쟁사 R&D 항상 공란 — `market/kr.py:539` `get_rd_intensity_kr`를 사업보고서 `document.xml` '연구개발비용' 표 파싱으로 재구현, 라이브 UAT 5/5 sane (fixed, 커밋 a797c2e+44629f2)
  - M4 라우트 리다이렉트 테스트 거짓 안전감 — 공유 `routes.js` `REDIRECTS` 추출 (fixed)
  - L1 enrich 빈 오브젝트 헤더-only — `Sections.jsx` 가드 강화 (fixed, 커밋 4f48777)
  - 잔여 리스크: M2가 노출하는 `pinned`/`is_mine`이 `API_SPEC.md` 미문서화(§6).
- **3차(task#168)** — finder 3렌즈 → 원시 1건 → 적대 검증 refuted → **confirmed 0건**(#165/#166/#167 수정분에 잔존 버그 없음).
- **2차(task#164)** — 15건(HIGH 1·MED 11·LOW 3) → task#165·#166으로 **15/15 전건 수정·배포**.
- **1차(task#107, 고위험 표면)** — 42건 → 41건 해소. 잔존 1건: **#28 consensus backfill force DELETE 비원자**(의도적 미수정).
