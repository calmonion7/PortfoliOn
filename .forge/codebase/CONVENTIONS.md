---
last_mapped_commit: 44629f27cfb796dbd2120b7002a99e3d82f7c725
mapped: 2026-07-24
---

# CONVENTIONS

PortfoliOn 코드베이스의 코드 스타일·명명·패턴·에러처리·로깅 규약. 이 문서 자체가 규약의 정본이며, 프로젝트 `CLAUDE.md`의 Gotchas가 근거다. 구현 사실만 다루고 도메인 용어 정의는 `.forge/codebase/CONTEXT.md`에 둔다.

백엔드는 Python/FastAPI(`backend/`), 프론트는 React 19 + Vite 8 plain CSS(`frontend/`).

---

## 1. Python 타입 어노테이션 — 로컬 3.9 제약

로컬 `backend/.venv`는 **Python 3.9.6**(Docker 컨테이너는 3.12)다. 로컬 pytest가 배포 게이트이므로 3.9가 사실상 하드 제약이다.

- **런타임 평가되는 어노테이션에 PEP604 `X | None` 금지 — `Optional[X]`를 쓴다.** Pydantic 모델 필드·FastAPI 시그니처처럼 어노테이션이 런타임 평가되는 자리에 `float | None`을 쓰면 로컬 pytest에서 `TypeError`(3.9는 union 연산자 미지원). 문자열 주석(`"dict | None"`)은 평가되지 않아 통과하므로 더 헷갈린다.
- 기존 코드가 이 규약을 따른다: `backend/routers/portfolio.py`(`target_price: Optional[float] = None`), `backend/routers/stocks.py`(`moat: Optional[Any] = None`) 등. bare list/dict 본문 파라미터는 `Body(...)`로 명시(FastAPI 요구).

## 2. 외부 파싱·로컬 의존성 격차

로컬 `backend/.venv`와 Docker 이미지의 의존성이 다르다 — `lxml`은 `requirements.txt`에 있고 Docker엔 설치되지만 **로컬 `.venv`엔 없다**.

- **HTML 파싱은 stdlib 파서를 쓴다: `BeautifulSoup(html, "html.parser")`** (로컬·프로덕션 모두 동작). `"lxml"`을 쓰면 로컬 pytest에서 깨진다. 기존 소비처 전부 이 규약을 따른다: `backend/services/backlog_parser.py`, `backend/services/scraper.py`, `backend/services/guru_scraper.py`, `backend/services/market/kr.py`.

## 3. NaN/inf 직렬화 안전 + DB NUMERIC ↔ float 산술

- **응답에 NaN/inf 가능 float를 싣는 엔드포인트는 반드시 가드한다.** starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 **500**(`Out of range float values are not JSON compliant`)이 난다. 폴백이 증상을 엇갈리게 한다: PostgreSQL은 `json` 컬럼에 NaN을 거부하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과 → DB 저장 실패·파일 성공·응답 직렬화 실패로 진단이 늦어진다.
- 가드는 **소스에서**(예: `math.isfinite` 체크 후 "시세 없음" 처리)가 출력 일괄 sanitize보다 깨끗하다. 시세/합산을 응답에 싣는 엔드포인트는 `services.utils.sanitize`(재귀적으로 NaN/inf→None; `backend/services/utils.py`) 또는 소스 `math.isfinite` 가드 중 하나가 필수.
- 시장-날짜 판정 헬퍼도 여기 산다: `services.utils.today_kst()`(§7 참조).
- **DB NUMERIC 컬럼은 파이썬 Decimal로 온다 — 외부 float와 직접 산술 금지.** `avg_cost`·`quantity` 등 NUMERIC 컬럼은 Decimal, 외부 시세/배당(yfinance·`stock_dividends`)은 float이라 `float / Decimal`이 `TypeError`를 낸다. 배당 있는 모든 보유 카드가 조용히 `_minimal_card` 폴백으로 빠진 실사례가 있다. 계산 전 양변을 `float()`로 정규화하고, **회귀 테스트 fixture는 Decimal 값을 쓴다**(float fixture는 이 버그를 못 잡는다).

## 4. 로깅 방출 규약

백엔드 진단/경고/에러는 **모듈 `logger`로 통일**한다. `tests/test_no_print.py`가 이 규약을 자동 강제한다(아래).

### 4.1 백엔드 — 모듈 logger

- **`print` 신규 금지.** 앱 코드(`main.py`·`routers/`·`services/`·`scheduler/`·`middleware/`)의 `print(` 개수는 0이어야 하며, `backend/tests/test_no_print.py`가 ast로 `print()` 호출 노드를 탐지해 단언한다(문자열/주석/`pprint` 오탐 없음, `tests/`·`scripts/`·`data/`는 대상 외).
- 모듈마다 `logger = logging.getLogger(__name__)`.
- **루트 로거는 `main.py`의 `_configure_logging()`이 기동 시 1회 배선한다**(`backend/main.py:16`). `basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")` + urllib3/yfinance/apscheduler/asyncio를 WARNING으로 억제 + uvicorn 로거 `propagate=False`(중복 emit 방지). **config가 없으면 root lastResort가 WARNING+만 내보내 `logger.info`가 docker logs에 안 뜬다.**
- 레벨: `warning`=graceful 담화, `error`=예상치 못함·데이터 손실(아껴 쓴다), `info`=배치/라이프사이클.
- 포맷: `logger.x(f"[Component] <무엇> (<ids>): {e}")`. **`[Component]`는 PascalCase, 개념당 1스펠링.** formatter에 프리픽스가 없어 메시지 내 마커가 유일한 grep 앵커다. 기존 마커 예: `[Report]`, `[Funnel]`, `[Financials]`, `[Pipeline]`, `[Digest]`, `[Backfill]`, `[Consensus]`, `[Backlog]`, `[Quote]`, `[Dividends]`, `[Beta]`.

### 4.2 프론트 — console

- `console.warn`=graceful, `console.error`=예상외. 자동 가드는 없다(lint 미연결).
- **마커는 소스 모듈/훅명 실명**(백엔드 개념명과 다르다): `[usePortfolioData]`, `[useReportList]`, `[PermissionPanel]`, `[Analytics]` 등. 메시지에 실패한 엔드포인트 경로를 함께 적는다(예: `'[usePortfolioData] dashboard(/stocks/dashboard) 조회 실패'`).

## 5. DB 스키마·마이그레이션 쌍

- **신규 DB 컬럼은 `app_schema.sql`만으로 배포에 반영되지 않는다.** 스키마 파일은 신규 설치용이고 라이브 DB는 기동 idempotent 마이그레이션(ADR-0006)만 탄다.
- **`backend/main.py`의 `_migrate()`(`backend/main.py:57`)에 `ADD COLUMN IF NOT EXISTS`를 쌍으로 추가하는 것이 완료기준(DoD)이다.** 한쪽만 고치면 배포 직후 그 컬럼을 쓰는 INSERT/SELECT가 컬럼 부재로 깨진다. 기존 마이그레이션 예: `ALTER TABLE user_stocks ADD COLUMN IF NOT EXISTS target_price numeric` 등.
- 리뷰도 변경 파일 밖 배선 계층(`main._migrate`·`include_router`·`batch_registry`)까지 확인한다.

## 6. 캐시 무결성 — 빈값/부분실패 박제·클로버 금지 (wrong < missing)

배치가 사전계산해 `market_cache`/테이블에 저장하고 요청은 저장값만 읽는 패턴이 표준이다(요청 경로에서 외부 API 라이브 호출 금지 — 캐시 만료마다 느려짐).

- **외부 fetch 실패를 조용히 삼키지 않는다.** silent `except`는 진단 불가. 최소한 진단 로그를 남기거나 좁은 예외만 잡는다.
- **빈/all-None 결과를 캐시에 박제하지 않는다.** 전부 None이면 save를 생략하고 직전 양호값을 유지한다(시드 가드가 "채워짐"으로 오판해 고착하는 것 방지). 의심 트리거가 아니라 **실패 클래스(all-None)를 가드**해야 근본원인 미상이어도 재발을 막는다.
- **요청 경로 fetch도 "성공-but-빈응답"을 박제 금지.** 외부 API가 `rt_cd=0`(무예외)으로 빈 output을 주면 예외 가드를 통과한다 — 값 수준 가드(price None/빈 history면 fetch 실패 취급, degenerate save 금지)가 필요하다. `indices.py`의 `if any(v is not None ...)` 지속 가드가 참조 패턴.
- **delete-rewrite(replace) 갱신은 fetch 실패 시 delete를 스킵한다.** `DELETE+INSERT`로 저장하는 store는 빈 결과를 삼키면 save 생략이 아니라 직전 양호값을 DELETE로 **파괴**한다(박제보다 은밀 — 소멸이라 토스트도 없음). 근본 신호는 fetch 성공 여부: fetch 함수가 예외를 `[]`로 삼키지 말고 전파해 호출측이 실패 시 replace를 통째 스킵하게 한다. genuine-empty(fetch 성공·무데이터)만 clear. replace는 delete+insert를 단일 트랜잭션으로.
- 원칙: **wrong < missing** — 틀린 값을 박제하느니 없는 편이 낫다. 추출/파싱 실패는 "안전한 기본값" 폴백이 아니라 pending(누락)으로 처리한다(단위 캡션 파싱 실패 시 억원 기본값 폴백이 ×100 대형 오저장을 만든 사례).

## 7. 시간대 — KST 시장-날짜

- **KR 시장-날짜(영업일/최근월물 판정)는 `datetime.now(ZoneInfo("Asia/Seoul")).date()`를 쓴다 — bare `date.today()` 금지.** 백엔드 컨테이너에 TZ env가 없어 `date.today()`=UTC라, 00:00~09:00 KST(UTC 전일)엔 하루 뒤처져 판정이 어긋난다.
- 공용 헬퍼 `services.utils.today_kst()`(`backend/services/utils.py`)가 정본. `_KST = ZoneInfo("Asia/Seoul")` 패턴도 `kospi_signal.py`·`scheduler/schedule.py`에서 재사용된다.
- 이는 series **정렬**용 `tz_localize(None)`(naive↔aware concat 시 `TypeError` 회피)과는 별개 문제다 — 이건 "어느 달력일이냐" 판정용.

## 8. 소비처 전수 grep — 계약 변경 시

- **엔드포인트 응답을 비-additive로(배열→객체 등) 바꾸면 그 경로를 fetch하는 모든 프론트 소비처를 전수 grep한다**: `grep -rn '<경로>' frontend/src/`. 독립 fetcher까지 전부 갱신해야 한다(훅과 별개로 직접 fetch하는 페이지가 조용히 깨진다). 가능하면 **additive(필드 추가)**를 선호하고, reshape 불가피 시 소비처 전수 감사를 DoD에 포함.
- **공용 프론트 컴포넌트/배지 variant를 바꾸면 소비처 전수 grep이 선행**한다. "규칙 위반처럼 보이는 배선"이 의도된 소비일 수 있다. 액션 버튼 블록은 단일 `frontend/src/components/reports/StockActions.jsx`로 통합돼 있어 게이트 변경은 거기 한 곳만 손댄다.
- **API 변경 시 명세서 갱신이 DoD**: `API_SPEC.md`(전체 REST 레퍼런스)와, Cowork 소비 대상이면 `CLAUDE_COWORK_API.md`(외부 Cowork 전용). 사용자 대면 read 엔드포인트는 `API_SPEC.md`에만. 엔드포인트 존재 drift는 `backend/tests/test_api_doc_sync.py`가 자동 검출(§9 TESTING 참조). 기능 표면(화면·env·스택·아키텍처·배치) 변경 시 `README.md` 해당 절도 같은 PR에서 갱신.

## 9. 프론트 KR 색 관례 — 가격 배지 ≠ 의미 배지

에디토리얼 리디자인(task#194) 이후 가격 방향 배지와 의미 상태 배지가 전용 variant로 분리됐다(`frontend/src/components/ui/Badge.css`·`frontend/src/styles/tokens.css`).

- **가격 방향**: `.badge--up`(상승 = 버밀리온 `--up` `#b3372b`)·`.badge--down`(하락 = 프러시안 `--down` `#2b5c9e`). `ChangeBadge`가 사용. (KR 관례: 상승=빨강, 하락=파랑.)
- **의미 상태**: `.badge--success`(녹 `--color-success`)·`.badge--danger`(빨 `--color-error`)·`.badge--warning`(오커 `--warn`) — 통념(Western)대로 동작.
- **가격 방향엔 up/down, 의미 상태엔 success/danger/warning — 교차 사용 금지.** 공용 배지 variant의 색 의미를 바꿀 땐 소비처 전수 grep 선행(의미색 교체가 ChangeBadge 가격색을 반전시킨 차단급 회귀 사례 — vitest·빌드는 색 의미에 블라인드, 스팟 시각 재캡처가 유일 포착).
- 다크 모드는 `frontend/src/styles/tokens.css`에서 같은 토큰의 밝은 변형으로 재정의된다.
