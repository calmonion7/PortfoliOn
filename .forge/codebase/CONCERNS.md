---
last_mapped_commit: f835958b49b4a4d7ce30254fd610ed6362462311
mapped: 2026-06-22
---

# CONCERNS

PortfoliOn의 기술 부채·기지 버그·보안 민감 지점·성능 위험·취약 영역. 1차 출처는 루트 `CLAUDE.md`의 "Gotchas" 절과 `.forge/retro/`(반복 파손 이력)이다. 본 문서는 구현 사실과 위험만 다루며, 도메인 용어 정의는 `CONTEXT.md` 소관이다.

---

## 1. KR 시세 발산 가드 (가장 자주 깨진 영역)

핵심 파일: `backend/services/market/kr.py`.

### 1.1 근본 문제 — NXT `_AL` 순간 이상체결
키움 통합코드 `{종목}_AL`(SOR/NXT 시간외)이 순간적으로 정상가의 1/5~1/N 짜리 이상체결을 반환할 때가 있고, 이 값이 일배치에 그대로 박제되면 리포트/대시보드에 깨진 현재가(예: 005930이 ~70k로 박제, 실값 354k의 1/5)가 남는다. 영속 소스 버그가 아니라 *일시적* 글리치이므로 "소스부터 고치는" 접근은 오진이다(task#94 근거).

### 1.2 방어 메커니즘 — 독립 피드 2-of-N 다수결 (task#98, 최신)
- `_corroborated_pick(feeds)` (`kr.py:124`): 순수 함수. 독립 현재가 피드들 중 어떤 피드 가격이 *다른* 피드 ≥1개와 2배 범위(`[0.5, 2.0]`) 이내로 합의하면 trusted로 보고, trusted 중 우선순위 최상위(rank 최소)를 반환. 합의 쌍이 없으면 None. rank 순서 = 반환 우선순위(키움 NXT 0 → KIS 1 → Naver 2 → 키움 KRX 3).
- `_kr_pick_basic(ticker, ref_close, regular)` (`kr.py:178`): 코드 단일 분기점.
  - `regular=True`(리포트 스냅샷, KRX 정규장, ADR-0020) → `_kr_pick_regular`: 키움(KRX)→KIS→Naver 첫 유효 + `_price_sane`. 다수결 미적용(이미 KRX 정규장가).
  - `regular=False`(NXT 라이브 대시보드) → 다수결. 평소엔 키움 NXT + 키움 KRX 2콜만 fetch(lazy, KIS/Naver 미호출). NXT≈KRX 합의면 NXT 반환. **불일치(disagreement)** 시에만 KIS·Naver를 escalate해 최대 4피드 다수결로 outlier(글리치) 폐기.
- `_kr_pick_degenerate_lazy` (`kr.py:159`): 키움 부재/단일(글리치 아닌 **outage**) 또는 전 피드 합의 불가 시 폴백 — NXT→KIS→Naver→KRX 첫 `_price_sane` 반환(±30% self-check). 단일 자기일관 글리치는 못 잡음(wrong<missing floor).
- `_price_sane(price, prev_close, ref_close)` (`kr.py:106`): ① 전일종가 ±30%(KR 일일 가격제한폭), ② 키움 일봉 종가의 `[0.5, 2.0]`. 참조가 무효(None/≤0)면 해당 검증만 생략.

### 1.3 잔존 위험 / 취약점
- **불일치 vs 부재 구분이 핵심** (retro `2026-06-22-kr-quote-majority-guard.md`): 둘 다 "합의 실패"지만 처리가 정반대다. 불일치=글리치 신호라 escalate+다수결, 부재=단순 장애라 lazy short-circuit. 이 구분을 안 하면 비용목표(평소 2콜)가 깨지고 기존 lazy 테스트(`test_get_quote_kr_uses_kis_when_kiwoom_fails`)가 깨진다. (additive read가 mock.call_args 시퀀스를 오염시키는 가토의 실사례.)
- **단일 피드 자기일관 글리치 면역 불가**: NXT 70k인데 KRX도 동시 down이면 2nd 피드가 없어 다수결도 무력. 본질적 한계지 버그 아님.
- **시세 기준 이원화** (ADR-0020): 리포트 스냅샷=KRX 정규장(`regular=True`), 라이브 대시보드=NXT(`regular=False`). 같은 종목이 리포트(354k)와 대시보드(350.5k)에 ~1% 다른 현재가를 보이는 건 의도된 기준 차이다.
- **stale 스냅샷 비소급**: fix 배포는 이미 박제된 70k 스냅샷을 치료하지 않는다. 재생성해야 KRX로 덮인다(재생성 전 프로브로 라이브 소스 깨끗 확인 → transient 재박제 방지).
- **`regular=True` opt-in 배선**: 리포트 writer만 opt-in. `backend/services/report_generator.py:70,75,82,243,262`, `backend/routers/report.py:445`. RSI(weekly/monthly_df)·대시보드(`get_quotes_batch`)·종목추가·`resolve_name`은 NXT 기본 유지. `get_quote` TTL 캐시 키에 `regular` 포함(정규장/NXT 충돌 방지).
- **시세 소스 ≠ 차트 소스 스케일 어긋남**: 리포트 현재가 마커는 `get_quote_kr`(키움 ka10001), 매물대/RSI는 `get_history_df`(키움 ka10081 일봉). 다른 TR이라 한쪽만 액면/병합 조정되면 최대 5배 어긋나 차트가 "깨져" 보인다 — 표시 버그가 아니라 박제 price를 의심할 것.

---

## 2. admin scope=all 액션버튼 leak (task#97)

핵심 파일: `backend/routers/report.py`, `backend/routers/admin.py`, 프론트 `frontend/src/components/reports/StockCard.jsx`·`TickerListItem.jsx`.

- **근본 문제**: `report.py:_mk_entry`(`report.py:207`)는 admin `scope=all` 목록에서 비소유 종목(`is_mine=false`)에도 `category`("holdings"/"watchlist")를 글로벌 포트폴리오 멤버십 기준으로 무조건 붙인다(`report.py:216`). 그래서 category로만 게이트된 관리 버튼(수정·승격·삭제)이 남의 종목(리서치 "그외" 탭)에도 노출됐고, 그 핸들러는 호출자 본인 user_stocks만 보는 user-scoped 엔드포인트(`/api/watchlist|portfolio/{ticker}`)라 **404로 조용히 깨졌다**(증상="관심 목록에 없다").
- **수정**: ① 액션 버튼 가시성은 category가 아니라 `is_mine`으로 게이트(`StockCard.jsx:99`, `TickerListItem.jsx:103` — `is_mine===false`면 삭제만 노출, 수정/승격 숨김). ② 관리자 교차-사용자 삭제는 `/api/admin/stocks/{ticker}` 전용(`admin.py:105`, `require_admin`, `DELETE FROM user_stocks WHERE UPPER(ticker)=%s` — 전 사용자·보유/관심 양쪽 제거, 스냅샷은 고아로 유지, idempotent).
- **취약점**: 버튼 블록은 **두 렌더러**(`StockCard` 그리드 + `TickerListItem` 사이드바)에 동일하게 존재한다. 한쪽만 고치면 다른 화면에서 깨진 채 남으므로 액션/버튼 변경은 항상 둘 다 수정해야 한다.

---

## 3. NaN/inf → JSON 직렬화 500

- starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 **500**(`Out of range float values are not JSON compliant`).
- **폴백이 증상을 엇갈리게 가린다**: PostgreSQL `json` 컬럼은 NaN을 거부(저장 실패)하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과 → DB저장 실패→파일 성공→응답 직렬화 실패로 진단이 늦어진다.
- **소스 가드가 정답**(출력 일괄 sanitize보다 깨끗): `backend/services/digest_service.py:42-44,61` — yfinance NaN 종가·NaN usdkrw를 `math.isfinite` 체크 후 "시세 없음"/기본값 처리. 일괄 sanitize 헬퍼는 `backend/services/utils.py:29` `sanitize()`(재귀적 NaN/inf→None).
- 프론트 사촌(별개 관심사): `frontend/src/utils.js` `fmtPrice`가 `!Number.isFinite(Number(val))`로 `₩NaN`/`$NaN` 노출 차단(retro `2026-06-20-fmtprice-nan-guard.md`).

---

## 4. DB 풀 sizing vs ThreadPool 동시성

핵심 파일: `backend/services/db.py`, `backend/services/parallel.py`.

- `_get_pool()`(`db.py:21`): `ThreadedConnectionPool(minconn=1, maxconn=20)`. **psycopg2 풀은 소진 시 블록이 아니라 `PoolError`를 던진다** — 따라서 maxconn은 최대 ThreadPool 동시성보다 크게 유지해야 한다(주석 `db.py:23-24`).
- 동시성 소비처: `calendar`(ThreadPoolExecutor max 30), `analysis`(11), `parallel_map`(default `max_workers=10`, `parallel.py:5`), `ranking_service`(`max_workers=12`, `ranking_service.py:110`). maxconn=20 < calendar 30이므로 calendar 풀파이프에서 동시성이 풀 한도를 넘으면 `PoolError` 위험 존재. ThreadPool 워커 수를 늘릴 때 maxconn 동반 조정 필요.

---

## 5. 배치 all-None 캐시 박제 방지

배치-백킹 뷰(랭킹·KR 업종 모멘텀)는 외부 API(키움)를 *요청/기동 경로*에서 라이브 호출하지 말 것(요청당 N콜 직렬=수초 지연). 배치가 사전계산해 `market_cache`/테이블에 저장하고 요청은 저장값만 읽는다.

- **빈/all-None 결과를 캐시에 박제 금지**: `backend/services/kr_sector_service.py:73-81` — 전 sector 모멘텀이 None이면(ka20006 빈 종가 케이스) `save`를 생략해 직전 양호값 유지. "의심 트리거(base_dt)가 아니라 *실패 클래스(all-None)*를 가드"가 원칙.
- **실패를 조용히 삼키지 말 것**: `ranking_service.py:115-121` — 페이지 fetch 실패 시 silent except가 아니라 stderr 로깅 + 일부 페이지 실패면 `RuntimeError`로 incomplete 차단(빈 캐시 박제 방지). (과거 task#48 `_fetch_one_sector`가 빈 종가를 삼켜 all-None 박제 → task#49 기동시드가 증폭한 3-타석 교훈.)
- 기동 시 빈 캐시 적재는 `_seed_*_if_empty`(랭킹·kr_sector) 패턴.

---

## 6. dual-source 종목명 (tickers.name vs snapshots.data.name)

- `tickers.name`(공유 마스터, 종목관리 목록이 live로 읽음) vs `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세가 읽음). 이름 변경 시 **둘 다** 갱신해야 목록↔상세 일치: `backend/services/storage/names.py:17` `refresh_snapshot_names`(단건) / `:34` `reconcile_snapshot_names`(전체).
- DB만 바꾸면 리포트 목록 캐시(`cache.get_list`)·스냅샷 LRU 탓에 화면 미반영 → `cache.invalidate(ticker)`+`invalidate_list()` 필수(storage→cache는 함수 내 지연 import로 순환참조 회피).
- **클로버 방지 가드**(task#41/77): `backend/services/storage/portfolio.py:58,124`의 tickers UPSERT는 들어온 name이 NULL/빈값/티커와 같으면 기존 `tickers.name` 보존(`name=CASE WHEN EXCLUDED.name IS NULL OR EXCLUDED.name = EXCLUDED.ticker THEN tickers.name ELSE EXCLUDED.name END`). 실명은 `market.resolve_name`(`backend/services/market/__init__.py:46`)이 quote에서 채운다.
- **백필 silent skip**: `POST /api/stocks/names/backfill`(admin)는 시세 일시실패 시 그 종목을 재시도 없이 조용히 스킵(`updated:0`). 결과 0이면 재실행 필요(응답 `skipped` 목록 + 서버 skip 진단 로그, task#88).

---

## 7. 외부 API 키 미설정 시 휴면 (안전 기본값)

- **키 미설정 = 휴면(기존 동작 무변화)**: 코드 먼저 머지해도 무해. `backend/services/kiwoom/client.py:34` `configured()`(KIWOOM_APP_KEY/SECRET_KEY), `backend/services/kis/client.py:37` `configured()`(KIS_APP_KEY/APP_SECRET). False면 해당 소스 None 반환 → 폴백 체인 그대로 진행.
- 키 미설정 시 수집 실패(저장값 무변경)인 서비스: `FRED_API_KEY`(macro/econ), `KOFIA_API_KEY`(leverage/lending), `DART_API_KEY`(backlog/disclosures/dividends KR), `KITA_API_KEY`(관세청, 미설정 시 UN Comtrade 폴백).
- **토큰 발급 방어**: KIS는 발급 1분당 1회 제한(EGW00133)에 강제 재발급 60s 가드, 키움/KIS 둘 다 401 시 재발급 재시도(인프로세스 싱글톤).

---

## 8. 로컬 .venv ≠ Docker 의존성 (lxml)

- `lxml`은 `requirements.txt`에 있고 Docker 이미지엔 설치되지만 **로컬 `backend/.venv`엔 없다**. 로컬 pytest로 검증할 HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 stdlib `BeautifulSoup(html, "html.parser")`를 써야 로컬·프로덕션 모두 동작.
- 현 코드는 전부 `html.parser` 사용: `backend/services/backlog_parser.py:231,294,315`, `backend/services/guru_scraper.py:56,79`, `backend/services/scraper.py:19`, `backend/services/market_indicators/earnings.py:53`. (`backlog_parser.py:14`는 `XMLParsedAsHTMLWarning`을 import해 document.xml을 html.parser로 파싱하는 경고를 억제.)

---

## 9. 데이터 파싱 취약 — 수주잔고(backlog) DART 단위 캡션

핵심 파일: `backend/services/backlog_parser.py`, `backend/services/backlog.py`.

- **단위 캡션 실패 시 ×100 오저장 위험**: 안전한 기본값(억원) 폴백은 백만원·USD천 등을 억원으로 오인해 ×100 대형 오저장을 만든다. 원칙은 **'wrong < missing'** — 추출 실패는 기본값이 아니라 pending(amount=None)으로 둔다.
- `_table_unit(table)` (`backlog_parser.py:211`): 표 직전 '(단위 ...)' 캡션에서 KRW 토큰만 추출. **캡션이 있으나 KRW 토큰이 없으면(USD천·백만달러·줄바꿈 분리) '기타'(비KRW)를 반환해 자동추출을 막는다.** `_EOK_FACTOR`(`:29`)로 억원 정규화(조원×10000, 백만원×0.01, 천원×1e-5, 원×1e-8).
- `_parse_susu_table` (`:161`): 외화(비KRW)/다중엔티티/빈셀/검산불일치(상대 1%, `_reconcile` `:188`)/무합계 다중행은 None(→pending). 검산 통과 시에만 `source='dart'`로 자동 저장.
- `_save_pending` (`backlog.py:216`): 추출 실패 분기를 pending으로 저장하되 **기존 채워진 값(llm/dart)은 보존**(amount는 SET 절에 없어 절대 덮어쓰지 않음 — 주간 배치가 Cowork 수치를 null로 덮던 동작 방지).
- **배포 후 전 종목 재적재 UAT 필수**: fixture 단위 테스트가 전부 통과해도 운영 재적재가 fixture에 없던 실데이터(외화 캡션·단위 줄바꿈 분리·연결 전 분기 회사컬럼 표)를 잡아낸다.
- 구조적 제약: DART엔 수주잔고 전용 API가 없어 `/api/document.xml`(ZIP→전 멤버 디코드) 원문을 받아 헤더 컬럼 매핑(`_expand_grid` rowspan/colspan)으로 추출한다. KR 전용.

---

## 10. 기타 취약/주의 영역

- **API 명세서 2개 + README 동기 갱신(DoD)**: 엔드포인트/스키마/인증 게이팅 변경 시 `API_SPEC.md` + `CLAUDE_COWORK_API.md` 항상 함께. 기능 표면(화면·env·스택·아키텍처·배치) 변경 시 `README.md` 해당 절도 같은 PR에서. 한쪽만 고치면 Cowork/소비자가 stale 명세로 호출.
- **비-additive reshape는 소비처 전수 grep**: 엔드포인트 응답을 배열→객체 등으로 바꾸면 `grep -rn '<경로>' frontend/src/`로 독립 fetcher까지 전수 갱신(예: `Analytics.jsx`가 훅과 별개로 `/api/stocks/dashboard` 직접 fetch — task#52에서 조용히 깨짐). 가능하면 additive 선호.
- **additive read 추가가 mock.call_args 시퀀스 오염**: 응답 shape뿐 아니라 호출 시퀀스도 늘어난다. 기존 `mock.call_args`(마지막 호출) 단언이 거짓통과/오류 → `call_args_list[i].kwargs`로 마이그레이션 + 신규 호출은 입력 비면 `if` 가드로 생략(task#66/67).
- **FastAPI 라우트 순서**: `PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 **먼저** 등록(아니면 `enrich`가 ticker로 라우팅). `GET /{ticker}/backlog`가 catch-all에 가려 500났던 사례도 동류(라우트 순서 버그).
- **FastAPI Body 파라미터**: PUT/POST에서 bare list/dict는 `Body(...)`로 명시 필수(미명시 시 재빌드 후 기동 불가 — PR #12).
- **배치 id 은퇴 시 전 표면 grep**: `batch_registry.BATCHES`에서 id 제거 시 ① 데이터 read ② 표시 문자열 ③ `job_runs.record` 전 lane(auto/manual/backfill) ④ 테스트까지. 한 곳이라도 옛 id면 stale read·배치 현황 실행이력 증발 회귀(daily_report split task#15/17/45 반복). 단 옛 스케줄 행→신규 id 승계 마이그레이션 read는 정당한 잔존.
- **배치 `source` 필드 동기**: fetch 소스 변경 시 `batch_registry`의 그 배치 `source`도 갱신(DoD). `source`(데이터 출처) ≠ `usage`(소비 UI).
- **KR 색 관례 토큰 반전 위험**: `--up`=빨강(상승)·`--down`=파랑(하락)이라 `.badge--success`=빨강·`.badge--danger`=파랑. 의미 상태 배지(수급 밴드 등)에 success/danger를 쓰면 Western 의도와 반전 → `frontend/src/components/ui/SupplyBadge.jsx`처럼 전용 색 명시. `warning` 변형은 `--color-warning`/`--warning-tint` 미정의로 깨져 있음.
- **자동 배포 폴러가 로컬 편집 삭제**: launchd `com.portfolion.auto-deploy-poll`이 2분마다 `origin/main`이 앞서면 `git reset --hard`. 메인 체크아웃의 커밋/push 안 한 tracked 편집은 ≤2분에 소실. commit+push를 묶어 즉시 반영, 수동 `docker compose build/up` 금지(`.forge/` 등 untracked는 안전).
- **백엔드 LLM 호출 없음**: `report_generator`는 시장 데이터 스냅샷만 생성, AI 텍스트는 외부 Cowork가 enrich API로 작성(`requirements.txt`에 anthropic 없음). `ANTHROPIC_API_KEY`는 `.env.docker`에 남아있으나 현재 미사용.

---

## 11. 미확인/검증 필요 잔존 (MEMORY.md)

- **JS 404 에러**(`project-js-404.md`): 배포 후 브라우저 콘솔에 404 리소스 요청 1건, 기능 영향 없으나 원인 미확인.
- **PC OAuth SW 수정**(`project-oauth-sw-fix.md`): SW navigate가 OAuth callback 가로채는 버그, 472cea0 배포됨, PC 테스트 미완.
- **발굴 저유동성 필터**(task#68): main 배포·테스트 green이나 라이브 행동 확인 미완(배치 재계산 선행 필요).
- **KIS 백업 시세 소스**: 코드 머지됐으나 키 재발급·`.env.docker` 주입 대기(키 없으면 휴면).
