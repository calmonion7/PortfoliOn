---
last_mapped_commit: f835958b49b4a4d7ce30254fd610ed6362462311
mapped: 2026-06-22
---

# CONVENTIONS

PortfoliOn 코드 스타일·네이밍·패턴·에러 처리 관찰 기록. 백엔드(Python/FastAPI)와 프론트엔드(React 19/plain CSS) 양쪽을 다룬다.

## Backend (Python / FastAPI)

### Module / file 구조

- 서비스 레이어는 `backend/services/`에 모듈/패키지로 둔다. 단일 파일이 커지면 패키지로 분해한다.
  - 예: 구 `backend/services/storage.py` → `backend/services/storage/` 패키지 (`__init__.py`, `portfolio.py`, `names.py`, `schedule.py`, `dates.py`). ADR-0017.
  - 패키지 `__init__.py`(`backend/services/storage/__init__.py`)는 서브모듈의 공개 심볼을 전부 re-export 한다. 주석에 명시된 이유: 외부 소비처가 모듈 속성(`storage.X`)으로 조회하므로 모든 심볼이 패키지 루트에 존재해야 한다. `from services.storage import X` 직접 import는 0건.
- 시장 데이터 소스는 시장별 모듈로 분리: `backend/services/market/kr.py`, `backend/services/market/format.py`(`_norm_sector`, `_n` 헬퍼), `backend/services/market/__init__.py`.
- 모든 모듈 파일 첫 줄에 `from __future__ import annotations`를 두는 것이 일반적 (`backend/services/market/kr.py:1`, `backend/routers/report.py:1`, `backend/services/utils.py:1`).
- 파일 상단 주석으로 모듈 경로/근거 ADR을 명시하는 패턴: `# backend/services/storage/portfolio.py`, `# backend/services/storage/names.py:1`.

### Naming

- **Private helper는 `_` 접두사**: `_naver_get`, `_kr_basic_naver`, `_kr_pick_basic`, `_price_sane`, `_corroborated_pick`, `_kr_closes_kiwoom` (`backend/services/market/kr.py`); `_slim_summary`, `_mk_entry`, `_read_snapshot`, `_run_generation`, `_run_backfill` (`backend/routers/report.py`); `_parse_json_field`, `_invalidate_name_caches` (storage).
- 모듈 레벨 상수는 `_UPPER` 또는 `UPPER`: `_NAVER_HEADERS`, `_NAVER_BASE`, `_FNGUIDE_HEADERS` (`kr.py`); `_RSI_KEYS`, `_SLIM_KEYS`, `SNAPSHOTS_DIR`, `REPORTS_DIR` (`report.py:21-29`); `TICKER_RE` (`utils.py:6`).
- 불변 집합은 `frozenset`: `_ANALYST_KEYS`, `_JSON_TEXT_FIELDS`, `_ENRICH_KEYS` (`backend/services/storage/portfolio.py:5-6,249`).
- 라우터는 `router = APIRouter(prefix="/api", tags=[...])` (`backend/routers/report.py:19`). 엔드포인트 함수명은 동사형(`list_reports`, `get_report`, `generate_all`, `refresh_analyst`).
- 타입 힌트는 PEP 604 union (`dict | list`, `tuple | None`, `float | None`) 사용 (`kr.py:15,66,106`).

### Error handling — graceful try/except

지배적 패턴: **외부 I/O(yfinance/Naver/FnGuide/DART/키움/KIS) 호출을 `try/except Exception`으로 감싸고 실패 시 안전 기본값(None / [] / `_empty` dict)을 반환**한다. `grep "except Exception"`은 거의 모든 서비스 모듈에 분포 (`report_generator.py` 8건, `consensus_pipeline.py` 10건, `digest_service.py` 6건, `backlog.py` 5건 등).

- None 반환: `_fnguide_market_cap` (`kr.py:35-37`), `_kr_basic_kiwoom` / `_kr_basic_kis` (실패/미설정/빈 price면 None, `kr.py:66-93`).
- 빈 리스트 반환: `_kr_closes_kiwoom` (`kr.py:96-103`), `get_financials_kr` / `get_annual_financials_kr` (`kr.py:300-352`, `except Exception: return []`).
- 빈 dict 반환: `get_analyst_data_kr`는 `_empty` 사전을 정의해 두고 실패·무데이터 시 반환 (`kr.py:394-436`).
- 함수 전체를 감싸는 큰 try/except + 부분 보강 블록은 따로 try/except: `get_quote_kr`은 전체를 try로 감싸 실패 시 `price=None`의 에러 dict 반환(`delisted` 플래그 포함, `kr.py:286-297`), 그 안의 yfinance sector/industry 보강은 별도 `try/except Exception: pass` (`kr.py:250-269`).
- 라우터의 배치 워커는 종목별 try/except로 한 종목 실패가 전체를 멈추지 않게 한다: `_run_backfill`, `_run_generation`의 `_process_one`은 실패를 `print(f"[Report] Failed for ...")` 로깅 후 진행 (`report.py:79-83,130-132`).
- HTTP 오류 코드로 도메인 의미 판정: Naver 409 = 상장폐지 (`kr.py:288`, `get_quote_kr` except 블록에서 `requests.exceptions.HTTPError` + `status_code == 409`).
- "wrong < missing" 원칙: 추출/검산 실패 시 잘못된 기본값(억원 폴백) 대신 누락(pending)으로 처리 (CLAUDE.md backlog gotcha, `_price_sane` 등 가드 함수).

### NaN / inf sanitize

- 중앙 sanitizer는 `backend/services/utils.py:29` `sanitize(obj)` — float가 NaN/inf면 None으로, dict/list는 재귀 처리. starlette `JSONResponse`(`allow_nan=False`)의 직렬화 500을 막는 출력 가드.
- 라우터에서 `from services.utils import sanitize as _sanitize`로 import, 응답 직전 적용: `_slim_summary`가 `return _sanitize(s)` (`report.py:40`), `_read_snapshot`이 DB/파일 데이터를 `_sanitize(...)`로 감싸 반환 (`report.py:149,154`).
- CLAUDE.md 가이드: 출력 일괄 sanitize보다 **소스에서** NaN을 가드(`math.isfinite` 체크 후 "시세 없음" 처리)하는 것이 권장. `kr.py`의 `_n` 헬퍼(`services.market.format`)가 값 정규화 단계에서 변환.

### Lazy imports (circular dep 회피)

함수 본문 안에서 import하는 패턴이 의도적으로 쓰인다.

- storage ↔ cache 순환참조 회피: `_invalidate_name_caches`가 함수 안에서 `from services import cache as cache_svc` (`backend/services/storage/names.py:6-14`, 주석 "storage↔cache 순환참조 회피용 지연 import").
- 외부 소스 어댑터 지연 로드: `_kr_basic_kiwoom`이 `from services.kiwoom import client, quote as kq` (`kr.py:69`), `_kr_basic_kis`가 `from services.kis import client, quote as kisq` (`kr.py:84`), `_kr_closes_kiwoom`이 `from services.kiwoom import chart as kchart` (`kr.py:99`).
- 라우터에서 서비스 함수를 엔드포인트 안에서 지연 import: `get_backlog`/`get_disclosures`/`get_pending_backlog` 핸들러가 본문에서 `from services.backlog import ...` (`report.py:307,318,352`).
- 표준 라이브러리도 함수 안에서 늦게 import하는 경우: `_fnguide_market_cap`의 `import re` (`kr.py:27`), `get_analyst_data_kr`의 `import json as _json` (`kr.py:397`), `refresh_analyst`의 `import yfinance as yf` (`report.py:429`).

### DB 접근

- DB 헬퍼는 `backend/services/db.py`의 `query`, `execute`, `get_connection`. 서비스/라우터는 `from services.db import query, execute`로 import (`report.py:15`, `portfolio.py:3`).
- `query`는 dict row 리스트 반환(테스트가 `[{"ticker": ...}]` 형태 기대). `execute`는 쓰기.
- 다단계 쓰기는 `with get_connection() as conn: with conn.cursor() as cur:` 블록에서 여러 `cur.execute` (`portfolio.py:49-86,102-137`).
- UPSERT는 `INSERT ... ON CONFLICT (...) DO UPDATE SET ...`. 이름 클로버 방지 가드: `name=CASE WHEN EXCLUDED.name IS NULL OR EXCLUDED.name = EXCLUDED.ticker THEN tickers.name ELSE EXCLUDED.name END` (`portfolio.py:58,124`).
- 파라미터는 항상 `%s` 플레이스홀더 + 튜플; ANY 배열은 `ticker = ANY(%s)`와 `(list(...),)` (`report.py:184,198`).
- JSONB 부분 갱신은 `jsonb_set(data, '{name}', to_jsonb(%s::text))` (`names.py:22,42`).

### 기타 패턴

- 라우트 순서 함정 방어: 구체 경로(`/report/{ticker}/backlog`, `/disclosures`, `/insider-trades`)를 catch-all `/report/{ticker}/{date_str}`보다 **먼저** 등록. 주석으로 이유를 남긴다 (`report.py:347-371`). `PUT /api/stocks/enrich/batch`도 `{ticker}/enrich`보다 먼저 (CLAUDE.md).
- 캐시 무효화는 mutation 후 명시 호출: `cache_svc.invalidate(ticker)` + `invalidate_list()` (`report.py:78,474`; `names.py:11-12`).
- 백그라운드 작업은 FastAPI `BackgroundTasks` + `job_runs.record(id, trigger)` 컨텍스트 매니저로 실행 이력 기록 (`report.py:69,138,319`).
- 인증 게이팅은 `Depends(...)`: `get_current_user`, `require_admin`, `get_current_user_or_api_key`, `require_admin_or_api_key` (`backend/auth.py`, `report.py:16`).
- 진행률은 `ProgressTracker` 인스턴스 (`report.py:42-43`).

## Frontend (React 19 + Vite)

### Styling — plain CSS, no TailwindCSS

- 컴포넌트별 CSS 파일을 동일 디렉터리에 두고 import: `import './Badge.css'` (`Badge.jsx:1`), `import './Card.css'` (`Card.jsx:1`). `frontend/src/components/ui/`에 `*.jsx` + `*.css` 쌍 (`Badge`, `Button`, `Card`, `Input`, `Skeleton`, `Stat`).
- 디자인 토큰은 CSS 변수로 `frontend/src/styles/tokens.css`의 `:root` / `[data-theme="dark"]`에 정의. `var(--bg)`, `var(--text)`, `var(--border)`, `var(--accent)`, spacing(`--space-1..6`), radius(`--radius-*`), shadow(`--shadow*`).
- inline style 객체도 폭넓게 사용하며 항상 토큰 참조: `style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)' }}` (`reportUtils.jsx:51`, `DetailTab.jsx`). 재사용 스타일 상수는 모듈에 export: `TH`, `TD` (`reportUtils.jsx:4-5`).

### KR color convention — `--up`=red / `--down`=blue

- `frontend/src/styles/tokens.css:25-30`: `--up: #d83a3a` (red = 상승), `--down: #2864e8` (blue = 하락). 다크 테마는 `:104-106`.
- 가격 방향 색은 `var(--up)` / `var(--down)`로: `gap.positive ? 'var(--up)' : 'var(--down)'` (`reportUtils.jsx:69,97,118`), 글로벌 유틸 클래스 `.up`/`.down` (`tokens.css:174-175`).
- **의미(semantic) 상태 배지에는 가격 토큰을 쓰지 않는다.** `--up`/`--down`이 KR 가격색이라 `.badge--success`(빨강)/`.badge--danger`(파랑)는 Western 통념(녹=좋음)과 반전됨.
  - `Badge.jsx`의 `ChangeBadge`는 가격 방향용이므로 `value >= 0 ? 'success' : 'danger'` 변형 사용이 의도적 (`Badge.jsx:33-42`).
  - 의미 배지는 전용 색을 명시 지정: `SupplyBadge.jsx`의 `BAND_DISPLAY`가 `style={{ background, color, borderColor }}`로 우호=초록·중립=회색·경계=주황을 직접 지정하고 `variant="neutral"`만 쓴다 (`frontend/src/components/ui/SupplyBadge.jsx:7-26`, 주석에 근거 명시 ADR-0014).
  - semantic 전용 토큰 따로 존재: `--color-success/error/info`, `--semantic-buy/sell`, `--corr-pos/neg/zero` (`tokens.css:42-55`). Buy/Sell 색은 `var(--semantic-buy)` / `var(--semantic-sell)` (`reportUtils.jsx:126,130`).
  - `--warning` / `--color-warning` 변형은 미정의라 caution 색으로 쓸 수 없음(CLAUDE.md).

### Component 패턴

- 함수형 컴포넌트 + props 구조분해 + 기본값: `function Card({ padding = 'md', hover = false, ..., className = '', children, ...props })` (`Card.jsx:5-13`). `...props` 스프레드로 passthrough.
- 클래스 조합은 배열 + `.filter(Boolean).join(' ')` (`Card.jsx:14-20`) 또는 `.join(' ')` (`Badge.jsx:14`). variant→className 매핑 객체 + nullish 폴백: `variantClass[variant] ?? 'badge--neutral'` (`Badge.jsx:3-14`).
- `as` prop으로 렌더 태그 교체: `as: As = 'div'` → `<As className={classes}>` (`Card.jsx:9,22`).
- export 패턴: default export 컴포넌트 + named export 보조 컴포넌트(`MarketBadge`, `ChangeBadge` in `Badge.jsx`; `CardHeader` in `Card.jsx`). UI 패키지 barrel은 `frontend/src/components/ui/index.js`가 `export { default as Button } from './Button'` 형태로 재노출.
- 표시용 헬퍼/포매터는 같은 모듈에 named export: `fmtN`, `rsiColor`, `fmtGap`, `_weather`, `overallWeather`, `MetricCard`, `SectionTitle`, `GapCell`, `TargetTooltip` (`frontend/src/components/reports/reportUtils.jsx`). private-ish 헬퍼도 `_weather`처럼 `_` 접두사를 쓰되 export 한다.
- 값 포매팅은 공용 유틸 import: `import { fmtPrice as fmt } from '../../utils'` (`reportUtils.jsx:2`, `DetailTab.jsx:2`). 시장별 포매팅 헬퍼 `krFmt`는 `frontend/src/components/market/marketUtils.jsx` (입력 단위='억원' 가정).
- null/결측 표시는 `'—'` em-dash (`reportUtils.jsx:7,69,96`).
- API 호출은 `import api from '../../api'` (`DetailTab.jsx:7`). 훅은 `frontend/src/hooks/` (예: `useIsMobile`, `DetailTab.jsx:8`).
- 컴포넌트는 기능별 하위 디렉터리: `frontend/src/components/reports/`(리포트 상세 탭·차트·섹션), `frontend/src/components/ui/`(원자 컴포넌트), `frontend/src/components/market/`, `frontend/src/components/portfolio/`.
