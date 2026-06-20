---
last_mapped_commit: 53b30e71425b810f8ce3edc33b2767b1be2e242c
mapped: 2026-06-20
---

# CONVENTIONS — 코드 스타일 & 네이밍

PortfoliOn의 실제 코드에서 검증한 컨벤션. CLAUDE.md 주장이 아니라 grep으로 대조한 패턴만 기재한다.

## 1. 백엔드 (Python / FastAPI)

### 1.1 routers / services 분리

- `backend/routers/*.py` — HTTP 표면(엔드포인트, Pydantic 모델, 의존성 주입). 비즈니스 로직 없음, services 호출에 위임.
- `backend/services/*.py` — 도메인 로직·외부 I/O·DB 접근. 라우터가 import해서 호출.
- 큰 service는 패키지로 분리: `backend/services/storage/`(`dates.py`/`names.py`/`portfolio.py`/`schedule.py` + `__init__.py` 재노출), `backend/services/market_indicators/`, `backend/services/recommendation/`, `backend/services/kiwoom/`, `backend/services/kis/`, `backend/services/market/`.
- 라우터 상단 import 관례: `from services import storage`, `from services.db import query` 처럼 **모듈/함수 단위**로 끌어온다 (`backend/routers/stocks.py:1-21`).

### 1.2 지연(lazy) import — 순환참조 회피

storage↔cache 같은 양방향 의존은 **함수 본문 안에서 import**한다. 모듈 최상단이 아니라 호출 시점에 가져와 import-time 순환을 끊는다.

```python
# backend/services/storage/names.py:8-10
"""storage↔cache 순환참조 회피용 지연 import."""
def ...:
    from services import cache as cache_svc
```

### 1.3 진단 로깅 — `print(f"[Tag] ...")`가 주류, 일부는 `logging`

- **대부분의 service/router는 `logging` 모듈이 아니라 `print(f"[Tag] ...")`** 로 진단을 찍는다. 태그는 대괄호 PascalCase/snake 혼용: `[Pipeline]`, `[Digest]`, `[Report]`, `[Guru]`, `[Backfill]`, `[AutoReport]`, `[Consensus]`, `[kr_sector]`, `[leverage_service]`, `[backfill_names]` 등 (`services/consensus_pipeline.py`, `services/digest_service.py`, `services/kr_sector_service.py`, `services/recommendation/funnel.py`).
- 이 `print` 로그는 테스트에서 `capsys`로 단언되므로 **계약**으로 취급된다(TESTING.md 참조). "all-None이면 save 생략" 같은 가드는 `print(... all-None ...)`로 사실을 남긴다.
- **예외**: 비교적 최근에 추가된 일부 service는 표준 `logging`을 쓴다 — `services/disclosures.py`(`logger = logging.getLogger(__name__)`, `logger.warning/info(f"[Disclosures] ...")`), `services/job_runs.py`, `services/insider_trades.py`, `services/backlog.py`, `services/dividends.py`. 이들도 메시지 본문은 동일한 `[Tag]` 접두 관례를 유지한다.
- 신규 코드는 둘 중 **주변 파일이 쓰는 방식을 따른다**(같은 패키지·서비스의 기존 관례 매칭).

### 1.4 에러 처리

- **NaN/Inf JSON 가드 (핵심)**: starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 500이 난다. 공통 재귀 sanitizer는 `backend/services/utils.py:29` `sanitize(obj)` — float가 `isnan/isinf`면 `None`으로 치환, dict/list 재귀. `report_generator.py`·`lending_service.py`가 저장/응답 직전 `sanitize(...)`로 감싼다.
- **소스 가드 선호**: 출력 일괄 sanitize보다 **소스에서 `math.isfinite` 체크**가 깨끗하다. `services/digest_service.py:44`(prev_close/current/usdkrw가 `isfinite` 아니면 "시세 없음"), `services/recommendation/funnel.py:121`(평균이 `isfinite` 아니면 `None`).
- **graceful None 폴백**: 외부 시세/결측은 예외 대신 `None`을 흘려보낸다. DB-우선 → 실패 시 파일/per-ticker 폴백(`routers/stocks.py:27` `_latest_snapshot`, `:53` `_latest_snapshots`는 `try: DB ... except Exception: pass` 후 폴백). `except Exception: pass`로 조용히 삼키는 패턴은 **read 폴백 경로에서만** 쓰고, 배치 fetch는 로깅해야 한다(silent except 금지 — `funnel.py` docstring "silent except 금지. 전부 None이면 save 생략").

### 1.5 FastAPI 패턴

- **bare list/dict 본문은 `Body(...)` 명시**: PUT/POST에서 Pydantic 모델이 아닌 raw `list`/`dict`를 받을 땐 `Body(...)`가 없으면 기동 불가. `routers/report.py:494` `entries: list = Body(...)`, `routers/batches.py:64` `schedule: dict = Body(...)`. 구조화된 본문은 `BaseModel` 서브클래스(`EnrichBody`, `EventBody`, `PermissionsBody`)로 받는다.
- **라우트 순서 — 구체경로 먼저, `{param}` 나중**: 같은 prefix에서 고정 세그먼트가 path-param보다 **위에** 와야 FastAPI가 `enrich`/`batch`를 ticker 값으로 매칭하지 않는다. `routers/stocks.py`: `PUT /enrich/batch`(:218)가 `PUT /{ticker}/enrich`(:233)보다 먼저, `GET /search`(:140)·`DELETE /dashboard/cache`(:244)·`GET /dashboard`(:326)도 `{ticker}` 경로보다 앞.
- **의존성 주입**: 인증은 `Depends`로. `user_id: str = Depends(get_current_user)`(세션), `Depends(get_current_user_or_api_key)`(세션 또는 Cowork API 키), `_: str = Depends(require_admin)`(admin 게이팅, `routers/stocks.py:251`). 라우터는 `prefix="/api/..."` + `tags=[...]`로 선언(`stocks.py:80`).
- 필드 화이트리스트: enrich류는 `{k: v for k, v in body.model_dump().items() if v is not None}`로 `None` 제거 후 빈 dict면 400(`stocks.py:235-237`).

### 1.6 네이밍

- 모듈 함수: `snake_case`. 모듈-private 헬퍼·내부 I/O는 선행 언더스코어(`_latest_snapshot`, `_fetch_one_sector`, `_mc_load`/`_mc_save`, `_kr_basic_kis`).
- Pydantic 모델: `PascalCase` + `Body` 접미(`EnrichBody`, `EventBody`).
- 티커는 비교·저장 시 `.upper()` 정규화가 관례(`utils.py`의 `find_ticker`/`ticker_exists_in` 모두 upper 비교).

## 2. 프런트엔드 (React 19 + Vite, plain CSS)

### 2.1 컴포넌트

- 전부 **함수 컴포넌트 + default export**. 클래스 컴포넌트 없음. 페이지는 `frontend/src/pages/*.jsx`, 재사용은 `frontend/src/components/*.jsx`(도메인 하위폴더 `market/`·`reports/`·`portfolio/`·`recommendations/`).
- 데이터 패칭: `useState`/`useEffect` + 공유 axios 인스턴스 `frontend/src/api.js`(`import api from '../api'`). `api`는 `localStorage`의 `access_token`을 request 인터셉터로 자동 첨부, 401이면 토큰 제거 후 `/`로 리다이렉트.
- import 관례: ui 프리미티브는 `import Card from '../components/ui/Card'`(default) 또는 배럴 `frontend/src/components/ui/index.js`에서 `{ Button, Card, Badge, MarketBadge, ChangeBadge, Stat }`. 토스트는 `useToast()`(`components/Toast`), 행동 로깅은 `trackEvent(...)`(`utils/analytics.js`, 토큰 없으면 no-op·`.catch(() => {})`).

### 2.2 ui 프리미티브

`frontend/src/components/ui/`: `Badge`, `Button`, `Card`(+ `CardHeader`), `Stat`, `Input`, `Skeleton`, `icons`(`fmt` 숫자 포매터 포함), 도메인 배지 `SupplyBadge`/`InsiderBadge`. 각 컴포넌트는 짝지은 `.css`를 자기 파일에서 `import './X.css'`로 가져온다.

### 2.3 plain CSS — 전역 토큰

- TailwindCSS 없음. 전역 스타일 3종: `frontend/src/styles/tokens.css`(CSS 변수·base reset·`.tab-btn` 등 유틸), `pc.css`, `mobile.css`.
- 색·간격·radius·shadow는 전부 `var(--token)`. 간격 `--space-1..6`(4~24px), radius `--radius-sm/md/lg/xl`, shadow `--shadow-sm/-/lg`. 다크 테마는 `[data-theme="dark"]`에서 같은 변수를 재정의(`tokens.css:88`).

### 2.4 KR 색 관례 — 의미 배지는 전용 색 필수

- **`--up`=빨강(상승)·`--down`=파랑(하락)** (`tokens.css:26-29`). 따라서 `ui/Badge.css`의 `.badge--success`는 `--up`(빨강), `.badge--danger`는 `--down`(파랑)을 쓴다 — Western(녹=좋음/빨=경고)과 **반대**.
- `ChangeBadge`(가격 방향)는 의도적으로 `value >= 0 ? 'success' : 'danger'` = 상승 빨강·하락 파랑(`Badge.jsx:35`)으로 정확하다.
- **가격 방향이 아닌 의미 상태 배지는 `success`/`danger` variant 금지** — 색이 KR 가격색으로 박혀 의미가 반전된다. `ui/SupplyBadge.jsx`처럼 **인라인 `style`로 전용 색 명시**(우호=초록 `#4caf50`·중립=회색 neutral·경계=주황 `#f57c00`), 가격 토큰 미사용.
- 의미 상태 전용 토큰은 `tokens.css:42-55`에 별도 존재(`--color-success`/`--color-error`/`--color-info`/`--semantic-buy`/`--semantic-sell`/`--corr-pos/neg/zero`) — 의미 색이 필요하면 이쪽을 쓴다.

### 2.5 포매터 & 빈 상태 '—'

- 결측은 일관되게 **em-dash `'—'`**(또는 일부 `'-'`)로 표시. 다수 컴포넌트가 채택(`components/portfolio/DashboardCard.jsx`에 10건 등).
- 공유 가격 포매터 `frontend/src/utils.js` `fmtPrice(val, market)` — `val == null || !Number.isFinite(Number(val))` 면 `'—'`, KR은 `₩` + `toLocaleString('ko-KR')`, US는 `$` + `toFixed(2)`. 즉 **포매터가 입구에서 NaN/null을 '—'로 흡수**하는 게 관례(`Number.isFinite` 가드).
- 포매터는 전역 단일이 아니라 **국소 정의가 흔하다** — `fmtN`/`fmtGap`(`components/reports/reportUtils.jsx`), `krFmt`(`components/market/marketUtils.jsx`, 억/조 단위), `fmt`(`ui/icons.jsx`), 페이지별 `fmtPrice`/`fmtChange`/`fmtVolume`(`pages/Ranking.jsx`). 단위가 다르면 전용 포매터를 쓴다(`krFmt`는 '억원' 단위 가정 — raw 원/주를 넘기면 오표기).

### 2.6 scope-dependent CSS 함정

- **CSS 변수는 정의처가 보장돼야 한다**: `ui/Badge.css`는 `--font-weight-medium`, `--font-size-xs`, `--font-size-sm`, `--accent-tint`를 참조하지만 이 토큰들은 `tokens.css`에 **정의돼 있지 않다**(`--warning`/`--color-warning`/`--warning-tint`도 미정의). 미정의 변수는 조용히 무효화되어 폰트 두께/크기·info 배지 배경이 의도와 다르게 렌더된다. 새 스타일이 참조하는 토큰은 `tokens.css`에 실재하는지 확인할 것.
- `.badge--warning`은 위 미정의 토큰 탓에 사실상 깨져 있어 caution 색으로 쓸 수 없다 — 경계 상태는 `SupplyBadge`처럼 전용 색을 직접 지정.
- variant 이름의 통념(success=녹/danger=빨)이 아니라 **토큰 실제값**으로 색을 판단해야 한다(§2.4).
