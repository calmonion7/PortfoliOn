---
last_mapped_commit: fd8dd650ede08d103b907ac4d87955f669ce3298
mapped: 2026-06-15
---

# CONCERNS — 기술부채·알려진 이슈·취약 영역

이 문서는 PortfoliOn 코드베이스의 기술부채, 운영 함정, 보안 고려사항, 성능 리스크, 깨지기 쉬운 영역을 구체적으로 기록한다. 각 항목은 실제 파일 경로(백틱)·ADR·retro로 근거를 단다.

---

## 1. 배포 취약성 (Deployment Fragility)

### 1.1 2분 폴러가 커밋 안 한 tracked 편집을 삭제한다 — `git reset --hard`

`scripts/auto-deploy-poll.sh`는 launchd `com.portfolion.auto-deploy-poll`이 2분마다 실행한다. 동작:

- `git fetch origin main` 후 `origin/main`이 로컬 `HEAD`보다 앞서면 `git reset --hard origin/main`(35번째 줄)을 친 뒤 `deploy.sh`를 돌린다.
- 즉, **메인 체크아웃(`/Users/calmonion/Project/PortfoliOn`)에서 커밋 안 했거나 push 안 해 로컬이 origin보다 앞선 tracked 편집은 다음 폴(≤2분)에 `reset --hard`로 소실**된다.
- `.forge/` 같은 untracked 파일은 `reset --hard` 대상이 아니라 안전.
- 대응: 코드 변경은 **commit + `git push origin main`을 묶어 즉시** 반영해야 한다.

근거: `scripts/auto-deploy-poll.sh`, `CLAUDE.md`(Deployment·Gotchas 섹션).

### 1.2 프론트 dist는 host-mount(:ro)라 로컬 빌드가 즉시 라이브, 백엔드는 재배포 후에만 라이브

배포 스크립트가 nginx 컨테이너를 `-v "$PROJECT_DIR/frontend/dist:/usr/share/nginx/html:ro"`로 마운트한다. 결과:

- 로컬 `cd frontend && npm run build`로 `frontend/dist`가 갱신되면 **nginx가 즉시 새 번들을 서빙**(서빙 해시=로컬 빌드 해시로 검증 가능).
- 반면 **백엔드 코드 변경은 `deploy.sh`가 backend 이미지를 재빌드·재기동해야 라이브**(Dockerfile 재이미지 + 컨테이너 재시작). 프론트만 빌드하고 백엔드를 재배포 안 하면 백엔드 의존 기능이 미동작하는 불일치가 생긴다.
- 함정: 검증/UAT 시 "프론트는 보이는데 API가 옛 동작"이면 백엔드 재배포 누락을 의심할 것.

### 1.3 동시 배포 가드는 단일 lock 파일

`deploy.sh`·`auto-deploy-poll.sh` 모두 `/tmp/portfolion-deploy.lock`으로 동시 실행을 막는다. lock이 stale하게 남으면(프로세스가 trap 없이 죽는 등) 다음 배포가 영구 스킵될 수 있다(폴러는 "lock exists, skipping"만 로그). 수동 점검 경로: `/Users/calmonion/Library/Logs/com.portfolion.auto-deploy-poll.log`.

---

## 2. DB 마이그레이션 — 반복되는 "DB 수동 적용 필요"의 근본 원인

### 2.1 신규 테이블/컬럼은 반드시 `main._migrate()` 런타임 IF NOT EXISTS에 넣어야 한다

`backend/app_schema.sql`은 docker-entrypoint-initdb.d에 마운트돼 **빈 pgdata 볼륨 최초 초기화 때만** 실행된다. 매 배포 재실행되지 않으므로, 거기에만 추가한 테이블/컬럼은 **이미 채워진 기존 운영 DB에는 절대 생기지 않는다.**

- 정본은 `backend/main.py`의 `_migrate()`(53~64번째 줄): 기동 시 lifespan에서 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`를 idempotent하게 실행한다(현재: `backlog_history.segments JSONB`, `batch_schedules` 테이블, `market_short_sell` 테이블).
- `app_schema.sql`은 신규 DB 일치용 **미러**일 뿐이다.
- 누락 시 증상: 신코드(스케줄러 시딩·라우트)가 그 테이블을 SELECT하면 `relation does not exist`로 **lifespan startup이 실패해 백엔드 부팅이 막힌다**(과거 `batch_schedules`에서 critical로 재현).
- **additive·idempotent DDL에만 한정.** drop/rename/type 변경·백필은 이 경로로 하지 말 것(기동마다 안전하게 도는 연산만).
- 운영 postgres 직접 접근(`docker exec`/외부 DSN mass-write)은 안전 가드로 차단돼, 사람이 수동 `ALTER TABLE`을 칠 경로도 사실상 막혀 있다 — 그래서 기동 마이그레이션이 유일한 자동 적용 경로다.

근거: `backend/main.py`(`_migrate`, lifespan), `backend/app_schema.sql`, ADR `0006-startup-idempotent-migration.md`, ADR `0001`(job_runs는 push 전/동시 적용 권고).

### 2.2 마이그레이션이 try/except로 조용히 삼켜진다

`_migrate()`의 각 DDL은 `try/except Exception:`(또는 `except Exception as e`)로 감싸져 있다(`backend/main.py` 55~64번째 줄). 부팅을 막지 않는다는 장점이 있으나, **마이그레이션 실패가 로그되더라도 조용히 진행**돼 이후 그 컬럼/테이블을 쓰는 코드가 런타임에 깨질 때까지 진단이 지연될 수 있다.

---

## 3. 로컬 `.venv` ≠ Docker 의존성 드리프트

`lxml`은 `requirements.txt`에 있고 Docker 이미지엔 설치되지만 **로컬 `backend/.venv`엔 없다**(`ls backend/.venv/.../site-packages | grep lxml` → 없음으로 확인).

- 로컬 pytest로 검증할 HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 stdlib `BeautifulSoup(html, "html.parser")`를 써야 로컬·프로덕션 모두 동작한다.
- `backend/services/backlog.py`는 이 이유로 document.xml(실제 XML)을 의도적으로 `html.parser`로 파싱한다(30번째 줄 주석, 382·445·466번째 줄에서 사용).
- 함정: 신규 파싱 코드에서 무심코 `"lxml"`을 쓰면 로컬 테스트가 ImportError로 깨진다.

근거: `backend/services/backlog.py`, `CLAUDE.md`(Gotchas).

---

## 4. 성능 리스크

### 4.1 대시보드/목록 per-card N+1 컨센서스 mart 쿼리 (admin `scope=all`은 캐시 우회)

`backend/services/consensus.py`의 `apply_asof()`/`get_asof()` 헬퍼는 호출 1회당 `daily_consensus_mart` 쿼리 1개(폴백 시 `consensus_history` 추가 1개)를 실행한다. 이 헬퍼가 N개 경로에서 항목별로 호출된다:

- `GET /api/stocks/dashboard` — 보유 종목 카드마다 1회. `ThreadPoolExecutor` 내부지만 카드 수만큼 쿼리.
- `GET /api/report/list` — 종목별 최신 리포트마다 1회.
- `GET /api/report/{ticker}/{date_str}` — 요청당 1회.

캐시 완화: `mine` 대시보드는 `_dashboard_cache`(TTL 300s), 목록은 `_list_cache`(TTL 60s)로 보호된다. **그러나 admin `scope=all` 목록은 `cache_svc.get_list`를 거치지 않고 `_build()`를 직접 호출**해 **요청마다 종목 수만큼 mart 쿼리가 그대로 실행**된다. 이는 fg-ask에서 합의된 **알려진 수용 비용**(silent cap 없음)으로 기록돼 있다.

근거: `backend/services/consensus.py`, `backend/routers/report.py`, ADR `0008-consensus-target-source-of-truth-mart-as-of-date.md`.

### 4.2 DB 커넥션 풀 maxconn=20 — ThreadPool 동시성과 경합

`backend/services/db.py`의 `_get_pool()`는 `ThreadedConnectionPool(minconn=1, maxconn=20)`(25번째 줄). 한편 여러 경로가 ThreadPool로 DB를 동시에 두드린다:

- `backend/routers/stocks.py:266` 대시보드 `max_workers=min(len(holdings),10)`
- `backend/routers/calendar.py:70` `max_workers=min(len(all_stocks),15)` ← **풀(20)보다 클 수 있음**
- `backend/services/digest_service.py:47` `max_workers=10`
- `backend/services/analysis_service.py:52` `max_workers=11`(SECTOR_ETFS), `:74` `max_workers=10`
- `backend/services/consensus_pipeline.py:101` `max_workers=5`
- `backend/routers/report.py:147` 백필 `max_workers=5`
- `backend/services/parallel.py` `parallel_map` 기본 `max_workers=10`

각 워커가 DB 커넥션을 잡으면 대기/경합이 발생할 수 있다. 특히 calendar(15)·analysis(11)이 풀 크기(20)에 가깝다. 배치(스케줄러)와 사용자 요청이 동시에 돌면 풀 고갈 위험. MEMORY `project-investor-flow.md`에 "배치 ThreadPool ≤ DB풀" 교훈이 기록돼 있다.

근거: `backend/services/db.py`, 위 각 파일.

### 4.3 인메모리 캐시 TTL — 코드/문서 드리프트

`backend/services/cache.py`의 실제 값:

- `_snapshots` OrderedDict `_MAX = 50`(36번째 줄) — `CLAUDE.md`는 "LRU 200"으로 적어 **드리프트** (실제 50).
- `_list_cache = TTLCache(60.0)`(33번째 줄) — `CLAUDE.md`는 "list (TTL 5s)"로 적어 **드리프트**(코드 60s, 문서 5s).
- `_dashboard_cache`·`_correlation_cache`·`_sector_cache`·`_macro_cache` 모두 TTL 300s(34·35·88·89번째 줄).

캐시는 프로세스 인메모리라 백엔드 재기동 시 전부 초기화된다(멀티 워커였다면 워커별 분리됐겠지만 현재 단일 컨테이너). 종목 추가/수정/삭제 시 `invalidate()`가 snapshot·list·dashboard·correlation·sector·macro를 일괄 무효화한다(52~61번째 줄).

근거: `backend/services/cache.py`, `CLAUDE.md`(Gotchas).

---

## 5. 라우팅 순서 함정 (FastAPI path-param shadowing)

경로 변수 라우트는 정적/특수 경로보다 **뒤에** 등록돼야 한다. 현재 의도적으로 순서를 맞춘 곳:

- `PUT /enrich/batch`(`backend/routers/stocks.py`)가 `PUT /{ticker}/enrich`(190번째 줄)보다 **먼저** 등록 — 아니면 `enrich`가 ticker 값으로 매칭된다. `CLAUDE.md`에 명시.
- `GET /report/{ticker}/backlog`(`backend/routers/report.py`)가 catch-all `GET /report/{ticker}/{date_str}`보다 **먼저** 등록 — 아니면 `"backlog"`가 `date_str`로 매칭돼 snapshots를 `date='backlog'`로 조회하다 500이 난다. 과거 실제 발생한 버그.

리스크: `/report/{ticker}/{date_str}` 같은 catch-all이 존재하는 한, `/report/{ticker}/...` 아래에 새 정적 서브경로를 추가할 때마다 **catch-all보다 앞에 등록**해야 한다. 순서를 어기면 조용히 500/오동작.

근거: `backend/routers/stocks.py`, `backend/routers/report.py`, `CLAUDE.md`, MEMORY `project-backlog-route-fix.md`.

---

## 6. 데이터 파싱 취약성 — 수주잔고 DART (`backend/services/backlog.py`)

DART엔 수주잔고 전용 구조화 API가 없어 공시서류원본파일 `/api/document.xml`(ZIP→디코드) 원문을 받아 표를 파싱한다. 가장 깨지기 쉬운 영역이며 여러 ADR이 누적돼 있다.

### 6.1 'wrong < missing' 원칙 — 추출 실패는 기본값이 아니라 pending으로

표 단위 캡션에서 KRW 통화 토큰을 못 읽으면(USD천·백만달러·줄바꿈 분리) 자동추출을 **막는다**. 단위 미인식 시 '안전한 기본값(억원)' 폴백은 **×100 대형 오저장**을 만들기 때문. 추출 실패는 amount=NULL pending 처리로 저장한다.

- 잠재 함정: 캡션이 아예 없을 때(`node`가 None) 폴백이 있을 수 있다 — 캡션 없는 표에서는 여전히 기본값이 깔릴 가능성.
- 금액은 모두 억원 정규화: 조원×10000·백만원÷100·천원÷1e5. 프론트가 amount를 억원으로 가정하기 때문 — 정규화 없으면 종목 간 차트 비교가 깨진다.

### 6.2 검산 게이트로만 자동 저장 (`source='dart'`)

- 유형1(수주상황 표): `수주총액−기납품≈잔고`(또는 `기말=기초+신규−기납품`) 상대 1% 검산 통과 시만 `source='dart'`. 실패는 pending.
- 다중엔티티(연결 요약표): `Σ(부문·법인 행)==합계 행`(상대 1%) 검산 통과 시 연결 합계를 amount, `회사×사업` 행을 `segments`로 저장. 한 문서에 다중엔티티 표가 섞이면 문서 전체를 pending 처리.
- 건설/EPC 공사진행 표는 **자동추출 정식 포기**(계약별 진행 ≠ 총 수주잔고) — 항상 pending, Cowork가 채움.

### 6.3 pending 저장이 기존 값을 덮어쓰지 않도록 가드

pending 저장은 `source = CASE WHEN amount IS NULL THEN 'pending' ELSE source END`로 **이미 채워진 llm/dart 값을 보존**하고 raw_text/unit만 갱신한다. 이 가드가 없으면 주간 배치가 매번 Cowork 수치를 증발시킨다(ADR-0005의 동반 수정).

### 6.4 ⚠️ 파서 변경 시 전 종목 재적재 UAT 필수

fixture 단위 테스트(`backend/tests/test_backlog.py`)가 전부 통과해도, 운영 재적재가 fixture에 없던 실데이터 케이스(외화 `(단위:USD천)`, 단위 캡션 줄바꿈 분리, 연결 전 분기의 회사컬럼 표 등)를 잡아낸다. **수주잔고/데이터 파싱 변경은 배포 후 전 종목 재적재 UAT를 게이트로** 둘 것.

근거: `backend/services/backlog.py`, ADR `0002`~`0006`.

---

## 7. 프론트엔드 — 대용량 번들·테스트 부재

### 7.1 ~990KB 단일 JS 청크 (>500kB 경고)

`frontend/dist/assets/index-*.js`가 약 990KB(단일 청크). `frontend/vite.config.js`에서 `manualChunks` 함수로 일부 분할(recharts→charts, markdown→markdown, 나머지→vendor)을 설정했으나 여전히 단일 대용량 번들이다. 코드 스플리팅 개선의 여지 있음(경로별 lazy loading 미적용).

근거: `frontend/dist/assets/`, `frontend/vite.config.js`(98~110번째 줄).

### 7.2 프론트엔드 자동화 테스트 없음

`frontend/src` 하위에 `*.test.*`/`*.spec.*` 파일이 0개. `frontend/package.json` scripts에 `test` 항목 없음(dev/build/lint/preview만). 프론트 검증은 수동/Playwright 디바이스 에뮬레이션 UAT에 의존. 백엔드는 반대로 `backend/tests/`에 ~42개 테스트 파일(466 passed)로 두텁다 — **테스트 커버리지가 백엔드에 편중**.

근거: `frontend/package.json`, `frontend/src/`(테스트 파일 부재), `backend/tests/`.

---

## 8. 보안 고려사항

- 하드코딩 시크릿 스캔(backend `*.py`): 검출 없음. 시크릿은 환경변수로 주입된다 — `os.environ["SESSION_SECRET"]`(`backend/main.py:78`), `os.environ["DATABASE_URL"]`(`backend/services/db.py:24`), JWT/OAuth/FRED/KOFIA 키 등은 `backend/.env.docker`(gitignored)에서 로드. 시크릿 값 자체는 본 문서에 재현하지 않음.
- 누락 시 거동: `SESSION_SECRET`·`DATABASE_URL`·`JWT_SECRET` 등이 없으면 `os.environ[...]` KeyError로 부팅 실패(fail-fast) — fallback 기본값 없음(양호).
- CORS: `allow_origins`는 `localhost:3000`/`localhost:5173`/`FRONTEND_URL`(env), `allow_methods=["*"]`, `allow_headers=["*"]`(`backend/main.py:82~87`). `FRONTEND_URL` 미설정 시 운영 origin이 빠질 위험.
- 운영 postgres 직접 쓰기는 안전 가드로 차단(ADR-0006) — 라이브 UAT는 직접 DB 조회 불가, API 경로로 설계해야 함.
- admin 게이팅: 리포트 생성·Guru 크롤·배치 refresh는 `require_admin` 의존성으로 보호. 메뉴 노출은 `user_menu_permissions`로 제어하되 이는 UI 필터링이라 **API 자체의 권한 게이트와 별개** — 권한 없는 메뉴라도 API가 admin-only가 아니면 직접 호출 가능할 수 있으니 라우트별 의존성 확인 필요.

근거: `backend/main.py`, `backend/services/db.py`, `CLAUDE.md`(Deployment·Gotchas), ADR `0006`.

---

## 9. 기타 취약/주의 영역

### 9.1 광범위한 `except Exception` (조용한 실패)

`except Exception` 사용 빈도가 높은 파일: `backend/scheduler.py`(24회), `backend/routers/market_indicators.py`(16회), `backend/services/market.py`(21회), `backend/services/report_generator.py`(8회), `backend/services/job_runs.py`(7회), `backend/services/consensus_pipeline.py`(10회), `backend/services/backlog.py`(5회). 일부는 의도적 graceful degrade(`_warm_calendar_cache`/`_warm_market_cache`/`_migrate`의 try/except, job_runs 계측의 관측-전용 가드 — ADR-0001)이지만, 광범위한 swallow는 디버깅 시 원인 추적을 어렵게 한다.

### 9.2 데드 코드 / 사용 중단 (drop 보류)

- `schedules`·`guru_schedules` 테이블: `batch_schedules` 통합(ADR-0007) 이후 시딩 때 1회 읽힌 뒤 **사용 중단(데드)**. 스키마엔 남겨 둠(드롭은 가역적이라 비목표).
- `backend/reports/` — legacy report 디렉터리(read-only, 구 snapshot JSON 폴백).
- `backend/data/consensus/`·`backend/data/calendar/` — 로컬 파일 캐시(gitignored). `daily_consensus_mart`로 정본이 이동한 뒤 consensus 파일 캐시의 역할이 축소됨.

### 9.3 TODO/FIXME/HACK

backend/frontend/scripts 소스에서 `TODO`/`FIXME`/`XXX`/`HACK` 마커 grep 결과 **검출 없음**(`.venv`·`node_modules`·`dist` 제외). 부채는 마커가 아니라 ADR/retro/MEMORY에 서술로 누적돼 있다.

### 9.4 외부 API 의존 배치의 폭주 가드

`batch_schedules`가 무거운 외부 API 배치(backlog/lending/earnings/monthly)도 인터벌로 바꿀 수 있게 하므로, 폭주 방지 가드레일(최소 5분 + `coalesce=True`)이 데이터 모델이 아니라 검증·트리거 옵션 레벨에 필요하다(ADR-0007). 키 미설정 시 거동: `KOFIA_API_KEY` 미설정 → leverage/lending 요청 실패, `KITA_API_KEY`(실제 관세청 키) 미설정 → UN Comtrade 폴백, `DART_API_KEY` 미설정 → 수주잔고 배치 실패.

근거: `backend/services/`, ADR `0007`·`0008`·`0001`, `CLAUDE.md`(Gotchas).

---

## 10. 외부 API 통합 경계 및 안정성

### 10.1 키움 REST API 토큰·Throttle (ADR-0009)

`backend/services/kiwoom/client.py`가 `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`(`.env.docker`, gitignore)로 토큰 발급(인프로세스 싱글톤, 401시 재발급 재시도) + `request(api_id, body, category)` 직렬 throttle. `quote.py`는 ka10001 → `market.get_quote_kr`이 **키움 우선 + Naver 폴백**(키움 미설정/실패/빈 price면 Naver). `sector.py`(ka20006·ka20002) → `kr_sector_service.py`가 전 업종 모멘텀 사전계산해 `market_cache`에 저장. 실시간 WS(0B/0D) 대체는 후속 Phase.

근거: `backend/services/kiwoom/`, `KIWOOM_API.md`, ADR `0009-kiwoom-integration-boundary.md`.

### 10.2 KIS REST API 백업 시세·토큰 발급 1분 1회 제한 (ADR-0011)

`backend/services/kis/client.py`가 `KIS_APP_KEY`/`KIS_APP_SECRET`(`.env.docker`, 기본 실전 `:9443`)로 `/oauth2/tokenP` 토큰 발급(인프로세스 싱글톤, **발급 1분당 1회 EGW00133 방어로 강제 재발급 60s 가드** + 401 재발급 재시도) + `request(tr_id, path, params)` 직렬 throttle. US 1차=yfinance·KIS=백업. **키 미설정이 안전 기본값**(`configured()` False면 휴면, 기존 동작 무변화).

근거: `backend/services/kis/`, `KIS_API.md`, ADR `0011-kis-readonly-backup-quote-source.md`.

### 10.3 base_dt 인트라데이 엣지 케이스 — kr_sector 캐시 무효화 복합키

`backend/routers/analysis.py`의 `GET /api/analysis/sector?market=KR` 엔드포인트가 KR 업종 모멘텀을 `kr_sector_service.load_momentum()`에서 읽는데, 캐시 무효화가 `invalidate_sector(user_id)`로 user_id 기반이라 **market을 캐시키에 반영하지 않으면** US/KR이 같은 user_id로 충돌할 수 있다. `cache.py:95`에서 `f"{user_id}:{market}"` 복합키로 방어했으나, `invalidate_sector()`(무인자 전체 clear)가 호출될 때 두 시장 모두 일괄 무효화되므로 의도한 저수준 오류는 없다. 다만 user별 무효화(`invalidate_sector(user_id)`)가 도입되면 이 복합키 미매칭으로 회귀할 수 있다(low priority, 알려진 리스크).

근거: `backend/services/cache.py:92~95`, `backend/routers/analysis.py`.

### 10.4 배치-백킹 뷰의 "외부 API 호출 금지" 원칙 (위반 방지 안티패턴)

배치-백킹 뷰(랭킹·KR 업종 모멘텀 등)는 외부 API(키움)를 **요청·기동 경로**에서 라이브 호출하지 말 것 — 배치가 사전계산해 `market_cache`/테이블에 저장하고 **요청은 저장값만 읽는다**(요청당 N콜 직렬=수초 지연). 외부 fetch는 ① **실패를 조용히 삼키지 말고 로깅**(silent except는 진단 불가) ② **빈/all-None 결과를 캐시에 박제 금지**(전부 None이면 save 생략·직전 양호값 유지). 의심 트리거가 아니라 **실패 클래스(all-None)**를 가드해야 근본원인 미상이어도 재발을 막는다.

근거: `CLAUDE.md`(Gotchas 배치-백킹 섹션, task#48~50 누적 재발 기록).

---

## 11. 배치 실행 이력 추적 설계 부채

### 11.1 Job_runs 테이블 부재 윈도우 (배포 후 시딩 시간차)

ADR-0001에서 채택한 `job_runs` 테이블은 신규 항목이므로 배포 직후 테이블이 존재하지 않는 윈도우가 있을 수 있다(lifespan이 CREATE IF NOT EXISTS를 돌기 전). 이 윈도우에서 자동 배치가 실행되면 `record()` INSERT가 실패할 수 있다. 초기 구현에서는 enter INSERT가 무방비여서 테이블 부재 시 모든 자동 잡이 깨질 뻔했고, 후속 보강(task #6 리뷰)으로 write-path의 모든 INSERT/DELETE/UPDATE를 try/except로 감싸 graceful degrade하도록 했다.

근거: ADR `0001-job-runs-execution-log.md`.

### 11.2 배치 ID 은퇴 시 전수 grep 필수 (중복 레코딩 회귀)

**배치 id를 `batch_registry.BATCHES`에서 빼면 그 id를 쓰는 *모든* 표면을 전수 grep**: ① 데이터 read(스케줄 소비처), ② 표시 문자열(`schedule_desc` 등), ③ **`job_runs.record(id, ...)` 모든 lane — auto뿐 아니라 manual·backfill 경로까지**, ④ 그 id를 단언하는 테스트. 한 곳이라도 옛 id로 남으면 stale read(과거)·**배치 현황 실행이력에서 사라지는 회귀**(이번: 수동생성/백필이 은퇴한 `daily_report`로 record → 카드에서 증발, ADR-0012·0013 task15·17·45 재발)·고아 run 누적이 생긴다.

근거: `CLAUDE.md`(Gotchas 배치 id 은퇴 섹션), ADR `0012-market-split-daily-report-batches.md`·`0013-batch-market-classification-and-earnings-monthly-split.md`.

---

## 요약 — 변경 시 가장 잘 깨지는 곳 (우선 점검)

1. 신규 테이블/컬럼 → `main._migrate()`에 IF NOT EXISTS 추가했는가 (안 하면 운영 부팅 실패).
2. 코드 변경 → commit+push 묶었는가 (안 하면 2분 폴러가 reset --hard로 삭제).
3. 수주잔고/파싱 변경 → 배포 후 전 종목 재적재 UAT 했는가 (×100 오저장 방지).
4. `/report/{ticker}/...` 신규 서브경로 → catch-all `{date_str}`보다 앞에 등록했는가.
5. HTML 파싱 → `html.parser` 썼는가 (로컬 .venv lxml 없음).
6. N개 카드 경로에 per-항목 헬퍼 추가 → admin `scope=all`(캐시 우회) N+1 비용 명시했는가.
7. 배치 ID 은퇴 → 전수 grep해 record/read/표시 모든 곳에서 옛 id를 제거했는가.
8. 배치-백킹 view 추가 → 외부 API를 요청 경로가 아닌 배치에서만 호출하게 했는가.
