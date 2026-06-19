---
last_mapped_commit: 163c29cbd89d9b1d2aa5a101670e9fa34ceb21c4
mapped: 2026-06-19
---

# CONVENTIONS

PortfoliOn 코드베이스에서 실제 파일을 읽어 귀납한 코드 스타일·네이밍·패턴·에러 처리 사실. 모든 경로는 프로젝트 루트(`/Users/calmonion/Project/PortfoliOn`) 기준.

## 1. 언어·주석

- 산문 주석·docstring은 **한국어 위주**다. 함수 docstring과 인라인 `#` 주석 모두 한국어가 기본이며, 근거로 ADR 번호를 자주 인용한다(예: `services/recommendation/scoring.py:1` `"""멀티팩터 합성 점수 ... (.forge/adr/0015 §3, 순수 로직)."""`).
- 변수·함수·클래스 식별자는 영어. 도메인 약어를 그대로 쓴다(`usdkrw`, `krw_value`, `_as_of`).
- 일부 오래된 모듈은 영어 docstring 잔존(예: `routers/stocks.py`의 `_latest_snapshot`은 영어 docstring). 신규 코드일수록 한국어 비중이 높다.

## 2. 백엔드 (Python / FastAPI)

### 2.1 모듈 헤더 스타일

- 신규 라우터/서비스는 모듈 최상단 docstring에 **엔드포인트 요약·응답 shape·핵심 제약**을 적는다. 예: `routers/recommendations.py:1`은 GET/POST 동작, 응답이 섹션 키 객체(additive)임, "저장값만 읽음(요청경로 외부 호출 0)"을 명시.
- `from __future__ import annotations`를 자주 씀(`services/`+`routers/` 중 45개 파일). 타입 힌트는 함수 시그니처에 부분 적용(`def query(sql: str, params=None) -> list[dict]:` `services/db.py:44`). 전수 강제는 아님.

### 2.2 라우터 등록 순서 — 구체 경로를 catch-all `{ticker}`보다 먼저

- FastAPI는 선언 순서로 매칭하므로, 구체 세그먼트 라우트를 catch-all `{ticker}/{date_str}` 같은 변수 경로보다 **위에** 둬야 한다. `routers/report.py:347-371`이 `/report/{ticker}/backlog`, `/disclosures`, `/insider-trades`를 `/report/{ticker}/{date_str}`(`:373`)보다 먼저 등록하고, 주석으로 "아니면 'backlog'가 date_str로 매칭돼 ... 500"이라 명시.
- 같은 함정이 `stocks.py`: `PUT /api/stocks/enrich/batch`(`:218`)를 `PUT /api/stocks/{ticker}/enrich`보다 먼저 등록. 이 클래스의 버그는 코드베이스에서 4회 재발했고 주석으로 추적됨(`report.py:365` "4번째 재발 방지").

### 2.3 Body 파라미터 명시

- PUT/POST에서 bare `list`/`dict` 본문을 받을 땐 `Body(...)`로 명시한다(미명시 시 기동 불가 버그 이력). 예: `routers/report.py:494` `def put_backlog(ticker: str, entries: list = Body(...), ...)`, `routers/batches.py:64` `schedule: dict = Body(...)`.
- 구조화 본문은 `pydantic.BaseModel` 서브클래스(`*Body` 네이밍): `EnrichBody`(`stocks.py:121`), `EventBody`(`events.py:20`), `PermissionsBody`/`BulkPermissionsBody`(`admin.py:35,39`).

### 2.4 NaN/inf 가드 (starlette `JSONResponse` allow_nan=False)

- 응답 dict에 `NaN`/`inf`가 섞이면 직렬화에서 500이 난다. `services/utils.py:29` `sanitize(obj)`가 float NaN/inf를 `None`으로 재귀 치환하는 공용 헬퍼.
- 선호 방식은 **소스에서 가드**. `services/recommendation/scoring.py:26` `_isnum(x)`은 `v == v`로 NaN을 거르고 bool/비숫자/None을 막아 점수 계산 진입 전에 차단. `routers/recommendations.py:105-121`도 가격/수량/평단을 `float(...)` + `try/except (TypeError, ValueError)`로 개별 정규화한 뒤 손익·환산을 계산(결측은 `None` 전파).

### 2.5 additive 응답·additive read 선호

- 응답 형태 변경 시 배열→객체 같은 reshape보다 **필드 추가(additive)**를 선호. `routers/recommendations.py:1-6` 주석이 "응답은 섹션 키 객체(additive) — part3/4가 'watchlist'/'holdings' 키를 추가만으로 붙인다"라고 명시. 응답은 항상 `{"as_of":..., "discovery":[...], "watchlist":[...], "holdings":[...]}` 객체(`:163`).
- additive read는 **입력이 비면 호출 생략**한다(빈 watchlist/holdings면 추가 `read_recommendations` 미발화 — `routers/recommendations.py:62` `if wl_tickers:`, `:86` `if holdings_tickers:`). 이는 기존 테스트의 `mock.call_args`(마지막 호출) 단언 오염을 막는 패턴(§TESTING 참조).

### 2.6 캐시 무효화 규칙

- 인메모리 캐시는 `services/cache.py`에 집약: `_snapshots`(LRU `_MAX=50`), `_list_cache`(TTL 60s), `_dashboard_cache`/`_correlation_cache`(TTL 300s) + sector/macro/quote.
- 종목 추가/수정/삭제 시 연쇄 무효화. `cache.invalidate(ticker)`(`:52`)가 해당 ticker LRU 항목 제거 후 `invalidate_list()`+`invalidate_dashboard()`+`invalidate_correlation()`+`invalidate_sector()`+`invalidate_macro()`를 호출(전 사용자 대시보드 클리어).
- `TTLCache.get(key, loader)`(`:12`)는 loader 콜백을 받아 캐시 미스 시 호출하는 read-through 패턴.

### 2.7 지연(lazy) import로 순환참조 회피

- 모듈 상호 의존은 함수 본문 안에서 import해 깬다. `services/storage.py:266-268` 주석 "storage↔cache 순환참조 회피용 지연 import" → 함수 내부 `from services import cache as cache_svc`.
- 같은 패턴 다수: `services/market.py:127` `from services.kiwoom import client, quote as kq`, `:142` `from services.kis import client`, `services/analysis_service.py:51`, `services/consensus.py:43`, `services/digest_service.py:156,192`, `routers/report.py`의 핸들러들이 본문에서 서비스 함수를 import(`:352,360,369`).

### 2.8 DB 접근 헬퍼

- 모든 DB 접근은 `services/db.py`의 `query(sql, params)`(SELECT→dict 리스트)·`execute(sql, params)`(INSERT/UPDATE/DELETE→rowcount) 2개 헬퍼로 단일화. psycopg2 `ThreadedConnectionPool`(minconn=1, **maxconn=20** — ThreadPool 동시성보다 크게, 소진 시 블록 아닌 PoolError, `:21-27`), `RealDictCursor`로 dict 반환.
- `get_connection()`(`:32`)은 `@contextmanager` — 성공 시 commit, 예외 시 rollback 후 re-raise, finally에서 putconn.
- 외부 시세는 **DB 우선, 파일 폴백** 패턴. `routers/stocks.py:27` `_latest_snapshot`이 `try: query(...) except Exception: pass` 후 파일시스템(`SNAPSHOTS_DIR`/`REPORTS_DIR`) 폴백. 요청당 N콜을 줄이는 배치 read 헬퍼(`_latest_snapshots` `:53`, `SELECT DISTINCT ON (ticker) ... = ANY(%s)`)도 둠.

### 2.9 에러·예외 처리

- HTTP 에러는 `services/errors.py`의 팩토리로 통일: `not_found(ticker, context)`→404, `already_exists(ticker, context)`→400(둘 다 `HTTPException` 반환). 라우터에서 직접 `raise HTTPException(status_code=..., detail="...")`도 혼용(예: `report.py:436` "리포트를 먼저 생성하세요").
- 외부 fetch 실패는 **graceful 빈 결과** 처리. 예: `services/insider_trades.py`의 `fetch_insider_trades`가 DART status 013(무데이터)·예외 모두 `[]` 반환(테스트 `test_insider_trades.py:103`).
- **silent except 금지** 규범. 배치/외부 fetch 경로는 예외를 삼키지 말고 로깅·집계. `scheduler.py:33,39,62,72`는 `except Exception as e: print(f"[Scheduler] ... failed: {e}")`로 로깅(scheduler는 `print(f"[Scheduler] ...")` 진단 로그가 관례). 빈/all-None 결과는 캐시에 박제 금지(직전 양호값 유지).
- 입력 검증 헬퍼는 `services/utils.py`: `is_valid_ticker`(`:9`, strip·upper 후 `^[A-Za-z0-9.\-]{1,15}$`), `find_ticker`/`find_ticker_index`/`ticker_exists_in`(모두 upper 비교).

### 2.10 ticker 정규화 관례

- ticker는 비교·저장 시 `.upper()`로 정규화하는 게 일관 관례(`utils.py:11,16,21,26`, `recommendations.py:65,89`, `insider_trades.upsert` 테스트가 `params[1] == "005930.KS"` upper 단언).

## 3. 프론트엔드 (React 19 + Vite, plain CSS)

### 3.1 스타일링 — 디자인 토큰 + plain CSS

- TailwindCSS 없음. CSS 변수 토큰을 `frontend/src/styles/tokens.css`에 정의하고 컴포넌트는 `var(--token)`을 참조. `[data-theme="dark"]`로 라이트/다크 토큰 분기(`:73`).
- 컴포넌트별 CSS 파일 동봉(`Badge.jsx`+`Badge.css`, `Button.jsx`+`Button.css` ... `frontend/src/components/ui/`). JSX 상단에서 `import './Badge.css'`.
- 폰트는 시스템 스택(`--font-sans` Inter/Pretendard/-apple-system ...). `.tnum`/`.mono`로 tabular-nums 적용.

### 3.2 한국 색 관례 (KR coloring) — success/danger 변형 함정

- **`--up`=빨강(상승), `--down`=파랑(하락)** (`tokens.css:26-29`, 주석 "Korean coloring: 상승=red, 하락=blue").
- 그 결과 `.badge--success`=`--up`(**빨강**), `.badge--danger`=`--down`(**파랑**)으로 매핑됨(`ui/Badge.css:29-37`). 즉 가격 방향 배지에는 맞지만(상승=success=빨강), **의미 상태 배지(좋음/나쁨)에 success/danger를 쓰면 Western 통념(녹=좋음/빨=경고)과 반전**된다.
- `ChangeBadge`(`Badge.jsx:33`)는 가격 방향이므로 `value >= 0 ? 'success' : 'danger'`가 의도대로(상승=빨강). 반대로 **의미 상태 배지는 전용 색을 명시**: `ui/SupplyBadge.jsx`가 success/danger를 피하고 inline `style`로 우호=초록/중립=회색/경계=주황을 직접 지정(`:7-11`, 주석에 충돌 이유 기록).
- `.badge--warning`은 `--warn`/`--warn-soft`(주황) 토큰을 참조(`Badge.css:39`). `.badge--info`는 `--accent-tint`를 참조하나 토큰이 tokens.css에 미정의로 보이므로(정의는 `--accent-soft`) caution 용도 확인 필요.
- 백엔드도 이 관례를 따라 **플래그 색을 결정하지 않는다**: `scoring.py:8` 주석 "플래그 색은 백엔드에서 결정하지 않는다(KR 가격 토큰 success/danger 금지) — {label, kind} 문자열 페어로만 내보내고 색 매핑은 프론트 담당".

### 3.3 컴포넌트 그룹핑

- `frontend/src/components/`는 도메인별 디렉터리: `ui/`(Badge, Button, Card, Stat, icons, InsiderBadge, SupplyBadge + `index.js` 배럴), `market/`, `reports/`, `portfolio/`, 루트(StockModal, MobileNav, Toast 등).
- `pages/`는 화면 단위, `hooks/`·`contexts/`·`utils/`로 로직 분리.

### 3.4 API 클라이언트

- `frontend/src/api.js`가 axios 인스턴스 단일 export. baseURL은 `import.meta.env.VITE_API_BASE_URL || ''`(미설정 시 상대경로 → Vite proxy). 요청 인터셉터가 `localStorage` access_token을 `Authorization: Bearer`로 주입, 응답 401 시 토큰 삭제 후 `/`로 리다이렉트.
- JSX는 세미콜론 생략 스타일(`api.js` 등). `export default` 컴포넌트 + named export 보조 컴포넌트(`Badge.jsx`의 `MarketBadge`/`ChangeBadge`).

### 3.5 비-additive 응답 변경 시 프론트 소비처 전수 grep

- 엔드포인트 응답을 배열→객체 등으로 reshape하면 그 엔드포인트를 fetch하는 **모든** 프론트 소비처(훅과 별개의 독립 fetcher 포함)를 `grep -rn '<경로>' frontend/src/`로 찾아 전부 갱신해야 함(과거 대시보드 reshape 시 상관관계 탭이 조용히 깨진 이력). 가능하면 additive 선호.

## 4. 문서 동기 규범 (DoD)

- API 엔드포인트/스키마/인증 게이팅 변경 시 `API_SPEC.md`(전체 REST)와 `CLAUDE_COWORK_API.md`(외부 Cowork API) **둘 다** 갱신.
- 기능 표면(화면·env·스택·아키텍처·배치) 변경 시 `README.md` 해당 절도 같은 PR에서 갱신.
- 의사결정은 `.forge/adr/NNNN-*.md`로 기록하고 코드 docstring에서 인용.
