---
last_mapped_commit: c482aa6811262685f424cb8fb871e8121cf438c6
mapped: 2026-07-02
---

# 코딩 컨벤션

## 언어·주석 스타일

- **주석·docstring은 한국어**가 기본. 인라인 `#` 주석, `"""docstring"""` 모두 한국어로 쓴다.
  - 예: `backend/services/utils.py` — `"""티커 형식 검증: strip·upper 후 영숫자+'.'/'-' 1~15자만 허용 (공백/잡문자/빈값/과길이 거부)."""`
  - 예: `backend/services/report_generator.py` — `"""yfinance info 값을 유한 float으로 변환. 'Infinity'/NaN/None → None."""`
- docstring에서 결측 처리를 `→ None` 화살표로 명시하는 관례 (`결측/예외→None`).
- 섹션 구분자는 `# ---` 스타일 (예: `backend/services/market_indicators/indices.py`의 `# --- S1: index levels ---`, `backend/services/consensus_pipeline.py`의 한국어 라벨 구분선).

## 네이밍

- **공개 함수**: `snake_case` 동사-명사 — `get_quote`, `generate_report`, `fetch_trend`, `resolve_name`, `backfill_ticker`.
- **비공개 헬퍼**: `_` 접두 — `_fin_num`, `_mc_load`, `_mc_save`, `_fetch_one_sector`, `_rsi_block`.
- **상수/매핑**: ALL_CAPS — `_SCORE_MAP`, `_INDEX_SYMBOLS`, `SNAPSHOTS_DIR`, `TICKER_RE` (모듈 비공개면 `_` 접두 유지).
- **모듈 비공개 싱글톤**: `_cache`, `_KST`.
- **불리언 헬퍼**: `is_valid_ticker`, `ticker_exists_in`.
- 섹션별 fetch 함수는 `(key, value_or_None)` 튜플 반환 패턴 (`indices.py` 등 market_indicators).

## 모듈 레벨 I/O 분리 (mock 가능 구조)

- 라우터는 서비스를 **모듈 레벨 이름으로 import** (`from services import storage`, `from services import market` — `backend/routers/stocks.py`). 테스트가 `patch("routers.stocks.storage.get_full_portfolio", ...)` 형태의 정규화된 경로로 patch할 수 있게 유지한다.
- 서비스 내부의 외부 I/O(yfinance/키움/DART 호출)는 **모듈 레벨 함수로 분리**해 `patch.object(service_module, "function_name", ...)`로 mock — 예: `backend/tests/test_nan_serialization_guards.py`의 `patch.object(analysis_service.yf, "Ticker", _ConstTicker)`.
- 함수를 클로저/람다 안에 숨기거나 함수 안에서 재바인딩하면 이 patch 관례가 깨지니 피할 것.

## 에러 처리

### 외부 fetch 실패 로깅 — silent except 금지

- 표준 패턴: `except Exception as e:` → `logger.warning(f"[Module] 설명 실패: {e}")` → `return None`(또는 폴백 진행).
- 로거는 모듈 레벨 `logger = logging.getLogger(__name__)` (거의 모든 서비스·라우터 공통).
- 메시지 포맷: **`[대문자모듈명]` 접두 + 한국어 설명 + `: {e}`**.
  - `logger.warning(f"[Scraper] scrape_finviz_consensus({ticker}) 실패: {e}")`
  - `logger.warning(f"[Cache] _mc_load key={key} 실패: {e}")`
  - `logger.warning(f"[Digest] 시세 fetch 실패 ticker={ticker}: {e}")`
- **무음 `except Exception: pass` 금지** — 기능이 예외 없이 조용히 꺼져 진단 불가가 된다(task#48 사례, task#127·128·129에서 백엔드 28파일+프론트 7건 일괄 로깅화). 잔존 무음 except는 `backend/services/job_runs.py`(계측 인프라의 의도적 삼킴)·`guru_scraper.py` 일부뿐이며 레거시/부채로 취급.
- 리포트 배치 등 stdout 진단이 필요한 곳은 loud `print("[Report] ...")` 병용 (`backend/services/report_generator.py`의 박제-스킵 로그).

### graceful 결측 (wrong < missing)

- 외부 소스 실패·결측은 예외 전파 대신 **None/빈 리스트 반환** → 호출자가 `if result is None:`으로 저장값 폴백 또는 필드 생략.
- 추출 실패에 '안전한 기본값'을 채우지 말 것 — 오저장(×100 등)보다 누락(pending/None)이 낫다.
- 빈/all-None 결과는 캐시에 박제 금지(직전 양호값 유지).

### NaN/isfinite 가드

- 외부 값을 **처음 소비하는 지점에서 `math.isfinite(v)` 가드** — starlette `JSONResponse`는 `allow_nan=False`라 NaN/inf가 응답에 남으면 500.
  - `backend/services/report_generator.py` `_fin_num`: `f = float(v); return f if math.isfinite(f) else None`
  - `backend/services/market_indicators/indices.py`: `if not math.isfinite(change_pct): change_pct = None`
  - `backend/routers/stocks.py`: `return v if (v is not None and math.isfinite(v)) else None`
- NaN은 `is None` 가드를 통과하므로(NaN≠None) None 체크만으로는 불충분.

### sanitize 안전망

- 정의: `backend/services/utils.py`의 `sanitize(obj)` — dict/list 재귀 순회로 NaN/inf float → None 치환.
- 사용처: `backend/routers/stocks.py`(대시보드 응답 전체), `backend/services/report_generator.py`(`_sanitize`로 import, 스냅샷 저장 전), `backend/routers/recommendations.py`(응답 전체).
- 관례: **소스 지점 `isfinite` 가드가 1차, `sanitize`는 라우터 응답 최외곽의 최후 안전망**. 시세/합산 float를 응답에 싣는 엔드포인트는 둘 중 하나 필수.

## 기타

- DB NUMERIC 컬럼(avg_cost·quantity 등)은 psycopg가 **Decimal**로 반환 — float와 산술 전 `float()` 정규화 필수(`float/Decimal` TypeError, 대시보드 배당 사례).
- KR 종목 series를 yfinance tz-aware series와 정렬할 땐 한쪽 인덱스 `tz_localize(None)` 필수.
- HTML 파싱은 `BeautifulSoup(html, "html.parser")` (stdlib) — 로컬 `.venv`엔 lxml 부재.
