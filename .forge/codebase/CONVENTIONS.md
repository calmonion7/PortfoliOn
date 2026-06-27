---
last_mapped_commit: f1839804fa84342f9e30cc6dc919d5e5abba7b8d
mapped: 2026-06-28
---

# 코딩 컨벤션 — PortfoliOn

이 문서는 백엔드(Python/FastAPI) 코드 스타일·네이밍·반복 패턴을 매핑한다. 도메인 용어는 정의하지 않는다.

## 1. router → service 분리

라우터(`backend/routers/`)는 HTTP 표면(경로·인증·요청/응답 shape)만 담당하고, 실제 로직·외부호출·DB I/O는 서비스(`backend/services/`)에 위임한다.

- 라우터는 서비스를 모듈 단위로 import 한다: `from services import storage`, `from services import market`, `from services import cache as cache_svc`, `from services import job_runs`, `from services.db import query`, `from services.utils import sanitize` (`backend/routers/stocks.py` 상단).
- 라우터 핸들러 본문은 `storage.<fn>(...)`·`market.<fn>(...)` 처럼 모듈 접두로 서비스 함수를 호출한다. 함수 단위 import가 아니라 모듈을 import 해서 `mod.fn` 형태로 쓰는 것이 관례다(테스트가 `patch("routers.stocks.storage.<fn>")`로 가로채는 전제).
- 일부 서비스는 패키지로 분리: `backend/services/storage/`(`__init__.py`, `dates.py`, `names.py`, `portfolio.py`, `schedule.py`), `backend/services/market/`(`__init__.py`, `format.py`, `kr.py`, `us.py`), `backend/services/market_indicators/`, `backend/services/kiwoom/`, `backend/services/kis/`, `backend/services/recommendation/`. 패키지 `__init__.py`가 하위 모듈 심볼을 re-export 한다(god-file split via package re-export, ADR-0017).
- 순환참조 회피: storage→cache 같은 역방향 의존은 **함수 내 지연 import**로 푼다(예: `cache.py:invalidate_portfolio_caches`가 `from routers import calendar as calendar_router`를 함수 안에서 import).

## 2. 네이밍

- 모듈 내부 헬퍼는 `_` 접두 (`_build_all`, `_safe`, `_minimal_card`, `_usdkrw_rate`, `_kr_basic_naver`, `_corroborated_pick`, `_norm`, `_mk_entry`).
- 외부 소스별 fetch 헬퍼는 `_<source>_<용도>` (`_kr_basic_kiwoom`, `_kr_basic_kis`, `_kr_basic_naver`, `_fnguide_market_cap`, `_naver_get`, `_naver_row_val`).
- 비율/퍼센트 계산 헬퍼는 `_safe_ratio`/`_safe_pct`(0·None 분모, inf/NaN을 None으로) — `backend/services/market/format.py`. 다른 셀렉터(`_norm_sector`, `_n`, `_yf_val`)도 format.py에 모인다.
- 모듈 전역 상수·캐시 인스턴스는 `_` 접두 (`_snapshots`, `_list_cache`, `_dashboard_cache`, `_NAVER_HEADERS`, `_NAVER_BASE`, `_API_KEY_USER_ID`).
- 정규식 상수는 대문자 (`TICKER_RE`, `_HEADER_RE`).
- 파일 상단에 `from __future__ import annotations` 가 흔하다(`utils.py`, `kr.py`, `batch_registry.py`).
- 주석·docstring·코드 설명은 한국어가 기본이며 ADR/task 번호를 인라인으로 단다(예: `# task#108`, `.forge/adr/0020`).

## 3. 인메모리 캐시 — `backend/services/cache.py`

- 단일 `TTLCache` 클래스(`get(key, loader)` lazy 적재 + `invalidate(key=None)`). loader 콜백 패턴: 캐시 미스 시 `loader()`를 호출해 채운다.
- 스냅샷만 별도 LRU(`OrderedDict` `_snapshots`, `_MAX=50`, `move_to_end`/`popitem(last=False)`).
- 캐시 인스턴스별 TTL: `_list_cache`(60s, key `"__global__"`), `_dashboard_cache`(300s, key=user_id), `_correlation_cache`(300s), `_sector_cache`(300s, key `f"{user_id}:{market}"`), `_macro_cache`(300s), `_quote_cache`(60s, key에 `regular` 포함), `_live_prices_cache`(15s, 장중 폴링 전용).
- 무효화는 함수로 노출(`invalidate_dashboard`, `invalidate_correlation`, `invalidate_list`, `invalidate_sector`, `invalidate_macro`, `invalidate_quote`, `invalidate_live_prices`). 종목 추가/수정/삭제 시 `invalidate(ticker)`가 스냅샷 prefix 제거 + list/dashboard/correlation/sector/macro/live_prices 일괄 무효화.
- 캐시 키에 변형 축(market·regular)을 넣어 충돌을 막는다(`get_sector`의 `f"{user_id}:{market}"`, quote 캐시의 `regular` 플래그).

## 4. NaN/inf sanitize — `backend/services/utils.py`

starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 500(`Out of range float values are not JSON compliant`)이 난다. 두 가지 방어 층이 있다.

1. **소스 isfinite 가드** (우선): float를 응답에 싣기 전에 `math.isfinite`로 검사해 비유한값은 None으로 강등. 예:
   - `routers/stocks.py:328` `_usdkrw_rate` — `return v if (v is not None and math.isfinite(v)) else None`.
   - `routers/recommendations.py:110` — `if price_f is not None and not math.isfinite(price_f)`.
   - `services/digest_service.py:44,61` — `math.isfinite(prev_close)`·`math.isfinite(usdkrw)`.
   - `services/report_generator.py:23` — `return f if math.isfinite(f) else None`.
   - `services/market/format.py`의 `_safe_ratio`/`_safe_pct`도 0/None 분모와 inf/NaN을 None으로 처리.
2. **출력 일괄 sanitize** (안전망): `sanitize(obj)`가 dict/list를 재귀 순회하며 NaN/inf float를 None으로 치환. 응답을 싣기 직전에 감싼다:
   - `routers/stocks.py:494` `return sanitize({"holdings": cards, "totals": _portfolio_totals(cards)})`.
   - `routers/recommendations.py:169`, `routers/report.py:40,149,154`(`as _sanitize`), `services/report_generator.py:201`(스냅샷 저장 직전).

규칙: 시세/합산을 응답에 싣는 엔드포인트는 sanitize 또는 소스 isfinite 가드를 반드시 적용한다. 소스 가드가 출력 일괄 sanitize보다 깨끗하다(우선). 폴백 경로가 NaN을 다르게 가린다는 점에 주의 — PostgreSQL `json` 컬럼은 NaN 저장을 거부하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과한다.

`utils.py`에는 티커 검증/조회 헬퍼도 있다: `is_valid_ticker`(strip·upper 후 `^[A-Za-z0-9.\-]{1,15}$`), `find_ticker_index`/`ticker_exists_in`/`find_ticker`(대소문자 무시 조회).

## 5. 에러 처리

- `backend/services/errors.py`는 표준 HTTPException 팩토리만 제공: `not_found(ticker, context="")` → 404, `already_exists(ticker, context="")` → 400.
- 외부 fetch 실패는 조용히 삼키지 말고 로깅하되, 결과는 graceful None/빈값으로 강등하는 것이 관례(`_kr_basic_kiwoom`은 미설정/예외/빈 price면 None 반환). 단 배치-백킹 캐시는 빈/all-None 결과를 박제하지 말 것(직전 양호값 유지).
- 대시보드 빌드(`routers/stocks.py:_build_all`)는 per-card `_safe`(throw→`_minimal_card`) + 일괄시세 try/except로 "holdings=N → 항상 N카드" 불변식을 지킨다(500-to-empty 금지).
- "wrong < missing" 원칙: 추출/검증 실패는 잘못된 기본값으로 채우지 말고 누락(pending/None/스킵)으로 둔다(수주잔고 단위 캡션 실패, 리포트 박제-시 독립피드 게이트 스킵).

## 6. FastAPI 라우팅 순서 gotcha

- **정적 경로 세그먼트는 path-param 경로보다 먼저 등록**해야 한다. `PUT /api/stocks/enrich/batch`(`routers/stocks.py:221`)는 `PUT /api/stocks/{ticker}/enrich`(`:236`)보다 **앞에** 등록해야 FastAPI가 `enrich`를 ticker 값으로 라우팅하지 않는다.
- 마찬가지로 catch-all 경로가 구체 경로를 가리지 않도록 순서를 맞춘다(`GET /{ticker}/backlog`가 catch-all에 가려 500 났던 사례).

## 7. 엔드포인트 인증 게이팅 — `backend/auth.py`

인증은 FastAPI `Depends(...)`로 핸들러 시그니처에 주입한다. 의존성 4종:

- `get_current_user` (`auth.py:18`) — `HTTPBearer`로 JWT 디코드(`JWT_SECRET`, HS256), `sub` 반환. 토큰 없으면 401. 일반 read 엔드포인트의 기본 게이트.
- `get_current_user_or_api_key` (`auth.py:37`) — `X-API-Key` 헤더(`COWORK_API_KEY` 대조, 일치 시 sentinel `_API_KEY_USER_ID="__api_key__"`) 또는 JWT. Cowork 소비 엔드포인트용.
- `require_admin` (`auth.py:61`) — `get_current_user` 위에 `auth_service.get_user_by_id`로 `role == "admin"` 검사, 아니면 403. 리포트 생성·백필 등 admin 전용.
- `require_admin_or_api_key` (`auth.py:68`) — API 키(sentinel 통과) 또는 admin JWT. enrich(`PUT /api/stocks/enrich/batch`·`/{ticker}/enrich`)가 사용(task#108).

게이팅 적용 예(`routers/stocks.py`): read는 `Depends(get_current_user)`, 목록/enrich-read는 `get_current_user_or_api_key`, mutation(enrich)는 `require_admin_or_api_key`, admin 작업(`names/backfill`·`dividends/refresh`·`supply-score/refresh`)은 `require_admin`.

**규칙**: 엔드포인트에 auth `Depends`를 추가/변경하면 그 경로를 호출하는 자체-app 테스트(모듈 상단에서 `FastAPI()`를 직접 만들어 `dependency_overrides`로 우회)를 전수 grep 해 새 의존성의 override를 추가해야 한다(401/403로 깨짐). 무인증 거부는 override 없는 fresh app으로 별도 검증(`tests/test_security_auth_gaps.py`). 자세한 패턴은 TESTING.md 참조.

## 8. dual-source 시세 폴백 체인 — `backend/services/market/`

- 시세 디스패치는 `market.get_quote(ticker, market, exchange, regular)`(`__init__.py:39`, TTL 캐시 래퍼) → `_get_quote_uncached`(`:66`). `market == "KR"`이면 KR 경로, 아니면 US 경로.
- **KR 체인**(`kr.py:get_quote_kr`, `:221`): 키움(ka10001) → KIS → Naver. `_kr_basic_kiwoom`/`_kr_basic_kis`/`_kr_basic_naver`가 각 소스에서 `(price, ratio, prev_close, mc, name)` 튜플을 만들고, 미설정/실패/빈 price면 None을 반환해 다음 소스로 폴백.
  - `regular=True`(리포트 스냅샷, ADR-0020): KRX 정규장 종가 우선순위 체인 `_kr_pick_regular`(`:140`).
  - `regular=False`(라이브 대시보드, NXT): 독립 피드 2-of-N 다수결 `_kr_pick_basic`/`_corroborated_pick`(`:127,181`) — 키움 NXT+키움 KRX 2콜 합의면 NXT 반환(lazy), 불일치면 KIS·Naver를 escalate해 최대 4피드 다수결로 outlier(글리치) 폐기. 합의 불가면 degenerate self-check(`_kr_pick_degenerate_lazy`, ±30%/±2x).
- **US 체인**(`__init__.py:106~`): yfinance 우선 → 예외/빈 시세면 KIS 백업(ADR-0011) → 그래도 없으면 에러 dict.
- 일괄 시세(`get_quotes_batch`, `:143`)는 US를 `yf.download` 1콜, KR은 종목별 `get_quote`(키움 우선). 차트는 `get_history_df`(`:199`)가 KR=키움(ka10081) 우선, 실패 시 yfinance 폴백.
- 외부 소스 NaN 가드: yfinance get_* 메서드 vs 프로퍼티의 index 라벨 규칙 차이로 `_yf_val` exact 매칭이 조용히 None을 반환할 수 있음 → 라이브 1종목 추출 대조를 DoD에 둔다(단위테스트는 mock이라 라벨 불일치를 못 잡음, US `us.py`는 cashflow도 `get_cashflow` 메서드 사용).

## 9. 배치 레지스트리 — `backend/services/batch_registry.py`

- `BATCHES` 리스트가 현황 허브에 노출되는 모든 배치의 정적 메타데이터를 담는다(dict per batch): `id`, `label`, `category`, `schedule_desc`, `usage`(소비 UI), `source`(데이터 fetch 출처), `editable`, `trigger_kinds`, `manual_endpoint`, `scheduler_job_id`, `timezone`, `misfire_grace_time`, `market`(`KR`/`US`/`공통`, 출처국 기준 분류, ADR-0013), `default_schedule`.
- `id`는 스케줄러 잡 id 및 `services.job_runs.record(job_id, trigger)` 호출 id와 반드시 일치한다.
- 일일 리포트는 시장별 분리(`daily_report_kr` 20:30 KST / `daily_report_us` 07:00 KST), 실적·월간도 분리(`earnings_kr`/`earnings_us`, `monthly_kr`/`monthly_us`).
- **DoD 규칙**: 배치 fetch 소스를 바꾸면 그 배치의 `source`도 갱신(`source`=fetch 출처, `usage`=소비 UI로 방향이 반대). 배치 `id`를 빼면 ① 데이터 read ② 표시 문자열 ③ `job_runs.record`의 모든 lane(auto·manual·backfill) ④ 단언 테스트를 전수 grep 해야 stale read·현황 증발 회귀를 막는다.

## 10. 문서 동기 DoD

- API 엔드포인트(method+path 추가/삭제/개명)·요청·응답 스키마·인증 게이팅을 바꾸면 `API_SPEC.md`와 `CLAUDE_COWORK_API.md`를 **항상 함께** 갱신. 엔드포인트 *존재* drift는 `backend/tests/test_api_doc_sync.py`가 자동검출(TESTING.md 참조).
- 기능 표면(화면·env·스택·아키텍처·배치)을 바꾸면 `README.md` 해당 절도 같은 PR에서 갱신.
- 엔드포인트 응답을 비-additive로(배열→객체 등) 바꾸면 `grep -rn '<경로>' frontend/src/`로 프론트 소비처를 전수 감사. 가능하면 additive(필드 추가) 선호.
