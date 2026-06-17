---
last_mapped_commit: 7f3aec7d6aab5b2ed9837f9aada7405f9505ae6b
mapped: 2026-06-17
---

# Codebase Concerns

**분석일:** 2026-06-17

> 모든 항목은 실제 코드에서 검증된 구현 사실이다. 용어 정의(도메인 글로서리)는 이 문서에 두지 않는다.

## 운영/배포 취약점 (Fragile Operations)

### 자동배포 폴러가 로컬 tracked 편집을 hard-reset
- 파일: `scripts/auto-deploy-poll.sh` (launchd `com.portfolion.auto-deploy-poll`, 2분 주기)
- 동작: `git fetch origin main` 후 `LOCAL != REMOTE`이면 `git reset --hard origin/main` → `bash deploy.sh` (37행 `git reset --hard origin/main`).
- 위험: 메인 체크아웃에서 **커밋 안 했거나 push 안 해 로컬이 origin보다 뒤처진 tracked 편집은 다음 폴(≤2분)에 소실**된다. lock 파일(`/tmp/portfolion-deploy.lock`)이 있으면 skip하지만 lock이 없는 평시엔 무조건 reset.
- 안전책: 코드 변경은 commit + `git push origin main`을 **한 번에 묶어** 즉시 반영. `.forge/` 등 untracked 파일은 `reset --hard` 대상이 아니라 안전.

### nginx 직접 서빙 vs 폴러 재배포의 라이브 시점 불일치
- 프론트 번들은 nginx가 `./frontend/dist`를 `:ro` 볼륨마운트로 직접 서빙 → 로컬 `npm run build`가 즉시 라이브.
- 그러나 **백엔드 변경은 폴러 재배포(컨테이너 재빌드) 이후에야 라이브**. 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작하는 시간차가 생긴다. (출처: `CLAUDE.md` Deployment 절, 검증 대상은 nginx 볼륨마운트 구성)

## 라우팅/계약 취약점 (Routing & Contract)

### FastAPI 라우트 순서 (enrich/batch가 {ticker}보다 먼저)
- 파일: `backend/routers/stocks.py:190` (`PUT /enrich/batch`) — `backend/routers/stocks.py:205` (`PUT /{ticker}/enrich`)
- `/enrich/batch`가 `/{ticker}/enrich`보다 **먼저** 등록돼 있어야 FastAPI가 `enrich`를 ticker 값으로 라우팅하지 않는다. 순서 역전 시 batch 호출이 깨진다.

### 비-additive 응답 reshape → 프론트 소비처 전수 grep 필요
- 파일: `backend/routers/stocks.py:293` `GET /dashboard` → `{"holdings": [...], "totals": ...}` (298행 빈 케이스 `{"holdings": [], "totals": None}`).
- 위험: 응답을 배열→객체로 바꾸면 훅과 별개로 `/api/stocks/dashboard`를 직접 fetch하는 독립 소비처(예: 상관관계 탭)가 `res.data`를 옛 형태로 취급해 조용히 깨진다. reshape 시 `grep -rn '/api/stocks/dashboard' frontend/src/`로 전수 감사 필요. 가능하면 additive(필드 추가) 선호.

### FastAPI bare list/dict Body 명시 필수
- 파일: `backend/routers/report.py:473` (`entries: list = Body(...)`), `backend/routers/batches.py:64` (`schedule: dict = Body(...)`)
- PUT/POST에서 bare `list`/`dict` 파라미터는 `Body(...)`로 명시해야 한다. 누락 시 FastAPI가 쿼리 파라미터로 해석해 기동/요청 단계에서 실패.

### 배치 id 은퇴 시 전 표면 grep 계약
- 파일: `backend/services/batch_registry.py` (id: `daily_report_kr`/`daily_report_us`/`earnings_kr`/`earnings_us`/`monthly_kr`/`monthly_us` 등), `backend/services/job_runs.py` (`record(id,...)`)
- 위험: `BATCHES`에서 id를 빼면 ① 데이터 read(스케줄 소비처) ② 표시 문자열(`schedule_desc`) ③ `job_runs.record(id, ...)` **모든 lane**(auto/manual/backfill) ④ 그 id를 단언하는 테스트까지 전수 grep해야 한다. 한 곳이라도 옛 id로 남으면 stale read·배치 현황 실행이력 증발 회귀·고아 run 누적. 단 옛 스케줄 행→신규 id 승계 마이그레이션 read는 정당한 잔존.
- 관련: `source`(fetch 출처)와 `usage`(소비 UI)는 반대 방향 필드 — fetch 체인을 바꾸면 `source`도 함께 갱신해야 현황 카드가 stale 출처를 안 보인다.

## 배치/요청경로 안티패턴 (tasks #48/#49/#50)

### 외부 API를 요청·기동 경로에서 라이브 호출 금지
- 파일: `backend/services/kr_sector_service.py:107` `map_holdings_to_sectors` — "저장 인덱스만 읽음 — 요청 경로에서 키움(ka20002) 라이브 호출 없음" 주석으로 명시.
- 원칙: 배치가 사전계산해 `market_cache`/테이블에 저장하고 요청은 저장값만 읽는다. 요청 시 라이브 빌드가 끼면 캐시 만료마다 수초 지연.

### silent-except / all-None 캐시 박제 금지
- 파일: `backend/services/kr_sector_service.py:58` `_fetch_one_sector` — except를 **삼키지 않고 로깅**(`print("[kr_sector] ... fetch failed")`)하고 all-None dict 반환.
- 파일: `backend/services/kr_sector_service.py:70` `refresh` — **all-None 모멘텀이면 save 생략**(76~79행), 직전 양호값 보존. 의심 트리거가 아니라 *실패 클래스(all-None)*를 가드해 근본원인 미상이어도 재발 차단.
- 기동 시 빈 캐시 적재 가드: `backend/scheduler.py:354` `_seed_rankings_if_empty`, `backend/scheduler.py:370` `_seed_kr_sector_if_empty`.
- 주의: `backend/services/investor_service.py:83` `except Exception: pass`는 silent-except 패턴 — 진단 어려움(현재 정상 동작이나 실패 시 무로그).

## 데이터 무결성 위험 (Data Integrity)

### 수주잔고 단위 캡션 파싱 — ×100 대형 오저장 위험 ("wrong < missing")
- 파일: `backend/services/backlog.py:362` `_table_unit`, `backend/services/backlog.py:180` `_EOK_FACTOR`(조원×10000·억원×1·백만원×0.01·천원×1e-5·원×1e-8).
- 가드: 캡션에 KRW 토큰이 없으면(USD천·줄바꿈 분리 등) `_DEFAULT_UNIT`(억원) 폴백이 아니라 **'기타'(비KRW) 반환으로 자동추출 차단**(366~370행). 단위 추출 실패는 안전한 기본값(억원)이 아니라 pending(누락)으로 처리 — 기본값 폴백 시 백만원을 억원으로 오인하면 ×100 오저장.
- 자동추출/pending 분기: `backend/services/backlog.py:374` `_auto_backlog` — 다중엔티티(`_is_multi_entity`) 표가 하나라도 있으면 문서 전체를 pending 처리. 검산 통과만 `source='dart'`(523~524행), 실패는 `_save_pending`(531행, amount=None, 기존 채운 값 보존).
- 운영 주의: 파서 변경은 배포 후 전 종목 재적재 UAT 필수(fixture에 없던 실데이터 케이스 — 외화·단위 캡션 줄바꿈·연결 전 분기 회사컬럼 표).

### 공시 피드 — list.json `pblntf_ty` 미echo
- 파일: `backend/services/disclosures.py` (corp_code별 `list.json` 호출, `stock_disclosures` 테이블 `rcept_no` dedup upsert)
- list.json이 응답에 `pblntf_ty`를 echo하지 않아 "단일 호출 후 응답필드 필터" 불가 → 핵심유형 A·B·C·D를 **각각 개별 호출**(종목당 4콜)해 질의 유형값을 stamp. KR 전용·`DART_API_KEY` 필수. status 013(무데이터)은 graceful 빈 리스트.
- 별도 store 주의: 자동 DART 목록(`stock_disclosures`)은 Cowork 애널리스트 코멘터리(`tickers.recent_disclosures`)를 절대 덮지 않는다.

### 컨센서스/목표가 정본 단일화 (as-of-date)
- 파일: `backend/services/consensus.py:6` — "목표가·의견수 정본 = `daily_consensus_mart`의 base_date<=date 최신행(as-of-date), ADR-0008".
- 파일: `backend/services/consensus_pipeline.py` — opinion 문자열을 5점 표준화 점수(`_SCORE_MAP`)로 변환 후 `consensus_history`에 저장하는 공통 파이프라인. `target_price`는 문자열 파싱(84행 `float(price_str.replace(",", ""))`, 실패 시 None).
- 소비처: `stocks.py`/`watchlist.py`/`portfolio.py`/`report.py`가 `daily_consensus_mart`를 읽음 — 정본을 옮기면 이 소비처들 동기 필요.

### 종목명 dual-source desync
- 파일: `backend/services/storage.py:275` `refresh_snapshot_names`(주석: "종목관리(live tickers.name)와 리서치(snapshot name)가 어긋난다"), `backend/services/storage.py:292` `reconcile_snapshot_names`.
- 위험: `tickers.name`(공유 마스터, 종목관리 목록 live read) vs `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세 read). 이름 변경 시 **둘 다** 갱신해야 목록↔상세 일치. DB만 바꾸면 `cache.get_list`·스냅샷 LRU 탓에 미반영 → `cache.invalidate(ticker)`+`invalidate_list()` 필수. 실명 채움: `backend/services/market.py:484` `resolve_name`.

### 배당 dual-source (US yfinance / KR DART)
- 파일: `backend/services/dividends.py:43` (US: yfinance `t.info` dividendRate/dividendYield), KR: DART `alotMatter.json`(reprt_code=11011 사업보고서, `DART_API_KEY` 필요).
- 무배당/결측은 None graceful(저장 안 함, 빈 박제 방지 — 46행). `GET /api/stocks/dashboard`가 저장값만 읽어(라이브 0) yield_on_cost·expected_annual_income·KRW 환산 totals(저장 FX `usdkrw`만 사용) 계산. yfinance dividendYield 스케일(현재 퍼센트)이 라이브러리 버전에 따라 변할 수 있는 외부 의존.

### krFmt 억원 단위 가정
- 파일: `frontend/src/components/market/marketUtils.jsx:1` `krFmt` (임계값 10000억=1조, 그 이하 `억`).
- 위험: **입력은 '억원' 단위 가정** — 원은 `/1e8` 변환 후 넘기고, 주(count) 등 다른 단위엔 부적합. raw 원/주를 그대로 넘기면 1e8배 오표기(공매도 "35조경원" 사례). 수익/수출 차트는 dual Y-axis 구조(`M7EarningsSection`/`KrTop2Section`/`KrExportsSection`).

## 외부 의존성 취약점 (External Dependencies)

### yfinance — 비공식 API
- 파일: `backend/services/market.py`(US 1차 시세), `backend/services/dividends.py`, `backend/services/analysis_service.py`, `backend/services/consensus_pipeline.py`(upgrades_downgrades), `market_indicators/*`.
- Yahoo 비공식 엔드포인트라 응답 스키마·레이트리밋·필드 스케일 변경 위험. US는 yfinance 1차, KIS 백업(이중화).

### Naver 스크래핑 — 비공식 모바일 API
- 파일: `backend/services/market.py:8`(`Referer: m.stock.naver.com`), `:25` `_naver_get`, `:111` `_kr_basic_naver`.
- KR 시세 최종 폴백(키움→KIS→Naver, `market.py:165`). 상폐 종목은 Naver 409로 검출(예외 전파). 모바일 API라 차단/스키마 변경 위험.

### 키움 토큰/throttle
- 파일: `backend/services/kiwoom/client.py:14`(`_MIN_INTERVAL=0.25s` 직렬 throttle), `:15`(`_TOKEN_CACHE_SEC=12h`), `:75` `_get_token`(인프로세스 싱글톤, lock), `:143`(401/403 시 1회 force 재발급 재시도). `return_code≠0` → `KiwoomError`(150행).
- KR 읽기전용 시세 1차. 직렬 throttle이라 배치 동시성은 무의미(`max_workers=4`).

### KIS 토큰/throttle — EGW00133 방어
- 파일: `backend/services/kis/client.py:17`(`_REISSUE_MIN_INTERVAL=60s` — 발급 1분당 1회 EGW00133 방어), `:15`(`_MIN_INTERVAL=0.05s`), `:16`(`_TOKEN_CACHE_SEC=23h`). `rt_cd≠"0"` → 예외.
- KR+US 읽기전용 **백업**(KR=키움→KIS→Naver, US=yfinance→KIS). `configured()` False면 휴면(키 미설정이 안전 기본값, 기존 동작 무변화).

### FRED/KOFIA/DART/KITA — 키 게이팅 + graceful degradation
- `FRED_API_KEY`: `backend/services/market_indicators/macro.py`·`econ.py` — 미설정 시 수집 실패(저장값 무변경).
- `KOFIA_API_KEY`: `backend/services/leverage_service.py`(신용잔고·반대매매), `backend/services/lending_service.py`(대차잔고, 동일 키) — 미설정 시 요청 실패.
- `DART_API_KEY`: `backlog.py`·`disclosures.py`·`dividends.py`(KR) — 필수.
- `KITA_API_KEY`: 실제로는 **관세청(Korea Customs Service)** 키(`apis.data.go.kr/1220000/Itemtrade`) — 미설정 시 UN Comtrade 공개 API 자동 폴백(`market_indicators/exports.py`).

## 보안 (Security)

### JWT HS256 + refresh token
- 파일: `backend/services/auth_service.py:19`(`os.environ["JWT_SECRET"]` — 미설정 시 KeyError), `:96` access encode(HS256), `:14` `_ACCESS_EXPIRE=1h`, `:15` `_REFRESH_EXPIRE=30d`. refresh는 `refresh_tokens` 테이블 DB 저장, `consume_refresh_token`(115행)이 만료(126행) 검증, `revoke_refresh_token`(131행) DELETE.
- HS256 대칭키 — 비밀 유출 시 위조 가능. refresh token이 DB에 평문 저장(컬럼 `token`).

### OAuth — at_hash 우회 디코딩 + SW navigate 차단
- 파일: `backend/routers/auth.py:170~172` — id_token payload를 `base64.urlsafe_b64decode`로 **직접 디코딩**(jose의 at_hash 검증 우회, 과거 at_hash 오류 회피). id_token 서명 자체는 검증하지 않고 Google 토큰 엔드포인트 응답을 신뢰하는 구조.
- OAuth code는 인메모리 dict `_oauth_codes`(`auth.py:24`, 120s TTL) — 다중 워커/재시작 시 휘발.
- 프론트 SW: `frontend/vite.config.js:24` `navigateFallback: null` — SW가 OAuth callback navigate를 가로채지 않도록(과거 SW가 callback을 인터셉트하던 버그 방어). `registerType: 'autoUpdate'`(11행).
- OAuth 환경변수(`GOOGLE_CLIENT_ID`/`SECRET`, `GITHUB_CLIENT_ID`/`SECRET`, `FRONTEND_URL`)는 `os.environ[...]`로 직접 접근(`auth.py:137`,`186` 등) — 미설정 시 KeyError로 OAuth 경로 500.

### admin role 게이팅
- admin만 리포트 생성·Guru 크롤·각종 refresh/backfill·`GET /api/admin/analytics` 가능. `user_menu_permissions`(프론트 `AuthContext`가 nav 필터)는 표시 제어이지 서버 인가가 아님 — 실제 인가는 라우터 의존성(`get_current_user`/admin 체크).

### CORS — env 기반 origin 허용
- 파일: `backend/main.py:124~127` — `allow_origins=["http://localhost:3000", "http://localhost:5173", FRONTEND_URL]`(빈 값 필터). `FRONTEND_URL` 미설정 시 localhost만 허용 → 배포 환경에서 누락하면 프론트 차단.

### secrets 위치 (키 NAME만)
- 파일: `backend/.env.docker`(gitignore), 루트 `.env`(docker-compose 보간용).
- 키 NAME: `POSTGRES_PASSWORD`, `JWT_SECRET`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, `FRED_API_KEY`, `KOFIA_API_KEY`, `DART_API_KEY`, `KITA_API_KEY`, `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`, `KIS_APP_KEY`/`KIS_APP_SECRET`/`KIS_BASE_URL`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, `FRONTEND_URL`, `ANTHROPIC_API_KEY`(미사용).

## 성능 (Performance)

### 캐시 TTL
- 파일: `backend/services/cache.py` — snapshot LRU(maxsize 200), `_list_cache`(TTL 60s, 33행), `_dashboard_cache`(300s), `_correlation_cache`(300s), `_sector_cache`(300s), `_macro_cache`(300s). 종목 추가/수정/삭제 시 `invalidate`(52행)가 dashboard·correlation·sector·macro·live_prices·list 전부 무효화.
- 주의: TTLCache는 maxsize 초과 시에만 만료 항목 정리(19~20행) — 항목 수가 적으면 만료된 키가 다음 get까지 메모리 잔존.
- storage→cache 호출은 함수 내 지연 import로 순환참조 회피(`CLAUDE.md` gotcha).

### ThreadPoolExecutor 병렬성 vs DB 풀
- 파일: `backend/routers/calendar.py:70`(max_workers ≤15), `backend/services/analysis_service.py:52`(섹터 11)·`:74`(보유 10), `backend/services/digest_service.py:48`(10), `backend/services/report_generator.py:73`(8), `backend/services/ranking_service.py:110`(12), `backend/services/consensus_pipeline.py:101`(5), `backend/services/market_indicators/earnings.py:136,158`(20), `backend/services/kr_sector_service.py:67`(4 — 키움 직렬 throttle 탓 보수적), `backend/services/parallel.py:5` `parallel_map`(기본 10).
- DB 풀: `backend/services/db.py:23` — 최대 ThreadPool 동시성(calendar 15·analysis 11)보다 크게 잡아 풀 고갈 회피. 신규 배치가 max_workers를 키우면 DB 풀 압박 재검토 필요.

### 요청경로 직렬 외부 호출 지연
- 키움/KIS는 직렬 throttle이라 요청당 N콜이면 수초 지연 누적. 배치 사전계산 + 저장값 read 원칙으로 회피(위 안티패턴 절). calendar yfinance는 ThreadPool 병렬화(15)로 완화.

## 죽은 코드 / 레거시 (Dead/Legacy)

### `backend/reports/` — 레거시 리포트 디렉터리
- 종목별 디렉터리(`000720`/`005930`/`207940` 등) 존재. read-only JSON fallback(구 스냅샷용). 런타임 데이터는 Docker PostgreSQL — 이 디렉터리는 신규 쓰기 경로 없음.

### `ANTHROPIC_API_KEY` — 미사용
- `backend/.env.docker`(10행, 빈 값)·`.env.docker.example`에만 존재. 백엔드 코드에 anthropic import/호출 없음(`requirements.txt`에 anthropic 패키지 없음). AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성. (`snapshots/MSFT/*.json`·`data/stocks.json`의 "ANTHROPIC"은 종목 데이터이지 키 사용 아님.)

### `SUPABASE_JWT_SECRET` — stale 테스트 참조
- 파일: `backend/tests/test_auth.py:22` — `monkeypatch.setenv("SUPABASE_JWT_SECRET", secret)`로 설정하나, 실제 코드 `backend/services/auth_service.py:19`는 `JWT_SECRET`을 읽는다. Supabase 마이그레이션 잔재 — 테스트가 잘못된 키 이름을 set해 실제 검증과 불일치(테스트가 깨진 전제를 고정할 수 있음). 운영 코드엔 `SUPABASE_JWT_SECRET` 사용 없음.

## 코드 마커 (TODO/FIXME)

- `grep -rni 'TODO|FIXME|HACK|XXX'`(backend/frontend src, `__pycache__`/`node_modules` 제외) 결과 **명시적 마커 0건**. 미완 지점은 마커 대신 docstring 주석(예: `kr_sector_service.py`의 graceful 빈 매핑, `backlog.py`의 pending 처리)으로 표기돼 있다.

---

*Concerns 감사: 2026-06-17*
