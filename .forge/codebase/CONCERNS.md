---
last_mapped_commit: 74f5ca940c42a3ee866a45ccccfe24ac701a04d9
mapped: 2026-06-27
---

# 코드베이스 우려 사항 (CONCERNS)

PortfoliOn(Python/FastAPI 백엔드 + React/Vite 프론트)의 기술부채·알려진 버그/푸트건·보안·성능·취약 지점. 각 항목은 라이브 코드에서 가드/함수 존재를 확인한 뒤 기재했다. 도메인 용어 정의는 여기 두지 않는다(CONTEXT.md 소관) — 여기는 구현 사실과 파일 경로만.

---

## 1. NaN/inf → 응답 직렬화 500 (전 엔드포인트 횡단 위험)

**문제:** starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화 단계에서 **500**(`ValueError: Out of range float values are not JSON compliant`)을 낸다. 외부 시세(yfinance `Close`=NaN, FX `usdkrw`=NaN 등)가 합산값을 오염시키는 게 전형이며, cold·warm 무관 **결정적** 500이다.

**대시보드 totals 실사례 (task#104, `.forge/retro/2026-06-22-dashboard-500-nan-serialization.md`):**
- 근본은 per-card throw가 아니라 `_portfolio_totals`의 NaN→직렬화 500이었다. `_usdkrw_rate()`(`backend/routers/stocks.py:313`)가 저장 FX의 비유한값(nan)을 그대로 반환하면, `_portfolio_totals`의 `if fx is None` 가드를 **NaN≠None이라 통과**(`stocks.py:438`) → US 카드 totals=NaN → 직렬화 500. 이는 §2의 per-card 가드 *위* 단계라 task#102 가드가 못 막는다.
- 현재 가드 2겹:
  1. `_usdkrw_rate`에 `math.isfinite` 가드 — 비유한이면 None 반환(`backend/routers/stocks.py:328`). None이면 US 카드가 totals서 graceful 제외.
  2. `_build_all` 반환을 `services.utils.sanitize`로 감싸 NaN/inf→None (`backend/routers/stocks.py:494`). 출처 불문 안전망.

**다이제스트 실사례 (`.forge/retro/2026-06-20-fmtprice-nan-guard.md` 계열):**
- `backend/services/digest_service.py:42-44`에서 prev_close/current가 비유한이면 "시세 없음" 처리(평가액 제외). `digest_service.py:61`에서 usdkrw 비유한이면 기본값 — 미가드 시 `total_value`=NaN → digest JSON 직렬화 500.

**파일-폴백이 증상을 가린다 (진단 지연 원인):** PostgreSQL `json` 컬럼은 NaN을 거부(저장 실패)하지만, 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백/내부 직렬화는 통과한다 — DB저장 실패↔파일 성공↔응답 직렬화 실패로 증상이 엇갈린다.

**처방(가드 위치 우선순위):** 시세/합산을 응답에 싣는 엔드포인트는 **소스에서 `math.isfinite` 가드**(예: "시세 없음" 처리)가 출력 일괄 sanitize보다 깨끗하다. 불가피하면 응답 dict 전체를 `sanitize`로 감싼다.

---

## 2. 대시보드 "holdings=N → 항상 N카드" 불변식 (500-to-empty 금지)

**파일:** `backend/routers/stocks.py:331-496` (`GET /api/stocks/dashboard`), 프론트 `frontend/src/pages/Portfolio.jsx` `DashboardGrid`.

**증상 (task#102, `.forge/retro/2026-06-22-dashboard-first-load-empty-grid.md`):** "헤더 N인데 그리드 빈" — 헤더(`/api/portfolio` = 단일 쿼리, ThreadPool 없음)는 N 정상, 그리드(`/api/stocks/dashboard` = 카드당 다중 DB read)만 cold throw→500→프론트 silent catch→빈 그리드. 첫 콜드 로딩만 발생, 재네비(풀 warm)면 정상.

**백엔드 가드 (`_build_all`, `stocks.py:472-494`):**
- `get_quotes_batch`를 try/except로 감싸 일괄시세 실패에도 빌드 계속(`stocks.py:474-478`).
- 카드당 `_safe`(`stocks.py:482-488`): `_build_card` throw 시 `_minimal_card`(`stocks.py:453`)로 폴백 — 한 종목 enrichment(snapshot/consensus/배당/수급/내부자) 실패가 전체 500을 안 낸다.

**프론트 가드:** `DashboardGrid`는 `stocks>0`이면 빈상태 대신 Skeleton(헤더↔그리드 모순 제거), self-heal은 one-shot이 아니라 **bounded 재시도(최대 3)**. one-shot self-heal은 안티패턴 — `useRef(false)` 한 방으로 막으면 일시 콜드 실패에 재마운트 전까지 영구 stuck(task#82 dashHealedRef 잔존 약점의 재발 토양).

**주의:** 이 가드는 *증상 차단*이지 풀 경합 자체 해결이 아니다(§4 참조). "헤더 N·그리드 빈" 증상을 보면 dashboard 빌드 throw + 프론트 silent catch를 의심할 것.

---

## 3. DB 연결 풀 경합 (PoolError)

**파일:** `backend/services/db.py:16-28`.

**현재 설정:** `ThreadedConnectionPool(minconn=1, maxconn=20)`. psycopg2 풀은 소진 시 블록이 아니라 **PoolError를 던진다** — 그래서 최대 ThreadPool 동시성(calendar 15·analysis 11)보다 크게(20) 둔다.

**ThreadPool 동시성 표면(풀과 경합):**
- 대시보드: `max_workers=min(len(holdings), 10)` (`stocks.py:490`), 카드당 다중 DB read.
- enrich 배치: `max_workers ≤ 8` (`stocks.py:269-270`).
- calendar: `max_workers=15` (`backend/routers/calendar.py:70`).
- analysis(상관관계/섹터): 11.

**잔존 위험:** maxconn=20이 현재 워커 합을 덮지만, 워커 수를 늘리거나 새 병렬 표면을 추가하면 PoolError가 다시 난다. 콜드 첫 호출(풀 미warm)에 경합이 집중된다. **§2 가드가 이 증상을 차단하지만 풀 sizing 자체 튜닝은 후속 후보**(maxconn vs ThreadPool 워커 합).

---

## 4. KR 시세 이중 소스 스케일 불일치 (글리치 박제)

**핵심:** KR 리포트의 시세 소스(`get_quote_kr`)와 일봉 차트 소스(`get_history_df`)는 다른 키움 TR(ka10001 vs ka10081)이라 스케일이 어긋날 수 있다. 매물대/RSI가 "깨져" 보이면 표시 버그가 아니라 **박제된 price 값 자체**를 의심할 것(005930이 ~70k=실값 354k의 1/5로 박제된 사례, task#94).

**거래소 이원화 (ADR-0020, task#95):** 키움 코드선택 단일 분기점 `client.integrated_code(stk_cd, regular=False)` (`backend/services/kiwoom/client.py:40-49`):
- 기본 `regular=False` → `f"{stk_cd}_AL"` (NXT 시간외, 라이브 대시보드).
- `regular=True` → 평문 KRX 코드 (정규장 종가, 리포트 스냅샷).
- → 같은 종목이 리포트(354k)와 대시보드(350.5k)에 ~1% 다른 현재가를 보이는 건 의도된 기준 차.

### 4.1 라이브(NXT) 다수결 가드 — 독립 피드 2-of-N

**파일:** `backend/services/market/kr.py:124-205`.
- `_corroborated_pick(feeds)` (`kr.py:124`): 어떤 피드 가격이 *다른* 피드 ≥1개와 ±2x([0.5,2.0]) 이내로 합의하면 trusted, 우선순위(키움 NXT→KIS→Naver→키움 KRX) 최상위 반환.
- `_kr_pick_basic(ticker, ref_close, regular)` (`kr.py:178`): regular=False면 ① 키움 NXT+키움 KRX 2콜 합의 → NXT 반환(평소, lazy), ② **불일치(글리치)면** KIS·Naver 추가 호출해 최대 4피드 다수결로 outlier 폐기.
- degenerate(가용 독립 2피드 없음)는 `_kr_pick_degenerate_lazy` (`kr.py:159`): 단일 피드 자기 prev_close ±30% self-check만(wrong<missing).
- `_price_sane` (`kr.py:106`)는 이제 regular=True 경로 + degenerate self-check에만 사용(다수결이 단일 KRX 교차검증을 대체, `krx_close` 파라미터 제거).

**구분 주의 (task#98 교훈):** "불일치(disagreement)"는 글리치 신호 → 추가 fetch 후 다수결. "부재(outage)"는 escalate 없이 lazy short-circuit. 이 구분을 안 하면 비용목표(평소 2콜)가 깨지고 기존 lazy 테스트(`test_get_quote_kr_uses_kis_when_kiwoom_fails`)가 깨진다.

**한계:** 단일 피드 self-consistent 글리치(NXT 70k인데 KRX도 down)는 2nd 피드 없으면 다수결 무력 — 본질적 한계(wrong<missing floor).

### 4.2 리포트 박제-시 독립피드 게이트 (KRX 자기일관 글리치)

**파일:** `backend/services/report_generator.py:181-199`, `generate_report` (KR만).
- regular=True(KRX)는 NXT `_AL` 글리치만 차단할 뿐 **KRX 두 TR(quote ka10001·일봉 ka10081)이 같은 시점에 함께 글리치하는 KRX 자기일관 오염**엔 면역이 아니다(같은 KRX 피드라 서로 합의·`_price_sane` 블라인드, 005930 리포트 또 70k, task#101).
- 게이트: 저장 직전 KRX와 독립인 **네이버 현재가**(`_kr_basic_naver`, `report_generator.py:188`)로 price·일봉 기준종가를 2x 교차검증 → 어긋나면 박제를 **스킵**(직전 양호 스냅샷 유지, wrong<missing). 네이버 부재 시 검증 생략, `backfill_ticker`(과거 날짜)는 현재가 대조 불가라 미적용.

**중요:** "fix 배포는 이미 박제된 stale 70k 스냅샷을 소급 치료하지 않는다" — *재생성*해야 KRX로 덮인다(재생성 전 프로브로 라이브 소스 깨끗 확인 → transient 글리치 재박제 방지).

**진단:** 네이버 공개 API(`m.stock.naver.com/api/stock/{code}/basic`)로 creds 없이 실값 대조 + 컨테이너에서 KRX(`005930`) vs SOR(`005930_AL`) 원값 직접 비교(`docker exec -i portfolion-backend-1 python - < probe.py`).

---

## 5. 종목명 이중 소스 (dual-source) — 클로버 푸트건

**두 소스:** `tickers.name`(공유 마스터, 종목관리 목록이 live로 읽음) vs `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세가 읽음). 이름 변경 시 **둘 다** 갱신해야 목록↔상세가 일치.

**동기화 함수 (`backend/services/storage/names.py`):**
- `refresh_snapshot_names(ticker, name)` (`names.py:17`) — 단건, 스냅샷 박제 name UPDATE + 캐시 무효화.
- `set_ticker_name` (`names.py:28`) — tickers.name + 스냅샷 동기.
- `reconcile_snapshot_names()` (`names.py:34`) — 전체 동기화(다른 것만).

**클로버 방지 가드 (task#77, `backend/services/storage/portfolio.py:58`, `:124`):** tickers UPSERT는 들어온 name이 NULL/빈값/티커와 같으면 기존 `tickers.name`을 보존:
```
name=CASE WHEN EXCLUDED.name IS NULL OR EXCLUDED.name = EXCLUDED.ticker THEN tickers.name ELSE EXCLUDED.name END
```
일일 배치(`report_generator`)는 `resolve_name`으로 ticker형 이름이면 quote 실명을 박제해 "고쳐도 다음날 또 종목번호" 재발을 막는다.

**캐시 함정:** DB만 바꾸면 리포트 목록 캐시(`cache.get_list`)·스냅샷 LRU 탓에 화면 미반영 → `cache.invalidate(ticker)`+`invalidate_list()` 필수(storage→cache는 함수 내 지연 import로 순환참조 회피).

**백필 푸트건:** `POST /api/stocks/names/backfill`은 시세 일시실패 시 그 종목을 **재시도 없이 조용히 스킵**(`updated:0`) — 결과 0이면 재실행. 응답 `skipped` 목록으로 빠진 종목 확인 가능.

---

## 6. admin scope=all `is_mine` 게이팅 (액션버튼 404)

**파일:** `backend/routers/report.py:207-211` (`_mk_entry`), 프론트 `frontend/src/components/reports/StockActions.jsx`.

**문제 (task#97):** admin `scope=all` 리포트 목록은 비소유 종목(`is_mine=false`)에도 `category`("holdings"/"watchlist")를 무조건 붙인다(글로벌 포트폴리오 멤버십 기준, `report.py:209-216`). category로만 게이트된 수정/승격/삭제 버튼이 남의 종목(리서치 "그외" 탭)에도 노출되면, 그 핸들러는 호출자 본인 user_stocks만 검사하는 user-scoped 엔드포인트(`/api/watchlist|portfolio/{ticker}`)라 **404로 조용히 깨진다**(증상="관심 목록에 없다").

**현재 가드:**
- 액션 버튼 가시성은 category가 아니라 **`is_mine`으로 게이트** — `StockActions.jsx:14`: `info.is_mine === false`면 전체삭제(`/api/admin`)만, 본인 종목이면 수정·승격·삭제.
- 관리자의 교차-사용자 동작은 `/api/admin/*` 전용(`require_admin`).
- **단일 `StockActions` 컴포넌트(task#103)**: `layout="card"|"list"` prop으로 `StockCard`(그리드)·`TickerListItem`(사이드바) 양쪽이 공유. 과거엔 두 렌더러에 byte-identical 중복이라 "항상 둘 다 수정" 푸트건이었고, 그게 task#97 재발 토양. **액션버튼/게이트 변경은 `StockActions.jsx` 한 곳만**.

---

## 7. 인메모리 캐시 TTL/무효화 + 로컬 파일 캐시

**파일:** `backend/services/cache.py`.

**인메모리 캐시(`cache.py:32-127`):**
| 캐시 | 유형 | 값 |
|------|------|----|
| snapshot | LRU | `_MAX = 50` (`cache.py:36`) |
| list | TTL | 60.0s (`cache.py:33`) |
| dashboard | TTL | 300.0s (`cache.py:34`) |
| correlation | TTL | 300.0s (`cache.py:35`) |
| sector | TTL | 300.0s (`cache.py:88`) |
| macro | TTL | 300.0s (`cache.py:89`) |
| quote | TTL | 60.0s (`cache.py:110`) |
| live_prices | TTL | 15.0s (`cache.py:124`) |

> 주의: 일부 기존 가토 문서가 snapshot LRU=200·list TTL=5s로 적혀 있으나 라이브 코드는 위 값(50·60s)이다 — 문서 드리프트.

**공용 무효화기 `invalidate_portfolio_caches()` (`cache.py:135-142`):** calendar + list + dashboard + sector + macro + correlation 일괄 무효화.

**리포트 목록 미갱신 버그 (task#105, `.forge/retro/2026-06-27-report-list-cache-invalidate-on-mutation.md`):** `invalidate_portfolio_caches()`가 `invalidate_list()`를 안 불러 `/api/report/list`가 60초 TTL stale 캐시 반환 → 종목 추가/승격 후 목록 미갱신이었다. 현재 `cache.py:138`에 `invalidate_list()` 포함으로 수정됨. 종목 mutation 시 이 무효화기를 부르는지 확인할 것.

**로컬 파일 캐시(gitignored, `.gitignore:13,23`):**
- `backend/data/calendar/YYYY-MM.json` — 월별 캘린더(종목 add/remove/promote 시 auto-clear, `DELETE /api/calendar/cache` 수동).
- `backend/data/consensus/` — per-ticker 컨센서스.
- `backend/reports/`, `backend/snapshots/`, `backend/data/*.json`(holdings/watchlist/stocks/schedule 등) gitignored — Docker PostgreSQL이 기본 저장소, 파일은 런타임 캐시.

---

## 8. 로컬 `.venv` ≠ Docker 의존성 (lxml 부재)

**문제:** `lxml`은 `requirements.txt`에 있고 Docker 이미지엔 설치되지만 **로컬 `backend/.venv`엔 없다**. 로컬 pytest로 검증할 코드의 HTML/XML 파싱은 `BeautifulSoup(html, "lxml")` 대신 stdlib `"html.parser"`를 써야 로컬·프로덕션 모두 동작.

**현재 준수 확인:** `backend/services/backlog_parser.py:231,294,315`·`scraper.py:19`·`guru_scraper.py:56,79` 모두 `"html.parser"` 사용. `backlog_parser.py:14-16`은 document.xml(원래 XML)을 html.parser로 파싱하므로 `XMLParsedAsHTMLWarning` 억제 주석 있음.

---

## 9. FastAPI 라우트 순서 (enrich/batch < {ticker}/enrich)

**파일:** `backend/routers/stocks.py:221`(`PUT /enrich/batch`), `:236`(`PUT /{ticker}/enrich`).

`PUT /api/stocks/enrich/batch`가 `PUT /api/stocks/{ticker}/enrich` **앞에** 등록돼야 FastAPI가 `enrich`를 ticker 값으로 라우팅하지 않는다. 현재 순서 정상(221 < 236). 라우트 추가 시 catch-all `{ticker}` 패턴 앞에 구체 경로를 두는 규칙 유지 — `GET /{ticker}/backlog`가 catch-all에 가려 500 난 전례(task backlog-route-fix).

---

## 10. 배치 id 은퇴 + source/usage 동기화 푸트건

**파일:** `backend/services/batch_registry.py` (`BATCHES`).

**배치 id 은퇴 시 전수 grep 대상:** ① 데이터 read(스케줄 소비처) ② 표시 문자열(`schedule_desc` 등) ③ **`job_runs.record(id, ...)` 모든 lane — auto·manual·backfill 전부** ④ 그 id를 단언하는 테스트. 한 곳이라도 옛 id면 stale read·**배치 현황 실행이력에서 증발하는 회귀**(daily_report-market-split 재발)·고아 run 누적. 단, 옛 스케줄 행→신규 id 승계 마이그레이션 read는 정당한 잔존.

**source vs usage 방향:** `batch_registry`의 각 배치는 `source`(데이터 fetch 출처, 예 `["키움","KIS","Naver"]`)와 `usage`(소비 UI, 예 `["리포트 탭"]`)를 갖고 `GET /api/batches`가 둘 다 노출(`batch_registry.py:19-20` 등). fetch 체인을 바꾸면(예 KR 랭킹 Naver→키움) `source`도 갱신(DoD) — 안 하면 현황 카드가 stale 출처 표시.

**시장 속성:** 모든 배치가 `market`(KR/US/공통, 출처국 기준)을 가진다(`batch_registry.py:9`). FRED 경제지표는 출처국 기준 US(`monthly_us`).

---

## 11. 배치-백킹 뷰는 요청/기동 경로에서 라이브 외부 호출 금지

**원칙:** 랭킹·KR 업종 모멘텀 등 배치-백킹 뷰는 외부 API(키움)를 *요청·기동 경로*에서 라이브 호출하지 말 것 — 배치가 사전계산해 `market_cache`/테이블에 저장하고 요청은 저장값만 읽는다(요청당 N콜 직렬=수초 지연).

**과거 실패 (task#48~50):**
- 외부 fetch 실패를 silent except로 삼키면 진단 불가(`_fetch_one_sector`가 빈 종가 삼켜 all-None 박제).
- **빈/all-None 결과를 캐시에 박제 금지** — 전부 None이면 save 생략·직전 양호값 유지. 안 그러면 시드 가드(`_seed_*_if_empty`)가 "채워짐"으로 오판해 고착.
- 의심 트리거(base_dt 등)가 아니라 *실패 클래스(all-None)*를 가드해야 근본원인 미상이어도 재발 차단.

**관련 silent-catch 위험:** §2 대시보드 프론트 `usePortfolioData.fetchDashboard`도 catch를 silent로 삼켜 빈 그리드를 만들었다 — 외부/내부 fetch 실패의 silent 삼킴은 횡단 진단 함정.

---

## 12. 자동배포 인프라 (무음 미배포 위험)

**문제 (task#105, `.forge/retro/2026-06-27-report-list-cache-invalidate-on-mutation.md`):** 코드 수정이 단위테스트 green이어도 배포 경로가 끊겨 5일간 무음 미배포된 인시던트. 근본원인 = PortfoliOn self-hosted 러너가 lab-taebro 세팅 때 재등록돼 죽음 + in-checkout 푸시는 폴러가 스킵(`LOCAL==origin/main`) → 주·폴백 둘 다 빠짐.

**배포 경로:** GitHub Actions self-hosted 러너(주, `deploy.yml runs-on: self-hosted`, 전용 `~/actions-runner-portfolion`) + 폴러(폴백, `scripts/auto-deploy-poll.sh`, origin>local일 때만 `deploy.sh`).

**백엔드가 옛 코드/이상 동작이면 진단 순서:** ① `docker ps` 백엔드 uptime(푸시보다 오래면 미배포) ② `gh run list`(잡이 `queued`/`cancelled(24h)`면 러너 부재) ③ `gh api repos/calmonion7/PortfoliOn/actions/runners`(online 러너?). task#104는 폴러 로그만 봐 러너 dead를 놓쳤다 — 두 경로 다 본다.

**폴러가 로컬 편집 삭제:** launchd `com.portfolion.auto-deploy-poll`이 2분마다 origin/main으로 `git reset --hard` → 메인 체크아웃의 커밋 안 한(또는 push 안 한) tracked 편집은 ≤2분에 소실. 코드 변경은 commit+`git push origin main`을 묶어 즉시 반영. `.forge/` 등 untracked는 안전.

**프론트/백엔드 라이브 시점 차:** nginx가 `frontend/dist`를 `:ro` 직접 서빙이라 로컬 `npm run build`가 즉시 라이브. **백엔드 변경은 폴러/러너 재배포 후에야 라이브** — 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작.

---

## 13. 외부 API 키 의존 기능 (키 미설정 시 휴면/실패)

`.env.docker`(gitignore)에 키가 없으면 해당 기능이 휴면 또는 요청 실패한다. 코드 머지 자체는 무해(안전 기본값):
- **KIS**(`backend/services/kis/client.py`): `configured()` False면 휴면(기존 동작 무변화). 키 주입 시 활성화. 토큰 발급 1분당 1회 EGW00133 방어로 강제 재발급 60s 가드.
- **키움**(`backend/services/kiwoom/client.py`): `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY` 미설정/실패/빈 price면 Naver 폴백.
- **FRED**(`FRED_API_KEY`): 미설정 시 매크로 신호·경제지표 수집 실패(저장값 무변경).
- **KOFIA**(`KOFIA_API_KEY`): 미설정 시 leverage/lending 요청 실패.
- **DART**(`DART_API_KEY`): KR 전용 backlog/disclosures/dividends 필수.
- **KITA**(`KITA_API_KEY` = 실제 관세청 키): 미설정 시 UN Comtrade 공개 API 자동 폴백.

---

## 14. 엔드포인트 응답 reshape / additive 호출의 테스트 오염

**비-additive reshape (배열→객체 등):** 그 엔드포인트를 fetch하는 *모든* 프론트 소비처를 `grep -rn '<경로>' frontend/src/`로 전수 갱신. 한 곳만 고치면 독립 fetcher(예 `Analytics.jsx`가 훅과 별개로 `/api/stocks/dashboard` 직접 fetch)가 옛 형태로 취급해 조용히 깨진다(task52 상관관계 탭 "보유종목 없음"). 가능하면 additive(필드 추가) 선호.

**additive read 추가 시 mock 오염:** 엔드포인트에 read/외부호출을 additive로 추가하면 `mock.call_args`(마지막 호출)를 단언하는 기존 테스트가 조용히 오염된다 — 호출 시퀀스가 늘어 마지막 호출이 신규 호출로 바뀐다. 대응: ① 기존 단언을 호출별 `call_args_list[i].kwargs`로 마이그레이션 ② 신규 호출은 입력 비면 `if`로 생략해 기존 테스트 보존 ③ 신규 테스트가 `call_count`로 시퀀스 못박기. 널리 호출되는 함수(예 `generate_report`)에 외부 read 추가 시 모든 테스트 호출처 grep 필수(task#101 `_mock_kr`이 네이버 read 미mock으로 깨진 사례).

**`importlib.reload` + `from x import y` 직접-import 패치 함정 (task#101):** reload는 모듈 본문 재실행해 직접-import 이름(`execute`/`query`/`sanitize`)을 원본으로 재바인딩 → 패치 무효화. 소스 모듈(`services.db.execute`)을 패치할 것(모듈-attr 패치는 reload 생존).

---

## 15. KR 색 관례 + 의미 배지

**파일:** `frontend/src/styles/tokens.css`, `frontend/src/components/ui/Badge.css`, `ui/SupplyBadge.jsx`.

이 앱은 `--up`=빨강(상승)·`--down`=파랑(하락)이라 `.badge--success`=빨강·`.badge--danger`=파랑이다. 가격 방향이 아닌 **의미 상태 배지(수급 밴드 등)에 success/danger를 쓰면 색이 KR 가격색으로 박혀 Western(녹=좋음/빨=경고) 의도와 반전**된다(수급 배지 우호=빨·경계=파 버그, 라이브 UAT 포착). 의미 배지는 `SupplyBadge.jsx`처럼 전용 색 명시. `warning` 변형은 `--color-warning`/`--warning-tint` 미정의로 현재 깨져 있어 caution 색으로 못 씀.

---

## 16. 문서 동기화 부채 (drift 위험)

- **API 변경 시 명세서 2개**(`API_SPEC.md` + `CLAUDE_COWORK_API.md`)를 항상 함께 갱신(DoD). 엔드포인트 *존재* drift(method+path 추가/삭제/개명)는 `backend/tests/test_api_doc_sync.py`가 자동검출 — 미문서화 기존 23개는 `KNOWN_UNDOCUMENTED` 베이스라인으로 동결. 단 요청/응답 스키마·인증 게이팅 동기는 여전히 수동 DoD.
- **기능 표면(화면/env/스택/아키텍처/배치) 변경 시 `README.md` 해당 절도 같은 PR**(DoD). README는 overview 레벨 — 엔드포인트 세부는 명세서 2개에만.
- **이 CONCERNS.md 자체의 캐시 값(§7)이 일부 기존 가토 문서와 불일치** — 라이브 코드(`cache.py`) 값이 정본.

---

*Concerns audit: 2026-06-27*
