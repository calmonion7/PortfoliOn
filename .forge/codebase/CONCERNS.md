---
last_mapped_commit: 1bbea86804f93c6f544092809ff8ed13977e5975
mapped: 2026-06-06
---

# CONCERNS — 기술 부채 · 잠재 버그 · 위험 영역

PortfoliOn 코드베이스에서 발견한 기술 부채, 잠재 버그, 보안 우려, 성능 병목, 취약 지점을 정리한다. 각 항목은 심각도(높음/중간/낮음)와 확정/의심 여부를 표기했다. 모든 경로는 `backtick`으로 표기한다.

---

## High — 보안

### JWT/리프레시 토큰을 localStorage에 저장 (확정)
`frontend/src/api.js:8`, `frontend/src/App.jsx:101-102`, `frontend/src/pages/LoginPage.jsx:28-29`에서 `access_token`과 `refresh_token`을 모두 `localStorage`에 저장한다. XSS가 발생하면 토큰이 그대로 탈취된다. 리프레시 토큰 수명이 30일(`backend/services/auth_service.py:15`)이라 탈취 시 피해가 크다. httpOnly 쿠키가 아니므로 의도된 SPA 트레이드오프일 수 있으나, 보안상 가장 큰 노출면이다.

### 리프레시 토큰 회전(rotation) 부재 — 무제한 재사용 (확정)
`backend/services/auth_service.py:115-128`의 `consume_refresh_token`은 토큰을 조회만 하고 **삭제하지 않는다**. `/api/auth/refresh`(`backend/routers/auth.py:89-94`)는 매 호출마다 새 access+refresh 쌍을 발급하지만 기존 토큰은 DB에 그대로 남아 30일간 무제한 재사용 가능하다. 또한 매 refresh마다 `refresh_tokens` 행이 새로 INSERT되어(`auth_service.py:102-105`) 정리 로직이 없어 테이블이 무한히 증가한다(로그아웃은 한 토큰만 DELETE). 이름은 "consume"이지만 실제로는 소비하지 않는다.

### 프론트엔드 401 시 자동 리프레시 미작동 (확정)
`backend/routers/auth.py`에 `/api/auth/refresh`가 존재하지만 `frontend/src/api.js:15-25`의 응답 인터셉터는 401을 받으면 곧바로 토큰을 지우고 `/`로 리다이렉트한다. access token이 1시간(`auth_service.py:14`)마다 만료되므로 사용자는 한 시간마다 강제 로그아웃된다. 30일 refresh token이 무의미해진다.

### OAuth ID 토큰 서명 검증 생략 (확정, 트레이드오프 가능성)
`backend/routers/auth.py:170-173`에서 Google `id_token`의 페이로드를 `base64.urlsafe_b64decode`로 직접 디코딩만 하고 **서명을 검증하지 않는다**. 메모리(`project-google-oauth-fix.md`)상 jose의 `at_hash` 검증 오류를 우회하려는 의도된 변경이다. 토큰이 Google `token` 엔드포인트 응답(HTTPS)에서 직접 왔으므로 중간자 위험은 낮으나, 표준 검증을 건너뛴 상태라는 사실은 명시 위험이다.

### CORS에 `allow_credentials` 미설정이지만 OAuth가 SessionMiddleware 의존 (의심)
`backend/main.py:62-71`은 `SessionMiddleware`를 추가하지만 CORS에 `allow_credentials=True`가 없다. OAuth state는 세션이 아닌 HMAC 서명 nonce(`backend/routers/auth.py:42-53`)로 검증하므로 당장 깨지지는 않으나, 세션 미들웨어가 실질적으로 쓰이지 않는 미사용 의존일 가능성이 있다. `allow_methods=["*"]`/`allow_headers=["*"]`는 넓게 허용되어 있다.

---

## High — 동시성 / DB 풀

### 대시보드 ThreadPool이 DB 풀을 고갈시킬 수 있음 (확정)
`backend/routers/stocks.py:258-260`의 `get_dashboard`는 보유 종목 수만큼(최대 10) `ThreadPoolExecutor`로 `_build_card`를 병렬 실행한다. `_build_card`(`stocks.py:215`)는 `_latest_snapshot`(`stocks.py:24`)을 통해 `query()`를 호출하므로 워커마다 DB 커넥션을 점유한다. DB 풀은 `maxconn=10`(`backend/services/db.py:23`)이다. 보유 10종목 + 다중 사용자 동시 요청 시 풀 초과(`PoolError`)가 발생할 수 있다.

스케줄러의 수급 배치는 이 문제를 인지하고 `max_workers ≤ 8`로 명시 제한(`backend/scheduler.py:188-189`)했으나, 사용자 요청 경로인 대시보드에는 같은 가드가 없다. CLAUDE.md의 "배치 ThreadPool≤DB풀" 교훈이 일부 경로에만 적용된 상태다.

### `parallel_map` 기본 max_workers=10이 풀 크기와 동일 (의심)
`backend/services/parallel.py:5`의 기본 `max_workers=10`은 DB `maxconn=10`과 같다. `backend/routers/report.py`에서 `parallel_map`을 쓰는 경로가 DB를 건드릴 경우 동일한 고갈 위험이 있다. (단, `report_generator.generate_report`의 내부 ThreadPool은 yfinance I/O 전용이라 무관.)

---

## High — 캐시 무효화

### 캘린더 캐시 무효화가 실제 캐시를 비우지 못함 (확정, 버그 의심)
`backend/routers/calendar.py:26-29`의 `clear_cache()`는 로컬 파일(`data/calendar/*.json`)만 삭제한다. 그러나 `_get_events`(`calendar.py:43-47`)는 `calendar_cache` **DB 테이블을 먼저 읽는다**. 종목 추가/삭제 시 호출되는 무효화 경로(`backend/services/cache.py:107-109`, `backend/routers/watchlist.py:96,151`, `backend/routers/portfolio.py`)가 모두 `clear_cache()`를 부르지만, 이는 더 이상 읽히지 않는 파일만 지우고 user별 DB 캐시 행은 남긴다. 결과적으로 종목을 추가/삭제해도 캘린더가 갱신되지 않을 수 있다. 사용자가 수동으로 `DELETE /api/calendar/cache?month=...`(`calendar.py:37-40`, user_id+month 스코프)를 호출해야만 DB 캐시가 비워진다. 주석(`calendar.py:27`)도 "Supabase 캐시... user_id 불명이므로 로컬만"이라 한계를 인정하고 있다.

### 종목 변경 시 전체 사용자 대시보드/상관관계 캐시 일괄 무효화 (확정, 성능)
`backend/services/cache.py:52-61`의 `invalidate(ticker)`는 `invalidate_dashboard()`를 인자 없이 호출해 **모든 사용자의** 대시보드 캐시(`cache.py:63-64`)를 비운다. `tickers`/`snapshots`가 전역 공유 자원이라 불가피한 면이 있으나, 한 종목 변경이 전 사용자 캐시를 날려 재계산 폭주(thundering herd)를 유발할 수 있다.

### 인메모리 캐시는 다중 워커/재시작에 휘발 (확정)
`backend/services/cache.py`의 6종 캐시, `backend/services/market_indicators/cache.py:11`의 `_cache`, `backend/routers/auth.py:24`의 `_oauth_codes`, `backend/services/leverage_service.py:178`의 `_backfill_progress`, `backend/routers/report.py:59-60`의 `_progress`는 모두 프로세스 인메모리 전역 dict다. uvicorn을 다중 워커로 띄우면(현재 `Dockerfile`은 워커 미지정 = 단일) 워커 간 비일관, OAuth 코드 교환 실패(`/oauth/token`이 다른 워커에 붙으면 코드 못 찾음), 진행률 표시 오류가 발생한다. 현재 단일 워커라 잠복 상태지만, 워커를 늘리는 순간 깨진다.

### 캐시 TTL 문서-코드 불일치 (낮음, 문서 부채)
CLAUDE.md는 list 캐시 TTL을 "5s"로 명시하나 `backend/services/cache.py:33`은 `60.0`(60초)이다. snapshot LRU도 문서는 "200"이나 코드(`cache.py:36`)는 `_MAX = 50`이다. 문서가 코드와 어긋난다.

---

## Medium — 외부 API 취약성

### yfinance 의존 전반 (확정)
`backend/services/market.py`, `report_generator.py`, `calendar.py`, `market_indicators/*.py` 등이 yfinance에 광범위 의존한다. yfinance는 비공식 스크레이핑 기반이라 레이트리밋·스키마 변경·차단에 취약하다. 대부분 `except Exception: return [] / return {...None}` 패턴(예: `market.py:149-150,167-178,456-463`, `scraper.py:38-39,91-92,129-130`)으로 실패를 조용히 흡수해, 데이터가 비어도 에러가 표면화되지 않는다. RSI/재무/컨센서스가 통째로 누락돼도 사용자는 "N/A"만 본다.

### 공공데이터포털 키 의존 + KOFIA/관세청 폴백 경로 (확정)
`backend/services/leverage_service.py:26`, `lending_service.py:13`은 `KOFIA_API_KEY`가 없으면 빈 키로 요청 → 실패한다(CLAUDE.md도 명시). `market_indicators/exports.py`는 `KITA_API_KEY`(실제 관세청 키) 미설정 시 UN Comtrade로 폴백하나, 이 폴백 경로의 안정성은 별도 검증이 필요하다. FRED 경제지표도 `FRED_API_KEY` 의존.

### 한국 데이터 스크레이핑이 HTML/JSON 구조에 결합 (확정, 취약)
`backend/services/market.py:36-47`의 FnGuide 시총은 정규식(`re.search(r"시가총액\s*\(보통주,억원\)...")`)으로 HTML을 긁는다. Naver Finance API(`market.py:25-28`), FnGuide JSON(`market.py:374-416`)도 비공식 엔드포인트라 응답 키(`closePrice`, `RECOM_CD`, `TARGET_PRC` 등)·행 인덱스(`_naver_row_val`의 하드코딩된 `rv(0,..) / rv(11,..) / rv(13,..)` 등 `market.py:208-214`)에 강하게 결합돼 있다. 사이트 개편 시 조용히 깨진다.

### finviz 스크레이핑이 셀 텍스트 매칭에 의존 (확정)
`backend/services/scraper.py:14-39`는 finviz HTML의 `snapshot-table2` 테이블에서 "Recom"/"Target Price" 라벨 다음 셀을 읽는다. 레이아웃·클래스명 변경 시 무음 실패.

### 외부 API 페이지네이션 루프의 종료 조건 (의심)
`backend/services/leverage_service.py:30-44`와 `lending_service.py:27-34`의 페이지 루프는 `len(items) < page_size`로 종료한다. API가 정확히 `page_size`개를 반환하는 경계 케이스나 `totalCount` 누락 시 추가 호출이 발생할 수 있다(leverage는 `totalCount`도 함께 체크해 비교적 안전).

---

## Medium — 데이터 무결성 / 모델

### 전역 공유 자원과 사용자별 자원의 혼재 (확정, 설계상)
`tickers`/`snapshots`/`consensus_history`는 전역 공유(`backend/app_schema.sql:6-26,69`)이고 `user_stocks`는 사용자별이다. `storage.enrich_stock`(`backend/services/storage.py:246-256`)과 `update_ticker_meta`(`storage.py:259-265`)는 사용자 검증 없이 전역 `tickers`를 직접 UPDATE한다. 한 사용자가 종목 메타(name/competitors/moat 등)를 수정하면 **모든 사용자에게 반영**된다. `get_global_portfolio`(`storage.py:210-240`)는 API 키 인증 시 전 사용자 종목을 합산한다. 의도된 단일 테넌트 가정으로 보이나, 다중 사용자 환경에서 데이터 격리가 없다는 점은 명시 위험이다.

### `enrich_stock`의 동적 SET 절 (낮음, SQLi는 방어됨)
`backend/services/storage.py:253-255`는 f-string으로 `SET` 절을 조립하나, 컬럼명을 `_ENRICH_KEYS` 화이트리스트로 사전 검증(`storage.py:248-249`)하고 값은 파라미터 바인딩하므로 SQL 인젝션은 방어된다. 패턴 자체는 주의 필요.

### `user_events.properties`가 무검증 임의 dict (중간, 보안/저장)
`backend/routers/events.py:20-22,43`은 `properties: dict = {}`를 검증 없이 그대로 JSON 저장한다. `event_name`만 `VALID_EVENTS`로 화이트리스트(`events.py:8-15,41`)되고 properties 내용·크기 제한은 없다. 클라이언트가 임의 페이로드를 무한정 밀어넣을 수 있다(스토리지 남용·PII 유입 가능). `middleware/event_tracker.py`의 자동 추적도 별개로 동작.

### KR 데이터에 휴리스틱 보정 다수 (낮음, 정확도)
`backend/services/market.py:120-121`은 등락률 부호를 휴리스틱으로 뒤집고, `report_generator.py:89` `trailing_eps = sum(eps_list[:4]) if len(eps_list) >= 2`는 분기 4개 미만이어도 TTM을 계산한다. 데이터 품질에 따라 부정확한 PER/PBR이 나올 수 있다.

---

## Medium — 에러 스왈로잉 / 가시성

### 광범위한 `except Exception: pass` / 빈 반환 (확정)
백엔드에 약 150개 `except`가 있고(`grep` 기준), 다수가 `pass` 또는 빈 dict/list 반환으로 실패를 흡수한다. 대표 사례:
- `backend/services/market_indicators/cache.py:35-36,48-49,55-56` — DB 읽기/쓰기/삭제 실패를 전부 `pass`. 캐시 저장이 조용히 실패하면 매 요청마다 외부 API 재호출.
- `backend/middleware/event_tracker.py:48-49`, `backend/routers/events.py:31-32` — 이벤트 저장 실패 무음.
- `backend/services/report_generator.py:174-175,331-333` — 스냅샷 DB 저장 실패 시 print만(백필은 파일도 롤백).
- `backend/routers/stocks.py:30-31,42-43` — 스냅샷 조회 실패 무음 폴백.

로깅이 `print()` 기반(구조화 로거 부재)이라 운영 중 원인 추적이 어렵다.

### NaN/Inf 정제는 `sanitize`로 처리하나 적용 일관성 의존 (확정)
`backend/services/utils.py:21-28`의 `sanitize`가 NaN/Inf → None 변환을 담당하고, `report_generator.py:165`, `leverage_service.py:343`, `lending_service.py:151` 등에서 적용된다. 다만 새 응답 경로에서 `sanitize` 적용을 빠뜨리면 JSON 직렬화 오류(`Infinity`/`NaN`은 표준 JSON 아님)가 발생한다. `_fin_num`(`report_generator.py:18-25`), `_safe_float`(`leverage_service.py:52`) 등 개별 가드가 산재해 일관성 부담.

---

## Medium — 마이그레이션 / 스키마

### 스키마 적용 순서 의존 + additive 컬럼 수동 배포 (확정)
`auth_schema.sql` → `app_schema.sql` 순서로 실행해야 한다(`app_schema.sql:3` "Depends on auth_schema.sql"). `app_schema.sql`의 FK(`users(id)`, `tickers(ticker)`)가 선행 테이블에 의존하기 때문이다. 메모리(`project-advisory-insights.md`, `feedback-fastapi-body-param.md`)에 따르면 additive 컬럼(`insights`, `enriched_at` 등)은 코드 배포 전에 DB에 수동 적용해야 하며 잊기 쉽다. `tickers.insights`/`enriched_at`(`app_schema.sql:16-17`)이 그 예.

### migrations/ 가 app_schema.sql과 중복 (확정, 혼란 유발)
`backend/migrations/001_user_events.sql`, `002_backlog_history.sql`은 `app_schema.sql:143-149,187-196`과 동일 테이블을 `IF NOT EXISTS`로 재정의한다. 정식 마이그레이션 도구(Alembic 등)가 없고, 신규/기존 DB에 어떤 파일을 어떤 순서로 적용하는지가 코드가 아닌 운영자 기억에 의존한다.

### 런타임 테이블의 코드 내 lazy 생성 (확정)
`backend/services/lending_service.py:55-68`의 `_ensure_table()`은 `market_lending_balance`를 코드에서 `CREATE TABLE IF NOT EXISTS`로 만든다. 같은 정의가 `app_schema.sql:175-185`에도 있다. 스키마 정의가 SQL과 Python 두 곳에 분산돼 드리프트 위험이 있다.

### 레거시 스키마 잔존 (낮음)
`backend/supabase_schema.sql`이 남아 있다. CLAUDE.md상 Supabase는 제거됐으므로 사용되지 않는 잔재로 추정(혼란 유발).

---

## Low — 라우팅 순서

### 라우팅 순서 가드 현재는 정상 (확정)
- `backend/routers/stocks.py:174` `PUT /enrich/batch`가 `:189` `PUT /{ticker}/enrich`보다 먼저 등록됨 (CLAUDE.md 가트차 준수). 또한 `:151` `GET /{ticker}/news`가 `:163` `GET ""`보다 먼저 와 정상.
- `backend/routers/report.py`: `:302` `GET /report/backlog/pending`이 `:308` `GET /report/{ticker}/{date_str}`보다, `:339` `/consensus/batch/progress`가 `:366` `/consensus/{ticker}`보다 먼저 등록됨. 정적 경로 우선 규칙 준수.

다만 이 순서 의존은 FastAPI의 선언 순서 기반이라, 새 경로 추가 시 순서를 어기면 `{ticker}`/`{date_str}`가 정적 세그먼트를 가로채는 사일런트 버그가 재발한다. 구조적 가드(명시적 path 우선순위)가 없어 취약점으로 남는다.

---

## Low — 프론트엔드

### 테스트 부재 (확정)
`frontend/`에 `*.test.*`/`*.spec.*` 파일이 없다(검색 결과 0건). 백엔드는 `backend/tests/`에 33개 테스트가 있으나 프론트엔드는 회귀 안전망이 전무하다.

### 대형 컴포넌트 (확정, 유지보수)
`frontend/src/pages/Reports.jsx`(752줄), `Ranking.jsx`(634줄), `components/reports/DetailTab.jsx`(571줄), `pages/Portfolio.jsx`(515줄)가 비대하다. 단일 파일에 많은 책임이 몰려 있어 변경 시 회귀 위험이 높다.

### 서비스워커 / PWA 캐시 (확정, 잠복)
`frontend/vite.config.js`의 VitePWA는 `registerType: 'autoUpdate'`, `skipWaiting`, `clientsClaim`을 쓰고 `/api/auth/`는 런타임 캐시에서 제외(`!/\/api\/auth\//`)한다. `navigateFallback: null`이라 SPA 라우트 폴백이 없다. 메모리(`project-oauth-sw-fix.md`)에 "SW navigate가 OAuth callback을 가로채는 버그"가 배포(472cea0)됐으나 **PC 테스트 미완료**로 기록돼 있어, 회귀 가능성이 검증되지 않은 잠복 영역이다. `cacheId`에 빌드 타임스탬프를 넣어 캐시 버스팅하지만, 구 SW가 클라이언트에 남으면 갱신 지연·stale 자산 로딩이 발생할 수 있다(메모리 `project-js-404.md`의 미해결 404와 연관 가능).

### `daily_change_pct` 등 휴리스틱 의존 표시 (낮음)
대시보드 카드(`backend/routers/stocks.py:234-256`)가 yfinance/Naver 응답에 직접 의존해, 외부 데이터 결손 시 None이 그대로 노출된다.

---

## Low — 기타

### 의존성 버전이 `>=` 하한만 지정 (확정, 재현성)
`backend/requirements.txt`는 전부 `>=` 또는 무버전(`python-dotenv`)이다. yfinance(`>=0.2.40`)처럼 비공식 API 변동이 잦은 라이브러리가 상한 없이 풀려 있어, 재빌드 시점에 따라 동작이 달라질 수 있다. `docker compose build`가 자동 배포 시점에 최신 호환 버전을 끌어와 예기치 못한 회귀를 부를 수 있다.

### TODO/FIXME/HACK 주석은 사실상 없음 (확정)
`grep`상 코드 내 `TODO`/`FIXME`/`HACK`/`XXX`는 발견되지 않았다(주석 한 건만: `frontend/src/components/PermissionManager.jsx:243` "임시 첨부"). 부채가 주석으로 표시되지 않고 코드 구조에 내재돼 있다는 의미로, 위 항목들이 실질 부채 목록이다.

### gitignored 런타임 데이터 (확정, 운영)
`.gitignore`상 `backend/snapshots/`, `backend/reports/`, `backend/data/calendar/`, `backend/data/consensus/`, `backend/data/*.json`이 제외된다. DB(Docker PostgreSQL)가 진실원본이고 이들은 파일 캐시/폴백이지만, `pgdata` 볼륨이나 이 디렉터리가 백업 없이 소실되면 스냅샷·캘린더 캐시가 사라진다. 특히 `backend/snapshots/`는 리포트 생성 결과의 파일 사본이라 DB와 이중 저장(`report_generator.py:166-173`)되지만, 둘 중 하나만 남으면 폴백 경로(`stocks.py:32-44`)에 의존하게 된다.

### `data/` 정적 참조 vs 런타임 혼재 (낮음)
`backend/data/`에 정적 참조(sp500/kospi 티커)와 런타임 캐시(calendar/consensus)가 섞여 있어, 백업·정리 정책 수립이 어렵다.
