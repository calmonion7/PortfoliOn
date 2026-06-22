---
last_mapped_commit: b6193c3837f4125a41930c36a2b3ae2ef198dc3c
mapped: 2026-06-22
---

# CONCERNS

PortfoliOn의 기술 부채·알려진 버그·보안 민감부·성능 위험·취약 영역을 정리한다. 1차 출처는 프로젝트 루트 `CLAUDE.md`의 Gotchas 절과 최근 `.forge/retro/`(특히 2026-06-21~22). 실제 파일 경로·심볼을 근거로 기록한다.

---

## 1. KR 시세 발산 가드 (가장 취약·최다 손댐 영역)

`backend/services/market/kr.py` — KR 현재가는 여러 독립 피드(키움 NXT `_AL`·키움 KRX 평문코드·KIS·Naver)에서 오는데, 한 피드가 순간 이상체결(글리치)로 실값의 1/5 같은 값을 내놓으면 일배치가 그 값을 스냅샷에 박제한다. 005930(삼성전자)이 실값 ~354k 대신 ~70k로 박제된 사례가 task#93~101에 걸쳐 반복 재발했다. **근본원인은 영속 소스 버그가 아니라 NXT `_AL`(SOR 통합코드)의 *일시적* 이상체결이 배치 시점에 박제된 것**이므로(task#94), 증상을 보면 "소스부터 고치자"가 아니라 박제된 price 값 자체를 의심해야 한다.

가드는 두 경로로 나뉜다.

### 1.1 regular=False (NXT 라이브, 대시보드·종목추가·RSI 기본) — 2-of-N 다수결
`get_quote_kr(ticker, exchange, regular=False)` → `_kr_pick_basic`(`kr.py:178`) → `_corroborated_pick`(`kr.py:124`). 어떤 현재가 피드가 *다른 독립 피드 ≥1개*와 ±2x([0.5, 2.0]) 이내로 **합의(corroborate)**해야 신뢰하고, trusted 중 우선순위 최상위(키움 NXT→KIS→Naver→키움 KRX)를 반환한다(task#98). lazy escalation: 평소엔 키움 NXT+키움 KRX 2콜만으로 합의→NXT 반환(비용 무변), 불일치 시에만 KIS·Naver를 추가 호출해 최대 4피드 다수결로 outlier를 폐기. 단일 피드 글리치는 다수를 못 이기므로 **KRX-poison(KRX 단일 글리치)과 자기일관 `_AL` 전체오염을 둘 다 해소**한다. 키움 outage/단일 피드뿐(불일치 아님)·전 피드 합의 불가는 **degenerate** 처리: 우선순위 첫 피드를 자기 prev_close ±30%로만 자가검증(`_kr_pick_degenerate_lazy`, `kr.py:159`, wrong<missing).

### 1.2 regular=True (리포트 스냅샷, KRX 정규장) — 박제-시 독립피드 게이트
다수결을 적용하지 않는다(`_kr_pick_regular`, `kr.py:137` — ①prev±30% + ②키움 일봉 종가 ±2x). 이유: KRX 자기일관 글리치는 task#94 "KRX 안정" 근거로 이론적이고, 다수결을 리포트에 매일 돌리면 +500~2000콜/일 실비용이 든다. **그러나 이것이 리포트의 근본해결은 아니다** — KRX 두 TR(quote ka10001·일봉 ka10081)이 같은 배치 시점에 함께 글리치하는 **KRX 자기일관 오염**엔 면역이 아니다(같은 KRX 피드라 서로 합의해 `_price_sane`(`kr.py:106`)을 블라인드로 통과, 005930 리포트 또 70k = task#101). 이건 별도 **박제-시 독립피드 게이트**(`backend/services/report_generator.py:181~`, `generate_report` 내부, KR만)가 막는다: 저장 직전 KRX와 독립인 **네이버 현재가**(`_kr_basic_naver`)로 price·일봉 기준종가를 2x 교차검증해 어긋나면 그 종목 박제를 **스킵**(직전 양호 스냅샷 유지, wrong<missing). 네이버 부재 시 검증 생략, `backfill_ticker`(`report_generator.py:243`, 과거 날짜)는 현재가 대조 불가라 미적용.

### 1.3 시세 기준 이원화 (ADR-0020, task#95)
키움 코드선택 단일 분기점 `client.integrated_code(stk_cd, regular=False)`에 `regular` 플래그가 있다(기본 False=`_AL` NXT 시간외, True=평문 KRX 정규장 종가). **리포트 스냅샷 writer만 `regular=True`로 opt-in**(`report_generator` daily_df·get_quote·경쟁사, `report.py:refresh_analyst`). RSI·대시보드(`get_quotes_batch`)·종목추가·`resolve_name`은 NXT 기본. → 같은 종목이 리포트(354k)와 대시보드(350.5k)에 ~1% 다른 현재가를 보일 수 있는 건 **의도된 기준 차**(버그 아님). `get_quote` TTL 캐시 키에 `regular` 포함(NXT/KRX quote 충돌 방지).

### 1.4 잔존 위험
- regular=False 다수결은 전 피드 합의 불가 시 degenerate로 떨어져 단일피드 self-check만 한다(참조/피드 부재 시 해당 검증 생략).
- regular=True는 네이버 부재 시 게이트가 무력, backfill 경로는 미적용.
- **fix 배포는 이미 박제된 stale 스냅샷을 소급 치료하지 않는다** — 배포 전 박제된 70k는 *재생성*해야 KRX로 덮인다(재생성 전 프로브로 라이브 소스 깨끗 확인 → transient 글리치 재박제 방지).
- **대시보드 핫패스(`get_quotes_batch`/`_changes_from_closes`)는 이 가드를 안 탄다**(ephemeral 용인, task#96·98 무변경).
- 진단법: 네이버 공개 API(`m.stock.naver.com/api/stock/{code}/basic`)로 creds 없이 실값 대조 + 컨테이너에서 KRX(`005930`) vs SOR(`005930_AL`) 원값 직접 비교(`docker exec -i portfolion-backend-1 python - < probe.py`).

---

## 2. 대시보드 빌드 불변식 — 500-to-empty 금지 (task#102)

`backend/routers/stocks.py` `_build_all`(`stocks.py:468`). 불변식: **holdings=N → 항상 N카드**. `GET /api/stocks/dashboard`는 `get_quotes_batch`(try/except→{}) + 카드당 `_safe`(`stocks.py:478`, throw→`_minimal_card` `stocks.py:449`)로 감싸 일괄시세·per-card enrichment(snapshot/consensus/배당/수급/내부자) 실패에도 전체 500을 안 낸다.

**증상 패턴**: 헤더 N인데 그리드 빈. 콜드 첫 호출에 10-워커 ThreadPool(`stocks.py:486`)×카드당 다중 DB read가 풀 경합/throw → 500 → 프론트 `usePortfolioData.fetchDashboard`(`frontend/src/hooks/usePortfolioData.js:31`)의 catch가 silent로 삼킴(`:63` "silent") → 빈 그리드. 헤더(`/api/portfolio`=단일 쿼리·ThreadPool 없음)는 N 정상이라 모순이 보인다. 첫 로딩만, 재네비=풀 warm면 정상.

**프론트 방어**(`frontend/src/pages/Portfolio.jsx`): `DashboardGrid`는 `stocks>0`이면 빈상태 대신 Skeleton(`Portfolio.jsx:54`, 헤더↔그리드 모순 제거). self-heal은 one-shot이 아니라 **bounded 재시도(최대 3, `dashHealTriesRef`)**(`Portfolio.jsx:74~83`) — 첫 콜드 실패에 한 방 헛쓰고 재마운트 전까지 stuck하던 회귀 차단. 헤더 N·그리드 빈 증상 → dashboard 빌드 throw(풀 경합 등)와 프론트 silent catch를 의심. (이 가드는 *증상 차단*이지 풀 sizing 자체 튜닝은 별도 후속.)

---

## 3. 액션버튼 컴포넌트 중복 제거 + 권한 leak (task#97, task#103)

### 3.1 비소유 종목 액션버튼 leak (task#97)
admin `scope=all` 리포트 목록은 비소유 종목(`is_mine=false`)에도 `category`("holdings"/"watchlist")를 무조건 붙인다(`backend/routers/report.py` `_mk_entry`, 글로벌 포트폴리오 멤버십 기준). category로만 게이트된 관리/액션 버튼(수정·승격·삭제)이 **남의 종목(리서치 "그외" 탭)에도 노출**되는데, 그 핸들러는 호출자 본인 user_stocks만 검사하는 user-scoped 엔드포인트(`/api/watchlist|portfolio/{ticker}`)라 **404로 조용히 깨진다**(증상="관심 목록에 없다"). 대응: ① 가시성은 category가 아니라 `is_mine`으로 게이트(비소유면 삭제만), ② 관리자 교차-사용자 동작은 `/api/admin/*` 전용(`require_admin`, ticker 단위 전 사용자 `user_stocks` 삭제, 스냅샷은 고아로 유지).

### 3.2 단일 컴포넌트 통합 (task#103)
액션버튼 블록은 **단일 `StockActions` 컴포넌트**(`frontend/src/components/reports/StockActions.jsx`, `layout="card"|"list"`)로 통합됨. `StockCard`(그리드)·`TickerListItem`(사이드바) 양쪽이 이걸 쓰므로 **액션버튼/게이트 변경은 거기 한 곳만**. 과거엔 두 렌더러에 byte-identical 중복이라 "항상 둘 다 수정" 푸트건이었고, 그게 task#97 재발 토양이었다.

---

## 4. DB 풀 sizing vs ThreadPool 경합

`backend/services/db.py` `_get_pool()`(`db.py:16`): `ThreadedConnectionPool(minconn=1, maxconn=20)`(`db.py:25`). psycopg2 풀은 소진 시 블록이 아니라 **PoolError를 던진다**(주석 `db.py:23~24`). 동시성 워커: calendar 15·analysis 11·dashboard 10(`stocks.py:486`)·enrich 8(`stocks.py:268`).

**실제 위험은 낮다**: 호출당 connection을 query/execute 직후 반납하는 패턴이라 워커당 영속 점유가 아니다. 콜드 첫 대시보드 빌드에서만 일시 경합 가능성이 있었고, task#102의 graceful 가드(§2)가 증상을 차단한다. **stale 주석 주의**: `stocks.py:267` 인라인 주석은 `maxconn=10`을 언급하지만 실제 `db.py:25`는 `maxconn=20`이다(주석이 옛 값으로 남음 — 코드를 신뢰).

---

## 5. NaN/inf JSON 직렬화 500

응답에 NaN/inf 가능 float를 싣는 엔드포인트는 NaN/inf를 가드해야 한다. starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 직렬화에서 **500**(`Out of range float values are not JSON compliant`). 폴백이 *다르게* 가린다: PostgreSQL은 `json` 컬럼에 NaN을 거부(저장 실패)하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과 → DB저장 실패·파일 성공·응답 직렬화 실패로 증상이 엇갈려 진단이 늦어진다. 외부 시세(yfinance `Close`가 NaN, FX/usdkrw가 NaN)에서 흘러든 NaN이 합산값(`total_value` 등)을 오염시키는 게 전형. **가드는 소스에서**(`math.isfinite` 체크 후 "시세 없음" 처리)가 출력 일괄 sanitize보다 깨끗. (다이제스트 생성 500 사례 8cd70a42.) 프론트 표시는 `fmtPrice` NaN 가드(`.forge/retro/2026-06-20-fmtprice-nan-guard.md`)로 보강.

---

## 6. 종목명 dual-source (목록↔상세 불일치)

`tickers.name`(공유 마스터, 종목관리 목록이 live로 읽음) vs `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세가 읽음). 이름 변경 시 **둘 다** 갱신해야 일치(`storage.refresh_snapshot_names` 단건 / `reconcile_snapshot_names` 전체). DB만 바꾸면 리포트 목록 캐시(`cache.get_list`)·스냅샷 LRU 탓에 화면 미반영 → `cache.invalidate(ticker)`+`invalidate_list()` 필수(storage→cache는 함수 내 지연 import로 순환참조 회피).

**클로버 방지 가드**(task#77): `save_holdings`/`save_stocks`의 tickers UPSERT는 들어온 name이 NULL/빈값/티커와 같으면 기존 `tickers.name` 보존(`name=CASE WHEN EXCLUDED.name IS NULL OR EXCLUDED.name = EXCLUDED.ticker THEN tickers.name ELSE EXCLUDED.name END`). 일일 배치는 `resolve_name`으로 ticker형 이름이면 quote 실명을 박제해 "고쳐도 다음날 또 종목번호" 재발 방지(task 41, `.forge/retro/2026-06-20-stock-name-ticker-revert-fix.md`).

**조용한 스킵 함정**: `POST /api/stocks/names/backfill`(admin)은 시세 일시실패 시 그 종목을 재시도 없이 조용히 스킵(`updated:0`) → 결과 0이면 재실행. 응답 `skipped` 목록 + 서버 skip 진단 로그로 어느 종목이 빠졌는지 확인(task#88, `.forge/retro/2026-06-20-name-backfill-skip-logging.md`).

---

## 7. 외부 API 키 미설정 시 동작 (보안·휴면)

키는 `backend/.env.docker`(gitignore)에만 둔다. 미설정 시 동작이 갈린다:
- **안전 휴면(기존 동작 무변화)**: KIS(`KIS_APP_KEY`/`KIS_APP_SECRET`, `configured()` False면 백업 소스 비활성), 코드 먼저 머지해도 무해(ADR-0011).
- **수집 실패(저장값 무변경)**: FRED 매크로 신호(`FRED_API_KEY`, `macro.py`), KR 배당(`DART_API_KEY`, `dividends.py`).
- **요청 실패**: 레버리지/대차(`KOFIA_API_KEY`, `leverage_service.py`·`lending_service.py`).
- **공개 API 폴백**: `KITA_API_KEY`(실제로는 관세청 키)는 미설정 시 UN Comtrade 공개 API로 자동 폴백.

토큰 발급 함정: KIS는 1분당 1회 EGW00133 방어로 강제 재발급 60s 가드(`kis/client.py`), 키움은 인프로세스 싱글톤·401시 재발급 재시도(`kiwoom/client.py`). 백엔드에 **LLM/Anthropic 호출 없음**(`requirements.txt`에 anthropic 없음) — `ANTHROPIC_API_KEY`는 `.env.docker`에 남았으나 미사용. AI 텍스트는 외부 Cowork가 enrich API로 작성.

---

## 8. 로컬 .venv ≠ Docker 의존성 (lxml)

`lxml`은 `requirements.txt`에 있고 Docker 이미지엔 설치되지만 **로컬 `backend/.venv`엔 없다**. 로컬 pytest로 검증할 HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 stdlib `BeautifulSoup(html, "html.parser")` 사용(로컬·프로덕션 모두 동작). 로컬에서만 필요하면 `.venv`에 직접 설치. → 로컬 그린이 프로덕션 동작을 보장 못 하는 환경 드리프트.

---

## 9. 수주잔고 DART 단위 캡션 ×100 오저장 (wrong < missing)

`backend/services/backlog.py` — DART엔 수주잔고 전용 API가 없어 공시서류원본파일 `/api/document.xml`(ZIP→전 멤버 디코드) 원문을 파싱한다. 헤더 컬럼 매핑(`_expand_grid` rowspan/colspan 전개)으로 금액을 뽑아 `수주총액−기납품≈잔고` 상대 1% 검산 통과 시 `source='dart'`·억원 정규화 저장, 실패·다중엔티티·외화·무합계는 `source='pending'`(amount=None)으로 두고 Cowork(`PUT /api/report/{ticker}/backlog`)가 채운다.

**핵심 위험**: 단위 캡션(`(단위 : USD천)` 등) 파싱 실패 시 '안전한 기본값(억원)' 폴백은 ×100 대형 오저장을 만든다. 추출 실패는 기본값이 아니라 **pending(누락)**으로 처리할 것 — 'wrong < missing'. **fixture 단위 테스트가 전부 통과해도 운영 재적재 UAT 필수** — fixture에 없던 실데이터 케이스(외화·단위 캡션 줄바꿈 분리·연결 전 분기의 회사컬럼 표)를 운영 재적재가 잡는다. KR 전용·`DART_API_KEY` 필수.

차트 단위 함정도 동류: `frontend/src/components/market/marketUtils.jsx`의 `krFmt`는 입력을 '억원' 단위로 가정 — raw 원/주를 그대로 넘기면 1e8배 오표기("35조경원" 사례 f9594f2b).

---

## 10. API 문서 drift 자동검출 (task#99·100)

`backend/tests/test_api_doc_sync.py` — 라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 `### \`METHOD /path\`` 헤더를 대조해 **엔드포인트 *존재* drift**(method+path 추가/삭제/개명)를 자동검출한다. `KNOWN_UNDOCUMENTED = frozenset()`(`test_api_doc_sync.py:49`) — **베이스라인 0**(미문서화 23개를 task#100에서 전수 문서화 완료). 새 엔드포인트를 `API_SPEC.md`에 안 적으면 테스트 실패; 라우터에서 사라졌는데 allowlist에 남으면 stale로 실패(`:55~61`).

**여전히 수동 DoD**: 요청/응답 스키마·인증 게이팅 동기는 테스트가 *존재만* 검증하고 prose를 파싱하지 않으므로 수동으로 두 명세서를 함께 갱신해야 한다. **doc-sync 3표면 규칙**: API 변경 시 `API_SPEC.md` + `CLAUDE_COWORK_API.md` 둘 다, 기능 표면(화면·env·스택·아키텍처·배치) 변경 시 `README.md` 해당 절도 같은 PR에서(README는 overview 레벨이라 엔드포인트 세부는 중복 금지).

---

## 11. 배포·운영 함정

### 11.1 자동배포 폴러가 미커밋 tracked 편집 삭제
launchd `com.portfolion.auto-deploy-poll`이 2분마다 `scripts/auto-deploy-poll.sh`로 `origin/main`이 로컬 HEAD보다 앞서면 `git reset --hard origin/main` 후 배포한다. → 메인 체크아웃에서 **커밋 안 한(또는 push 안 해 로컬이 origin보다 앞선) tracked 편집은 다음 폴(≤2분)에 소실**된다. 코드 변경은 commit과 `git push origin main`을 묶어 즉시 반영. `.forge/` 등 untracked 파일은 reset --hard 대상이 아니라 안전. (`.forge/retro/.../project-deploy-poller-wipes-local-edits` 참조.)

### 11.2 프론트/백엔드 배포 시점 불일치
nginx가 `./frontend/dist`를 `:ro`로 직접 서빙 → 로컬 `npm run build`가 즉시 라이브. 그러나 **백엔드 변경은 폴러 재배포 후에야 라이브** — 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작한다. `docker compose build`/`up` 수동 재빌드 금지.

### 11.3 라우팅 순서 의존
`PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 **먼저** 등록해야 FastAPI가 `enrich`를 ticker 값으로 라우팅하지 않는다.

---

## 12. 배치-백킹 뷰 라이브 호출 금지 (성능)

랭킹·KR 업종 모멘텀 등 배치-백킹 뷰는 외부 API(키움)를 **요청·기동 경로에서 라이브 호출하지 말 것** — 배치가 사전계산해 `market_cache`/테이블에 저장하고 요청은 저장값만 읽는다(요청당 N콜 직렬=수초 지연; task#50). 외부 fetch는 ① 실패를 조용히 삼키지 말고 로깅(silent except는 진단 불가 — task#48 `_fetch_one_sector`가 빈 종가 삼켜 all-None 박제), ② 빈/all-None 결과를 캐시에 박제 금지(전부 None이면 save 생략·직전 양호값 유지). **의심 트리거(base_dt 등)가 아니라 실패 클래스(all-None)를 가드**해야 근본원인 미상이어도 재발을 막는다. 기동 시 빈 캐시 적재는 `_seed_*_if_empty` 패턴(랭킹·kr_sector). (task#48→#49→#50 3-타석.)

---

## 13. 계약/리셰이프 푸트건

### 13.1 비-additive 응답 reshape는 프론트 전수 grep
엔드포인트 응답을 배열→객체 등으로 바꾸면 그 엔드포인트를 fetch하는 *모든* 프론트 소비처를 `grep -rn '<경로>' frontend/src/`로 전수 찾아 갱신. 한 소비처만 고치면 다른 곳(예: `Analytics.jsx`가 훅과 별개로 `/api/stocks/dashboard`를 직접 fetch)이 옛 형태로 취급해 조용히 깨진다(task52). **additive(필드 추가) 선호**, reshape 불가피 시 소비처 전수 감사를 DoD에.

### 13.2 additive 호출 추가는 `mock.call_args` 테스트 오염
엔드포인트에 read/외부호출을 additive로 추가하면 마지막 호출 인자를 `mock.call_args`로 단언하던 기존 테스트가 조용히 오염된다(호출 시퀀스가 늘어 마지막 호출이 신규 호출로 바뀜). 대응: ① 기존 단언은 `call_args_list[i].kwargs`(인덱스 명시)로 마이그레이션, ② 신규 호출은 입력 비면 `if`로 생략, ③ 신규 테스트가 `call_count`로 시퀀스 못박음(task#66·67).

### 13.3 배치 id 은퇴 시 4표면 전수 grep
`batch_registry.BATCHES`에서 id를 빼면 ① 데이터 read(스케줄 소비처), ② 표시 문자열(`schedule_desc`), ③ `job_runs.record(id, ...)` 모든 lane(auto·manual·backfill), ④ 그 id를 단언하는 테스트를 전수 grep. 한 곳이라도 옛 id면 stale read·배치 현황 실행이력 증발 회귀·고아 run 누적. 옛 id를 단언하던 테스트는 깨진 동작을 고정하므로 id 은퇴 시 테스트도 grep 대상. 단, 옛 id를 *읽는* 시드 마이그레이션은 정당한 잔존. fetch 소스를 바꾸면 `batch_registry`의 `source`도 갱신(DoD).

---

## 14. UI 색 토큰 반전 위험 (KR 가격색 관례)

이 앱은 `--up`=빨강(상승)·`--down`=파랑(하락, `frontend/src/styles/tokens.css`)이라 `.badge--success`=빨강·`.badge--danger`=파랑(`ui/Badge.css`). **가격 방향이 아닌 의미 상태 배지(수급 밴드 등)에 success/danger를 쓰면 색이 KR 가격색으로 박혀 Western(녹=좋음/빨=경고) 의도와 반전**된다(수급 배지 우호=빨·경계=파 버그, 라이브 UAT 포착 b288f494, `.forge/retro/2026-06-20-kr-color-convention-semantic-tokens.md`). 의미 배지는 `ui/SupplyBadge.jsx`처럼 전용 색을 명시(가격 토큰 미사용). UI 리뷰도 variant 이름 통념이 아니라 토큰 실제값을 대조해야 한다. `warning` 변형은 `--color-warning`/`--warning-tint` 미정의로 **현재 깨져 있어** caution 색으로 못 쓴다.

---

## 15. 기타 취약·드리프트 가능 영역

- **공시 피드 vs 코멘터리 dual store**: `stock_disclosures`(자동 DART 목록, `disclosures.py`) ≠ `tickers.recent_disclosures`(Cowork 애널리스트 코멘터리, enrich). disclosures 서비스는 `recent_disclosures`를 절대 덮지 않는다. DART `list.json`은 `pblntf_ty`를 echo하지 않아 핵심유형 A·B·C·D를 각각 개별 호출해 stamp(종목당 4콜).
- **Vite 8 = rolldown 번들러**: `vite.config.js`의 `manualChunks`는 **함수 형식만** 받는다 — 객체형은 `Expected Function but received Object`로 빌드 깨짐(task 28). 거대 의존성(recharts+d3)은 트랜지티브까지 매처에 포함해야 의도한 청크 생성.
- **매크로 용어 혼동**: 매크로 신호(FRED 거시 시계열, `macro.py`/`GET /api/market/macro-signals`) ≠ 매크로 상관(`analysis_service.py`/`GET /api/analysis/macro-correlation`, 보유 종목-매크로 자산 90일 상관). 서로 다른 서비스·엔드포인트·화면.
- **인메모리 캐시 무효화 누락**: `cache.py` 6종(snapshot LRU 200·list TTL 5s·dashboard/correlation/sector/macro TTL 300s). 종목 추가/수정/삭제 시 dashboard·correlation·sector·macro 자동 무효화에 의존 — 새 mutation 경로 추가 시 무효화 누락이면 stale 표시.
- **calendar 파일 캐시**: `backend/data/calendar/YYYY-MM.json`(gitignored). 종목 add/remove/promote 시 자동 클리어에 의존. yfinance 호출 ThreadPoolExecutor max 30 — 풀 경합 잠재(§4와 동류).
- **프로덕션 쓰기는 사용자 경유**: prod DB/컨테이너 쓰기·읽기·settings 자가권한이 전부 분류기 차단 — admin 엔드포인트나 사용자 `!` 실행으로, 종단은 사용자 화면 확인(`reference-prod-writes-need-user`).
