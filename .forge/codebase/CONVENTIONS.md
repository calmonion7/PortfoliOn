---
last_mapped_commit: 3aa35ba7b754566835ea9a21f7076a5f4450789a
mapped: 2026-07-17
---

# CONVENTIONS

PortfoliOn 코드 스타일·명명·패턴·에러 처리 규약. 도메인 용어 정의는 CONTEXT.md 소관 — 여기는 "코드가 어떻게 쓰이는가"만.

## 1. Backend Python 스타일

- **파일 상단 `from __future__ import annotations`** 를 새 모듈에 관용적으로 붙인다(`backend/services/utils.py`, `backend/services/dividends.py`). 문자열 반환형(`"dict | None"`)도 종종 쓴다.
- **타입 힌트 + 반환형 명시**: `def is_valid_ticker(ticker: str) -> bool`, `def _dart_key() -> str`. 함수 시그니처에 힌트를 다는 게 표준.
- **모듈 docstring + 함수 docstring(한국어)**: 서비스 모듈 상단에 소스·정규화·분기 규칙을 한국어 docstring으로 요약(`dividends.py:1-12`). 함수 docstring도 한국어로 "무엇을·어떤 조건에" 형태.
- **private 심볼은 `_` 접두**: `_get_corp_code_map`, `_dart_key`, `_build_all`, `_migrate`. 모듈 내부 헬퍼·상수(`_DART_BASE`, `_REPRT_ANNUAL`, `_KST`)에 일관 적용.
- **섹션 배너 주석**: `# ── US: yfinance ──────────` 형태의 구분선으로 큰 함수 묶음을 나눈다(`dividends.py:41`).
- **KST 날짜는 `services.utils.today_kst()`** — 컨테이너가 UTC라 bare `date.today()` 금지. `datetime.now(ZoneInfo("Asia/Seoul")).date()` 패턴을 헬퍼로 통일(`utils.py:11-13`).
- **DB 접근은 `services.db`의 `query`/`execute`/`execute_many`/`get_connection`을 통한다**(`from services.db import execute, query, get_connection`). 라우터·서비스는 커넥션 풀을 직접 만지지 않는다.
- 티커 정규화 헬퍼는 `services.utils`에 집약(`is_valid_ticker`·`find_ticker`·`find_ticker_index`·`ticker_exists_in`) — 대소문자·strip을 이 계층에서 흡수.

## 2. Frontend React/JS 스타일

- **세미콜론 없는 스타일**: import·문장 끝에 세미콜론을 쓰지 않는다(`frontend/src/hooks/usePortfolioData.js:1`, 테스트 파일 동일). 신규 코드도 이 스타일에 맞춘다.
- **plain CSS(TailwindCSS 없음)**: 색·간격 등은 CSS 커스텀 프로퍼티(토큰)로. `frontend/src/styles/tokens.css`가 정본(§9·§12). 모션 전용 유틸은 `frontend/src/styles/motion.css`(§13).
- **hook 규약**: 커스텀 훅은 `useXxx.js`(`frontend/src/hooks/`), 상태는 `useState`, 이펙트 콜백은 `useCallback`으로 감싼다(`usePortfolioData.js`). API 호출은 항상 `frontend/src/api` 모듈(axios 래퍼)을 import해 쓴다(직접 `fetch` 금지 관례).
- **인라인 한국어 주석으로 미묘한 순서·게이트 설명**: 상태 갱신 순서, 폴링 틱 게이트 등 함정을 주석으로 명시(`usePortfolioData.js:16-17,25`).

## 3. NaN/inf sanitize discipline

- **starlette `JSONResponse`는 `allow_nan=False`** — 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 **500**(`Out of range float values are not JSON compliant`).
- **`services.utils.sanitize(obj)`** 가 안전망: dict/list를 재귀 순회하며 비유한 float(`math.isnan`/`math.isinf`)를 `None`으로 치환(`utils.py:36-43`).
- **시세·합산을 응답에 싣는 엔드포인트는 반환을 `sanitize(...)`로 감싼다**. 실사용처: `routers/portfolio.py`(rebalance·exposure), `routers/recommendations.py:210`, `routers/stocks.py:313,645`(dashboard), `routers/report.py`(alias `_sanitize`).
- **가드는 가능하면 소스에서**: 외부 시세가 NaN이면(`math.isfinite` 체크) "시세 없음"으로 먼저 처리하는 게 출력 일괄 sanitize보다 깨끗(예: `_usdkrw_rate`의 `math.isfinite` 가드). `if fx is None` 류 가드는 NaN을 통과시키므로(NaN≠None) `isfinite`를 써야 한다.
- **폴백이 다르게 가린다**: PostgreSQL `json` 컬럼은 NaN을 거부(저장 실패)하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과 → DB 실패·파일 성공·응답 500으로 증상이 엇갈린다.

## 4. 로깅 방출 규약 (Logging)

**전체 정본은 이 절.** 백엔드는 자동 가드(테스트)까지 있고, 프론트는 관례+리뷰 의존.

### 4.1 Backend

- **모듈 `logger`로 통일, `print` 신규 금지**: 각 모듈 상단 `logger = logging.getLogger(__name__)`(`services/*.py` 전반). 앱 코드 `print(` = 0.
- **자동 가드 `backend/tests/test_no_print.py`**: `ast`로 `print()` 호출 노드를 탐지, 대상은 `main.py`·`routers`·`services`·`scheduler`·`middleware`(`tests/`·`scripts/`·`data/` 제외). 신규 `print`가 새어들면 즉시 실패.
- **루트 로거 1회 배선 — `main.py:_configure_logging()`**(`main.py:16-28`): 기동 시 `logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")` + 노이즈 라이브러리(urllib3/yfinance/apscheduler/asyncio)를 `WARNING`으로 억제 + uvicorn 로거 `propagate=False`(중복 emit 방지). **이 config가 없으면 root lastResort=WARNING이라 `logger.info`가 docker logs에 안 뜬다.**
- **레벨 의미**: `warning`=graceful 담화(예상된 실패 폴백), `error`=예상치 못함·데이터 손실(아껴 쓴다), `info`=배치/라이프사이클.
- **메시지 포맷**: `logger.x(f"[Component] <무엇> (<ids>): {e}")`. `[Component]`는 PascalCase, **개념당 1스펠링**(formatter 프리픽스가 없어 메시지 내 `[마커]`가 유일한 grep 앵커). 실사용 마커: `[Sector]`·`[Correlation]`·`[AGM]`·`[Backlog]`·`[Beta]`·`[Dividends]` 등.

### 4.2 Frontend

- **`console.warn`/`console.error`만 진단에 쓴다** — `console.log`는 방출용 아님. `.warn`=graceful(폴백 있는 실패), `.error`=예상외·폴백 없는 실패.
- **마커는 소스 모듈/훅명 실명**(백엔드 개념명과 다름): `[usePortfolioData]`·`[useReportList]`·`[PermissionPanel]`·`[Analytics]`·`[AdminAnalytics]`·`[ReportManualGen]`. `frontend/src` 전체 `console.warn/error`는 모두 `[모듈/훅명]` 마커로 시작(무마커 grep 0).
- **자동 가드 없음(인수된 갭)**: `vite build`·`deploy.sh`·CI 어디에도 lint가 안 걸려 eslint `no-console`을 넣어도 죽은 가드다. §4.2는 **관례+리뷰 의존**으로만 강제된다. 강제하려면 "규칙 추가"가 아니라 lint를 build/deploy/CI에 **먼저 배선**하는 게 선행 조건.

## 5. 마이그레이션 페어링 (schema + `_migrate`)

- **신규 DB 컬럼은 `app_schema.sql`만으론 배포에 반영 안 된다** — 스키마 파일은 신규 설치용, 라이브 DB는 기동 idempotent 마이그레이션만 탄다.
- **`main.py:_migrate()`에 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`를 쌍으로 추가 필수**(`main.py:57-`, 실사용 다수: `backlog_history.segments`·`stock_disclosures.meeting_date`·`stock_recommendations.{low_liquidity,exchange,name}`·`user_stocks.{target_price,...}`·`tickers.key_resource` 등). `_migrate`는 `execute(...)` DDL 나열이며 기동 시 1회 실행(`main.py:207`).
- **완료 기준(DoD)**: 컬럼 추가 슬라이스는 `app_schema.sql` + `_migrate` 두 파일 쌍을 명시. 한쪽만 고치면 배포 직후 그 컬럼 INSERT/SELECT가 컬럼 부재로 깨진다. 리뷰도 변경 파일 밖 배선 계층(`_migrate`·`include_router`·`batch_registry`)까지 본다.

## 6. API 문서 동기화 (doc-sync)

- **정본 2개**: `API_SPEC.md`(전체 REST 레퍼런스) + `CLAUDE_COWORK_API.md`(외부 Cowork enrich/backlog 워크플로우 전용).
- **자동 가드 `backend/tests/test_api_doc_sync.py`**: 라이브 `app.routes`(데코레이터 파싱 아님) ↔ 두 문서의 ```### `METHOD /path` ``` 헤더를 대조. `_norm`으로 path param 철자·쿼리스트링·끝 슬래시를 정규화. 미문서화 baseline `KNOWN_UNDOCUMENTED = frozenset()`(task#100에서 0으로 동결) — 새 엔드포인트를 `API_SPEC.md`에 안 적으면 `test_api_spec_documents_all_live_endpoints`가 실패. 삭제 누락은 `test_*_has_no_stale_endpoints`가 검출.
- **테스트는 존재(method+path)만 검증** — 요청/응답 스키마·인증 게이팅 동기는 여전히 수동 DoD(prose 파싱 안 함).
- **"2문서 모두"는 Cowork 관련 엔드포인트에 한한다**: 사용자 대면 read 엔드포인트(`/api/portfolio/*`·admin 배치 refresh 등)는 `API_SPEC.md`에만. 신규 엔드포인트가 Cowork 소비 대상인지 먼저 판별해 DoD를 좁힌다(기계적 "둘 다"는 과함).

## 7. README 동기 DoD

- **기능 표면을 바꾸면 `README.md` 해당 절도 같은 PR에서 갱신**. 표면 = ① 화면 구성(nav 탭/화면 기능) ② 환경변수(env/데이터 소스 키) ③ 기술 스택 ④ 아키텍처(router/service/table) ⑤ 배치.
- README는 **overview 레벨** — 엔드포인트/요청·응답 스키마 세부는 여기 중복하지 말고 `API_SPEC.md`/`CLAUDE_COWORK_API.md`에만(§6와 역할 분담).

## 8. Additive 변경 가토 (response / mock / auth)

- **비-additive reshape(배열→객체 등)는 그 엔드포인트를 fetch하는 *모든* 프론트 소비처를 전수 grep**: `grep -rn '<경로>' frontend/src/`. 훅과 별개로 직접 fetch하는 페이지(예: `Analytics.jsx`가 `/api/stocks/dashboard`를 독립 fetch)가 옛 형태로 조용히 깨진다. 가능하면 **additive(필드 추가)**를 선호.
- **read/외부호출을 additive로 추가하면 `mock.call_args`(마지막 호출) 단언 테스트가 오염**된다 — 호출 시퀀스가 늘어 마지막 호출이 바뀐다. 대응: ① 기존 단언을 호출별 `call_args_list[i].kwargs`로 마이그레이션, ② 신규 호출은 `if <조건>:`로 입력 비면 생략해 기존 테스트 보존, ③ 신규 테스트가 `call_count`로 시퀀스를 못박음.
- **auth `Depends`(get_current_user/require_admin/require_admin_or_api_key) 추가는 자체-app 테스트를 401/403로 깨뜨린다** — 다수 테스트가 conftest `client`가 아니라 모듈 상단에서 `FastAPI()`를 직접 만들어 `app.dependency_overrides[...]`로 auth를 우회한다(§TESTING 참고). 의존성 추가 시 그 경로를 호출하는 자체-app 테스트를 전수 grep해 override를 추가. 무인증 거부(401/403)는 override 없는 fresh app으로 별도 검증.
- **공용 UI킷 변형(Badge 등)의 색 "의미"를 바꾸는 리팩터도 같은 가족** — CSS/컴포넌트 규칙만 보고 "위반"을 판정하지 말고 실 소비처를 전수 grep할 것(§12 Badge 사례 참조). "규칙 위반처럼 보이는 배선"이 실은 의도된 별도 소비(가격 배지 등)일 수 있다.

## 9. KR 색 토큰 (`--up`=red / `--down`=blue)

- `frontend/src/styles/tokens.css`: **`--up`=빨강(상승)·`--down`=파랑(하락)** — KR 관례(Western과 반대). 현재(에디토리얼, ADR-0026) light `#b3372b`/`#2b5c9e`(버밀리온/프러시안블루 잉크), dark `#ef6a5a`/`#6fa1e8`(`tokens.css:48-51,151-154`). 이 명암 관계는 ADR-0025→0026 아이덴티티 교체를 관통해 불변(§12 참조).
- **의미 상태 배지에 `success`/`danger` 변형 쓰지 말 것**: 의미 배지는 전용 색을 명시(가격 토큰 미사용). `warning` 변형은 토큰 미정의로 현재 깨져 있어 쓸 수 없다. `success`/`danger` vs `up`/`down` 배지 variant의 CSS 분리 세부는 §12 참조.
- UI 리뷰는 variant 이름의 통념이 아니라 토큰 실제값을 대조한다.

## 10. Dual-source 패턴 (name / enriched_at)

- **종목명 dual-source**: `tickers.name`(공유 마스터, 종목관리 목록이 live로 읽음) vs `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세가 읽음). 이름 변경 시 **둘 다** 갱신해야 목록↔상세가 일치(`storage.refresh_snapshot_names` 단건 / `reconcile_snapshot_names` 전체). DB만 바꾸면 `cache.get_list`·스냅샷 LRU 탓에 화면 미반영 → `cache.invalidate(ticker)`+`invalidate_list()` 필수.
- **`enriched_at`(AI 분석 존재) 정본은 `tickers` 테이블 컬럼 — 스냅샷 `data` JSON엔 없다**. 신규 판정/표시 필드를 붙일 땐 정본 저장 위치를 가정하지 말고 기존 소비처(`report.py` 등)를 grep으로 확정하고, 테스트가 실구조(테이블·컬럼)를 단언할 것. 스냅샷 JSON에서 읽도록 가정하면 fixture는 green인데 라이브는 항상 False(fixture-pass-live-fail의 저장소 혼동판).

## 11. 심볼/배치 id 변경 시 grep 규율

- **모듈에서 심볼(import·함수)을 제거/개명하면 그 심볼을 patch하는 테스트를 파일 불문 전수 grep**(`grep -rn "모듈경로.심볼" backend/tests/`) — mock 타깃은 "그 기능의 주 테스트 파일"에만 있지 않다.
- **배치 id를 `batch_registry.BATCHES`에서 빼면 모든 표면 전수 grep**: 데이터 read·표시 문자열·`job_runs.record(id,...)` 모든 lane(auto/manual/backfill)·그 id를 단언하는 테스트.
- **id를 추가할 때도 테스트의 count/set 하드코딩 단언을 전수 grep**: `grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/`. exact-count/exact-set 단언이 여러 파일(`test_macro_signals_batch.py`·`test_batch_market_split.py`·`test_batches_router.py`)에 흩어져 있어(현재 `== 29`, 3aa35ba 기준 불변) 한 파일만 고치면 나머지가 스위트에서 깨진다.
- `batch_registry`의 `source`(데이터 fetch 출처)와 `usage`(소비 UI)는 반대 방향 — fetch 소스를 바꾸면 `source`도 갱신(DoD).

## 12. 디자인 토큰 소비 규약 (ADR-0026, `frontend/src/styles/tokens.css`)

- **팔레트 교체(터미널→에디토리얼 등)는 토큰 "이름"을 보존하고 값(hex)만 재조율한다** — task#190(cb4d71a)에서 ADR-0025(다크 터미널)→ADR-0026(라이트 종이) 전면 교체 시 `--bg`·`--accent`·`--up`·`--down`·`--data-1~5`·`--tag-*`·`--cal-*` 등 기존 토큰명은 전부 유지, hex만 재계산(`git diff 8e37e2c cb4d71a -- frontend/src/styles/tokens.css` 확인). 소비 코드(컴포넌트 CSS)는 무변경으로 새 팔레트를 자동 획득 — 이름을 바꾸면 전 소비처 개별 수정이 필요해진다.
- **신규 토큰 추가는 필요 시 허용**되나(예: `--font-serif: 'Noto Serif KR', 'Apple Myungjo', Georgia, serif` 신설, task#190), **기존 토큰 개명·제거는 지양** — "공유 토큰 재색상은 전 소비처 blast radius 확인"이 매 파트 계획서에 반복 명시된 원칙(과거 task#175 F22 사례 계승).
- **hex 옆에 실측 AA 대비 수치를 주석으로 남긴다**: `--up: #b3372b; /* 버밀리온 잉크 (5.33) */` 형태(`tokens.css:48` 등). 새 색을 추가/변경할 때 4.5:1 미달이면 주석에 드러나므로 리뷰 앵커로 쓴다.
- **KR 가격색 `--up`/`--down`(§9)과 의미 상태색(`--color-success`/`--color-danger` 등)은 값·용도 모두 분리** — Badge 레벨에서도 명시적으로 갈린다: `frontend/src/components/ui/Badge.jsx`의 `ChangeBadge`는 `variant: value >= 0 ? 'up' : 'down'`만 쓰고(주석 "KR 가격색 관례 — 의미색(success/danger) 아님", `Badge.jsx:37`) `Badge.css`도 `.badge--up/--down`(가격, task#194 신설)과 `.badge--success/--danger`(의미)를 별도 규칙으로 정의(`Badge.css:26-51`).
- **공용 UI킷 변형(Badge 등)의 색 "의미"를 바꾸는 작업은 실 소비처 전수 grep이 선행돼야 한다** — task#194 감사에서 "success/danger 변형이 가격 토큰(`--up`/`--down`)을 참조하니 의미 배지 규칙 위반"이라는 판정만 보고 실제 소비처(`ChangeBadge`가 `success`/`danger`로 가격을 표시 중이던 배선)를 grep하지 않은 채 색 교체를 지시 → 상승/하락 배지색이 서구식으로 반전되는 회귀가 났다(vitest·빌드는 안 잡음, 라이브 재캡처로만 발견). 이후 `up`/`down` 전용 variant를 신설해 가격 배지와 의미 배지를 CSS 레벨에서 완전히 분리했다(§8에도 교차 기록).

## 13. 모션 규약 (`frontend/src/styles/motion.css`, ADR-0026 §3)

- **유틸 목록**: `.anim-fade-up`(opacity+translateY 0.4s, entrance) · `.anim-fade`(opacity 전용 0.4s) · `.anim-stagger > *`(자식 순차 지연, `--stagger-i` 0~7, `nth-child(1)`~`(8)`까지 정의) · `.reveal`+`.is-visible`(뷰포트 진입 트랜지션, `useReveal()` 훅과 짝) · `.sketch-draw .sk-path`(stroke-dashoffset 드로잉, `nth-child(2)`~`(5)`까지 delay 계단) · `useCountUp()`(첫 유효 데이터 rAF 보간).
- **라우트/레이아웃 래퍼(`position: fixed` 자손을 품는 조상)엔 transform 애니메이션 금지 — `.anim-fade`(opacity 전용)만 쓴다.** `animation-fill-mode: both`는 애니메이션 종료 후에도 computed transform을 identity matrix로 남기며(`none`이 아님) 이는 `position: fixed` 자손(플로팅 버튼·모달 오버레이 등)의 컨테이닝 블록을 뷰포트→래퍼로 바꿔버린다. 실사례(task#195): `frontend/src/App.jsx:76`의 라우트 전환 래퍼(`<div key={location.pathname} className="anim-fade">`)가 원래 `.anim-fade-up`을 썼다가 FAB·모달이 스크롤을 따라오는 버그가 나서 `.anim-fade`로 교체. `.anim-fade-up`은 leaf 요소(한 번만 마운트되고 fixed 자손이 없는 카드·탭·헤더)에만 쓴다 — 실사용: `DashboardCard`·`StockCard`·`ReportDetailTabs`·`HistoryTab`·`TickerListItem`·`Masthead`(헤더 자체) 등.
- **정적 캡처 UAT는 fixed/sticky 이탈을 구조적으로 못 잡는다** — 스크롤 0 캡처에선 fixed 요소가 정상 위치로 보인다. `getBoundingClientRect()` 스크롤 전/후 대조 + 모달 오버레이 뷰포트 풀커버 + 조상 computed transform `none` 단언을 UAT 프로브 표준으로 추가할 것(`scripts/uat195-probe.mjs` 패턴).
- **`useCountUp()`은 "마운트 1회"가 아니라 "첫 유효 데이터 도착 1회"로 게이트해야 한다** — 비동기 화면에서 마운트 시점 값(0/undefined)에 애니메이션 예산을 낭비하면 실제 데이터 도착 시 카운트업이 안 보인다(task#192 적대 리뷰가 포착, `frontend/src/pages/Portfolio.jsx`가 `usePortfolioData`의 `hasFetched` 플래그로 게이트해 수정).
- `prefers-reduced-motion: reduce`에서 위 애니메이션 전부(`anim-fade-up`·`anim-fade`·`sketch-draw`)를 `!important`로 무효화 + `.reveal`은 즉시 `is-visible` 상태로 고정 — 신규 모션 유틸 추가 시 이 미디어쿼리 블록에도 반드시 추가할 것.
- 모션 라이브러리(framer-motion 등) 도입 금지 — CSS keyframes + 소형 훅(`useReveal`/`useCountUp`, `frontend/src/hooks/`)만으로 충분(ADR-0026 검토 대안에서 명시적 기각, YAGNI).

## 14. 스케치 SVG 계약 (`frontend/src/components/sketches/`, ADR-0026 §2)

- **12종**: 상태 3(`SketchEmpty`/`SketchError`/`SketchNotFound`) + 카테고리 아이콘 5(`IconResearch`/`IconPortfolio`/`IconMarket`/`IconCalendarIncome`/`IconGuru`) + 히어로 1(`SketchHero`) + 장식 모티프 3(`SketchUnderline`/`SketchArrowUp`/`SketchCircleMark`) — 전부 `frontend/src/components/sketches/index.js`에서 named export로 re-export.
- **공통 계약**(`SketchEmpty.jsx`·`IconResearch.jsx` 등): `stroke="currentColor"`(fill 없음, 테마색 자동 상속) + 각 `<path>`에 `pathLength="1"` + `className="sk-path"`(motion.css `.sketch-draw .sk-path`가 이 클래스를 훅으로 드로잉 애니메이션을 건다) + `role="img"` + `<title>{제목}</title>`(props `title`로 오버라이드 가능, 기본값은 한국어 상황 설명 문자열).
- **순수 장식 모티프는 계약이 조건부**: `SketchUnderline`처럼 콘텐츠 의미가 없는 모티프는 `title` prop이 없으면 `role`/`title`을 생략하고 `aria-hidden="true"`로 전환한다(`SketchUnderline.jsx:8-10`) — 콘텐츠성 일러스트(상태 3종·아이콘 5종·히어로)는 `role="img"`+`<title>`을 항상 고정한다.
- **소비 패턴**: 빈상태/에러 화면에 `SketchEmpty`/`SketchError`를 `sketch-draw` 클래스 래퍼로 감싸 드로잉 재생, 마스트헤드 카테고리 링크에 `Icon*`(18~20px), 리포트 상세 `SectionTitle`(`frontend/src/components/reports/reportUtils.jsx:95-104`)의 표제 밑줄에 `SketchUnderline`, 로그인 화면에 `SketchHero`.
- **재사용 지렛대 패턴**: 공용 컴포넌트 1곳(`SectionTitle` — 리포트 상세 20+ 섹션이 공유, 시장 허브 `SectionCard` — `marketUtils.jsx` 15개 섹션이 공유)을 업그레이드하면 소비하는 전 화면에 일괄 전파된다. 신규 표제/카드 스타일을 적용하기 전에 "이미 소비되는 공용 컴포넌트가 있는가"부터 확인할 것(task#192·193에서 반복 확인된 유효 전략).

## 15. 세리프 타이포 위계 (ADR-0026)

- `tokens.css`: **`h1, h2, h3 { font-family: var(--font-serif); font-weight: 700; letter-spacing: -0.01em; }` 전역 규칙 + `.serif` 유틸리티 클래스**(`tokens.css:235-236`). `--font-serif: 'Noto Serif KR', 'Apple Myungjo', Georgia, serif'`(task#190 신설 토큰).
- **시맨틱 태그(`h1`-`h3`)를 못 쓰는 표제**(레이아웃상 `<span>`/`<div>`로 구성된 `SectionTitle`의 `.rpt-title__text`, 마스트헤드 브랜드 `.masthead-brand`, 대시보드 카드 헤드라인 등)는 **해당 CSS 클래스에 `font-family: var(--font-serif)`를 직접 지정**한다 — 실사용: `ReportDetail.css`(`.rpt-title__text`)·`Masthead.css`·`DashboardCard.css`·`Market.css`.
- **본문·데이터는 산세리프 유지 + tabular 숫자 불변**: `body`가 전역 `font-variant-numeric: tabular-nums`(`tokens.css:228`), 숫자 전용 텍스트는 `.tnum`/`.mono` 유틸(`font-feature-settings: 'tnum'`, `tokens.css:238-239`)로 정렬 폭을 고정한다. 세리프 전환은 **제목에만** 적용되고 데이터 표시 방식은 무변경.
