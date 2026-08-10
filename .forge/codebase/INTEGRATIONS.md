---
last_mapped_commit: 20dd46eb829b05025af793b010dfe4efe2925a7d
mapped: 2026-08-10
---

# INTEGRATIONS — 외부 API·데이터베이스·인증 제공자·웹훅

**구현 사실만** 담는다(도메인 용어 정의는 `.forge/CONTEXT.md`). 런타임·의존성·설정 파일은 자매 문서 `.forge/codebase/STACK.md`.
시크릿 값은 어디에도 적지 않는다 — **키 이름만** 쓴다.

---

## 0. 인벤토리

### 0.1 아웃바운드 (백엔드 → 외부)

| # | 제공자 | 호스트 | 인증 | env 키 | 주 구현 |
|---|---|---|---|---|---|
| 1 | PostgreSQL 16 | `postgres`(compose 내부) / `localhost:5432` | DSN | `DATABASE_URL` | `backend/services/db.py` |
| 2 | Google OAuth 2.0 | `accounts.google.com`, `oauth2.googleapis.com` | client id/secret | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `backend/routers/auth.py` |
| 3 | GitHub OAuth | `github.com`, `api.github.com` | client id/secret | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `backend/routers/auth.py` |
| 4 | 키움증권 REST | `api.kiwoom.com` | OAuth2 client_credentials | `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIWOOM_BASE_URL` | `backend/services/kiwoom/` |
| 5 | 한국투자증권(KIS) REST | `openapi.koreainvestment.com:9443` | OAuth2 client_credentials | `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_BASE_URL` | `backend/services/kis/` |
| 6 | yfinance (Yahoo Finance) | 라이브러리 내부 | 없음 | — | 19개 모듈(§4) |
| 7 | Naver 금융 (모바일 API 4계열) | `m.stock.naver.com`, `api.stock.naver.com`, `ac.stock.naver.com`, `finance.naver.com` | 없음(UA/Referer 헤더 필요) | — | §5 |
| 8 | FnGuide | `comp.fnguide.com` | 없음(Referer 필요) | — | §6 |
| 9 | Finviz | `finviz.com` | 없음 | — | `backend/services/scraper.py` |
| 10 | DART(전자공시) | `opendart.fss.or.kr/api`, `dart.fss.or.kr` | API 키(query `crtfc_key`) | `DART_API_KEY` | §7 |
| 11 | FRED (St. Louis Fed) | `api.stlouisfed.org` | API 키(query `api_key`) | `FRED_API_KEY` | §8.1 |
| 12 | 공공데이터포털 — KOFIA 통계 / 시장지수 | `apis.data.go.kr/1160100/service/...` | serviceKey | `KOFIA_API_KEY` | `backend/services/leverage_service.py` |
| 13 | 공공데이터포털 — 금융위 대차잔고 | `apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2` | serviceKey | `KOFIA_API_KEY`(동일 키 재사용) | `backend/services/lending_service.py` |
| 14 | 공공데이터포털 — 관세청 품목별 수출입 | `apis.data.go.kr/1220000/Itemtrade` | serviceKey | `KITA_API_KEY`(**실제로는 관세청 키**) | `backend/services/market_indicators/exports.py` |
| 15 | UN Comtrade | `comtradeapi.un.org` | 없음(preview) | — | 위와 동일(폴백) |
| 16 | ExchangeRate-API | `open.er-api.com/v6/latest/USD` | 없음 | — | `backend/services/market_indicators/fx.py` |
| 17 | multpl.com | `www.multpl.com/shiller-pe` | 없음(HTML 크롤) | — | `backend/services/market_indicators/indices.py` |
| 18 | CNN Fear & Greed | `production.dataviz.cnn.io` | 없음(브라우저 유사 헤더 필수) | — | `backend/services/market_indicators/sentiment.py` |
| 19 | Wikipedia | `en.wikipedia.org` | 없음 | — | `backend/services/market_indicators/earnings.py`의 `_scrape_sp500` |
| 20 | dataroma | `www.dataroma.com/m` | 없음 | — | `backend/services/guru_scraper.py` |
| 21 | Telegram Bot API | `api.telegram.org` | 봇 토큰 | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | `backend/services/digest_service.py`의 `send_telegram` |
| 22 | Cowork 루틴 fire(로컬 리스너) | `COWORK_ROUTINE_FIRE_URL`(기본 `host.docker.internal:8787`) | Bearer | `COWORK_ROUTINE_FIRE_URL`, `COWORK_ROUTINE_FIRE_TOKEN` | `backend/services/cowork_trigger.py` |

### 0.2 아웃바운드 (프론트 → 외부)

| 제공자 | 무엇 | 위치 |
|---|---|---|
| Google Fonts | `Inter` 400/500/600/700 + `Noto Serif KR` 600/700 (`display=swap`) + preconnect 2건 | `frontend/index.html` `<head>` |
| jsDelivr | Pretendard `v1.3.9` static CSS + preconnect | `frontend/index.html` `<head>` |

둘 다 `frontend/vite.config.js`의 `VitePWA.workbox.runtimeCaching`에서 **CacheFirst / 1년 만료 / maxEntries 10**으로 캐시된다. 이 외의 외부 호출은 프론트에 없다(모든 데이터는 동일 오리진 `/api/*`).

### 0.3 인바운드 (외부 → 백엔드)

| 소비자 | 자격 | 진입점 |
|---|---|---|
| 브라우저 SPA | JWT Bearer(`Authorization`) | 전 라우터 |
| 외부 Cowork 클라이언트 | `X-API-Key: <COWORK_API_KEY>` | `get_current_user_or_api_key` / `require_admin_or_api_key`가 걸린 엔드포인트 |
| OAuth 제공자 리다이렉트 | HMAC `state` 검증 | `GET /api/auth/oauth/{google,github}/callback` |
| 헬스체크(nginx·deploy.sh) | 없음 | `GET|HEAD /health` |

### 0.4 인프라 경유

- **Cloudflare Tunnel** — `portfolion.taebro.com` → `localhost:80`. compose 서비스가 아니라 **launchd로 실행되는 `cloudflared`**.
- **nginx** — `/api/`와 `/health`만 `backend:8000`으로 프록시, 나머지는 `frontend/dist` 정적 서빙(SPA 폴백).
- **certbot** — compose 4번째 컨테이너, 12시간 루프로 `certbot renew`. nginx의 443 블록은 현재 **주석 처리** 상태이고 TLS 종단은 Cloudflare Tunnel이 맡는다.

---

## 1. PostgreSQL

### 1.1 접속

`backend/services/db.py` — `psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=20, dsn=os.environ["DATABASE_URL"])`를 전역 싱글톤으로 지연 생성(이중검사 + `threading.Lock`).

- `get_connection()` 컨텍스트매니저 — 성공 시 `commit`, 예외 시 `rollback` 후 re-raise, `finally`에서 항상 `putconn`.
- `query(sql, params)` → `RealDictCursor`로 `list[dict]`.
- `execute(sql, params)` → `cur.rowcount`.
- `execute_many(sql, params_list)` → 단일 커넥션에서 `psycopg2.extras.execute_batch`. **빈 리스트는 커넥션조차 잡지 않는다.**

`maxconn=20`은 최대 ThreadPool 동시성(calendar 15 · analysis 11)보다 크게 잡은 값이다 — psycopg2 풀은 소진 시 대기하지 않고 **`PoolError`를 던지므로** 워커 수보다 커야 한다.

⚠️ 로컬 `DATABASE_URL`은 호스트에 노출된 Docker postgres(`5432:5432`)를 가리킨다 = **로컬 pytest에서 실 DB가 사거리 안**. `backend/tests/conftest.py`의 autouse `_block_real_db`가 `services.db._get_pool`을 raise로 대체해 이를 차단한다.

### 1.2 스키마 정본과 마이그레이션

세 층이 있고 **역할이 다르다**:

1. `backend/auth_schema.sql` → `backend/app_schema.sql` — compose가 `/docker-entrypoint-initdb.d/01-auth.sql`·`02-app.sql`로 마운트. **신규 설치 전용**(빈 볼륨에서만 실행).
2. `backend/main.py`의 `_migrate()` — 기동 시 idempotent DDL(ADR-0006). **라이브 DB가 실제로 타는 유일한 경로.**
3. `backend/migrations/001_user_events.sql`·`002_backlog_history.sql` — 수기 참조용 잔재.

→ **신규 컬럼은 `app_schema.sql`만 고치면 배포에 반영되지 않는다.** `_migrate()`에 `ADD COLUMN IF NOT EXISTS` 쌍이 필수(DoD).

### 1.3 테이블

`app_schema.sql`이 정의: `tickers` · `snapshots` · `user_stocks` · `schedules` · `guru_managers` · `guru_schedules` · `batch_schedules` · `digests` · `consensus_history` · `calendar_cache` · `market_cache` · `user_menu_permissions` · `default_menu_permissions` · `raw_reports` · `daily_consensus_mart` · `user_events` · `market_leverage_indicators` · `market_lending_balance` · `backlog_history` · `market_rankings` · `market_investor_trend` · `market_short_sell` · `stock_disclosures`.

`auth_schema.sql`이 정의: `users`(role `user|admin`) · `refresh_tokens`. `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`가 선행한다.

`main._migrate()`가 추가로 생성/변경(라이브 반영 경로): `backlog_history.segments`(JSONB) · `batch_schedules` · `market_short_sell`(+idx) · `stock_disclosures`(+idx, +`meeting_date`) · `stock_dividends` · `stock_dividend_schedule`(+idx) · `stock_beta` · `stock_supply_score` · `stock_insider_trades`(+idx) · `stock_recommendations`(+`low_liquidity`/`exchange`/`name`, +idx) · `us_supply_snapshot`(+`insider_transactions`/`insider_net`) · `user_stocks.{target_price,stop_price,target_weight,pinned}` · `tickers.{key_resource,competitor_edge,market_outlook,analyst_target}` · `analyst_reports` · `tech_reports`(+`key_points`/`milestones`).

### 1.4 `market_cache` — 외부 지표의 영구 캐시

`key TEXT PK, data JSONB, fetched_at TIMESTAMPTZ`. 접근 헬퍼는 `backend/services/market_indicators/cache.py`의 `_mc_load`/`_mc_save`(UPSERT `ON CONFLICT (key) DO UPDATE`)/`_mc_delete`/`clear_cache`.

현재 사용 중인 키 **15종**: `fx` · `vix` · `commodities` · `treasury` · `econ_indicators` · `kr_exports` · `m7_earnings` · `kr_top2_earnings` · `macro_signals` · `kospi_signal` · `kospi_futures` · `indices` · `fear_greed` · `sp500_tickers` · `kospi_tickers`, 그리고 서비스 상수로 잡힌 `kr_sector_momentum`(`services/kr_sector_service.CACHE_KEY`) · `us_sector_momentum`(`services/us_sector_service.CACHE_KEY`).

**`get_or_refresh(key, fetch_fn, ttl, force=False)`의 실제 의미**(이름과 어긋난다):
- `force=False`면 ① 인메모리 `_get_cache(key)` → ② `_mc_load(key)`가 행을 주면 **나이 불문 그대로 반환**하고 인메모리에 `ttl`로 얹는다 → ③ 둘 다 없을 때만 `fetch_fn()`.
- 즉 **`ttl`은 인메모리 수명만 지배하고 저장값에는 걸리지 않는다.** 한 번 `market_cache`에 들어가면 `force=True`가 오기 전까지 영구 서빙이다. 실제 재조회자는 `force=True`를 주는 배치뿐.
- **fetch 실패 시 직전 저장값으로 폴백하지 않는다**(실패를 전파). 취약한 소스는 수동 폴백 패턴(§10.2)을 쓴다.

`_yf_close_history(sym, stored, precision)`가 증분 fetch의 공통 구현이다 — 저장된 마지막 날짜+1일부터만 조회, 미래면 즉시 반환, 366일 컷오프로 트림, `_filter_outliers`(중앙값 대비 5배 밖 제거, 표본 5개 미만이면 무동작), `_merge_history`(날짜 키 dict 병합 — **새 값이 빈 리스트면 stored를 그대로 반환**).

### 1.5 인메모리 캐시 (DB 아님)

`backend/services/cache.py` — `TTLCache(ttl, maxsize=200)` 인스턴스와 스냅샷 LRU(`OrderedDict`, `_MAX=50`).

list 60s · dashboard 300s · correlation 300s · sector 300s · macro 300s · quote 60s · live_prices 15s · rebalance 300s · exposure 300s. `invalidate_portfolio_caches(user_id)`가 종목 변경 시 묶음 무효화하고, 캘린더는 `calendar.clear_cache(user_id)`로 **DB `calendar_cache` 행까지** 지운다.

`services/storage`→`services/cache` 호출은 **함수 내 지연 import**로 순환참조를 피한다.

---

## 2. 인증 제공자

### 2.1 로컬 이메일/비밀번호

`backend/routers/auth.py` + `backend/services/auth_service.py`.

- `POST /api/auth/register` → 중복 이메일이면 400, `create_user`(bcrypt `hashpw`/`gensalt`) + `apply_default_permissions`.
- `POST /api/auth/login` → `verify_password` 후 `issue_tokens`.
- `POST /api/auth/refresh` → `consume_refresh_token`(1회용) → 재발급.
- `POST /api/auth/logout` → `revoke_refresh_token`.
- `GET /api/auth/me` → `{user_id, email, role, menu_permissions}`. **admin이면 `ALL_MENUS`를 통째로** 반환하고, 일반 사용자는 `user_menu_permissions`에서 `enabled = true`인 행만.
  `ALL_MENUS = ["portfolio", "research", "market", "analysis", "guru", "settings"]` (`routers/auth.py` 모듈 상수).

토큰: HS256 / `JWT_SECRET` / access `1시간` · refresh `30일`(`services/auth_service.py`의 `_ACCESS_EXPIRE`·`_REFRESH_EXPIRE`).

### 2.2 Google OAuth 2.0

`GET /api/auth/oauth/google` → `_no_cache_redirect`로 `https://accounts.google.com/o/oauth2/v2/auth?...`

- 파라미터: `response_type=code`, `client_id`, `redirect_uri = FRONTEND_URL + "/api/auth/oauth/google/callback"`, `scope="openid email profile"`, `state`.
- **`state`는 세션이 아니라 HMAC 서명 nonce** — `_make_state()`가 `secrets.token_urlsafe(16) + "." + HMAC-SHA256(SESSION_SECRET, nonce)[:20]`, `_verify_state()`가 `hmac.compare_digest`로 검증(무상태라 다중 프로세스에 안전).

`GET /api/auth/oauth/google/callback` (`oauth_google_callback`):
1. `error` 쿼리가 있으면 `{FRONTEND_URL}/?error=oauth_denied`로 리다이렉트.
2. `_verify_state` 실패 → 400 `Invalid state`.
3. `httpx.AsyncClient`로 `POST https://oauth2.googleapis.com/token`(`grant_type=authorization_code`).
4. **`id_token` 페이로드를 서명 검증 없이 base64url 디코드**해서 `email`/`sub`를 꺼낸다(`_b64.urlsafe_b64decode(payload + "==")`). `id_token`이 없거나 점이 2개 미만이면 `?error=oauth_failed`. — 과거 `jose`의 `at_hash` 검증 오류를 우회하려 도입된 경로.
5. `upsert_oauth_user(email, "google", sub)` → `apply_default_permissions` → `issue_tokens`.
6. 토큰을 **직접 URL에 싣지 않는다** — `_store_oauth_tokens(tokens)`가 `secrets.token_urlsafe(24)` 코드를 만들어 프로세스 내 dict `_oauth_codes`에 `(tokens, now+120초)`로 담고, `{FRONTEND_URL}/?oauth={code}`로 리다이렉트.

`GET /api/auth/oauth/token?code=...` (`oauth_token_exchange`) → `_pop_oauth_tokens`가 pop+만료검사(1회용). 실패 시 400.

⚠️ `_oauth_codes`는 **인프로세스 dict**다 — 워커가 여러 개면 코드 교환이 다른 프로세스로 가서 깨진다(현재 uvicorn 단일 프로세스 전제). 삽입마다 O(n) 만료 sweep을 돈다.
⚠️ 세 리다이렉트 모두 `_no_cache_redirect`(`Cache-Control: no-store, no-cache, must-revalidate` + `Pragma: no-cache`) — 뒤로가기/bfcache가 콜백 문서를 재사용하지 못하게 한다.

### 2.3 GitHub OAuth

`GET /api/auth/oauth/github` → `https://github.com/login/oauth/authorize?...`, `scope="user:email"`, 동일한 HMAC state.

콜백(`oauth_github_callback`)은 **`httpx.AsyncClient` 하나로 3콜**:
1. `POST https://github.com/login/oauth/access_token` (`Accept: application/json`)
2. `GET https://api.github.com/user` (`Authorization: token <access_token>`)
3. `GET https://api.github.com/user/emails`

이메일은 `primary && verified`인 것을 우선하고 없으면 `profile.email`로 폴백. 이후 흐름은 Google과 동일(`upsert_oauth_user(..., "github", str(profile["id"]))` → 코드 발급 → `/?oauth={code}`).

⚠️ Google 콜백과 달리 **`error` 쿼리 분기가 없다** — GitHub에서 거부하면 state 검증 단계에서 400이 난다.

### 2.4 프론트 쪽 세션 처리

- `frontend/src/api.js` — 요청에 `Authorization: Bearer <localStorage.access_token>`, **응답 401이면 두 토큰 제거 + `window.location.replace('/')`**.
- `frontend/src/hooks/useAuthBootstrap.js` — 콜백 착지(`/?oauth=`)에서 코드교환을 수행하고, fetch **전에** 동기적으로 `history.replaceState({}, '', '/')`로 쿼리를 지운다. 부팅 구간 계측(`bootTimings()`)을 진단 로그에 싣는다.
- `frontend/src/hooks/useBfcacheAuthGuard.js` — 뒤로가기 캐시 복원 시 세션을 in-place로 뒤집는다(ADR-0035). 전체 리로드가 아니므로, 리로드가 우연히 세탁하던 초기화 의존이 드러날 수 있다.
- `frontend/src/utils/oauthHistory.js` — OAuth 왕복이 남긴 히스토리 엔트리 되감기.
- `frontend/src/contexts/AuthContext.jsx` — 로그인 시 `menu_permissions`를 로드해 nav를 필터링.

### 2.5 API 키 (Cowork)

`X-API-Key` 헤더 == `COWORK_API_KEY`면 sentinel user `"__api_key__"`로 통과(`backend/auth.py`). 상세는 §9.

---

## 3. 증권사 REST API

### 3.1 키움증권 — KR 읽기전용 1차 소스 (ADR-0009)

**클라이언트** `backend/services/kiwoom/client.py`
- base `KIWOOM_BASE_URL` 기본값 `https://api.kiwoom.com`. `configured()`가 두 키 존재를 확인하고, 미설정이면 호출측이 폴백한다.
- 토큰: `POST /oauth2/token` (`grant_type=client_credentials`, `appkey`/`secretkey` JSON body) → `d["token"]`. 인프로세스 싱글톤 + `threading.Lock`, 캐시 창 `_TOKEN_CACHE_SEC = 12*3600`(수명 ~24h보다 보수적).
- 요청: `POST /api/dostk/{category}`, 헤더 `api-id`·`authorization: Bearer`·`Content-Type: application/json;charset=UTF-8`. `timeout=8`.
- **직렬 throttle** `_MIN_INTERVAL = 0.25초`(전역 락).
- 401/403이면 **강제 재발급 후 1회 재시도**. `return_code`가 0/None이 아니면 `KiwoomError`.
- `request_paged(api_id, body, category, list_key, max_items=1000)` — 응답 헤더 `cont-yn`/`next-key`로 연속조회.
- **`integrated_code(stk_cd, regular=False)`가 시세 기준의 단일 분기점**: 기본은 `{code}_AL`(SOR 통합코드 — NXT 확장시간 08:00~20:00 가격 포착, NXT 미거래 종목은 통합이 KRX로 자동 폴백), `regular=True`면 평문 KRX 코드(정규장 종가). 이미 `_`가 있으면 그대로.

**사용 TR 9종**

| TR | 카테고리 | list_key | 용도 | 구현 |
|---|---|---|---|---|
| `ka10001` | `stkinfo` | — | 주식기본정보(현재가·기준가·시총·종목명) | `kiwoom/quote.py` |
| `ka10081`/`ka10082`/`ka10083` | `chart` | `stk_dt_pole_chart_qry` / `stk_stk_pole_chart_qry` / `stk_mth_pole_chart_qry` | 일/주/월봉 OHLC (`upd_stkpc_tp: "1"`) | `kiwoom/chart.py` |
| `ka10059` | `stkinfo` | `stk_invsr_orgn` | 투자자별 순매수(`amt_qty_tp:"2"`, `unit_tp:"1"` → **주식 수량(주)**) | `kiwoom/investor.py` |
| `ka10008` | `frgnistt` | `stk_frgnr` | 외국인 보유율(`wght`, %) | `kiwoom/investor.py` |
| `ka10014` | `shsa` | `shrts_trnsn` | 공매도 추이(`strt_dt`/`end_dt`) | `kiwoom/shortsell.py` |
| `ka20006` | `chart` | `inds_dt_pole_qry` | 업종 일봉 종가 series(한 페이지 600개 → 1콜) | `kiwoom/sector.py` |
| `ka20002` | `sect` | `inds_stkpc` | 업종별 종목 매핑(`mrkt_tp:"0"`, `stex_tp:"1"`) | `kiwoom/sector.py` |

**정규화 주의**: `ka10001` 값은 **부호 포함 문자열**이고 시총은 **억원 단위** → `cur_prc` 절대값·`mac × 1e8`. 업종 종가도 부호 절대값(`normalize_closes`).

**tz**: 키움 `daily_df` 인덱스는 **tz-naive**, yfinance(`^KS11` 등)는 **tz-aware(Asia/Seoul)** → `pd.concat(axis=1)`이 `TypeError`. KR series를 yfinance 지수와 정렬하는 계산(베타·상관·상대강도)은 한쪽을 `tz_localize(None)`해야 한다.

**경계**: 조회 TR만. 계좌·주문 미연동, 실시간 WebSocket(0B/0D) 미착수. 카탈로그는 루트 `KIWOOM_API.md`.

### 3.2 한국투자증권(KIS) — KR/US 읽기전용 **백업** (ADR-0011)

**클라이언트** `backend/services/kis/client.py`
- base `KIS_BASE_URL` 기본값 `https://openapi.koreainvestment.com:9443`(실전 — 시세는 계좌 불요).
- 토큰: `POST /oauth2/tokenP` → `access_token`. 캐시 창 `23*3600`.
- **발급 1분당 1회 제한(EGW00133) 방어**: `_REISSUE_MIN_INTERVAL = 60` — 강제 재발급 요청이 와도 최근 60초 내 발급분이 있으면 기존 토큰을 그대로 반환한다(토큰 수명 24h라 안전 + 401 폭주와 발급제한을 동시 방어).
- 요청: `GET {path}`(전체 `/uapi/...`), 헤더 `tr_id`·`appkey`·`appsecret`·`custtype: "P"`·`authorization`. throttle `_MIN_INTERVAL = 0.05`(실전 20req/s). `rt_cd`가 `"0"`/0/None이 아니면 `KisError`.

**사용 TR 5종**

| TR | path | 용도 |
|---|---|---|
| `FHKST01010100` | `/uapi/domestic-stock/v1/quotations/inquire-price` | 국내 현재가 — `stck_prpr`·`stck_sdpr`·`prdy_ctrt`·`hts_avls`(억원→원 정규화). **종목명 없음 → None** |
| `HHDFS00000300` | `/uapi/overseas-price/v1/quotations/price` | 해외 현재가 |
| `HHDFS76240000` | `/uapi/overseas-price/v1/quotations/dailyprice` | 해외 일별 시세 |
| `FHMIF10000000` | `/uapi/domestic-futureoption/v1/quotations/inquire-price` | 코스피200 선물 현재가 |
| `FHKIF03020100` | `/uapi/domestic-futureoption/v1/quotations/inquire-daily-fuopchartprice` | 선물 일봉 |

**US EXCD probe** (`kis/quote.py`): `_US_EXCD_ORDER = ("NAS","NYS","AMS")`. `_EXCD_MAP`으로 exchange 힌트를 EXCD로 바꿔 그것을 먼저 시도하고 나머지를 순차 probe. price → dailyprice 순.

⚠️ **선물 시세 TR의 응답 봉투는 `output1`/`output2`/`output3` 분할**이다(주식 현재가의 단수 `output`과 다름). `output1`=계약 quote(`futs_prpr`·`futs_prdy_ctrt`·`mrkt_basis`·`futs_last_tr_date`·`hts_kor_isnm`), `output2`=일봉 리스트(최신순), `output3`=기초 KOSPI200 지수. `d.get("output")`만 읽으면 `rt_cd=0`인데도 늘 빈값이라 "코드/파라미터 오류"로 오진하기 쉽다.
표시 **베이시스는 `mrkt_basis`**(선물−현물)이지 이론 `basis`(이론가−현물)가 아니다.
최근월물 코드는 `_code(year, month) = f"A01{year%10}{month:02d}"`(분기월 3/6/9/12) + `futs_last_tr_date`로 롤오버 확정.

**경계**: 읽기전용 시세만(주문·계좌·hashkey 미사용, ADR-0011/0022). 카탈로그는 루트 `KIS_API.md`.

### 3.3 KR 현재가 소스 체인 — 독립 피드 다수결

`backend/services/market/kr.py`의 `get_quote_kr(ticker, exchange="KS", regular=False)`가 오케스트레이션한다.

피드 어댑터 4종: `_kr_basic_kiwoom`(NXT `_AL` / KRX 평문) · `_kr_basic_kis` · `_kr_basic_naver` · 일봉 참조 `_kr_closes_kiwoom`.

- **`regular=False`(라이브 대시보드, NXT 기준)** — `_kr_pick_basic` → `_corroborated_pick`: 어떤 현재가 피드가 **다른 독립 피드 ≥1개와 ±2x(`[0.5, 2.0]`) 이내로 합의(corroborate)**해야 신뢰하고, trusted 중 우선순위 최상위(키움 NXT → KIS → Naver → 키움 KRX)를 반환한다.
  lazy escalation: 평소엔 키움 NXT + 키움 KRX 2콜로 합의(KIS/Naver 미호출) → 불일치할 때만 KIS(설정 시)·Naver를 추가 호출해 최대 4피드 다수결.
  전 피드 합의 불가/단일 피드만 가용이면 **degenerate 경로**(`_kr_pick_degenerate_lazy`) — 우선순위 첫 피드를 자기 `prev_close` ±30%로만 자가검증.
- **`regular=True`(리포트 스냅샷, KRX 정규장 기준, ADR-0020)** — `_kr_pick_regular`: prev ±30% + 일봉 2x 검증.
  `regular` 플래그는 `get_quote` → `get_basic_info`, `get_history_df` → `fetch_bars`로 전파되고 **리포트 writer만 opt-in**한다(`services/report_generator.py`의 당일/백필 daily_df·`get_quote`·경쟁사, `routers/report.py`의 `refresh_analyst`). `get_quote`의 TTL 캐시 키에 `regular`가 포함돼 두 기준이 섞이지 않는다.
- 그래서 같은 종목이 리포트와 대시보드에 ~1% 다른 현재가로 보일 수 있다 — **의도된 기준 차**.
- 대시보드 핫패스(`get_quotes_batch`/`_changes_from_closes`)는 이 가드를 타지 않는다(ephemeral 용인).

**박제-시 독립피드 게이트**(KR 한정, `services/report_generator.py`의 `generate_report`): 스냅샷 저장 직전, KRX와 **독립인** ref 피드로 `price`와 일봉 기준종가를 2x 교차검증한다. ref 피드는 ① Naver retry-once(`_kr_basic_naver`, 첫 예외 시 0.5초 후 재시도) → ② 실패/None이면 KIS 폴백. **ref가 전무하면 박제를 스킵**하고 loud 로그를 남긴다(`wrong < missing`). `backfill_ticker`(과거 날짜)는 현재가 대조가 불가해 미적용.

---

## 4. yfinance (Yahoo Finance)

인증·키 없음. `requirements.txt` `yfinance>=0.2.40`. **19개 모듈**이 임포트한다(§STACK 1.6).

**주요 소비 지점**

| 무엇 | 어디 | API 표면 |
|---|---|---|
| US 현재가·기본정보 | `services/market/__init__.py`의 `_get_quote_uncached` | `yf.Ticker(sym).info`, `.history()` |
| 배치 시세 | `services/market/__init__.py`의 `get_quotes_batch`/`_closes_from_download` | `yf.download`(1콜 다종목) |
| US 연간 재무 | `services/market/us.py`의 `get_annual_financials_us` | `t.get_income_stmt(freq='yearly')`, `t.get_balance_sheet(...)`, **`t.get_cashflow(freq='yearly', as_dict=False)`**, `t.info` |
| 시장지표 시계열 | `services/market_indicators/cache.py`의 `_yf_close_history` | `yf.Ticker(sym).history(start=..., interval="1d")` |
| 지수 | `market_indicators/indices.py` | `^GSPC` `^KS11` `^KQ11` |
| FX | `market_indicators/fx.py` | `USDKRW=X` `USDJPY=X` `EURUSD=X` (+ VIX) |
| 원자재·국채 | `market_indicators/commodities.py` | `GC=F`(USD/oz) `CL=F`(USD/bbl) `HG=F`(USD/lb) / `^IRX` `^FVX` `^TNX` `^TYX` |
| 코스피 방향 신호 | `market_indicators/kospi_signal.py` | `^GSPC` `^IXIC` `USDKRW=X` `^SOX` + `^KS11` |
| 섹터 모멘텀 | `services/analysis_service.py` `SECTOR_ETFS` | XLK XLF XLV XLE XLI XLY XLP XLB XLU XLRE XLC |
| 매크로 상관 | `services/analysis_service.py` `MACRO_TICKERS` | TLT · UUP · USO · `^VIX` |
| US 랭킹 | `services/ranking_service.py` | **`yf.screen("most_actives", count=250)`** |
| US 수급 | `services/us_supply.py` | `t.info`(shortPercentOfFloat·shortRatio·sharesShort), institutional_holders, insider_transactions |
| US 컨센서스 | `services/consensus_pipeline.py`의 `_fetch_us_raw` | `t.upgrades_downgrades`, 없으면 `t.analyst_price_targets` |
| US 배당 | `services/dividends.py`의 `fetch_us_dividend` | `t.info.dividendRate` / `dividendYield` |
| US 베타 | `services/beta.py`의 `fetch_us_beta` | `t.info.beta`, 없으면 `beta3Year`(ETF 대응) |
| EV/EBITDA | `services/report_generator.py` | `t.info.enterpriseToEbitda` |
| 캘린더 실적·배당 | `routers/calendar.py` | `t.calendar["Earnings Date"]`, `t.calendar["Ex-Dividend Date"]` |
| M7 분기 순이익 | `market_indicators/earnings.py` | 분기 손익 |

**심볼 규칙** — `services/market/format.py`의 `_yf_sym(ticker, market, exchange)`: US = bare ticker, **KR = `{ticker}.{exchange or "KS"}`**(KOSPI `.KS` / KOSDAQ `.KQ`). raw ticker로 `yf.Ticker`를 만들면 KR은 0건이 된다.

**라벨 규칙 함정** — `get_income_stmt()`/`get_balance_sheet()`/`get_cashflow()` **메서드**는 무공백 index 라벨(`OperatingCashFlow`·`TotalRevenue`·`CapitalExpenditure`)을, `.income_stmt`/`.cash_flow` **프로퍼티**는 공백 라벨(`Operating Cash Flow`)을 쓴다. `format._yf_val`은 exact 매칭(`key not in src.index`)이라 어긋나면 **예외 없이 조용히 None**을 반환한다 → `market/us.py`는 반드시 메서드 형태를 쓴다.

**퍼센트 스케일** — `info.shortPercentOfFloat`(0.0098 = 0.98%), `institutional_holders.pctHeld`/`pctChange`, `insider_purchases`의 `% Buy/Sell Shares`, `info.dividendYield` 등은 **0~1 소수분수**다. 표시는 `×100`, 문서 예시값·테스트 fixture도 분수 스케일로 적어야 실데이터와 일치한다.

**캘린더 KR 실적일** — `.KS`/`.KQ`의 `t.calendar["Earnings Date"]`가 **유일한 forward 소스**다(Naver는 forward 실적일 미제공, DART도 forward 스케줄 없음). KOSDAQ 커버리지는 patchy(일부 `.KQ`에 404) — best-effort.

**RSI 결측 주의** — RSI(14봉)는 상장 **14거래일 미만** 신규 종목에서 전부 NaN이지만 EMA·52주·HV·매물대는 값이 나온다. "RSI만 빈" 증상을 fetch 실패로 단정하지 말 것(히스토리 행수를 라이브 프로브로 확인).

---

## 5. Naver 금융 (호스트 4계열)

인증 없음. 공통 헤더가 필요하다 — `User-Agent: Mozilla/5.0 ...` + `Referer: https://m.stock.naver.com/` + `Accept: application/json, text/plain, */*`(`_NAVER_HEADERS`, `services/market/kr.py`·`market_indicators/earnings.py`·`ranking_service.py`·`guru_scraper.py`가 각자 정의).

| 호스트 | 경로 | 용도 | 구현 |
|---|---|---|---|
| `m.stock.naver.com` | `/api/stock/{code}/basic` | KR 현재가·기준가·시총(폴백 피드) | `market/kr.py`의 `_naver_get`/`_kr_basic_naver` |
| | `/api/stock/{code}/finance/quarter` | 분기 재무 | `market/kr.py`의 `get_financials_kr`, `report_generator`, `market_indicators/earnings.py`의 `_get_naver_quarterly_net_income` |
| | `/api/stock/{code}/finance/annual` | 연간 재무 | `market/kr.py`의 `get_annual_financials_kr` |
| | `/api/stock/{code}/trend` | 투자자별 수급(키움 폴백) | `services/investor_service.py`의 `_fetch_trend_naver` |
| | `/api/stocks/marketValue` | 시총 랭킹 페이지네이션(`_PAGE_SIZE=100`, `_TOP_N=200`) | `services/ranking_service.py` |
| | `/api/research/stock/{ticker}?pageSize=200`, `/api/research/stock/{ticker}/{rid}` | KR 애널리스트 리포트(FnGuide 폴백) | `services/consensus_pipeline.py`의 `_fetch_kr_raw` |
| | `/api/news/stock/{ticker}` | 종목 뉴스 | `services/scraper.py` |
| `api.stock.naver.com` | `/stock/{ticker}/basic`, `/stock/{ticker}.O/basic` | **US 종목 한글명**(NYSE는 suffix 없이, NASDAQ은 `.O`) | `services/guru_scraper.py`의 `get_name_kr` |
| `ac.stock.naver.com` | `/ac?q=&target=stock` | 한글 종목 검색 자동완성 | `backend/routers/stocks.py` |
| `finance.naver.com` | `/sise/sise_market_sum.naver` | KOSPI 티커 목록 스크레이프 | `market_indicators/earnings.py`의 `_scrape_kospi` |
| `n.news.naver.com` | `/mnews/article/{office_id}/{article_id}` | 뉴스 본문 링크 | `services/scraper.py` |

`ranking_service`의 랭킹 파싱은 `stockEndType`으로 보통주/ETF를 가른다(`_ETF_END_TYPES = {"etf","etn"}`), 숫자는 `_parse_int`/`_parse_float`가 콤마·`-`·`N/A`를 방어한다.

**Naver가 주지 않는 것**: forward 실적일(`irScheduleInfo` = null), `/finance`·`/consensus` 404. 그래서 캘린더 KR 실적은 yfinance 전용이다.

---

## 6. FnGuide

인증 없음. `Referer: https://comp.fnguide.com/` 헤더가 필요하다(`_FNGUIDE_HEADERS`).

| 경로 | 용도 | 구현 |
|---|---|---|
| `/SVO2/asp/SVD_main.asp?gicode=A{ticker}` | 시가총액(보통주, 억원) 정규식 크롤 → `×1e8` | `market/kr.py`의 `_fnguide_market_cap` |
| `/SVO2/json/data/01_06/03_A{ticker}.json` | KR 컨센서스 원천(**1차** — Naver Research보다 우선) | `services/consensus_pipeline.py`의 `_fetch_kr_fnguide` |
| `/SVO2/json/data/01_06/03_{gicode}.json` | 애널리스트 데이터 | `market/kr.py`의 `get_analyst_data_kr` |

---

## 7. DART (전자공시, opendart.fss.or.kr)

인증: query 파라미터 `crtfc_key = DART_API_KEY`. **키 미설정이면 전 기능 휴면**(`_dart_key()`가 `""` 반환 → graceful 빈 결과). KR 전용.
뷰어 링크는 `https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}`.

### 7.1 corp_code 매핑 (공유 캐시)

`backend/services/backlog.py`의 `_get_corp_code_map()` — `GET /api/corpCode.xml`(ZIP)에서 `{stock_code: corp_code}` 매핑을 만들어 **모듈 메모리에 1주일**(`_CORP_CODE_TTL = timedelta(weeks=1)`) 캐시. `disclosures.py`·`dividends.py`·`insider_trades.py`·`agm.py`·`market/kr.py`가 전부 이걸 재사용한다(중복 다운로드 회피).

### 7.2 엔드포인트별 소비처

| 엔드포인트 | 소비처 | 비고 |
|---|---|---|
| `corpCode.xml` | `backlog._get_corp_code_map` | 위 |
| `list.json` | `backlog.py`(보고서 rcept_no) · `disclosures.py` · `agm.py` · `market/kr.py`의 `get_rd_intensity_kr` | §7.3 |
| `document.xml` | `backlog.py`의 `_get_document_text`(ZIP → 전 멤버 디코드·결합) · `agm.py` · `get_rd_intensity_kr` | 원문 텍스트 |
| `fnlttSinglAcnt.json` | `backlog.get_financials` | 주요계정 — **fs_div 없이 호출**하고 응답 행별 `fs_div`로 필터 |
| `fnlttSinglAcntAll.json` | `market/kr.py`의 `get_annual_financials_kr` | 전체 재무제표(현금흐름 포함) — §7.4 |
| `alotMatter.json` | `services/dividends.py` | 배당(`reprt_code=11011` 사업보고서, 보통주 '주당 현금배당금(원)'·'현금배당수익률(%)'의 당기값) |
| `elestock.json` | `services/insider_trades.py` | 임원·주요주주 소유상황 → `report_kind='insider'` |
| `majorstock.json` | `services/insider_trades.py` | 5%룰 대량보유 → `report_kind='major5'` |

### 7.3 `list.json`의 유형(`pblntf_ty`) 함정 — 세 갈래로 다르게 쓴다

- **공시 피드**(`disclosures.py`): 응답이 `pblntf_ty`를 **echo하지 않으므로** "1콜 후 응답 필터"가 불가능하다 → 핵심 유형 `_CORE_TYPES = ("A","B","C","D")`(정기·주요사항·발행·지분)를 **각각 개별 호출**하고 질의값을 항목에 stamp한다(종목당 4콜, 직렬 배치라 감당 가능). 노이즈 E·F·I·J는 제외.
- **주총(AGM)**(`agm.py`): `pblntf_ty`를 지정하면 주총 공시가 **0건**이다 → **유형 미지정(no-type) 호출**로만 발견되고 `report_nm`에 "주주총회" 필터를 건다. 그래서 `disclosures.py`는 주총을 구조적으로 놓치고, `agm_fetch` 배치가 자체 no-type 호출 + `ON CONFLICT(rcept_no)`로 `stock_disclosures` 행을 self-insert한다.
- **R&D 집약도**(`market/kr.py`의 `get_rd_intensity_kr`): `pblntf_ty="A"` + `bgn_de`(730일 전) + `page_count=10`으로 최근 **사업보고서** rcept_no를 찾고, `document.xml` 원문에서 '연구개발비용' 표를 파싱한다. `fnlttSinglAcntAll`에는 R&D 세부 라인이 구조적으로 없다(라이브 확인).

### 7.4 `fnlttSinglAcntAll` 계약

- `fs_div`(CFS/OFS)를 **요청 필수값**으로 받는다 — 누락 시 `status 100 "필수값(fs_div)이 누락되었습니다"`. 연결(CFS) 우선 → 없으면 OFS 폴백.
- **응답을 행별 `fs_div`로 필터하면 안 된다** — fs_div를 요청한 응답은 단일 fs라 행에 그 필드를 echo하지 않아 `row.get("fs_div")`가 None → 전 행 스킵된다.
- 계정 매칭은 회사마다 표기가 바뀌는 `account_nm`(예 "영업활동현금흐름" ↔ "영업활동으로 인한 현금흐름")이 아니라 **`account_id`(XBRL 표준)**로 한다(예 `ifrs-full_CashFlowsFromUsedInOperatingActivities`).
- 한 콜이 `thstrm`/`frmtrm`/`bfefrmtrm`로 3개 연도를 준다(`_dart_extract_3y`).
- 이자보상 분모는 `금융비용`(FinanceCosts — FX손실 포함이라 과대)이 아니라 **`이자의 지급`**(`ifrs-full_InterestPaidClassifiedAsOperatingActivities`).

### 7.5 수주잔고 (`backlog.py` + `backlog_parser.py`)

DART에 수주잔고 전용 구조화 API가 없어 `document.xml` 원문을 파싱한다(ADR-0002/0003/0005).

흐름: corp_code → `list.json`으로 사업/반기/분기보고서 rcept_no → `document.xml`(ZIP, 전 멤버 디코드·결합) → "수주" 포함 표/문단 추출 → 유형 판정.

- **유형1(기납품+수주잔고 컬럼)**: `_expand_grid`(rowspan/colspan 전개)로 헤더 컬럼을 매핑해 금액을 뽑고 `수주총액 − 기납품 ≈ 잔고`(또는 `기초+신규−기납품 ≈ 기말`) **상대 1% 검산**(`_reconcile`)을 통과하면 `source='dart'` + 억원 정규화 금액으로 자동 저장.
- 검산 실패·다중엔티티(`회사` 컬럼/종속회사)·외화(`USD천` 등)·무합계 다중행은 **`source='pending'`, amount=None**으로 두고 외부 Cowork가 `PUT /api/report/{ticker}/backlog`로 채운다.
- **단위 캡션 파싱 실패 시 '안전한 기본값(억원)' 폴백 금지** — ×100 대형 오저장을 만든다. 추출 실패는 기본값이 아니라 누락(`wrong < missing`).
- `segments` JSONB에 부문>법인 누적 구조를 담는다(`_segments_from_susu`/`_auto_backlog_multi`, Σ==합계 검산).

### 7.6 주총 일시 파싱 (`agm.py`)

**회의일은 공시 filing date(`rcept_dt`)가 아니라 문서 본문에 있다.** 표기가 갈려 3전략:
1. `structured_table` — 소집결의 XHTML: `2. 일시 … YYYY-MM-DD`(`STRUCT_TABLE_RE`, DOTALL).
2. `free_text_ilsi` — 소집공고 자유 텍스트: `일    시 : …2026년 3월 25일`(콜론↔날짜 사이 `</SPAN>` 등 **HTML 태그 허용** 필요).
3. `fallback` — '주주총회' 첫 등장 후 600자 내 첫 한국어 날짜.

검증 가드: year 2000–2100 · month 1–12 · day 1–31. 실패는 None(저장 안 함).
**증분 규칙**: 최신 AGM `rcept_no`가 **이미 해결된 경우에만** 비싼 document fetch를 스킵한다 — "티커에 해결된 주총이 하나라도 있으면 스킵"으로 만들면 연례 주총이 다음 시즌에 영영 재fetch되지 않는다.

---

## 8. 공공/거시 데이터

### 8.1 FRED (St. Louis Fed)

키 `FRED_API_KEY`(query `api_key`). 미설정 시 수집 실패(저장값 무변경) — `econ.py`는 `{"error": "FRED_API_KEY 환경변수가 필요합니다."}`를 반환한다.

| 소비처 | 엔드포인트 | 시리즈 |
|---|---|---|
| `market_indicators/econ.py` | `/fred/series/observations` | `CPIAUCSL`(CPI) · `UNRATE`(실업률). 3년 전부터 증분(저장 마지막 날짜부터) |
| `market_indicators/macro.py` | `/fred/series/observations` | `T10Y2Y`(10Y-2Y 금리차) · `BAMLH0A0HYM2`(ICE BofA US HY OAS) · `M2SL` · `DFF`(연방기금 실효금리) |
| `routers/calendar.py` | `/fred/releases/dates` | 큐레이션 4종 릴리스명: Consumer Price Index · Employment Situation · Gross Domestic Product · Producer Price Index |

관측치 파싱은 `"."`/None/`""`을 건너뛴다(FRED의 결측 표기).

`macro.evaluate_signals(data)`는 **순수함수**로 신호 2종을 판정: `inverted`(최신 금리차 < 0) · `credit_stress`(최신 HY ≥ `HY_STRESS_THRESHOLD = 5.0`). 시리즈가 없으면 각각 None. `GET /api/market/macro-signals`는 저장값만 반환(요청경로 라이브 FRED 0콜).

⚠️ **FRED에 S&P CAPE 시리즈는 없다** — FRED의 "Case-Shiller"는 *주택가격* 지수다. CAPE는 §8.5의 multpl 크롤에서 온다.

### 8.2 공공데이터포털 — KOFIA 통계 / 시장지수 (`leverage_service.py`)

- `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService` (신용잔고·예탁금·미수/반대매매)
- `https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService` (시총)
- 인증: URL query `serviceKey = KOFIA_API_KEY`. `resultType=json`, `numOfRows=1000`, `pageNo` 순회. `timeout=30`, `User-Agent: Mozilla/5.0`.
- 응답 필드 상수(라이브 프로브로 확정): `basDt`(날짜) · `crdTrFingScrs`(KOSPI 신용) · `crdTrFingKosdaq` · `invrDpsgAmt`(예탁금) · `brkTrdUcolMny`(미수) · `brkTrdUcolMnyVsOppsTrdAmt`(반대매매) · `ucolMnyVsOppsTrdRlImpt`(반대매매 비율) · `idxNm` · `lstgMrktTotAmt`(시총).
- 저장: `market_leverage_indicators`(base_date 기준 시계열). 배치 `leverage_fetch`(KR, 매일 07:00).

### 8.3 공공데이터포털 — 금융위 대차잔고 (`lending_service.py`)

- `https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2/getNatiAndForeLendAndBorrBalaCo_V2`
- **`KOFIA_API_KEY`를 재사용**한다(별도 키 아님). 페이지네이션(`page_size=1000`, 페이지 간 `time.sleep(0.3)`).
- 저장: `market_lending_balance`. 엔드포인트 `GET /api/market/lending` · `POST /api/market/lending/sync`(admin). 배치 `lending_fetch`(KR, 매월 5일 08:00).

### 8.4 관세청 품목별 수출입 + UN Comtrade (`market_indicators/exports.py`)

- **`KITA_API_KEY`는 이름과 달리 관세청(Korea Customs Service) 키다** — `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`, query `serviceKey`, XML 응답(`xml.etree.ElementTree`로 `.//item` 순회, `expDlr` 합산, `year`가 `"총계"`인 행 제외), HS 코드 `8542`(반도체) 등.
- **키 미설정 시 UN Comtrade 공개 preview로 자동 폴백** — `https://comtradeapi.un.org/public/v1/preview/C/M/HS`.
- 저장 키 `kr_exports`. 배치 `monthly_kr`(매월 1일 02:00).

### 8.5 그 외 무인증 소스

| 소스 | URL | 파싱 | 소비처 |
|---|---|---|---|
| ExchangeRate-API | `https://open.er-api.com/v6/latest/USD` | `rates.KRW` | `fx.py`의 `_fetch_usdkrw_current`(timeout 5) |
| multpl | `https://www.multpl.com/shiller-pe` | `BeautifulSoup(html, "html.parser")` — `#current` div에서 `Ratio:NN.NN` 정규식 + 통계 테이블 | `indices.py`의 `_parse_multpl_cape` → `valuation.sp500_cape` |
| CNN Fear & Greed | `https://production.dataviz.cnn.io/index/fearandgreed/graphdata` | `fear_and_greed.score` + `fear_and_greed_historical.data` 최근 60포인트 | `sentiment.py` |
| Wikipedia | `https://en.wikipedia.org/wiki/List_of_S%26P_500_companies` | S&P500 티커 목록 | `earnings.py`의 `_scrape_sp500` |
| Finviz | `https://finviz.com/quote.ashx?t={ticker}` | `table.snapshot-table2`의 `Recom` 셀 | `scraper.py`의 `scrape_finviz_consensus`(US 전용) |

CNN은 차단이 잦아 **브라우저 유사 헤더 전체 세트**(`sec-ch-ua`·`Origin: https://edition.cnn.com`·`Referer` 포함)를 보낸다.

---

## 9. Cowork (외부 AI 클라이언트) — 양방향

백엔드에 LLM 호출은 없다. AI 분석 텍스트는 외부 Cowork 클라이언트가 써 넣는다.

### 9.1 인바운드 — enrich/발행 API (`X-API-Key`)

- 자격: `X-API-Key: <COWORK_API_KEY>` (`backend/auth.py`의 `get_current_user_or_api_key` / `require_admin_or_api_key`). sentinel user_id `"__api_key__"`.
- ⚠️ **`require_admin`은 API 키를 거부한다**(admin JWT 전용) — Cowork가 호출해야 하는 엔드포인트는 반드시 `require_admin_or_api_key`여야 한다.
- 대표 표면: 종목 enrich(`PUT /api/stocks/{ticker}/enrich`, `PUT /api/stocks/enrich/batch` — **batch를 먼저 등록**해야 `enrich`가 티커로 라우팅되지 않는다), 수주잔고 채움(`PUT /api/report/{ticker}/backlog`), 애널리스트 리포트 발행(`/api/analyst-reports`), 선도기술 리포트 발행(`/api/tech-reports`).
- 계약 정본: `CLAUDE_COWORK_API.md`(Cowork 스코프 전용) + `API_SPEC.md`(전체). Cowork 소비 대상이 아닌 사용자 대면 read 엔드포인트는 `API_SPEC.md`에만 둔다.

**발행물 저장 계층**
- `services/analyst_reports.py`(ADR-0027) — 판단·서사(rating·title·적정주가 밴드·산정방식·points·risks)는 Cowork가 제출하고, **숫자 블록(발행 시점 시세·forward 추정·피어 멀티플·PER 밴드·컨센서스 목표가)은 서버가 최신 스냅샷에서 발췌·계산해 박제**한다. 요청경로 외부 API fetch 0. 같은 (ticker, published_date) 재발행만 upsert, 다른 날은 누적. `RATINGS = ("buy","neutral","sell")`.
- `services/tech_reports.py`(ADR-0033/0034) — 종목이 아니라 기술 단위. `TECH_TOPICS`가 대상 4종의 정본: `reusable-rocket`·`solid-state-battery`·`smr`·`robotics`. (slug, published_date) upsert. `_json_or_null`이 `json.dumps(None)`→문자열 `"null"` 함정을 피한다.

**입력 검증 계약**(Pydantic v2):
- float 필드는 `allow_inf_nan=False`를 **명시**해야 한다 — raw JSON의 `NaN` 토큰은 `json.loads`가 허용하고 기본 Pydantic float이 통과시키며, NaN 비교는 항상 False라 범위 검증도 못 잡는다.
- 선택 필드는 `Optional[X] = Field(None, ...)` — `x: float = Field(None)`이면 **키 생략은 통과하고 명시적 `null`만 422**가 되는 비대칭이 생겨, 중첩 배열 안의 필드 하나가 요청 전체를 막는다.
- 422가 입력 NaN을 echo하면 500이 되므로 `main.py`의 `RequestValidationError` 핸들러가 `sanitize`로 막는다.

### 9.2 아웃바운드 — 루틴 fire 웹훅 (`services/cowork_trigger.py`, ADR-0028)

- `configured()` = `COWORK_ROUTINE_FIRE_URL` **and** `COWORK_ROUTINE_FIRE_TOKEN` 둘 다 존재. 미설정이면 휴면(dormant-safe).
- `fire(text)` → `requests.post(url, headers={"Authorization": f"Bearer {TOKEN}"}, json={"text": text}, timeout=15)`. HTTP ≥300이면 warning 로그 + False. **예외를 전파하지 않는다**(best-effort — 배치 본문을 깨뜨리지 않음).
- 본문 생성기 2종: `daily_text(market)`(일배치 완료) · `manual_text()`(admin 수동). **둘 다 개별 정책·상한값을 열거하지 않는다** — 정책 정본은 루틴 프롬프트이고, 여기에 열거하면 프롬프트와 드리프트해 프롬프트를 이겨버린다.
- 트리거 시점: 일일 리포트 배치 완료 직후 + admin 수동. **백엔드가 하는 LLM 관련 동작은 이 POST 하나뿐**이다.

### 9.3 수신측 — 로컬 fire 리스너 (`scripts/cowork-fire-listener.py`)

- `127.0.0.1:8787` 바인드(백엔드 컨테이너는 `host.docker.internal:8787`로 도달), 표준 라이브러리 `http.server`.
- `POST /fire`, `Authorization: Bearer <COWORK_ROUTINE_FIRE_TOKEN>` 검증(`backend/.env.docker`를 직접 파싱해 값을 읽는다).
- 프롬프트 = `scripts/cowork-routine-prompt.md`의 `{{COWORK_API_KEY}}`를 `.env.docker` 값으로 치환 + 트리거 text → **stdin으로** `claude -p --model opus --allowedTools Bash,WebSearch,WebFetch,Read,Write`에 전달(ps에 키가 노출되지 않게).
- 실행 cwd는 `tempfile.mkdtemp(prefix=ts+"-", dir=~/portfolion-routine-runs)`로 **원자 생성**(레포 컨텍스트·편집 차단 + 같은 초 2회 fire의 `run.log` truncate 방지 — 리스너가 launchd 장수 단일 프로세스라 PID가 늘 같다).
- launchd 서비스 `com.portfolion.cowork-fire-listener` — `claude -p`가 keychain OAuth를 쓰므로 plist `EnvironmentVariables`에 `HOME`/`USER`/`LOGNAME`이 필요하다.

---

## 10. 외부 연동 공통 규약

### 10.1 요청경로 vs 배치경로

**배치-백킹 뷰(랭킹·업종 모멘텀·수급·공매도·배당·베타·공시 등)는 요청·기동 경로에서 외부 API를 라이브 호출하지 않는다.** 배치가 사전계산해 `market_cache`/전용 테이블에 저장하고, 요청은 저장값만 읽는다.

예외(요청경로 증분 fetch, 스케줄 배치 없음 = `batch_registry` 무등록): `fx` · `vix` · `commodities` · `treasury` · `indices` · `kospi_futures` · `fear_greed`. 패턴은 동일하다 — 인메모리 TTL 캐시 → `_mc_load` → 라이브 fetch → `_mc_save` + 폴백.

기동 시 빈 캐시 시드: `_seed_rankings_if_empty` · `_seed_kr_sector_if_empty` · `_seed_us_sector_if_empty`(`scheduler/jobs.py`).

### 10.2 빈 결과 가드 — 저장 파괴 방지 (`wrong < missing`)

외부 소스가 실패하거나 빈 응답을 줄 때 **직전 양호값을 덮거나 지우지 않는 것**이 이 저장소의 일관 규약이다. 형태가 셋이다.

**(a) 소스-폴백(기본형·구조적으로 안전)** — 빈 결과가 저장 지점에 **도달하기 전에** 직전값으로 채워진다.
- `market_indicators/fx.py`의 `_fetch_fx` — 실패 시 `stored_history`를 담아 반환.
- `market_indicators/cache.py`의 `_merge_history(prev, [])` — prev를 그대로 반환.
- `services/dividends.py` — `fetch_dividend_schedule(...)`를 `replace_schedule` **진입 전에** 평가.

**(b) 끝 가드(저장 직전 판정)** — 여기서 실패 클래스 3종을 **모두** 물어야 한다.
1. **예외**(try/except)
2. **성공-but-빈응답** — 외부가 `rt_cd=0`/HTTP 200에 0건을 주면 예외 가드를 그냥 통과한다. `market_indicators/kospi_futures.py`의 `_fetch`가 `front["price"] is None or not history`를 **값 수준**으로 검사해 미영속 처리하는 것이 그 대응.
3. **부분 페이로드** — 같은 payload의 *일부 필드*만 가드하면 나머지가 파괴된다(`kr_sector`가 `sectors`만 보고 `index`를 빠뜨린 사례) → 필드별 직전값 보존(`index = build_sector_index() or load_sector_index()`).

**(c) delete-rewrite(replace) 저장** — `DELETE + INSERT`로 갱신하는 store는 fetch 실패를 빈 결과로 삼키면 저장을 *생략*하는 게 아니라 **직전값을 DELETE로 파괴**한다. fetch 함수가 예외를 `[]`로 삼키지 말고 **전파**해 호출측이 replace를 통째 스킵하게 한다. replace의 delete+insert는 **단일 트랜잭션**으로.

**임계 선택은 집합의 성격으로 갈린다**(`market_indicators/earnings.py`):
- **고정 명명 집합의 합**(M7 7종목·KR Top2 2종목 — 비중 차트의 분자) → **완전성** 요구(`m7_ok < len(M7)`이면 저장 생략).
- **유동적 대규모 집합**(S&P500/KOSPI 나머지 ~490종목) → **커버리지 임계** `_REST_MIN_COVERAGE = 0.5`.
- **독립 항목**(원자재 심볼·업종처럼 서로 합산되지 않는 것) → 실패분만 개별 백필.
- ⚠️ `if not X:` all-or-nothing 게이트는 이 셋 중 어디에도 해당하지 않는다 — 유동 집합에 그것만 걸면 절반이 조용히 소실된다.
- ⚠️ **백필과 전량실패 판정의 순서**가 중요하다 — 백필을 먼저 하면 저장값이 있는 한 판정이 영원히 발동하지 않는다(`commodities.get_treasury()`가 그 형태). 판정은 백필 *전* raw fetch 결과로(`if not any(results.values())` — `get_commodities()`가 옳은 순서).

관측 규약: 저장 스킵 시 admin 응답·로그가 **"갱신됨"과 "생략·직전값 유지"를 구분**해야 한다. `job_runs`는 본문이 예외를 전파할 때만 `failed`라, 스킵은 기본적으로 초록으로 기록된다.

### 10.3 NaN/inf 방어

- **출력**: starlette `JSONResponse`가 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 **500**. 소스에서 `math.isfinite` 가드가 우선이고, 안전망으로 `services/utils.py`의 `sanitize`(float **및 Decimal** 검사)를 응답 직전에 씌운다.
- 폴백이 증상을 엇갈리게 만든다 — PostgreSQL은 `json` 컬럼에 NaN을 거부(저장 실패)하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과한다.
- **입력**: §9.1의 Pydantic 계약 + `main.py` 검증 핸들러.

### 10.4 타임존

- `services/utils.py`의 `today_kst()` = `datetime.now(ZoneInfo("Asia/Seoul")).date()`. **컨테이너에 TZ env가 없어 bare `date.today()`는 UTC**이므로 00:00~09:00 KST에 하루가 어긋난다. KR 시장-날짜(영업일·최근월물 판정)는 반드시 `today_kst()`.
- 별개 문제: 키움 naive ↔ yfinance aware **series 정렬**은 `tz_localize(None)`(§3.1).
- 스케줄러 트리거 타임존은 배치별 `timezone` 필드(대부분 `Asia/Seoul`).

### 10.5 재시도·throttle·타임아웃

| 소스 | 타임아웃 | throttle/재시도 |
|---|---|---|
| 키움 | 8s | 직렬 0.25s 간격, 401/403 시 토큰 재발급 후 1회 재시도, 연속조회 페이지네이션 |
| KIS | 8s | 직렬 0.05s 간격, 401/403 재시도, 토큰 강제 재발급 60s 가드 |
| DART | 15s(대체로) | corp_code 1주 메모리 캐시로 콜 수 억제 |
| Naver | 5~8s | `_kr_basic_naver`는 첫 예외 시 0.5s 후 **retry-once** |
| FRED | 10s | 증분(저장 마지막 날짜부터) |
| 공공데이터포털 | 30s | 페이지 순회, lending은 페이지 간 0.3s |
| CNN / multpl / Wikipedia / Finviz | 10~15s | 없음(실패는 폴백/graceful) |
| Cowork fire | 15s | 없음(best-effort) |

병렬화: `services/parallel.py`의 `parallel_map(max_workers=10)`, 캘린더 `ThreadPoolExecutor(max 30→실사용 15)`, 섹터 11, 시장지표 각 모듈의 `ThreadPoolExecutor`. **DB 풀 `maxconn=20`이 상한 기준**이다.

### 10.6 자격증명 미설정 = 휴면

키움·KIS·DART·FRED·KOFIA·Telegram·Cowork fire는 전부 `configured()`/`_dart_key()` 류의 존재 검사를 두고 **미설정이면 조용히 비활성**된다(기존 동작 무변화). 그래서 코드를 먼저 머지해도 무해하고, 사용자가 `.env.docker`에 키를 주입하면 활성화된다.
반대로 `SESSION_SECRET`·`DATABASE_URL`·`JWT_SECRET`은 `os.environ[...]` 직접 접근이라 **없으면 기동/요청이 실패**한다.

### 10.7 fixture-pass-live-fail (외부 연동의 상시 위험)

단위 테스트는 외부 응답을 mock하므로 **라벨 불일치·응답 봉투 차이·SQL 타입 캐스트를 원리적으로 못 잡는다**. 이 저장소에서 반복 관측된 형태:
- yfinance 메서드/프로퍼티 index 라벨 차이 → 조용한 None.
- KIS 선물 `output` vs `output1/2/3` → `rt_cd=0`인데 늘 빈값.
- DART `fs_div` 요청/응답 비대칭 → 전 행 스킵.
- uuid 컬럼에 `= ANY(%s)`로 str 리스트 → `operator does not exist: uuid = text`(단건 `= %s`는 암묵 캐스트로 *동작하던* 것이 배치화에서 깨진다) → `ANY(%s::uuid[])`.
- `VALUES` 행 나열을 바깥 괄호로 감싸면 N행이 아니라 record 1행.

→ **외부소스 파싱 슬라이스와 신규/개작 SQL은 라이브 1종목 대조 또는 배포 후 라이브 스모크를 DoD에 포함**한다. 진단 도구는 컨테이너 인프로세스 프로브: `docker exec -i portfolion-backend-1 python - < probe.py`.

### 10.8 시크릿 취급

- `backend/.env.docker`와 `certbot/conf/`는 gitignored. 값은 문서·로그·세션에 인용하지 않는다.
- 게이팅된 엔드포인트를 라이브 검증할 때는 **컨테이너가 자기 env의 키를 읽어 스스로 호출**하게 한다(`docker exec`에서 `os.environ["COWORK_API_KEY"]`로 `X-API-Key`를 채워 `127.0.0.1:8000` 호출) — 값이 세션에 노출되지 않는다.
- fire 리스너도 같은 원칙으로 프롬프트를 **stdin**으로 넘긴다(§9.3).

---

## 11. 데이터 흐름 요약 (소스 → 저장 → 소비)

| 저장소 | 채우는 소스 | 배치 | 읽는 표면 |
|---|---|---|---|
| `snapshots` | 키움/KIS/Naver/FnGuide(KR) · yfinance/Finviz(US) | `daily_report_kr`/`daily_report_us` | 리포트 목록·상세 |
| `consensus_history`, `daily_consensus_mart`, `raw_reports` | FnGuide → Naver Research(KR) · yfinance `upgrades_downgrades`/`analyst_price_targets`(US) | `consensus`(리포트에 내장) | 컨센서스 차트, 목표가·의견수(ADR-0008 as-of-date) |
| `backlog_history` | DART `document.xml` + Cowork | `backlog_fetch` | 리포트 상세(수주잔고) |
| `stock_disclosures` | DART `list.json`(A·B·C·D) + AGM no-type | `disclosure_fetch`, `agm_fetch` | 리포트 상세(최신 공시), 캘린더, 다이제스트 |
| `stock_insider_trades` | DART `elestock.json`/`majorstock.json` | `insider_fetch` | 리포트 상세(내부자) |
| `stock_dividends`, `stock_dividend_schedule` | yfinance(US) · DART `alotMatter.json`(KR) | `dividend_fetch` | 대시보드 배당, 배당 탭 |
| `stock_beta` | yfinance(US) · `^KS11` 회귀(KR) | `beta_fetch` | 포트폴리오 노출 탭 |
| `market_investor_trend` | 키움 `ka10059`+`ka10008` → Naver `/trend` 폴백 | `investor_trend_fetch` | 수급 섹션·스크리닝 |
| `market_short_sell` | 키움 `ka10014` | `short_sell_fetch` | 공매도 섹션 |
| `stock_supply_score` | 키움·Naver 파생 | `supply_score_fetch` | 수급 배지 |
| `us_supply_snapshot` | yfinance | `us_supply_fetch` | US 수급·내부자 섹션 |
| `market_rankings` | Naver `marketValue`(KR) · `yf.screen`(US) | `kr_rankings_fetch`/`us_rankings_fetch` | 랭킹 탭 |
| `market_leverage_indicators` | 공공데이터포털 KOFIA·시장지수 | `leverage_fetch` | 수급지표 탭 |
| `market_lending_balance` | 공공데이터포털 금융위 | `lending_fetch` | 수급지표 탭 |
| `market_cache`(15키) | FRED·yfinance·Naver·관세청/Comtrade·CNN·multpl·KIS 선물·키움 업종 | `monthly_*`·`earnings_*`·`macro_signals_fetch`·`kospi_signal_fetch`·`kr_sector_fetch`·`us_sector_fetch` + 요청경로 7종 | 시장지표 탭, 섹터·매크로 |
| `stock_recommendations` | Naver·키움·yfinance·DART(KR) · yfinance·dataroma(US) | `recommendation_kr`/`recommendation_us` | 추천 탭 |
| `guru_managers` | dataroma(+Naver US 한글명) | `guru_crawl` | 구루 화면 |
| `analyst_reports`, `tech_reports` | Cowork 제출 + 서버 스냅샷 발췌 | (fire 트리거) | 심층/선도기술 리포트 |
| `digests` | 보유종목 시세 집계 (+Telegram 발송) | `daily_digest` | 다이제스트 탭 |
| `calendar_cache` | yfinance + FRED releases + `exchange_calendars` + `stock_disclosures.meeting_date` | (요청 시 빌드·캐시) | 캘린더 |
| `user_events` | `EventTrackerMiddleware` + `POST /api/events` | — | admin 분석(`/api/admin/analytics`) |

---

## 12. 미확인 / 주의

- `backend/.env.docker`는 **키 이름만** 확인했다(값 미열람). `.env.docker`에 없지만 코드가 읽는 `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`가 실제 배포에서 설정돼 있는지는 이 조사로 확정할 수 없다 — 미설정이면 다이제스트 텔레그램 발송이 조용히 스킵된다.
- `authlib`는 `requirements.txt`에 있으나 임포트 0건 — 제거 가능해 보이지만 이번 조사 범위에서 판단하지 않았다.
- `backend/Procfile`·`frontend/vercel.json`·`backend/supabase_schema.sql`·`supabase/`는 과거 배포 경로의 잔재로 보이며, 현재 파이프라인에서 참조되지 않는다.
- 외부 API의 **응답 스키마 상세**(전 필드 목록)는 각 모듈 상단 docstring이 라이브 프로브 결과로 기록해 두고 있다 — 이 문서는 엔드포인트·인증·폴백 구조만 담았다.
- 컨테이너·라이브 DB에는 접근하지 않았다(읽기 전용 정적 분석). 따라서 "현재 `market_cache`에 실제로 어떤 키가 채워져 있는가" 같은 런타임 상태는 미확인이다.
