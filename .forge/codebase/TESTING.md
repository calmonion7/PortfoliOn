---
last_mapped_commit: 53b30e71425b810f8ce3edc33b2767b1be2e242c
mapped: 2026-06-20
---

# TESTING — 테스트 프레임워크 & 패턴

실제 `backend/tests/`와 프런트 검증 흐름에서 검증한 패턴.

## 1. 백엔드 — pytest

### 1.1 프레임워크 · 실행

- 프레임워크: **pytest** + FastAPI `TestClient`. 별도 설정파일 없이 `backend/tests/conftest.py`가 부트스트랩.
- 실행: 프로젝트 루트에서 `cd backend && .venv/bin/python -m pytest` (CLAUDE.md 명시). macOS venv는 `backend/.venv/bin/python`.
- 규모: 테스트 파일 **75개**(`backend/tests/test_*.py`), `def test_*` 함수 **~817개**(commit 53b30e71 기준; "~840"은 직전 추정, 실측은 817).

### 1.2 구조 · 네이밍

- 파일명 `test_<대상>.py`, 라우터는 `test_<name>_router.py`(예: `test_stocks_router.py`, `test_admin_router.py`), 서비스는 `test_<service>.py`(예: `test_digest_service.py`, `test_leverage_service.py`). 함수명 `test_<행동>_<기대>` 서술형(예: `test_get_stocks_returns_flat_list_with_type`, `test_refresh_skips_save_when_all_none`).
- 픽스처: `backend/tests/fixtures/`(예: `fixtures/backlog/` — DART 원문 HTML 샘플). 파싱 테스트는 fixture를 읽어 단언.
- `conftest.py`는 ① `sys.path`에 backend 루트 삽입 ② `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`로 전역 인증 우회 ③ `client` 픽스처(`TestClient(app)`) ④ `autouse` `_clear_quote_cache`(매 테스트 전 `cache.invalidate_quote()`로 종목 TTL 캐시 교차오염 방지).

### 1.3 인증 우회 — `app.dependency_overrides`

- 전역 우회는 `conftest.py`(`get_current_user`). 라우터별 테스트 파일은 **자체 `FastAPI()` 인스턴스를 만들어 라우터만 include**하고 override를 건다:
  ```python
  # tests/test_stocks_router.py:9-13
  app = FastAPI(); app.include_router(router)
  app.dependency_overrides[get_current_user] = lambda: "test-user-id"
  app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
  client = TestClient(app)
  ```
- admin 게이팅 테스트는 `require_admin`을 override: `app.dependency_overrides[require_admin] = lambda: "admin-id"` (`tests/test_admin_router.py:10`). `require_admin` override를 쓰는 파일: `test_admin_router`, `test_batch_endpoints`, `test_batches_router`, `test_batch_market_split`, `test_disclosure_batch`, `test_macro_signals_batch`, `test_job_runs_instrumentation`, `test_report_router`, `test_recommendation_endpoint`, `test_backfill_names_skip` 등.

### 1.4 모킹 패턴

- **`unittest.mock.patch`로 라우터가 import한 심볼을 패치** — 패치 대상은 정의 모듈이 아니라 **사용처 경로**: `patch("routers.stocks.storage.enrich_stock", ...)`, `patch("routers.analysis.kr_sector_service.load_momentum", ...)`, `patch("routers.analytics.yf.Ticker", ...)`. (라우터가 `from services import storage` 한 뒤 `storage.X`로 부르므로 `routers.<mod>.storage.X`를 패치.)
- `return_value` / `side_effect`(함수로 케이스별 분기, 예: `mock_enrich`가 ticker별 True/False 반환, `test_stocks_router.py:63`).
- 서비스 단위 테스트는 **`monkeypatch.setattr`로 모듈 함수 교체** — DB/외부 I/O는 모듈 함수로 분리돼 있어 patch 가능(`tests/test_kr_sector_momentum.py:39` `monkeypatch.setattr(svc, "_mc_save", ...)`, `_mc_load`를 in-memory dict로 대체). `funnel.py`/`universe.py`는 "외부/DB I/O는 모듈 함수로 분리(테스트는 patch.object로 mock)"를 명시.

### 1.5 print-log 단언 — `capsys`

`print(f"[Tag] ...")` 진단 로깅(CONVENTIONS §1.3)은 테스트 계약이라 **`capsys`로 출력을 단언**한다:
```python
# tests/test_kr_sector_momentum.py:95-105
def test_refresh_skips_save_when_all_none(monkeypatch, capsys):
    ...
    assert "all-None" in capsys.readouterr().out  # 사실 로깅
```
`capsys` 사용 파일: `test_kr_sector_momentum.py`, `test_backfill_names_skip.py`, `test_recommendation_funnel.py`. "빈 종가 시 로깅"·"예외 시 로깅" 같은 silent-except-금지 가드를 capsys로 검증.

### 1.6 `mock.call_args` 오염 함정 (additive 호출)

엔드포인트에 read/외부호출을 **additive로 추가**하면 응답 shape뿐 아니라 **호출 시퀀스**도 늘어, 마지막 호출 인자를 `mock.call_args`로 단언하던 기존 테스트가 조용히 깨진다(마지막 호출이 신규 호출로 바뀜). 대응:
- 기존 단언을 **호출별 인덱스 `call_args_list[i].kwargs`** 로 마이그레이션 — 어느 호출인지 명시. `tests/test_recommendation_endpoint.py:77` `discovery_kwargs = mock_read.call_args_list[0].kwargs`(첫 호출=discovery), `:105` `for call in mock_read.call_args_list[1:]:`(이후 호출 순회).
- 신규 테스트는 **`call_count`로 시퀀스를 못박는다**.
- 신규 호출은 입력이 비면 생략(`if <조건>:`)해 기존 단일-호출 테스트를 보존.

`call_args_list`/`call_count` 사용 파일: `test_recommendation_endpoint`, `test_portfolio_router`, `test_watchlist_router`, `test_market_indicators`, `test_job_runs`, `test_batch_resilience`, `test_kis_quote`, `test_storage`, `test_stocks_router`, `test_admin_router`.

### 1.7 로컬 `.venv` 에 `lxml` 없음 — `html.parser` 사용

- `lxml`은 `requirements.txt`/Docker엔 있지만 **로컬 `backend/.venv`엔 미설치**. 로컬 pytest로 도는 HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 **stdlib `BeautifulSoup(html, "html.parser")`** 를 써야 로컬·프로덕션 모두 동작.
- 실제로 소스/테스트 모두 `html.parser` 사용: `services/backlog_parser.py:231/294/315`(주석 `# ... html.parser로 파싱하므로(lxml 로컬 미설치) 경고가 ...`), `tests/test_backlog_extract.py:25/131/134`. DART document.xml은 XML이지만 의도적으로 `html.parser`로 파싱.

## 2. 프런트엔드 — 유닛 테스트 인프라 없음

- **프런트 유닛/컴포넌트 테스트 프레임워크 없음** (Jest/Vitest/RTL 미도입). `frontend/`에 `*.test.*`/`*.spec.*` 없음.
- 검증은 **Playwright 디바이스 에뮬레이션 UAT**로 수행 — 폰 없이 모바일/PC 뷰포트 에뮬레이트. 테스트 계정 `test@portfolion.com` / `test1234`.
- **라이브 사이트 대상 UAT**: nginx가 `frontend/dist`를 `:ro` 볼륨마운트로 서빙해 로컬 `npm run build`가 즉시 라이브 → 빌드 후 라이브 URL을 Playwright로 검증(서빙 번들 해시=로컬 빌드 해시로 확인 가능). 격리 하니스(vite `uat.html`)로 인증 플로우를 우회하는 경로도 있음.
- 자동배포 환경 특성상 검증은 **main 머지·배포 후**에만 가능(로컬 단독 확인 요청은 무의미).
