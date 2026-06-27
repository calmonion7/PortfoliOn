---
last_mapped_commit: f1839804fa84342f9e30cc6dc919d5e5abba7b8d
mapped: 2026-06-28
---

# CONCERNS — 기술 부채·취약 표면·알려진 위험

PortfoliOn 코드베이스의 정합성·견고성·보안·성능 위험과 외부소스 파싱 함정을 한곳에 모은 지도다. 각 항목은 라이브 코드 확인 기준이며, **최근 수정된 항목은 "[해결됨]"으로 표시**하고 미수정 위험과 구분한다. 상세 원시 목록은 `/Users/calmonion/Project/PortfoliOn/.forge/bug-report.md`(task#107, 42건 검증)에 있고, 이 문서는 그 위에 "지금 무엇이 닫혔고 무엇이 열려 있는가"를 정리한다.

---

## 1. NaN/inf 직렬화 500 (starlette `allow_nan=False`)

starlette `JSONResponse`는 `allow_nan=False`라 응답 dict 어디든 `NaN`/`inf` float가 있으면 직렬화에서 HTTP 500(`Out of range float values are not JSON compliant`)이 난다. 외부 시세(yfinance `Close`가 NaN, FX/usdkrw가 NaN 등)에서 흘러든 비유한값이 합산값을 오염시키는 게 전형. PostgreSQL `json` 컬럼은 NaN을 거부(저장 실패)하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과 — DB저장 실패↔파일 성공↔응답 직렬화 실패로 증상이 엇갈려 진단이 늦어진다.

**공통 안전망**: `/Users/calmonion/Project/PortfoliOn/backend/services/utils.py`의 `sanitize(obj)`가 dict/list를 재귀 순회하며 NaN/inf float를 `None`으로 치환한다. 출처 불문 응답 dict에 씌우는 마지막 가드.

**[해결됨] 대시보드 totals NaN (task#104)**: `/Users/calmonion/Project/PortfoliOn/backend/routers/stocks.py`의 `_usdkrw_rate()`(313–328줄)가 저장 FX의 비유한값을 `math.isfinite` 가드로 `None` 처리한다(이 가드가 없으면 `_portfolio_totals`의 `if fx is None`을 NaN이 통과해 — `NaN≠None` — US totals=NaN→직렬화 500). 또 `_build_all`의 반환을 `sanitize(...)`로 감싼다(494줄). 카드당 throw는 `_safe`→`_minimal_card` 폴백으로 가린다(482–488줄). cold·warm 무관 결정적 500이 닫혔다.

**[해결됨] macro-correlation·recommendations NaN/inf (task#109)**: `/Users/calmonion/Project/PortfoliOn/backend/services/analysis_service.py`의 `get_macro_correlation`이 `corr_val`에 `math.isfinite` 가드(116줄), scatter append 전 `mv`/`pv` isfinite 체크(118–120줄)를 둔다. zero-variance 시리즈의 `corr()`=NaN, zero-price `pct_change()`=inf를 막는다. `/Users/calmonion/Project/PortfoliOn/backend/routers/recommendations.py`는 `import math`(8줄)·snapshot price isfinite 가드(110줄)·최종 반환 `sanitize(...)`(169줄)를 갖춘다.

**가드가 있을 수 있으나 점검 필요한 표면**: 시세/합산을 응답에 싣는 다른 엔드포인트는 sanitize 또는 소스 isfinite 가드가 필수다. 신규 엔드포인트가 외부 시세 float를 sanitize 없이 응답에 실으면 동일 500이 재발할 수 있다. 다이제스트 생성(`backend/services/digest_service.py`)도 과거 NaN으로 500이 난 사례가 있다(commit 8cd70a42) — 가드는 소스에서(예: `math.isfinite` 후 "시세 없음") 하는 게 출력 일괄 sanitize보다 깨끗하다.

---

## 2. KR 시세 소스 분기·다수결 가드, 리포트-박제 vs 라이브-대시보드 기준 분리

KR 시세는 여러 독립 피드(키움 NXT `_AL`·키움 KRX 평문코드·KIS·Naver)에서 오며, 한 피드가 순간 이상체결을 반환하면 그 값이 박제될 수 있다(005930이 ~70k=실값 354k의 1/5로 박제된 사례). 핵심 로직은 `/Users/calmonion/Project/PortfoliOn/backend/services/market/kr.py`에 있다.

**기준 이원화 (task#95, ADR-0020)**: `/Users/calmonion/Project/PortfoliOn/backend/services/kiwoom/client.py`의 `integrated_code(stk_cd, regular=False)`(40줄)가 단일 분기점. 기본 `False`=`_AL`(NXT 시간외), `regular=True`=평문 KRX 코드(정규장). 리포트 스냅샷 writer만 `regular=True`로 opt-in한다 — `/Users/calmonion/Project/PortfoliOn/backend/services/report_generator.py`(70·75·82·263·282줄). 대시보드/종목추가/`resolve_name`은 NXT 기본. 같은 종목이 리포트(354k)·대시보드(350.5k)에 ~1% 다른 현재가를 보이는 건 의도된 기준 차.

**라이브(regular=False) 다수결 가드 (task#98)**: `_kr_pick_basic`(181–218줄)이 독립 피드 2-of-N 다수결을 적용한다. `_corroborated_pick`(127–137줄)은 어떤 피드가 다른 피드 ≥1개와 ±2x([0.5,2.0]) 이내로 합의해야 신뢰하고 우선순위 최상위(키움NXT 0→KIS 1→Naver 2→키움KRX 3)를 반환한다. 평소엔 키움 NXT+KRX 2콜 합의로 끝나고(KIS/Naver 미호출), 불일치 시 KIS·Naver를 escalate해 최대 4피드로 outlier를 폐기한다. 키움 부재/단일(outage)·합의 불가는 `_kr_pick_degenerate_lazy`(162–178줄)가 ±30% self-check로 처리(`_price_sane` 109–124줄).

**리포트 박제-시 독립피드 게이트 (task#101)**: regular=True가 근본해결은 아니다 — KRX 두 TR(시세 ka10001·일봉 ka10081)이 같은 배치 시점에 함께 글리치하는 자기일관 오염엔 면역이 아니다(같은 KRX 피드라 서로 합의). `report_generator.py`(181–199줄)가 저장 직전 KRX와 독립인 네이버 현재가로 price·일봉 기준종가를 2x 교차검증해 어긋나면 박제를 스킵(직전 양호 스냅샷 유지, wrong<missing). 네이버 부재 시 검증 생략, 과거날짜 backfill은 미적용. **단 fix 배포는 이미 박제된 stale 70k를 소급 치료하지 않는다 — 재생성 필요.**

**열린 비효율 (bug-report #14·#22·#31)**: degenerate 경로(218줄)가 escalation에서 이미 얻은 KIS/Naver를 재사용하지 않고 `_kr_pick_degenerate_lazy` 내부에서 다시 호출(165–166줄)해 합의 불가 시 KIS/Naver 이중 HTTP가 난다. 또 escalation 튜플 리터럴(208줄)이 `_kr_basic_kis`/`_kr_basic_naver`를 모두 즉시 평가하므로 — `_kr_basic_naver`는 비-409 HTTP 예외를 전파(55–66줄) — escalation 단계의 네이버 네트워크 오류가 degenerate 폴백 도달 전에 전체 선택을 throw시킬 수 있다(`_kr_basic_kis`는 예외를 잡아 None 반환). 대시보드 핫패스(`get_quotes_batch`)는 이 가드를 안 타며 무변경.

---

## 3. 대시보드 콜드 패스 DB 풀 경합

`GET /api/stocks/dashboard`의 `_build_all`(`/Users/calmonion/Project/PortfoliOn/backend/routers/stocks.py` 472–494줄)은 `ThreadPoolExecutor(max_workers=min(len(holdings), 10))`(490줄)로 카드를 병렬 빌드한다. 각 카드는 `_latest_snapshot`(DB)·`consensus_svc.apply_asof`(DB)·`dividends.get_dividend`(DB)·`supply_score.read_score`(DB)·`insider_trades.compute_net_signal`(DB)로 카드당 다중 DB read를 한다 — 10 워커 × 카드당 N read가 첫 콜드 호출에 풀 경합을 일으킨다.

**풀 sizing**: `/Users/calmonion/Project/PortfoliOn/backend/services/db.py`의 `_get_pool`(16–28줄)은 `minconn=1, maxconn=20`. psycopg2 풀은 소진 시 블록이 아니라 `PoolError`를 던지므로 최대 ThreadPool 동시성(calendar 15·analysis 11)보다 크게 둔다는 주석이 명시. 과거 maxconn이 작았을 때 콜드 첫 호출에 PoolError→500→프론트 silent catch→빈 그리드 증상이 있었다.

**[해결됨, 증상 차단] 빈 그리드 불변식 (task#102/#104)**: `_safe`(482–488줄)가 카드당 throw를 `_minimal_card` 폴백으로 가리고(holdings=N→항상 N카드), 일괄시세 실패도 try/except로 빈 quotes로 진행(474–478줄). 단 근본은 §1의 totals NaN(task#104)이었다 — 이 가드 *위* 단계의 직렬화 500이라 #102가 못 막던 것. 프론트 방어: `Portfolio.jsx`가 `stocks>0`이면 Skeleton·bounded 재시도(최대 3).

**열린 진단 사각 (bug-report #21)**: `_latest_snapshot`(30–53줄)의 `except Exception: pass`(39줄)가 PoolError를 로그 없이 삼켜 snapshot=None으로 카드를 빌드한다 — RSI·목표가·컨센서스가 전부 None인 카드가 200 OK로 내려가도 원인 추적 불가. **열린 프론트 회귀 (bug-report #23·#39)**: self-heal 3회 소진 후 영구 Skeleton(에러 UI 없음), `usePortfolioData.fetchAll` 비-401 네트워크 오류 시 `listLoading=true` 영구 고착.

---

## 4. 인증 공백 (최근 닫힘)·자체-app 테스트 의존성-오버라이드 취약성

**[해결됨] 무인증 mutation 클러스터 + refresh token 회전 (task#108)**: 다음이 모두 인증을 강제하도록 닫혔다(`/Users/calmonion/Project/PortfoliOn/backend/tests/test_security_auth_gaps.py`가 fresh app으로 401 검증).
- `POST /api/report/{ticker}/refresh-analyst` — `backend/routers/report.py:428` `Depends(get_current_user)`
- `POST /api/consensus/{ticker}/backfill` — `report.py:479` `Depends(get_current_user)`
- `POST /api/market/refresh-market` — `backend/routers/market_indicators.py:213` `Depends(require_admin)`
- `DELETE /api/stocks/dashboard/cache` — `backend/routers/stocks.py:248` `Depends(get_current_user)`
- `PUT /api/stocks/{ticker}/enrich` / `enrich/batch` — `stocks.py:237/222` `Depends(require_admin_or_api_key)`

  주: bug-report #7·#8은 `require_admin`을 제안했으나 실제 적용은 `get_current_user`(임의 로그인 사용자 허용)다. #27(enrich가 소유권 검사 없이 공유 `tickers` 필드를 덮음)은 enrich가 admin/api_key 전용으로 좁혀져 일반 사용자 위험은 줄었으나 ticker 소유권 자체는 여전히 미검사.

**[해결됨] refresh token 회전 (task#108)**: `/Users/calmonion/Project/PortfoliOn/backend/services/auth_service.py`의 `consume_refresh_token`(115–130줄)이 사용 즉시 `DELETE`(129줄)로 1회용 폐기한다 — 탈취 토큰 재사용을 막는다(테스트 `test_consume_refresh_token_is_one_time`).

**자체-app 테스트 의존성-오버라이드 취약성 (task#108 가토)**: 다수 테스트가 `conftest`의 `client`가 아니라 모듈 상단에서 `FastAPI()`를 직접 만들어 `app.dependency_overrides[...]`로 auth를 우회한다(예: `test_stocks_router.py`·`test_consensus_router.py`). conftest는 `main.app`의 `get_current_user`만 override하므로 자체-app 테스트엔 안 걸린다. **엔드포인트에 auth `Depends`를 추가/변경하면 그 경로를 호출하는 자체-app 테스트가 401/403으로 깨진다** — 새 의존성의 override를 전수 추가해야 한다(`app.dependency_overrides[require_admin_or_api_key] = lambda: "test-user-id"` 등). 무인증 거부 검증은 override 없는 fresh app으로 별도(`test_security_auth_gaps.py` 패턴).

**열린 OAuth 위생 (bug-report #36)**: `/Users/calmonion/Project/PortfoliOn/backend/routers/auth.py`의 모듈 레벨 `_oauth_codes` dict(24줄)는 120초 TTL이나 만료 엔트리 sweep이 없어 토큰 교환 없이 끝난 OAuth 로그인이 무한 누적(메모리 누수). `id_token` 서명 미검증은 server-side authorization code flow(서버가 TLS+CA 검증으로 직접 토큰 교환)라 실질 결함 아님으로 기각됨.

---

## 5. 외부소스 파싱 취약성 (모킹 단위테스트가 못 잡음, 라이브 재적재에서만 드러남)

외부소스(yfinance/DART/Naver/공공데이터포털) 응답 파싱은 라벨·필드 규칙이 미묘하게 다르고, fixture를 mock한 단위테스트는 라이브 데이터 케이스를 못 잡는다. **외부소스 파싱 슬라이스는 라이브 1종목 추출 대조를 DoD에 넣을 것**(task#111/#117에서 fixture 통과·실데이터 실패가 반복).

**yfinance 라벨 불일치 (task#117)**: yfinance `get_income_stmt()`/`get_balance_sheet()`/`get_cashflow()` *메서드*는 무공백 라벨(`OperatingCashFlow`·`TotalRevenue`·`CapitalExpenditure`)인데 `.income_stmt`/`.cash_flow` *프로퍼티*는 공백 라벨(`Operating Cash Flow`)이라 규칙이 다르다. `/Users/calmonion/Project/PortfoliOn/backend/services/market/format.py`의 `_yf_val`은 exact 매칭(`key not in src.index`)이라 라벨이 어긋나면 예외 없이 조용히 `None`을 반환한다. `/Users/calmonion/Project/PortfoliOn/backend/services/market/us.py`는 현금흐름도 `t.get_cashflow(freq='yearly', as_dict=False)` 메서드로 받는다(24줄) — `t.cash_flow` 프로퍼티를 쓰면 공백 라벨이라 FCF·CapEx가 전부 None이 된다.

**DART `fs_div` 함정 (task#117)**: `fnlttSinglAcntAll`(전체 재무제표, 현금흐름표 포함)은 `fs_div`(CFS/OFS)를 *요청 필수값*으로 받는다(누락 시 status 100). 반면 `fnlttSinglAcnt`(주요계정, `backlog.get_financials`)는 fs_div 없이 호출해 응답 행별 `fs_div`로 필터한다 — 둘을 헷갈리면 깨짐. `/Users/calmonion/Project/PortfoliOn/backend/services/market/kr.py`의 `get_annual_financials_kr`(456–475줄)은 ① 요청에 fs_div를 넣고(CFS 우선→OFS 폴백) ② 응답을 행별 fs_div로 *필터하지 않는다*(fs_div를 요청한 응답은 단일 fs라 행에 `fs_div` 필드를 echo하지 않아 필터하면 전 행 스킵). 계정은 `account_nm`(표기 변동)이 아닌 `account_id`(XBRL 표준)로 매칭한다(`_dart_extract_3y` 374–389줄). 이자보상 분모는 `금융비용`이 아닌 `이자의 지급`(`ifrs-full_InterestPaidClassifiedAsOperatingActivities`, 370줄).

**공공데이터포털 빈응답 (bug-report #24·#25, 열림)**: 무결과를 `{"items": ""}`(빈 문자열)로 반환할 때 `body["items"].get("item", [])`가 str.get() → AttributeError. `/Users/calmonion/Project/PortfoliOn/backend/services/lending_service.py:18-20`, `/Users/calmonion/Project/PortfoliOn/backend/services/leverage_service.py:37-38`에서 미방어. `isinstance(raw, dict)` 분기가 필요.

**DART list.json 필드 미echo**: `/Users/calmonion/Project/PortfoliOn/backend/services/disclosures.py`의 list.json은 응답에 `pblntf_ty`를 echo하지 않아(라이브 확인) "단일 호출 후 응답필드 필터" 불가 — 핵심유형 A·B·C·D를 각각 개별 호출해 질의 유형값을 stamp한다(종목당 4콜).

**수주잔고 외화 오저장 (bug-report #29, 열림)**: `/Users/calmonion/Project/PortfoliOn/backend/services/backlog_parser.py:344-349`에서 USD 단위 문서의 pending 행이 `unit or _DEFAULT_UNIT`로 '억원' 기본값이 박힌다 — Cowork가 USD 잔고를 억원으로 오인 가능. **단위 캡션 파싱 실패 시 '안전한 기본값(억원)' 폴백은 ×100 대형 오저장을 만드니, 추출 실패는 기본값이 아니라 pending(누락)으로 처리할 것('wrong < missing').** 수주잔고/데이터 파싱 변경은 배포 후 전 종목 재적재 UAT 필수.

---

## 6. 배치/스케줄러 함정 (silent except·all-None 캐싱·소스/id drift)

배치-백킹 뷰는 외부 API를 요청·기동 경로에서 라이브 호출하지 말 것 — 배치가 사전계산해 `market_cache`/테이블에 저장하고 요청은 저장값만 읽는다(요청당 N콜 직렬=수초 지연).

**[해결됨, 패턴] all-None 캐싱 가드**: `/Users/calmonion/Project/PortfoliOn/backend/services/kr_sector_service.py`(76–78줄)는 전부 None이면 save를 생략하고 직전 양호값을 유지한다(빈/all-None 결과를 캐시에 박제 금지 — task#48~50 3-타석 확립). **의심 트리거(base_dt)가 아니라 실패 클래스(all-None)를 가드해야 근본원인 미상이어도 재발 차단.**

**열린 wipe-on-empty (bug-report #5)**: `/Users/calmonion/Project/PortfoliOn/backend/services/ranking_service.py`의 `get_us_rankings`(138–147줄)는 yfinance가 빈 `{"quotes": []}`를 반환해도 예외 없이 빈 결과를 반환하고, 호출자 `replace_market_rankings`(152–174줄)가 모든 US 행을 DELETE 후 0건 insert해 US 랭킹 테이블을 조용히 비운다. KR `_fetch_naver_market`(118–121줄)은 부분 fetch 시 `RuntimeError`를 던지므로 막히는데 US엔 동등 가드가 없다.

**열린 silent except (bug-report #19·#20)**: `/Users/calmonion/Project/PortfoliOn/backend/services/market_indicators/cache.py`의 `_mc_save`(48줄)·`_mc_load`(34줄)가 PoolError를 포함한 모든 예외를 로그 없이 삼킨다 — DB 영구 저장 실패가 묻히고, `get_or_refresh`(106–116줄)가 None을 받아 외부 API를 동시다발 재호출(thundering herd)할 수 있으며 진단 불가. `_latest_snapshot`(stocks.py:39)도 동일(§3 참조). 외부 fetch 실패는 조용히 삼키지 말고 로깅할 것.

**열린 print-only 로깅 (bug-report #40)**: `/Users/calmonion/Project/PortfoliOn/backend/services/consensus_pipeline.py`의 `run_daily`·`backfill`(295–354줄)은 예외를 `print()`로만 출력하고 logger를 안 쓴다(모듈에 logger 선언 자체 없음). `/Users/calmonion/Project/PortfoliOn/backend/scheduler/jobs.py`의 배치들도 `print()` 기반 — Docker 컨테이너에서 stdout이 로그 시스템에 안 닿으면 실패가 소실될 수 있다.

**소스/id drift (CLAUDE.md gotcha)**: 배치 fetch 소스를 바꾸면 `batch_registry.BATCHES`의 `source`도 갱신해야 현황 카드가 stale 출처를 안 보인다(`source`=fetch 출처 ≠ `usage`=소비 UI). 배치 id를 은퇴시키면 그 id를 쓰는 모든 표면(데이터 read·표시 문자열·`job_runs.record`의 auto/manual/backfill 모든 lane·테스트)을 전수 grep해야 실행이력에서 증발하는 회귀를 막는다.

**열린 수동생성 id 오기록 (bug-report #37)**: `/Users/calmonion/Project/PortfoliOn/backend/routers/report.py:69,138`의 `_run_backfill`·`_run_generation`이 모든 시장에 `job_runs.record("daily_report_us", "manual")`을 하드코딩 — KR-only 수동 백필/생성이 `daily_report_us` 카드에 기록되고 `daily_report_kr` 카드엔 수동 실행이 안 보인다.

---

## 7. 컨센서스 마트 정합성 (열림)

**bug-report #13**: `/Users/calmonion/Project/PortfoliOn/backend/services/consensus_pipeline.py:238-276`의 `refresh_mart`가 90일 내 `raw_reports`가 없으면 `latest_per_brokerage` CTE가 빈 결과→집계함수가 NULL row 1건 반환→`ON CONFLICT DO UPDATE`가 기존 양호 마트 행을 analyst_count=0·buy/hold/sell=0·avg_target_price=NULL로 덮는다. 사용자 화면에서 목표가·의견수가 갑자기 사라진다. `run_daily`는 raw upsert 결과와 무관하게 항상 `refresh_mart`를 호출.

**bug-report #28**: `backfill(force=True)`의 `DELETE`(336줄)가 개별 트랜잭션으로 자동커밋된 뒤 INSERT 루프가 중단되면 mart 행이 영구 소실(DELETE와 INSERT가 원자적이지 않음).

---

## 8. N+1 DB 쿼리·행별 커넥션 체크아웃 (열림, 성능)

`/Users/calmonion/Project/PortfoliOn/backend/services/db.py`의 `query`/`execute`(44–57줄)는 호출마다 `get_connection()`으로 풀 커넥션을 획득/반환한다. 루프 안 호출은 행 수만큼 풀 회전을 일으킨다.

- N+1 쿼리 (bug-report #3·#15·#16·#17): `report.py:215-220` list_reports의 consensus `apply_asof` 종목당 루프, `admin.py:28-32` list_users 사용자당 권한 조회, `digest_service.py:159-163/194-197` 보유종목당 공시·내부자 조회. `WHERE ticker = ANY(%s)` 일괄조회로 묶을 수 있다.
- 행별 execute (bug-report #30·#32·#33): `investor_service.py:104-113`·`short_sell_service`의 `upsert_trend`(252행 백필 시 워커당 252회 회전), `disclosures.py:97-105`·`insider_trades.py:165-181`의 upsert(종목당 최대 400 round-trip). 단일 `get_connection()` + `executemany`/`execute_batch`로 1 round-trip화 가능. ThreadPool 워커(max 8)와 곱해지면 풀 경합 가중.

**요청경로 라이브 외부호출 (bug-report #4·#18)**: `analysis_service.py:50-57` `GET /api/analysis/sector?market=US` 캐시미스 시 11개 ETF yfinance 동기 fetch, `digest_service.py:34-60` `POST /api/digest/generate` 보유종목당 yfinance + open.er-api.com FX 동기 호출. KR sector는 이미 배치 사전계산(`kr_sector_fetch`) 패턴인데 US sector·digest는 미적용.

---

## 9. 프론트엔드 견고성 (열림)

- **하드코딩 FX (bug-report #12)**: `/Users/calmonion/Project/PortfoliOn/frontend/src/pages/Analytics.jsx:106-107`의 `KRW_TO_USD=1380` 모듈 상수로 섹터 배분/버블 차트의 KR 종목 가치를 환산 — 라이브 환율(`/api/market/fx`)과 어긋난다.
- **인터벌 미정리 (bug-report #38)**: `frontend/src/hooks/useStockManagement.js:14-34`의 `pollReportGeneration` setInterval이 언마운트 시 clear되지 않아 언마운트 후 Toast 호출(최대 90초 유령 tick).
- **listLoading 영구 고착 (bug-report #39)**: `frontend/src/hooks/usePortfolioData.js:18-29` `fetchAll`이 try/finally 없어 비-401 오류 시 무한 스피너.
- **영구 Skeleton (bug-report #23)**: §3 참조 — self-heal 소진 후 에러 UI 없음.

---

## 10. 캐시 무효화·이름 dual-source (열림)

- **live_prices 누락 (bug-report #34)**: `/Users/calmonion/Project/PortfoliOn/backend/services/cache.py:135-142`의 `invalidate_portfolio_caches()`가 `invalidate_live_prices()`를 포함하지 않아 종목 추가/삭제/승격 후 최대 15초간 `GET /api/portfolio/prices`가 옛 ticker set 가격을 반환. 단건 `invalidate(ticker)`(61줄)는 포함하는데 mutation 경로가 부르는 포트폴리오 일괄 무효화엔 빠짐.
- **silent except (bug-report #35)**: `backend/services/storage/names.py:9-14`의 `_invalidate_name_caches` `except Exception: pass`가 캐시 무효화 실패를 묻어 이름 업데이트 후 stale 캐시.
- **종목명 dual-source (CLAUDE.md gotcha)**: `tickers.name`(공유 마스터)와 `snapshots.data.name`(리포트 박제)이 별도라 이름 변경 시 둘 다 갱신해야 목록↔상세가 일치. DB만 바꾸면 list 캐시·snapshot LRU 탓에 미반영. `update_ticker_meta`(`storage/names.py:61-65`)는 빈/티커-동일 name 가드가 없어(bug-report #2) `{"name": ""}` 입력이 tickers와 전 snapshot의 name을 빈 문자열로 덮을 수 있다(`save_holdings`의 CASE 가드와 비대칭).

---

## 11. 잡다한 부채 (LOW)

- **dead config (bug-report #41)**: `frontend/vite.config.js:13-18`의 `pwaAssets` 블록이 `@vite-pwa/assets-generator` 제거 후 잔존해 빌드 시 경고 노이즈.
- **중복 호출 (bug-report #42)**: `backend/routers/admin.py:108-109`에서 `invalidate_portfolio_caches()`(내부에 `invalidate_list` 포함) 직후 `invalidate_list()` 중복(무해·멱등).
- **문서-구조 drift**: `CLAUDE.md`는 `backend/scheduler.py`(루트 모듈)를 언급하나 실제는 `backend/scheduler/` 패키지(`__init__.py`·`jobs.py`·`schedule.py`·`_state.py`)다.
- **로컬 `.venv` ≠ Docker 의존성**: `lxml`은 `requirements.txt`/Docker엔 있으나 로컬 `backend/.venv`엔 없다 — 로컬 pytest 코드의 HTML 파싱은 `BeautifulSoup(html, "html.parser")`(stdlib)를 써야 로컬·프로덕션 모두 동작.
