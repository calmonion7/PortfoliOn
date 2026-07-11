---
last_mapped_commit: b52f0f5e237fcffe1972eda44d70ad867f632331
mapped: 2026-07-12
---

# 코딩 컨벤션

두 스택: **백엔드** Python/FastAPI (`backend/`), **프론트엔드** React 19 + Vite (`frontend/`, plain CSS·no TypeScript). 전체 gotcha 원장은 프로젝트 루트 `CLAUDE.md`(방대함) — 이 문서는 *반복 관찰되는 컨벤션*만 간추린다.

---

## 1. 네이밍

**백엔드:**
- 파일 `snake_case.py` — 라우터는 도메인명(`stocks.py`·`report.py`), 서비스는 기능명(`report_generator.py`·`dividends.py`).
- 대형 모듈은 **패키지 + `__init__.py` 재노출**(ADR-0017): `services/storage/`, `services/market/`, `services/market_indicators/`, `services/recommendation/`, `scheduler/`(`__init__.py`·`jobs.py`·`schedule.py`·`_state.py`), `services/kiwoom/`·`services/kis/`. 소비처는 `from services import storage`처럼 패키지명으로 import.
- 함수 `snake_case`, **모듈 내부 전용은 선행 언더스코어**(`_build_all`·`_usdkrw_rate`·`_migrate`) — private가 public과 비등하거나 더 많다. 시그니처에 타입힌트, 신규 모듈은 상단 `from __future__ import annotations`.
- 모듈 상수 UPPER_SNAKE(`TICKER_RE`·`SNAPSHOTS_DIR`). 요청 바디는 Pydantic `BaseModel`(`class EnrichBody(BaseModel)` — `routers/stocks.py`).

**프론트엔드:**
- 컴포넌트 `PascalCase.jsx` + 동명 co-located `PascalCase.css`(`Badge.jsx`+`Badge.css`). 훅 `camelCase.js`+`use` 접두사(`hooks/`). 유틸 `camelCase.js`(`api.js`·`utils/analytics.js`). Context `PascalCaseContext.jsx`.
- 함수형 컴포넌트, 기본 export는 named function 선언(`export default function Badge({...}) {...}`), 보조 컴포넌트는 named export 같은 파일에(`export function MarketBadge`·`ChangeBadge` — `components/ui/Badge.jsx`). props는 구조분해+기본값.

---

## 2. 코드 스타일

- 백엔드: 전용 포매터/린터 없음(`pyproject.toml`/`ruff.toml` 부재) — 4-space, 주변 파일 스타일 준수. 자동 강제 가드 3종: `backend/tests/test_no_print.py`(§4)·`test_no_bare_today.py`(§8)·`test_api_doc_sync.py`(문서 drift).
- 프론트: **ESLint flat config** `frontend/eslint.config.js`(`@eslint/js` recommended + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh`, `npm run lint`). Prettier·TypeScript 없음(JSX+plain JS). 세미콜론 생략, 작은따옴표.

---

## 3. Import 조직

**백엔드 순서:** `from __future__ import annotations`(신규) → 표준 라이브러리 → 서드파티(`fastapi`·`pydantic`·`yfinance`·`pandas`) → 로컬(`from services import storage`) → `logger = logging.getLogger(__name__)`.
- **순환참조 회피용 지연 import**: 함수 본문 안에서 `from services.db import execute`(예 `main._migrate`, storage↔cache). 지연 import는 테스트 patch 대상 경로에 영향(TESTING.md §4).

**프론트엔드:** 서드파티 → 로컬 상대경로(alias 미사용). API는 **단일 axios 인스턴스** `frontend/src/api.js`(default import) — 인증 헤더 주입(request interceptor)·401 처리(response interceptor)를 담당하므로 컴포넌트에서 axios 직접 사용 금지. UI 프리미티브는 barrel `components/ui/index.js`로 재노출.

---

## 4. 로깅 규약

**앱 코드는 모듈 `logger`로 통일, `print(` 신규 금지** — `backend/tests/test_no_print.py`가 `main.py`·`routers`·`services`·`scheduler`·`middleware`를 ast로 walk해 단언(현재 0건).

**루트 로거 배선** `backend/main.py:_configure_logging()`(import 시점 1회 호출): `basicConfig(level=INFO, format="%(levelname)s %(name)s: %(message)s")` + urllib3/yfinance/apscheduler/asyncio는 WARNING 억제 + uvicorn 로거 `propagate=False`(중복 emit 방지). **config 없으면 root lastResort가 WARNING+만 내보내 `logger.info`가 docker logs에 안 뜬다.**

모듈 로거: `logger = logging.getLogger(__name__)`.

**레벨 의미:** `warning`=graceful 담화(예상된 실패→폴백/스킵, 지배적 다수) · `error`=예상치 못함·데이터손실(매우 아껴 씀) · `info`=배치/라이프사이클. `debug`/`exception`은 사실상 미사용.

**포맷** `logger.x(f"[Component] <무엇> (<ids>): {e}")` — `[Component]`는 **PascalCase·개념당 1스펠링**(formatter가 컴포넌트를 안 찍으므로 메시지 내 마커가 유일 grep 앵커). 어휘 예: `[Scheduler]`·`[Report]`·`[Migrate]`·`[Backlog]`·`[Consensus]`·`[Quote]`·`[FX]`. 진단 로그를 broad `except: pass`로 삼키지 말 것.

---

## 5. 에러 처리

**HTTP 계층:** `raise HTTPException(status_code=..., detail="...")`. 반복 패턴은 `backend/services/errors.py`의 `not_found(ticker, context)`/`already_exists(ticker, context)` 헬퍼. 비동기 배치 트리거는 `status_code=202` + `BackgroundTasks`.

**서비스 계층 — "wrong < missing" graceful 폴백:**
- 외부 소스(yfinance/DART/키움/KIS/Naver) 호출은 `try/except` → `logger.warning` 후 폴백/스킵. 예외 전파보다 부분 성공 유지.
- **빈/all-None 결과를 캐시에 박제 금지** — 전부 None이면 save 생략, 직전 양호값 유지. "성공-but-빈응답"도 값 수준 가드로 실패 취급.
- **delete-rewrite(replace) store는 fetch 실패 시 delete 자체를 스킵**, delete+insert는 단일 트랜잭션(`services/dividends.py:replace_schedule`).
- **NaN/inf 가드**: starlette `JSONResponse`는 `allow_nan=False`라 응답에 NaN/inf 있으면 500. 소스에서 `math.isfinite` 1차, 출력 세정은 `backend/services/utils.py`의 재귀 `sanitize(obj)`.
- **사용자별 캐시는 키에 user_id 포함**(`services/cache.py`의 `get_list(user_id, loader)`).

**프론트엔드:** `api.js` response interceptor가 401 전역 처리. 컴포넌트/훅은 `try/catch` + Toast(`components/Toast.jsx`의 `useToast().showToast`). 비동기 응답 반영 시 stale/race 가드(요청 시퀀스 토큰 비교) 필요.

---

## 6. 주석·문서화

- 주석·docstring은 **한국어**. 함수/모듈 docstring은 triple-quoted로 목적·소스·gotcha 서술. 근거는 `task#N`/`ADR-000N` 인라인 참조.
- JSDoc/TSDoc 미사용.

---

## 7. 함수·모듈 설계

- 라우터 핸들러는 얇게, 로직은 서비스로 위임(`routers/*` → `services/*`). 복잡한 조립은 private 헬퍼로 분해(`_build_all`·`_build_card`).
- Python은 명시 `__all__` 없이 언더스코어 관례로 public/private 구분. 대형 모듈은 패키지 `__init__.py`에서 심볼 재노출(ADR-0017).
- 프론트 UI 프리미티브는 `components/ui/index.js` barrel로 재노출.

---

## 8. DB 마이그레이션 규약

**신규 DB 컬럼/테이블은 `backend/app_schema.sql`(신규 설치용)뿐 아니라 `backend/main.py:_migrate()`(기동 시 idempotent, `ADD COLUMN IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS`)에 쌍으로 추가할 것** — 한쪽만 고치면 라이브 DB(스키마 파일 재실행 안 됨)가 그 컬럼을 못 봐 INSERT/SELECT가 깨진다. `_migrate`는 각 문 `try/except` + `logger.warning`로 개별 실패를 격리.

**SQL 배치화 함정:** uuid 컬럼에 `= ANY(%s::uuid[])`로 명시 캐스트(단건 `= %s`의 암묵 캐스트가 배열화에서 안 통함). VALUES 다중행 플레이스홀더는 `(%s,%s), (%s,%s), ...`(바깥 괄호로 더 감싸면 record 1행이 됨) — `backend/services/consensus.py:_values_placeholder` 참조.

**라우트 순서:** 배치 라우트를 `{ticker}` 라우트보다 먼저 등록(`PUT /api/stocks/enrich/batch`가 `PUT /api/stocks/{ticker}/enrich`보다 먼저 — `backend/routers/stocks.py`).

---

## 9. KST 타임존 & KR 도메인 관례

- **KR 시장-날짜 판정은 `backend/services/utils.py:today_kst()`**(`datetime.now(ZoneInfo("Asia/Seoul")).date()`) — bare `date.today()`/`datetime.today()`는 컨테이너 UTC라 00~09시 KST에 하루 어긋나 금지. `backend/tests/test_no_bare_today.py`가 ast 스윕으로 신규 위반을 즉시 실패시킴(`main.py`·`routers`·`services`·`scheduler`·`middleware` 대상).
- **KR 색 관례**(`frontend/src/styles/tokens.css`, ADR-0025): `--up`=빨강(상승)·`--down`=파랑(하락). `ui/Badge.css`의 `.badge--success`는 `--up`(빨강), `.badge--danger`는 `--down`(파랑)에 배선돼 있다 — 가격 방향 배지(`ChangeBadge`)는 이 매핑이 의도대로 맞지만, **가격 방향이 아닌 의미 상태 배지에 `success`/`danger` variant를 쓰면 색이 반전**된다. 의미 배지는 `ui/SupplyBadge.jsx`처럼 `style` prop으로 전용 색(`--color-success`/`--warn` 등)을 직접 지정할 것.
- 디자인 토큰은 다크 기본(ADR-0025 terminal identity), 라이트는 동일 색상군 재조정. AA 대비 확보를 위해 다듬어진 토큰: `--warn`(#8a5c00)·`--color-success`(#146c4c)·`--semantic-sell`(#a8480a, `--up`과 시각적으로 구분).
- yfinance 퍼센트 필드는 **소수분수**(0.0098=0.98%) — 표시 시 `×100`, fixture/문서 예시값도 분수 스케일로.
- DB NUMERIC 컬럼(avg_cost·quantity 등)은 **Decimal**로 온다 — float(외부값)과 산술 전 양변 `float()` 정규화.

---

*컨벤션 갱신 근거: 2026-07-12(HEAD b52f0f5e). 직전 지도(1e8da3b, 2026-07-10) 대비 task#171~178(디자인 리뉴얼 5단계 + 사이드바 IA)이 프론트 토큰/색상 규약(§9)을 확정. 백엔드 컨벤션은 안정(§1~8 무변경). 전체 gotcha는 `CLAUDE.md` 참조.*
