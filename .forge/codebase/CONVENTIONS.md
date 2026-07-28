---
last_mapped_commit: a4994f84832f6215ac127c5ef0a645861ab2f857
mapped: 2026-07-28
---

# CONVENTIONS

PortfoliOn 코드 스타일·명명·모듈 패턴·에러처리·로깅·응답·인증·프론트·문서 DoD 규약. **구현 사실만** 다루고 도메인 용어 정의는 `.forge/CONTEXT.md`에 둔다.

백엔드 Python/FastAPI(`backend/`), 프론트 React 19 + Vite 8 + plain CSS(`frontend/`).

---

## 1. 런타임·타입 어노테이션 제약

로컬 `backend/.venv` = **Python 3.9.6**, Docker 컨테이너 = 3.12. 로컬 pytest가 배포 게이트이므로 3.9가 사실상 하드 제약이다.

| 자리 | 규약 | 근거 |
|---|---|---|
| **Pydantic 모델 필드 / FastAPI 엔드포인트 시그니처** | `Optional[X]` 필수 (PEP604 `X \| None` 금지) | FastAPI가 `get_type_hints`로 런타임 해석 → 3.9에서 `TypeError`. `from __future__ import annotations`가 있어도 **면제 안 됨** — `backend/routers/report.py`는 future import가 있는데도 엔드포인트 파라미터에 `Optional[str]`을 쓴다 |
| **내부 헬퍼 함수 어노테이션** | 모듈에 `from __future__ import annotations`가 있으면 PEP604 허용 | `services/db.py:12`(`ThreadedConnectionPool \| None`), `services/auth_service.py`, `services/agm.py` 등 — services/scheduler 대부분이 future import를 켬 |
| **future import 없는 모듈의 내부 헬퍼** | 문자열 어노테이션으로 회피 | `routers/stocks.py`(`-> "float \| None"`), `services/disclosures.py`(`-> "str \| None"`) |
| bare `list`/`dict` 본문 파라미터 | `Body(...)` 명시 필수 | FastAPI가 없으면 query 파라미터로 해석 → 기동 불가 |

> ⚠️ CLAUDE.md는 "PEP604 금지"로 단정하지만 **코드는 future import 모듈에서 널리 쓴다**. 실제 제약선은 "런타임 해석되는 자리(Pydantic·FastAPI 시그니처)"뿐이다.

**로컬 ≠ Docker 의존성**: `lxml`은 `requirements.txt`/Docker에는 있고 로컬 `.venv`엔 없다 → HTML 파싱은 stdlib `BeautifulSoup(html, "html.parser")`. 소비처: `services/backlog_parser.py`, `services/scraper.py`, `services/guru_scraper.py`, `services/market/kr.py`, `services/market_indicators/indices.py`.

## 2. 모듈 구조·명명

- **레이어**: `routers/*.py`(HTTP·검증·인증 게이트) → `services/*.py`(비즈니스·외부 fetch) → `services/db.py`(`query`/`execute`/`execute_many`). 라우터에서 psycopg2를 직접 다루지 않는다.
- 라우터 파일 = 도메인 1개, 모듈 상단에 `router = APIRouter(prefix="/api/...", tags=["..."])`. prefix가 도메인 단위(`/api/stocks`)거나 여러 경로를 묶으면 `prefix="/api"`(`rankings`·`investor`·`short_sell`·`report`·`digest`·`calendar`·`batches`).
- **라우터 레벨 `dependencies=[...]`는 쓰지 않는다** — 인증은 엔드포인트별 `Depends(...)`로 붙인다(§6).
- 패키지로 쪼갠 서비스: `services/market/`(`kr.py`·`us.py`·`format.py`), `services/market_indicators/`, `services/storage/`(`portfolio.py`·`names.py`·`dates.py`·`schedule.py`), `services/kiwoom/`, `services/kis/`, `services/recommendation/`, `scheduler/`(루트 레벨 패키지).
- 명명: Python `snake_case`(모듈·함수), 모듈 프라이빗은 `_leading_underscore`. JS/JSX 컴포넌트·페이지는 `PascalCase.jsx`, 훅은 `useXxx.js`, 유틸은 `camelCase`.
- 라우터 순서 함정: **구체 경로를 catch-all보다 먼저 등록** — `PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 위. 발행물 API는 이 오인 라우팅을 피하려 `/api/report` catch-all을 떠나 별도 prefix `/api/analyst-reports`를 썼다(`routers/analyst_reports.py`, ADR-0027).

## 3. 로깅 방출 규약

### 3.1 백엔드 — 모듈 logger (자동 강제)

- **`print` 금지.** 앱 코드(`main.py`·`routers/`·`services/`·`scheduler/`·`middleware/`)의 `print()` 호출은 0이어야 하며 `backend/tests/test_no_print.py`가 ast로 `ast.Call`+`ast.Name("print")` 노드를 탐지해 단언한다(문자열/주석/`pprint` 오탐 없음; `tests/`·`scripts/`·`data/`는 대상 외).
- 모듈마다 `logger = logging.getLogger(__name__)`.
- **루트 로거는 `main.py:_configure_logging()`이 import 시점에 1회 배선**(`backend/main.py:18-30`): `basicConfig(level=INFO, format="%(levelname)s %(name)s: %(message)s")` + `urllib3`/`yfinance`/`apscheduler`/`asyncio` → WARNING 억제 + `uvicorn`/`uvicorn.error`/`uvicorn.access` `propagate=False`(중복 emit 방지). **config가 없으면 root lastResort가 WARNING+만 내보내 `logger.info`가 docker logs에 안 뜬다.**
- 레벨: `warning`=graceful 담화, `error`=예상치 못함·데이터 손실(아껴 씀), `info`=배치/라이프사이클.
- 포맷: `logger.x(f"[Component] <무엇> (<ids>): {e}")`. **`[Component]`는 PascalCase·개념당 1스펠링** — formatter에 프리픽스가 없어 메시지 내 마커가 유일한 grep 앵커다.
- 현재 마커 상위(빈도, `logger.x(f"[...]"` 실사용 기준): `[Scheduler]` 73, `[Migrate]` 18, `[Report]` 13, `[Funnel]` 10, `[Financials]` 9, `[Backlog]` 7, `[Pipeline]`·`[Earnings]`·`[Digest]`·`[Backfill]`·`[AGM]` 6, `[UsSupply]`·`[Dividends]`·`[Consensus]`·`[Beta]` 5 … 총 **68종**. 신규 마커는 기존 스펠링 재사용을 우선 확인(`grep -rho "\[[A-Z][A-Za-z0-9]*\]" backend/services backend/routers`). 이 grep은 타입 어노테이션 문자열(`Optional[Any]` 등)도 매치하는 오탐이 있으니 `logger.x(` 앞뒤 컨텍스트로 걸러낼 것.

### 3.2 프론트 — console (자동 가드 없음)

- `console.warn`=graceful, `console.error`=예상외. **lint 미연결 — 가드 테스트 없음.**
- **마커는 소스 모듈/훅 실명**(백엔드 개념명과 규칙이 다르다): `[usePortfolioData]`, `[useReportList]`, `[PermissionPanel]`, `[Analytics]`, `[Reports]`, `[ReportManualGen]`, `[AdminAnalytics]`, `[AnalystReports]`, `[AnalystReport]`, `[GuruDetail]`.
- 메시지에 실패한 엔드포인트 경로를 함께 적는다(예: `'[usePortfolioData] dashboard(/stocks/dashboard) 조회 실패'`).

## 4. 에러 처리

- HTTP 에러는 `HTTPException`. 반복 형태는 `backend/services/errors.py`의 팩토리 사용: `not_found(ticker, context)`(4행) → 404, `already_exists(ticker, context)`(9행) → 400.
- **graceful degrade > 500**: 카드/섹션 단위 enrichment 실패는 부분 폴백으로 흡수하고 전체 500을 내지 않는다(`routers/stocks.py`의 `_safe`/`_minimal_card` 패턴). 단 폴백은 근본원인을 마스킹하므로 **폴백 진입 시 반드시 로그**를 남긴다.
- **broad `except: pass` 금지** — 외부 정렬/파싱 실패를 삼키면 기능이 예외 없이 조용히 None으로 꺼진다. 좁은 예외를 잡고 최소 진단 로그를 남긴다.
- **wrong < missing**: 파싱/추출 실패는 "안전한 기본값" 폴백이 아니라 누락(None/pending)으로 처리한다(단위 캡션 파싱 실패에 억원 기본값을 쓰면 ×100 오저장).
- Pydantic 단계 차단선: 불변 문서에 오염값이 들어가지 않도록 `Field(..., allow_inf_nan=False)`를 쓴다(`routers/analyst_reports.py:29,42-43` — raw JSON의 `NaN` 토큰은 `json.loads`와 NaN 비교를 다 통과하므로 이게 유일한 게이트).

## 5. API 응답 규약

- **NaN/inf 가드 필수.** starlette `JSONResponse`는 `allow_nan=False` → 응답 dict에 `NaN`/`inf`가 있으면 직렬화 **500**. 두 방식 중 하나:
  - 소스 가드(권장): `math.isfinite` 체크 후 "값 없음" 처리.
  - 출력 sanitize: `services.utils.sanitize`(`backend/services/utils.py:36-43`, dict/list 재귀 → NaN/inf를 None으로). 시세·합산·외부 데이터 블록을 싣는 응답은 이걸 통과시킨다.
  - 폴백이 증상을 엇갈리게 한다: PostgreSQL `json` 컬럼은 NaN을 거부하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과 → DB 실패·파일 성공·응답 500으로 진단이 늦어진다.
  - 422 검증 에러도 같은 함정: raw 요청의 NaN이 `RequestValidationError.errors()`에 echo되면 500이 된다 — `main.py`의 커스텀 `RequestValidationError` 핸들러(`main.py:253-259`)가 `sanitize(jsonable_encoder(exc.errors()))`로 앱 전역에서 막는다.
- **additive-over-reshape.** 응답에 필드를 *추가*하는 변경을 선호한다. 배열→객체 같은 비-additive reshape는 그 경로를 fetch하는 **모든** 프론트 소비처 전수 감사(`grep -rn '<경로>' frontend/src/`)를 DoD에 포함해야 한다 — 훅과 별개로 직접 fetch하는 페이지가 조용히 깨진다.
- additive는 응답 shape만 아니라 **호출 시퀀스**도 늘린다 → `mock.call_args`(마지막 호출)를 단언하는 기존 테스트를 오염시킨다(대응은 `TESTING.md` §4).
- 구 payload 호환은 기본값으로: `metrics: List[PointMetric] = Field(default_factory=list, ...)`(`routers/analyst_reports.py:34` — 구 판 payload는 `[]`).
- **DB NUMERIC ↔ float 산술 금지.** `avg_cost`·`quantity` 등 NUMERIC은 psycopg2가 `Decimal`로 주고 외부 시세/배당은 `float`이라 `float / Decimal` → `TypeError`. 계산 전 양변 `float()` 정규화, **회귀 테스트 fixture는 Decimal 값**을 쓴다(float fixture는 이 버그를 못 잡는다).

## 6. 인증 의존성 규약

정의는 `backend/auth.py` 한 곳(79줄). `HTTPBearer(auto_error=False)` + JWT HS256(`JWT_SECRET`), API key는 헤더 `X-API-Key` ↔ `COWORK_API_KEY`.

**ADR-0029("공개 read 없음")로 3부작(task#230·231·232) + 회귀 게이트 승격(task#233)이 진행돼, `/api/*` 엔드포인트는 `auth.py` 자체의 로그인/OAuth 9개만 빼고 전부 인증 뒤에 있다.** 아래는 현재 라우터별 실제 카운트(`grep -o "Depends(...)" routers/*.py` 기준):

| 게이트 | 정의 | 통과 조건 | 실패 | 사용처(엔드포인트 수, 총 129) |
|---|---|---|---|---|
| `get_current_user` | `auth.py:18` | Bearer JWT의 `sub` | 401 | `market_indicators`(17) `portfolio`(10) `report`(11) `stocks`(6) `guru`(5) `watchlist`(5) `batches`(3) `analysis`(2) `calendar`(2) `digest`(2) `investor`(2) `analytics`·`auth`·`events`·`rankings`·`recommendations`·`short_sell`(각 1) — **총 71** |
| `get_current_user_or_api_key` | `auth.py:37` | JWT **또는** 유효 API key → sentinel `"__api_key__"` | 401 | `report`(6) `analyst_reports`(3) `stocks`(1) — **총 10** |
| `require_admin` | `auth.py:61` | JWT + `users.role == "admin"` | 401/403 | `admin`(12) `market_indicators`(8) `report`(8) `stocks`(4) `analysis`(2) `analyst_reports`·`batches`·`digest`·`guru`·`investor`·`rankings`·`recommendations`·`short_sell`(각 1) — **총 42** |
| `require_admin_or_api_key` | `auth.py:68` | API key(무조건 통과) **또는** admin JWT | 401/403 | `admin`(2) `stocks`(2) `analyst_reports`(1) `report`(1) — **총 6** |

규칙:

- **사용자별 데이터를 읽고/쓰는 엔드포인트는 `get_current_user` 계열만** — api-key 게이트는 `user_id`가 sentinel `"__api_key__"`라 per-user 저장소 조회에 못 쓴다.
- **`require_admin_or_api_key`는 API key를 admin과 동급으로 취급**한다(role 검사 건너뜀). 외부 루틴(Cowork)이 쓰는 쓰기 경로용.
- **루틴을 배제해야 하는 파괴적 동작은 `require_admin`을 명시적으로 고른다** — 발행물 삭제가 그 예(`routers/analyst_reports.py`: 조회 `get_current_user_or_api_key`·발행 `require_admin_or_api_key`·삭제 `require_admin`).
- 관리자의 교차-사용자 동작은 user-scoped 엔드포인트가 아니라 `/api/admin/*`(`require_admin`)으로 분리한다 — user-scoped 핸들러는 호출자 본인 `user_stocks`만 보므로 남의 종목엔 404를 낸다.
- **auth 의존성을 추가/변경하면 그 경로를 호출하는 self-app 테스트가 401/403으로 깨진다** — 단, 먼저 전수 grep해 선제적으로 override를 추가하지 말고 **의존성을 붙인 뒤 전체 스위트를 돌려 실제로 깨지는 파일만 고친다**(형제 read가 먼저 인증돼 있으면 override가 이미 등록돼 있는 경우가 많아 선제 추가는 중복이 된다). 상세는 `TESTING.md` §3.
- **새 read 엔드포인트는 기본이 `get_current_user`(또는 그 이상)** — ADR-0029 이후 무인증으로 남기려면 `backend/tests/test_no_public_reads.py`의 `ALLOWED_PUBLIC`을 먼저 개정해야 하므로, 그 개정 없이 인증 의존성을 빠뜨리면 스위트가 즉시 잡는다(`TESTING.md` §5).

## 7. 캐시·저장 무결성 (wrong < missing)

배치가 사전계산해 `market_cache`/테이블에 저장하고 **요청은 저장값만 읽는** 패턴이 표준이다(요청·기동 경로에서 외부 API 라이브 호출 금지).

- 외부 fetch 실패를 조용히 삼키지 않는다(최소 진단 로그).
- **빈/all-None 결과를 캐시에 박제 금지** — 전부 None이면 save 생략, 직전 양호값 유지. 의심 트리거가 아니라 **실패 클래스(all-None)** 를 가드해야 근본원인 미상이어도 재발을 막는다. 참조 패턴: `services/market_indicators/indices.py`의 `if any(v is not None ...)`.
- **요청 경로도 "성공-but-빈응답"을 박제 금지** — 외부 API가 `rt_cd=0`(무예외)로 빈 output을 주면 예외 가드를 통과한다 → 값 수준 가드 필요(`market_indicators/kospi_futures.py`).
- **delete-rewrite(replace) 갱신은 fetch 실패 시 delete를 스킵** — `DELETE+INSERT` store는 빈 결과를 삼키면 save 생략이 아니라 직전 양호값을 **파괴**한다. fetch 함수가 예외를 `[]`로 삼키지 말고 전파해 호출측이 replace를 통째 스킵하게 한다. genuine-empty(fetch 성공·무데이터)만 clear. replace는 delete+insert를 단일 트랜잭션으로.
- `get_or_refresh(key, fetch_fn, ttl)`는 **fetch 실패 시 직전 저장값 폴백을 하지 않는다**(실패 전파) — 취약한 외부 소스는 `fx.py`식 수동 폴백(`_get_cache→try fetch→성공 시 _mc_save+반환, 실패 시 _mc_load 직전값`)을 쓰고 응답에 저장값 `timestamp`를 실어 프론트가 stale을 인지하게 한다.
- **테스트 실행 자체가 이 원칙을 어길 수 있다** — `services/market_indicators/earnings.py`의 티커 7일 캐시가 한때 `backend/data/sp500_tickers.json`/`kospi_tickers.json`(추적 대상 정적 참조 파일)을 캐시로 겸용(read+write)해, 전체 pytest 스위트가 `_block_real_db`로 DB를 막으면 캐시 미스→라이브 스크레이프→그 파일에 write하는 부수효과가 있었다. task#234에서 캐시를 `market_cache`(키 `sp500_tickers`·`kospi_tickers`)로 옮겨 write 경로를 0으로 만들고 파일은 read-only 시드로 격하했다(`services/recommendation/universe.py`는 원래도 read 전용). 일반화한 교훈: **파일 mtime을 캐시 신선도 기준으로 쓰면 덮어쓴 직후 mtime이 갱신돼 "오염됐다"는 증상이 스스로 숨는다** — 신선도 판정은 자기 자신을 갱신하지 않는 값(`market_cache.fetched_at` 등)으로 둘 것.

## 8. 시간대 — KST 시장-날짜 (자동 강제)

- **bare `date.today()`/`datetime.today()` 금지** — 컨테이너에 TZ env가 없어 UTC라 00:00~09:00 KST엔 하루 어긋난다. `backend/tests/test_no_bare_today.py`가 ast로 `.today()` 호출 노드를 탐지해 앱 코드에서 0을 단언한다.
- 정본 헬퍼: `services.utils.today_kst()`. 모듈 로컬 상수 패턴 `_KST = ZoneInfo("Asia/Seoul")`도 `routers/analyst_reports.py`, `market_indicators/kospi_signal.py`, `scheduler/schedule.py`에서 쓰인다.
- 이는 pandas series **정렬**용 `tz_localize(None)`(naive↔aware concat `TypeError` 회피)과 별개 문제다.

## 9. 프론트 규약

- **plain CSS만** — TailwindCSS 없음(`frontend/package.json`에 tailwind 의존성 0). CSS는 컴포넌트와 **콜로케이트**(`components/ui/Badge.jsx` ↔ `Badge.css`), 전역은 `frontend/src/styles/`(`tokens.css`·`pc.css`·`mobile.css`·`motion.css`). 전체 23개 CSS 파일.
- 색·간격·타이포는 `frontend/src/styles/tokens.css`의 CSS 변수만 사용(하드코딩 hex 금지). 다크 모드는 같은 파일에서 동일 토큰을 밝은 변형으로 재정의.
- **KR 색 관례 — 가격 배지 ≠ 의미 배지**(`frontend/src/components/ui/Badge.css`):

| 용도 | variant | 토큰 | 값(라이트) |
|---|---|---|---|
| 가격 상승 | `.badge--up` (`ChangeBadge` 전용) | `--up`/`--up-soft` | `#b3372b` 버밀리온 |
| 가격 하락 | `.badge--down` (`ChangeBadge` 전용) | `--down`/`--down-soft` | `#2b5c9e` 프러시안 |
| 의미 긍정 | `.badge--success` | `--color-success` | 녹 |
| 의미 부정 | `.badge--danger` | `--color-error` | 빨 |
| 의미 주의 | `.badge--warning` | `--warn` | 오커 |
| 중립/정보/시장 | `.badge--neutral`·`.badge--info`·`.badge--market-kr`·`.badge--market-us` | `--border`/`--accent`/`--color-success`/`--color-info` | — |

  **교차 사용 금지** — 가격 방향엔 up/down, 의미 상태엔 success/danger/warning. 공용 배지 variant의 색 의미를 바꿀 땐 **소비처 전수 grep 선행**: 의미색 교체가 `ChangeBadge` 가격색을 서구식으로 반전시킨 차단급 회귀가 있었고 **vitest·빌드는 색 의미에 블라인드**였다(스팟 시각 재캡처가 유일 포착).
- HTTP는 `frontend/src/api.js`의 axios 싱글톤만 사용 — `baseURL = VITE_API_BASE_URL || ''`, 요청 인터셉터가 `localStorage.access_token`을 `Authorization: Bearer`로 주입, 응답 401이면 토큰 제거 + `window.location.href = '/'`.
- 액션 버튼 블록은 단일 `frontend/src/components/reports/StockActions.jsx`(`layout="card"|"list"`)로 통합 — 게이트/버튼 변경은 거기 한 곳만 손댄다(과거 두 렌더러 중복이 404 회귀 토양이었음).
- yfinance 유래 퍼센트 필드는 **소수분수**(0.0098 = 0.98%) → 표시 시 `(v*100).toFixed(n)`. API_SPEC 예시값·테스트 fixture도 분수 스케일로 적는다.
- 리서치 하위탭은 PC/모바일 두 곳에 이원화(`frontend/src/pages/ResearchShell.jsx`의 `RESEARCH_TABS` + `frontend/src/components/Masthead.jsx`의 `SECTIONS.research.items`) — 탭 추가/개명/삭제는 항상 쌍으로, `grep -rn "RESEARCH_TABS\|SECTIONS" frontend/src/`로 확인.

## 10. 문서·스키마 DoD

| 변경 유형 | 함께 고쳐야 하는 것 | 자동 검출 |
|---|---|---|
| 엔드포인트 추가/삭제/개명 | `API_SPEC.md`(전체 REST 레퍼런스) | ✅ `backend/tests/test_api_doc_sync.py`(존재 drift만, `KNOWN_UNDOCUMENTED = frozenset()`) |
| Cowork 소비 대상 엔드포인트 | + `CLAUDE_COWORK_API.md` | 부분: stale만 검출(`test_cowork_api_has_no_stale_endpoints`) |
| **인증 게이팅 변경(추가/제거)** | `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 `**Auth:**` 산문 | ✅ 무인증 *여부*만: `backend/tests/test_no_public_reads.py`(ADR-0029, `ALLOWED_PUBLIC` 양방향 exact-match). **`**Auth:** 불필요` 산문 자체는 미검출** — 게이팅을 바꾸는 슬라이스는 착수 시 `grep -n '\*\*Auth:\*\* 불필요' API_SPEC.md`로 곧 틀릴 표기를 먼저 세어둘 것(3부작에서 8곳이 오표기로 남았던 전례) |
| 요청/응답 스키마 | 위 문서의 prose | ❌ 수동 DoD(테스트는 prose 파싱 안 함) |
| 신규 DB 컬럼 | `backend/app_schema.sql` **+** `backend/main.py:_migrate()`(`ADD COLUMN IF NOT EXISTS`, 현재 16개) | ❌ |
| 화면 구성·env·스택·아키텍처(router/service/table)·배치 | `README.md` 해당 절(같은 PR) | ❌ |
| 배치 fetch 소스 변경 | `services/batch_registry.py`의 그 배치 `source` | ❌ |
| 배치 id 추가/은퇴 | 데이터 read·표시 문자열·`job_runs.record` **전 lane(auto/manual/backfill)**·count/set 단언 테스트(`test_batches_router.py`·`test_batch_market_split.py`·`test_macro_signals_batch.py`, 현재 `BATCHES` 29개) | 부분(스위트가 count 단언으로 깨짐) |

- **`CLAUDE_COWORK_API.md`는 외부 Cowork의 enrich/backlog/발행 워크플로우 전용 스코프** — 사용자 대면 read 엔드포인트(`/api/portfolio/*` 등)는 `API_SPEC.md`에만 넣는다. 기계적 "둘 다"는 과함. 예: `POST /api/analyst-reports/{ticker}`(발행)는 두 문서 모두, `GET /api/analyst-reports`·`DELETE`는 `API_SPEC.md`에만 상세 + Cowork 문서엔 워크플로우 단계로만 언급.
- **`app_schema.sql`만 고치면 배포에 반영되지 않는다** — 스키마 파일은 신규 설치용, 라이브 DB는 기동 idempotent 마이그레이션(ADR-0006)만 탄다. 한쪽만 고치면 배포 직후 그 컬럼을 쓰는 INSERT/SELECT가 깨진다.
- 리뷰는 변경 파일 밖 **배선 계층**까지 본다: `main._migrate` · `main.py`의 `include_router` · `services/batch_registry.py`.
