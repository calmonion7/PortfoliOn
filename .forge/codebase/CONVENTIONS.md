---
last_mapped_commit: 1e8da3bc525d61545c6c374b1f91a04238dabf30
mapped: 2026-07-10
---

# 코딩 컨벤션

**분석 기준일:** 2026-07-10

두 스택으로 나뉜다: **백엔드** Python/FastAPI (`backend/`), **프론트엔드** React 19 + Vite (`frontend/`, plain CSS·no TypeScript). 아래 규약은 실제 코드에서 관찰된 지배적 패턴이며, 신규 코드는 이를 따른다.

---

## 1. 네이밍 패턴

### 백엔드 (Python)

**파일:**
- 서비스/라우터 모두 `snake_case.py` — 라우터는 도메인 단수/복수(`stocks.py`·`report.py`·`market_indicators.py`), 서비스는 기능명(`report_generator.py`·`consensus_pipeline.py`·`dividends.py`).
- 대형 모듈은 **패키지로 분할 + `__init__.py` 재노출**(ADR-0017): `services/storage/`(`portfolio.py`·`names.py`·`dates.py`·`schedule.py`), `services/market/`, `services/market_indicators/`, `services/recommendation/`, `scheduler/`(`__init__.py`·`jobs.py`·`schedule.py`·`_state.py`), `services/kiwoom/`·`services/kis/`. 소비처는 `from services import storage`처럼 패키지명으로 import(내부 분할은 불투명).

**함수:**
- `snake_case`. **모듈 내부 전용 함수는 선행 언더스코어**(`_latest_snapshot`, `_build_all`, `_usdkrw_rate`, `_configure_logging`, `_migrate`) — 서비스 코드에서 이 관례가 광범위하다(private가 public과 비등하거나 더 많음). 공개 API/재사용 헬퍼만 언더스코어 없이 노출.
- 타입 힌트를 시그니처에 부여: `def _latest_snapshot(ticker: str) -> tuple:`, `def is_valid_ticker(ticker: str) -> bool:`. `typing`의 `Optional`/`List`/`Any`를 사용하고, 신규 모듈은 상단에 `from __future__ import annotations`를 선언(`services/utils.py`·`services/dividends.py`).

**변수/상수:**
- 지역/인자 `snake_case`. **모듈 상수는 UPPER_SNAKE**(`TICKER_RE`, `SNAPSHOTS_DIR`, `REPORTS_DIR`, `SAMPLE_PORTFOLIO`).

**타입/클래스:**
- `PascalCase`. 요청 바디는 **Pydantic `BaseModel` 서브클래스**로 정의(`class EnrichBody(BaseModel):`, `class BatchEnrichItem(BaseModel):` — `routers/stocks.py`).

### 프론트엔드 (React/JS)

**파일:**
- 컴포넌트는 `PascalCase.jsx`(`Badge.jsx`·`StockModal.jsx`·`BatchScheduleEditor.jsx`), CSS는 **동명 co-located** `PascalCase.css`(`Badge.jsx` + `Badge.css`).
- 훅은 `camelCase.js`이며 **`use` 접두사**(`useAuth.js`·`usePortfolioData.js`·`useStockManagement.js`), `hooks/`에 위치.
- 유틸/비컴포넌트 모듈은 `camelCase.js`(`api.js`·`utils.js`·`utils/analytics.js`·`utils/marketHours.js`).
- Context는 `PascalCaseContext.jsx`(`contexts/AuthContext.jsx`).

**컴포넌트/함수:**
- 함수형 컴포넌트, **기본 export는 named function 선언**: `export default function Badge({ variant = 'neutral', ... }) { ... }`. 같은 파일의 보조 컴포넌트는 named export(`export function MarketBadge(...)`, `export function ChangeBadge(...)` — `components/ui/Badge.jsx`).
- props는 구조분해 + 기본값(`{ size = 'sm', className = '', ...props }`).

---

## 2. 코드 스타일

**백엔드 포매팅/린팅:**
- 전용 포매터/린터 설정 없음(`pyproject.toml`·`.flake8`·`ruff.toml` 부재). 스타일은 관례로만 유지 — 4-space 들여쓰기, 함수 사이 2줄. 신규 코드는 주변 파일 스타일에 맞출 것.
- 자동 강제되는 스타일 가드는 3종: `tests/test_no_print.py`(§4의 print 금지), `tests/test_no_bare_today.py`(bare `date.today()` 금지 — §8), `tests/test_api_doc_sync.py`(문서 drift).

**프론트엔드 포매팅/린팅:**
- **ESLint flat config** `frontend/eslint.config.js` — `@eslint/js` recommended + `eslint-plugin-react-hooks`(flat.recommended) + `eslint-plugin-react-refresh`(vite). `dist` 무시. `npm run lint`.
- Prettier 설정 **없음**. TypeScript **없음**(JSX + plain JS, `@types/react`는 에디터 힌트용 devDependency일 뿐).
- 세미콜론 생략 스타일(ASI 의존), 작은따옴표. 주변 파일 관례 준수.

---

## 3. Import 조직

**백엔드 순서(관찰된 관례):**
1. `from __future__ import annotations`(신규 모듈)
2. 표준 라이브러리(`import os`·`import logging`·`import math`·`from pathlib import Path`)
3. 서드파티(`from fastapi import ...`·`from pydantic import BaseModel`·`import yfinance as yf`·`import pandas as pd`)
4. 로컬(`from services import storage`·`from services.db import query`·`from auth import get_current_user`)
5. 모듈 상단에서 로거 초기화: `import logging` → `logger = logging.getLogger(__name__)`.

- **순환참조 회피용 지연 import**: 함수 본문 안에서 `from services.db import execute`처럼 늦게 import(예 `main._migrate`, storage↔cache, `services/us_supply.py`의 `from services.db import query`). 모듈 최상단 import가 순환을 만들면 함수 내부로 옮긴다. (지연 import는 테스트 patch 대상 경로에 영향 — TESTING.md §4 참조.)

**프론트엔드:**
- 서드파티(`react`·`axios`·`recharts`·`react-router-dom`) → 로컬 상대경로(`./Badge.css`·`../api`·`../components/Toast`). 경로 alias 미사용(상대경로 `../`).
- API 접근은 **단일 axios 인스턴스** `frontend/src/api.js`를 default import(`import api from '../api'`). 이 인스턴스가 `Authorization` 헤더 주입(request interceptor)과 401 시 토큰 제거·리다이렉트(response interceptor)를 담당하므로 컴포넌트에서 axios를 직접 쓰지 말 것.
- UI 프리미티브는 barrel `components/ui/index.js`로 재노출(`export { default as Badge, MarketBadge, ChangeBadge } from './Badge'`).

---

## 4. 로깅 규약 (중요 — task#162/#163으로 전면 개편)

**백엔드 진단/경고/에러는 모듈 `logger`로 통일한다. 앱 코드에 `print(` 신규 금지.** 개편 후 `routers/`·`services/`·`scheduler/`·`middleware/`·`main.py`의 `print(` 개수는 **0**이며, `tests/test_no_print.py`가 이를 ast로 단언한다(HEAD 1e8da3b 재검증 완료).

**루트 로거 배선 — `backend/main.py` `_configure_logging()`:**
```python
def _configure_logging():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    for _noisy in ("urllib3", "yfinance", "apscheduler", "asyncio"):
        logging.getLogger(_noisy).setLevel(logging.WARNING)
    for _uv in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(_uv).propagate = False

_configure_logging()  # import 시점(라우터 import 전)에 1회 호출
```
- **왜 필수인가:** config가 없으면 root의 lastResort 핸들러가 WARNING+만 내보내 `logger.info`가 docker logs에 안 뜬다. `basicConfig(level=INFO)`가 이를 해소.
- 노이즈 서드파티(urllib3/yfinance/apscheduler/asyncio)는 WARNING으로 억제, uvicorn 로거는 `propagate=False`로 root 핸들러와의 중복 emit(double-log) 차단.

**모듈 로거 초기화(54개 모듈에서 동일):**
```python
import logging
logger = logging.getLogger(__name__)
```

**레벨 의미(사용 빈도로 확인됨, 2026-07-10 재집계):**
- `logger.warning` — **graceful 담화**(예상된 실패를 잡아 폴백/스킵할 때). 지배적(≈212건). 예: `logger.warning(f"[Report] {ticker} KR 베타 계산 실패: {e}")`, `logger.warning(f"[FX] 갱신 실패, 직전 저장값 유지: {failed}")`.
- `logger.error` — **예상치 못함·데이터 손실. 매우 아껴 쓴다**(현재 앱 전체에 단 1건): `logger.error(f"[Report] {ticker} KRX 시세 글리치 감지: ...")`(`services/report_generator.py`).
- `logger.info` — **배치/라이프사이클**(≈47건). 예: `logger.info(f"[Scheduler] Report generated for {stock['ticker']}")`, `logger.info("[Scheduler] Guru crawl completed")`.
- `logger.debug`/`logger.exception`은 현재 미사용(0건).

**포맷 규약 `logger.x(f"[Component] <무엇> (<ids>): {e}")`:**
- **`[Component]`는 PascalCase, 개념당 1스펠링**을 지킨다. formatter 프리픽스가 `%(levelname)s %(name)s`(모듈명)일 뿐 컴포넌트를 안 찍으므로, **메시지 안의 `[Component]` 마커가 유일한 grep 앵커**다. 실제 어휘 예: `[Scheduler]`(최다)·`[Migrate]`·`[Report]`·`[Funnel]`·`[Financials]`·`[Backlog]`·`[Pipeline]`·`[Digest]`·`[Backfill]`·`[AGM]`·`[Dividends]`·`[Consensus]`·`[Beta]`·`[Quote]`·`[KISQuote]`·`[Snapshot]`·`[FX]`. 같은 개념은 반드시 같은 철자로(예 `[KIS Quote]` 아닌 `[KISQuote]` — 커밋 ad7f85c가 이 정규화).
- `{e}`로 예외를 뒤에 붙이고, 종목/사용자 등 식별자를 함께 실어 grep 가능하게 한다.

**진단 로그를 삼키지 말 것:** 외부 fetch 실패를 broad `except: pass`로만 처리하면 "기능이 조용히 꺼짐"이 된다 — 최소한 `logger.warning`으로 담화를 남기고 좁은 예외만 잡는다.

---

## 5. 에러 처리

**HTTP 계층(라우터):**
- `raise HTTPException(status_code=..., detail="...")`. 4xx는 검증 실패(`400 "tickers required"`, `400 "최대 4개까지 비교 가능합니다"`), 미존재는 `404`.
- 반복 패턴은 `services/errors.py` 헬퍼로 통일: `not_found(ticker, context)` / `already_exists(ticker, context)`가 `HTTPException`을 반환.
- 비동기 배치 트리거 엔드포인트는 `@router.post(..., status_code=202)`(예 `/dividends/refresh`·`/beta/refresh`·`/names/backfill`) + `BackgroundTasks`.

**서비스 계층 — graceful 폴백 원칙("wrong < missing"):**
- 외부 소스(yfinance/DART/키움/KIS/Naver) 호출은 `try/except`로 감싸 실패 시 `logger.warning` 후 폴백/스킵. 예외를 위로 전파하기보다 **부분 성공을 유지**한다.
- **빈/all-None 결과를 캐시에 박제 금지**: 전부 None이면 `_mc_save`를 생략하고 직전 양호값을 유지. "성공-but-빈응답"(예외 없이 빈 dict 반환)도 **값 수준 가드**로 실패 취급해야 한다(`services/us_supply.py`의 `_is_all_empty`가 빈 yfinance `t.info`의 upsert를 스킵 — 헌트164). 부분 실패는 직전 저장값으로 채운다(`services/market_indicators/fx.py`가 실패 심볼만 `stored_rates`로 보전).
- **delete-rewrite(replace) store는 fetch 실패 시 delete 자체를 스킵**(직전 값 파괴 방지). 저장은 delete+insert를 **단일 커넥션/트랜잭션**으로(`services/recommendation/store.py`의 `replace_recommendations`·`services/dividends.py`의 `replace_schedule` — 중단 시 rollback으로 기존 행 보존).
- **NaN/inf 가드**(starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 500): 소스에서 `math.isfinite`로 거르는 게 1차, 출력 일괄 세정은 `services/utils.py`의 재귀 `sanitize(obj)`(NaN/inf→None, dict/list 재귀)로 방어. 시세/합산을 응답에 싣는 엔드포인트는 둘 중 하나 필수.
- **사용자별 데이터를 담는 인메모리 캐시는 키에 user_id를 포함**: `services/cache.py`의 리스트 캐시가 전역 단일 키로 TTL 60s 내 타 사용자 목록을 유출한 버그를 `get_list(user_id, loader)` per-user 키로 수정(task#165). 신규 캐시도 개인화 응답이면 user-scoped 키 필수.

**프론트엔드:**
- `api.js` response interceptor가 401을 전역 처리(토큰 제거 + `/`로 리다이렉트). 컴포넌트/훅은 `try/catch` + Toast(`components/Toast.jsx`의 `useToast().showToast`)로 사용자에게 알린다. 조용한 catch로 삼키면 "헤더 N인데 그리드 빈" 류 은밀 버그가 되므로 유의.
- 비동기 fetch 응답을 state에 반영할 때는 **stale/race 가드**(요청 시퀀스 토큰 비교 등)를 둔다 — 늦게 도착한 옛 응답이 최신 선택을 덮지 않게(`pages/Compare.jsx`·`components/GlobalSearch.jsx`, 헌트164 프론트 2건).

---

## 6. 주석·문서화

- **주석·docstring은 한국어**가 기본(사용자 언어). 백엔드 함수/모듈 docstring은 triple-quoted `"""..."""`로 목적·소스·정규화·gotcha를 상세히 적는다(예 `services/dividends.py` 모듈 docstring이 US/KR 분기·정규화 스키마를 서술).
- 관련 근거는 `task#N` 또는 `ADR-000N`을 주석에 인라인 참조(`# ...(task#108)`, `근거: ADR-0009`). 프론트 주석도 한국어(`// api 모킹`, `// Vite 8(rolldown)은 manualChunks를 함수로만 받는다`).
- JSDoc/TSDoc은 사용하지 않음.

---

## 7. 함수·모듈 설계

- **함수 크기:** 라우터 핸들러는 얇게 유지하고 로직은 서비스로 위임(`routers/*` → `services/*`). 복잡한 조립(`_build_all`·`_build_card`)은 private 헬퍼로 분해.
- **재사용 우선:** corp_code 매핑(`backlog._get_corp_code_map`)·document fetch 등은 여러 서비스가 공유 import해 중복 다운로드를 피한다.
- **모듈 exports:** Python은 명시 `__all__` 없이 언더스코어 관례로 public/private을 구분. 대형 모듈은 패키지 `__init__.py`에서 심볼을 재노출해 외부 계약을 안정화(ADR-0017 — split via package re-export).
- **프론트 exports:** 컴포넌트 파일은 주 컴포넌트 default + 보조 named. UI 프리미티브는 `components/ui/index.js` barrel로 묶어 소비.

---

## 8. 도메인 관례 (신규 코드가 흔히 어기는 것)

- **KR 색 관례(`frontend/src/styles/tokens.css`):** `--up`=빨강(상승)·`--down`=파랑(하락). 그래서 `.badge--success`=빨강·`.badge--danger`=파랑(`ui/Badge.css`). 가격 방향이 아닌 **의미 상태 배지에 `success`/`danger` variant를 쓰면 색이 반전**된다 — 의미 배지는 `ui/SupplyBadge.jsx`처럼 전용 색을 명시. `ChangeBadge`(등락률)만 가격 색을 의도대로 쓴다.
- **yfinance 퍼센트 필드는 소수분수**(0.0098 = 0.98%) — 표시 시 `×100`, 문서/fixture 예시값도 분수 스케일로.
- **DB NUMERIC 컬럼(avg_cost·quantity 등)은 Decimal**로 온다 — float(외부값)과 산술하면 `TypeError`. 양변을 `float()`로 정규화.
- **KR 시장-날짜 판정은 `services.utils.today_kst()`** — bare `date.today()`/`datetime.today()`는 컨테이너가 UTC라 00~09시 KST에 하루 어긋나므로 **금지**(task#157·165 전수 스윕). 현재 20개 앱 모듈이 `today_kst()`를 사용하며, `tests/test_no_bare_today.py`가 ast 스윕으로 신규 위반을 즉시 실패시킨다(`main.py`·`routers`·`services`·`scheduler`·`middleware` 대상, `tests/`·`scripts/` 제외).

---

*컨벤션 분석: 2026-07-10 (HEAD 1e8da3b 재검증 — 직전 지도 ad7f85c 대비 task#165~167 반영: per-user 리스트 캐시, bare today() 가드 테스트 + `today_kst()` 헬퍼, FX 부분실패 last-good 보전, 단일 트랜잭션 replace, 캘린더 파일 캐시 제거)*
