---
last_mapped_commit: b6193c3837f4125a41930c36a2b3ae2ef198dc3c
mapped: 2026-06-22
---

# CONVENTIONS

PortfoliOn 코드 스타일·네이밍·패턴·에러처리 관례. 백엔드(Python/FastAPI)와 프론트(React 19 + plain CSS)로 나눠 기술. 모든 사실은 실제 파일에서 확인됨.

## Backend (Python)

### Private helper 네이밍 — `_foo`

모듈 내부 전용 헬퍼는 전부 leading-underscore. 라우터·서비스 모두 일관.

- `backend/services/market/kr.py`: `_naver_get`, `_fnguide_market_cap`, `_naver_row_val`, `_kr_basic_naver`, `_kr_basic_kiwoom`, `_kr_basic_kis`, `_kr_closes_kiwoom`, `_price_sane`, `_corroborated_pick`, `_kr_pick_regular`, `_kr_pick_degenerate_lazy`, `_kr_pick_basic`
- `backend/routers/stocks.py`: `_latest_snapshot`, `_latest_snapshots`, `_search_naver`, `_usdkrw_rate`, `_run_dividends_all`, `_run_supply_score_all`
- 공개 API는 underscore 없음: `get_quote_kr`, `get_dashboard`, `enrich_single`.

### Graceful try/except — None / [] / 빈 dict / 최소형 반환

외부 I/O(시세·HTTP·DB)는 예외를 삼키고 빈/None/기본형을 반환하는 게 기본. 호출측은 항상 "데이터 없음"을 다룰 수 있어야 함.

- `kr.py:get_financials_kr` / `get_annual_financials_kr`: `except Exception: return []`
- `kr.py:get_analyst_data_kr`: `_empty` 상수 dict를 선언하고 실패 시 `return _empty`
- `kr.py:_fnguide_market_cap`: `except Exception: pass` 후 `return None`
- `kr.py:_kr_basic_kiwoom` / `_kr_basic_kis`: 미설정(`configured()` False)·예외·빈 price면 `return None`
- `stocks.py:_latest_snapshot`: DB 시도 → `except Exception: pass` → 파일시스템 폴백 → 둘 다 실패 시 `(None, None)`
- `stocks.py:_search_naver`, `get_stock_news`: `except Exception: return []`

**예외의 부분 전파**: `kr.py:_kr_basic_naver` 독스트링 "HTTP 오류(상폐 409)는 전파" — 상장폐지 검출을 위해 일부 HTTP 에러는 일부러 위로 던지고, `get_quote_kr`의 바깥 try가 `requests.exceptions.HTTPError` status 409를 잡아 `delisted: true`로 변환.

### NaN/inf sanitize

`backend/services/utils.py:sanitize(obj)` — float가 `math.isnan` 또는 `math.isinf`면 `None`으로, dict/list는 재귀 sanitize. starlette `JSONResponse`(allow_nan=False)가 NaN/inf에 500을 내는 것을 막는 출력단 가드. (CLAUDE.md 권장은 소스단 `math.isfinite` 가드가 더 깨끗.)

### Lazy import — 순환참조 회피

`storage ↔ cache` 처럼 상호 import하는 모듈은 함수 내부에서 지연 import.

- `backend/services/storage/names.py:_invalidate_name_caches`: 함수 본문에서 `from services import cache as cache_svc` (독스트링 "storage↔cache 순환참조 회피용 지연 import"), `try/except Exception: pass`로 감쌈
- `backend/services/market/kr.py`의 키움/KIS 헬퍼: 함수 본문에서 `from services.kiwoom import client, quote as kq` / `from services.kis import client, quote as kisq` (런타임 서비스 경계 분리)
- `routers/stocks.py:_run_dividends_all`: `from services.dividends import fetch_all_dividends` 함수 내부

### Per-card graceful build — dashboard `_build_all` → `_safe` / `_minimal_card`

`backend/routers/stocks.py:get_dashboard`의 핵심 패턴. holdings=N이면 **항상 N개 카드**를 보장하고, 한 종목 실패가 전체 응답을 500-to-empty로 만들지 않음 (task#102).

- `_build_all()`: 일괄시세(`market.get_quotes_batch`)를 try로 감싸 실패 시 `quotes = {}`로 진행(시세 없이 빌드, price None은 폴링이 채움)
- `_safe(stock)`: `_build_card`를 try로 호출, 예외 시 `_minimal_card`로 폴백하고 `print(..., file=sys.stderr)`로 진단 로그
- `_minimal_card(stock, quote)`: 식별/보유정보 + quote 시세만 채우고 지표/배당/수급/내부자는 전부 None
- `ThreadPoolExecutor(max_workers=min(len(holdings), 10))`로 카드 병렬 빌드 — 워커 수를 holdings·풀크기로 캡
- 응답 shape: `{"holdings": [...], "totals": {...} | None}`. holdings=[] 이면 `{"holdings": [], "totals": None}`로 조기 반환

### Bake-time independent-feed gate

리포트 스냅샷 박제 시 외부 시세 글리치를 독립 피드와 대조해 박제를 스킵하는 게이트(`backend/services/report_generator.py`, KR `regular=True` 경로). 자기일관 글리치(quote·일봉 둘 다 ~70k)를 네이버 등 독립 소스와 2x 밖이면 `ValueError`로 박제 중단 — 스냅샷에 잘못된 값을 영속화하지 않음. 검증은 `test_report_price_gate.py` 참조.

### KR 시세 소스 발산 가드 — 다수결 + self-check

`backend/services/market/kr.py`의 멀티소스 시세 선택. 단일 참조 글리치에 면역시키는 패턴:

- `_price_sane(price, prev_close, ref_close)`: ① 전일종가 ±30%(KR 일일 가격제한폭, 상수 `0.7`/`1.3`), ② 키움 일봉 종가 `[0.5, 2.0]` 교차검증. 참조 무효(None/≤0)면 그 검증만 생략
- `_corroborated_pick(feeds)`: 독립 피드 2-of-N 다수결. 순수 함수(I/O 없음). `feeds = [(priority_rank, src, basic_tuple)]`, rank 순서가 곧 반환 우선순위(키움 NXT 0 → KIS 1 → Naver 2 → 키움 KRX 3)
- `_kr_pick_basic(ticker, ref_close, regular)`: `regular=True`(리포트)면 `_kr_pick_regular`(KRX 우선순위 체인), `regular=False`(NXT 라이브)면 다수결. 평소엔 키움 NXT+KRX 2콜로 lazy short-circuit(KIS/Naver 미호출), 불일치 시에만 escalate
- 폐기 시 `print(f"[quote] {ticker}: ... 폐기")` 진단 로그(silent except 금지 — CLAUDE.md)

### `regular` 플래그 전파 — 시세 기준 이원화

키움 코드선택 단일 분기점이 `regular` 키워드 인자. 기본 `False`=NXT 시간외(`_AL`), `True`=KRX 정규장 평문코드. `get_quote_kr(ticker, exchange, regular=False)` → `_kr_pick_basic(..., regular=regular)` → `_kr_basic_kiwoom(t, regular=regular)` / `_kr_closes_kiwoom(t, regular=regular)`로 전파. 리포트 스냅샷 writer만 `regular=True`로 opt-in(ADR-0020).

### 상수·정규식 모듈 레벨 선언

`backend/routers/stocks.py`: `_KR_PATTERN = re.compile(r'[가-힣]')`, `_INTL_SUFFIX = re.compile(...)`, `SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"`. `backend/services/market/kr.py`: `_NAVER_HEADERS`, `_NAVER_BASE`, `_FNGUIDE_HEADERS`를 모듈 상단에 둠.

### FastAPI 라우터 관례

- `router = APIRouter(prefix="/api/stocks", tags=["stocks"])` — prefix+tags
- 인증: `Depends(get_current_user)` / `Depends(get_current_user_or_api_key)` / `Depends(require_admin)`
- 라우트 등록 순서 주의: `PUT /enrich/batch`를 `PUT /{ticker}/enrich`보다 **먼저** 등록(FastAPI가 `enrich`를 ticker 값으로 라우팅하는 것 방지 — CLAUDE.md gotcha)
- 본문 모델은 `pydantic.BaseModel` 서브클래스(`EnrichBody`, `BatchEnrichItem`), `Optional[Any]`로 nullable 필드
- 백그라운드 작업은 `BackgroundTasks.add_task` + `with job_runs.record(id, "manual"):` 컨텍스트로 실행 기록
- 응답은 plain dict/list 직접 반환(별도 response_model 없음이 일반)
- ticker는 일관되게 `.upper()`로 정규화 후 비교/저장

## Frontend (React 19)

### Plain CSS — TailwindCSS 없음

스타일은 전부 plain CSS. 디자인 토큰은 `frontend/src/styles/tokens.css`의 CSS 변수(`:root` + `[data-theme="dark"]`). 컴포넌트별 `.css` 파일(`ui/Badge.css` 등) + 인라인 `style={{...}}` 혼용.

### KR 색 관례 — `--up`=red / `--down`=blue

`frontend/src/styles/tokens.css`:
- `--up: #d83a3a`(red = 상승), `--down: #2864e8`(blue = 하락) — 한국 시장 관례(주석 "Korean market coloring")
- 다크 테마는 `--up: #ff4d4d` / `--down: #4d8bff`
- 유틸 클래스 `.up { color: var(--up); }` / `.down { color: var(--down); }`
- **가격 방향이 아닌 의미 상태는 별도 토큰**: `--color-success` / `--color-error` / `--semantic-buy` / `--semantic-sell`(주석 "Semantic state colors — NOT price direction"). 의미 배지에 `success`/`danger` Badge variant를 쓰면 KR 가격색으로 박혀 의미가 반전됨(CLAUDE.md gotcha) — 전용 색 토큰을 명시할 것

### 공유 컴포넌트 추출 — `StockActions.jsx`의 `layout` prop

`frontend/src/components/reports/StockActions.jsx`: 보유/관심 카드 액션버튼(수정·승격·삭제·전체삭제)의 단일 소스(task#103). 이전엔 `StockCard`(그리드)·`TickerListItem`(사이드바)에 byte-identical로 중복돼 있던 블록을 통합.

- `layout` prop으로 렌더 컨테이너 분기: `'card'`(그리드 카드 본문 — `<div style={{display:'flex',...}}>` 래퍼) | `'list'`(사이드바 — fragment `<>...</>`, 기본값)
- 두 소비처 모두 `import StockActions from './StockActions.jsx'`: `StockCard.jsx:98`, `TickerListItem.jsx:102`
- **가시성은 category가 아니라 `is_mine`으로 게이트**(task#97): `info.is_mine === false`(타인 종목)면 전체삭제(`/api/admin`)만, 본인 종목이면 수정·[승격]·삭제. 액션버튼 변경은 이 파일 한 곳만 고치면 됨

### 컴포넌트 디렉터리 구조

`frontend/src/components/reports/`에 리포트/종목 카드 관련 컴포넌트 집중: `StockCard.jsx`, `TickerListItem.jsx`, `StockActions.jsx`, `DetailTab.jsx`, `HistoryTab.jsx`, `Sections.jsx`, `ConsensusChart.jsx`, `FinancialsChart.jsx`, `reportUtils.jsx`(공유 유틸). UI 프리미티브는 `components/ui/`(`Badge`, `Button`, `Card`, `Stat`, `icons`).

### 한국어 주석·UI 텍스트

코드 주석·UI 라벨·title 속성 모두 한국어("수정", "보유로 이동", "전체 삭제", "그외 탭"). 변수/함수명은 영어, 설명은 한국어가 일관된 패턴.
