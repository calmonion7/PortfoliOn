---
last_mapped_commit: 74f5ca940c42a3ee866a45ccccfe24ac701a04d9
mapped: 2026-06-27
---

# 코딩 컨벤션

**분석일:** 2026-06-27

PortfoliOn은 Python/FastAPI 백엔드(`backend/`)와 React 19 + Vite 프론트엔드(`frontend/`) 모노레포다. 아래는 실제 코드에서 관찰된 규칙으로, 새 코드를 작성할 때 그대로 따른다.

## 네이밍 패턴

### 백엔드 (Python)

- **모듈/파일:** snake_case — `backend/services/report_generator.py`, `backend/services/leverage_service.py`, `backend/routers/market_indicators.py`.
- **함수:** snake_case — `is_valid_ticker`, `find_ticker_index`, `get_quote_kr`, `invalidate_portfolio_caches` (`backend/services/utils.py`, `backend/services/cache.py`).
- **내부 헬퍼:** 선행 언더스코어 — `_build_all`, `_safe`, `_minimal_card`, `_usdkrw_rate`, `_portfolio_totals` (`backend/routers/stocks.py`), `_mc_load`/`_mc_save` (`backend/services/market_indicators/cache.py`), `_kr_pick_basic`/`_corroborated_pick` (`backend/services/market/kr.py`).
- **상수:** UPPER_SNAKE — `TICKER_RE` (`backend/services/utils.py`), `SAMPLE_STOCKS`, `KNOWN_UNDOCUMENTED` (`backend/tests/test_api_doc_sync.py`), `BATCHES`/`ALL_MENUS`/`VALID_EVENTS`.
- **Pydantic 요청 모델:** PascalCase + `Body` 접미사 — `EnrichBody` (`backend/routers/stocks.py`), `EventBody` (`backend/routers/events.py`), `PermissionsBody`/`BulkPermissionsBody` (`backend/routers/admin.py`).
- **타입 힌트:** 함수 시그니처에 타입 힌트를 단다(`def find_ticker(items: list, ticker: str, key: str = "ticker") -> Optional[dict]:`). 신규 모듈은 `from __future__ import annotations`를 파일 상단에 둘 수 있다(`backend/services/utils.py`).

### 프론트엔드 (React/JS)

- **컴포넌트 파일/함수:** PascalCase, `.jsx` — `frontend/src/components/ui/Badge.jsx`, `StockActions.jsx`, `frontend/src/pages/Portfolio.jsx`. `export default function ComponentName(...)` 형태.
- **훅:** `use` 접두 camelCase, `.js` — `frontend/src/hooks/useStockManagement.js`, `useReportFilters.js`, `usePortfolioData.js`. 디렉터리는 `frontend/src/hooks/`.
- **유틸/헬퍼 모듈:** camelCase 또는 `*Utils` — `frontend/src/components/market/marketUtils.jsx`, `frontend/src/components/reports/reportUtils`.
- **CSS 클래스:** BEM 변형 — 블록 `badge`, 변형 `badge--success`, 요소 `badge__icon` (`frontend/src/components/ui/Badge.jsx`).
- **CSS 커스텀 프로퍼티(토큰):** kebab-case with `--` — `--up`, `--down`, `--bg-elev`, `--color-success` (`frontend/src/styles/tokens.css`).

## 코드 스타일

### 포매팅/린팅

- **프론트엔드 린트:** ESLint flat config — `frontend/eslint.config.js`. `@eslint/js` recommended + `eslint-plugin-react-hooks`(flat recommended) + `eslint-plugin-react-refresh`(vite). `dist`는 ignore. 실행: `cd frontend && npm run lint`.
- 별도 Prettier 설정 파일은 없다(`.prettierrc` 없음). 스타일은 ESLint와 기존 코드 관행에 맞춘다.
- **백엔드:** 별도 ruff/flake8/black 설정 파일은 없다(`backend/pytest.ini`만 존재). 기존 파일 스타일(4-space indent, snake_case, 짧은 도커스트링)에 맞춘다.
- **주석:** 한국어로 작성하는 것이 관행 — `backend/tests/conftest.py`, `backend/services/utils.py`의 인라인 주석, `tokens.css` 주석 모두 한국어/혼용. 도커스트링도 한국어가 많다(`is_valid_ticker`, `test_api_doc_sync.py`).

### 모듈/파일 분리

- 비대해진 단일 파일은 **패키지 재export로 분리**한다(ADR-0017, `.forge/adr/0017-god-file-split-via-package-reexport.md`). 예: `backend/services/market_indicators/`(`cache.py`/`fx.py`/`commodities.py`/`earnings.py`/`econ.py`/`exports.py`/`macro.py`), `backend/services/kiwoom/`, `backend/services/kis/`, `backend/services/market/`(`kr.py` 등). 기존 import 경로는 패키지 `__init__`이 재export로 유지한다.

## Import 구성

### 백엔드

- 순서 관행: ① 표준 라이브러리(`import math`, `import re`, `from pathlib import Path`) → ② 서드파티(`from fastapi import ...`, `import pytest`) → ③ 로컬 모듈(`from main import app`, `from routers.watchlist import router`).
- **순환 import 회피는 함수 내부 지연 import로** 한다 — `storage`→`cache` 호출은 함수 내에서 `from services import cache`로 지연 import(루트 CLAUDE.md gotcha, `storage`↔`cache` 순환 방지).

### 프론트엔드

- API 호출은 `frontend/src/api.js`의 default export(axios 인스턴스)를 import해 사용 — `import api from '../api'` 후 `api.get/post/put/delete`. 테스트도 이 모듈을 mock 한다(`vi.mock('../api', ...)`).
- 경로 별칭(path alias)은 사용하지 않는다 — 상대 경로(`'../api'`, `'./useReportFilters'`) 사용.

## 에러 핸들링

### NaN/inf 가드 ("직렬화 500" 방지)

starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 **HTTP 500**(`Out of range float values are not JSON compliant`)이 난다. 외부 시세(yfinance `Close`, FX `usdkrw` 등)에서 흘러든 비유한값이 합산값을 오염시키는 게 전형이다.

- **출력 일괄 새니타이즈:** `backend/services/utils.py`의 `sanitize(obj)` — dict/list를 재귀 순회하며 `NaN`/`inf` float를 `None`으로 치환한다. 시세/합산을 응답에 싣는 엔드포인트(`backend/routers/stocks.py`의 `_build_all`, `backend/routers/report.py`, `backend/services/digest_service.py`, `leverage_service.py`, `recommendation/funnel.py`)가 이를 호출한다.

```python
def sanitize(obj):
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    return obj
```

- **소스 가드(더 선호):** 비유한값을 응답에 싣기 *전에* `math.isfinite`로 차단하는 편이 출력 일괄 새니타이즈보다 깨끗하다. 예: `_usdkrw_rate`는 저장 FX가 비유한이면 `None`을 반환해 US totals를 graceful 제외(`backend/routers/stocks.py`). `NaN != None`이므로 `if fx is None` 가드는 NaN을 통과시킨다 — 반드시 `math.isfinite`를 쓴다.
- **이중화:** 위험 엔드포인트는 소스 isfinite 가드 *와* 응답 `sanitize` 래핑을 둘 다 적용한다(출처 불문 안전망).
- **함정:** PostgreSQL `json` 컬럼은 NaN 저장을 거부하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과한다 → "DB저장 실패·파일성공·응답직렬화 실패"로 증상이 엇갈린다.

### "wrong < missing" (그레이스풀 스킵 vs 기본값)

데이터 추출/시세 검증에 실패하면 **틀린 값을 박제하지 말고 누락(pending/skip)으로 처리**한다. 잘못된 값이 정상으로 위장하는 것보다 비어 있는 게 낫다.

- 수주잔고 단위 캡션 파싱 실패 시 '안전한 기본값(억원)' 폴백은 ×100 대형 오저장을 만든다 → 추출 실패는 기본값이 아니라 `source='pending'`(amount=None)으로 둔다(`backend/services/backlog.py`).
- 리포트 박제 직전 KRX와 독립인 네이버 현재가로 2x 교차검증해 어긋나면 그 종목 박제를 **스킵**(직전 양호 스냅샷 유지)한다(`backend/services/report_generator.py`).
- 라이브 KR 현재가는 독립 피드 2-of-N 다수결로 outlier(글리치)를 폐기한다(`backend/services/market/kr.py`, `_corroborated_pick`).
- 배치 fetch가 빈/all-None 결과를 캐시에 박제하지 않는다 — 전부 None이면 save를 생략하고 직전 양호값을 유지한다. 외부 fetch 실패는 silent except로 삼키지 말고 로깅한다.

### HTTPException / 500-to-empty 금지

- 라우터는 검증 실패에 `HTTPException`을 raise한다(`backend/routers/` 14개 파일). 중복 추가→400, 미존재→404 등.
- **불변식: holdings=N → 항상 N 카드.** `backend/routers/stocks.py`의 `_build_all`은 `get_quotes_batch`를 try/except→`{}`로, 카드당 enrichment를 `_safe`(throw→`_minimal_card`)로 감싸 per-card 실패에도 전체 500을 내지 않는다. 프론트는 `Portfolio.jsx`의 `DashboardGrid`가 `stocks>0`이면 빈 상태 대신 Skeleton을 보이고 bounded 재시도(최대 3)로 self-heal 한다.

### FastAPI Body 파라미터

- PUT/POST에서 bare list/dict 본문은 반드시 `Body(...)`로 명시한다 — 누락 시 재빌드 후 기동 불가. 예: `backend/routers/batches.py`의 `schedule: dict = Body(...)`. 구조화 본문은 Pydantic `*Body` 모델을 쓴다.
- **라우트 등록 순서:** 구체 경로를 path-param 경로보다 먼저 등록한다 — `PUT /api/stocks/enrich/batch`를 `PUT /api/stocks/{ticker}/enrich`보다 **먼저** 등록(안 하면 `enrich`를 ticker 값으로 라우팅).

## KR 색 관례 (가격색 ↔ 의미색 분리)

`frontend/src/styles/tokens.css`는 한국 시장 관례를 따른다 — **상승=빨강(`--up: #d83a3a`), 하락=파랑(`--down: #2864e8`)**. Western(녹=좋음/빨=경고)과 반대다.

- 가격 *방향* 배지에는 `success`(빨강)/`danger`(파랑) 변형이 의도대로 동작한다 — `ChangeBadge`(`frontend/src/components/ui/Badge.jsx`)가 `value >= 0 ? 'success' : 'danger'`로 매핑(상승=빨/하락=파).
- **가격 방향이 아닌 의미 상태 배지(수급 밴드 등)에 `success`/`danger`를 쓰지 말 것** — `.badge--success`=빨강·`.badge--danger`=파랑으로 박혀 의미가 반전된다. 의미 배지는 전용 색을 명시하는 컴포넌트를 쓴다(예: `frontend/src/components/ui/SupplyBadge.jsx`, 가격 토큰 미사용).
- `--warn`/`--warn-soft`는 정의돼 있으나 `badge--warning`이 참조하는 `--color-warning`/`--warning-tint`는 미정의 — `warning` 변형은 현재 깨져 있어 caution 색으로 쓸 수 없다.
- 의미 상태 전용 토큰은 별도로 둔다: `--color-success`/`--color-error`/`--color-info`, `--semantic-buy`/`--semantic-sell`, `--corr-pos`/`--corr-neg`(`tokens.css`). 다크 테마는 `[data-theme="dark"]`에서 재정의.

## API 변경 규율: additive 우선, reshape는 전수 감사

- **additive(필드 추가)를 선호**하고 비-additive reshape(배열→객체 등)는 피한다. 불가피하면 그 엔드포인트를 fetch하는 *모든* 프론트 소비처를 `grep -rn '<경로>' frontend/src/`로 전수 갱신한다(독립 fetcher 포함). 한 곳만 고치면 다른 곳이 옛 형태로 조용히 깨진다.
- **additive로 read/외부호출을 *추가*하면 `mock.call_args`(마지막 호출)를 단언하는 기존 테스트가 오염된다.** additive는 응답 shape뿐 아니라 *호출 시퀀스*도 늘린다. 대응: ① 기존 단언을 `call_args_list[i].kwargs`(인덱스 명시)로 마이그레이션, ② 신규 호출은 입력 비면 `if`로 생략해 기존 테스트 보존, ③ 신규 테스트가 `call_count`로 시퀀스를 못박음. (테스트 작성 규약은 `TESTING.md` 참조.)
- **엔드포인트 존재 drift는 자동 검출된다** — 새 엔드포인트를 `API_SPEC.md`에 안 적으면 `backend/tests/test_api_doc_sync.py`가 실패. 추가/삭제/개명 시 `API_SPEC.md`와 `CLAUDE_COWORK_API.md`를 함께 갱신한다(요청/응답 스키마·인증 게이팅은 수동 DoD).

## 캐시 무효화 패턴

`backend/services/cache.py`에 인메모리 캐시들이 있다 — `TTLCache` 클래스(`get`/`invalidate`) 기반. snapshot(LRU), `_list_cache`(60s), `_dashboard_cache`(300s), `_correlation_cache`(300s), `_sector_cache`(300s), `_macro_cache`(300s), `_quote_cache`(60s), `_live_prices_cache`(15s).

- **무효화 함수는 명시적으로 호출한다** — `invalidate(ticker)`(스냅샷 LRU + `invalidate_list()`), `invalidate_dashboard`, `invalidate_correlation`, `invalidate_sector`, `invalidate_macro`, `invalidate_quote`, `invalidate_live_prices`, 그리고 묶음 `invalidate_portfolio_caches()`.
- **종목 추가/수정/삭제 시 관련 캐시를 전부 무효화한다** — dashboard·correlation·sector·macro·list가 자동 무효화돼야 화면에 즉시 반영된다. 무효화 누락 시 stale 화면(예: 종목 추가 후 리포트 목록 미갱신 → `invalidate_portfolio_caches`에 리스트 캐시 무효화 추가로 수정).
- **이름 변경은 dual-source 둘 다 갱신** — `tickers.name`(공유 마스터)과 `snapshots.data.name`(박제). DB만 바꾸면 `cache.get_list`·스냅샷 LRU 탓에 미반영 → `cache.invalidate(ticker)` + `invalidate_list()` 필수.
- **테스트 격리:** `get_quote`는 종목 단위 TTL 캐시를 쓰므로, `backend/tests/conftest.py`의 `_clear_quote_cache`(autouse fixture)가 매 테스트 전 `cache.invalidate_quote()`를 호출해 교차 오염을 막는다.

## 함수/모듈 설계

- **작고 단일 책임** — `backend/services/utils.py`의 헬퍼들처럼 한 가지 일만 하는 짧은 함수. 단일-사용 추상화는 만들지 않는다(프로젝트 `CLAUDE.md` §2 Simplicity First).
- **외부 API는 요청/기동 경로에서 라이브 호출하지 않는다** — 배치가 사전계산해 `market_cache`/테이블에 저장하고 요청은 저장값만 읽는다(랭킹·KR 업종 모멘텀 등). 기동 시 빈 캐시 적재는 `_seed_*_if_empty` 패턴.
- **프론트 컴포넌트는 default export 함수** — `export default function X(...)`. 중복 렌더링 로직은 단일 컴포넌트로 통합한다(예: 액션 버튼은 `frontend/src/components/reports/StockActions.jsx` 한 곳, `layout="card"|"list"`로 분기 — 그리드/사이드바 양쪽이 공유).

---

*컨벤션 분석: 2026-06-27*
