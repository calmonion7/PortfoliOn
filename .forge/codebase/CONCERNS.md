---
last_mapped_commit: 5fbe7ce1e39457d5ee1b29cfbf8350d8e551801f
mapped: 2026-06-20
---

# CONCERNS

PortfoliOn(FastAPI 백엔드 + React/Vite 프론트)의 기술부채·잠재버그·보안·성능 취약·위험 영역 지도. 각 항목은 현재 소스(HEAD `5fbe7ce1`)에 대해 검증했고, 패키지 분리 리팩토링(`storage`/`scheduler`/`market`/`backlog_parser`, ADR-0017)으로 파일이 이동한 경우 **신/구 경로를 모두 표기**한다. task#77(종목명 ticker 클로버 버그 수정)을 반영했다.

---

## 0. 문서 메타: CLAUDE.md Gotchas가 가리키는 경로가 stale (LOW, 광범위)

`CLAUDE.md`의 Gotchas/Architecture 절은 아직 **분리 전 단일 파일 경로**를 다수 가리킨다 — 코드는 이미 패키지로 쪼개졌다. 신규 합류자가 grep할 때 못 찾는다.

| CLAUDE.md가 말하는 경로 | 현재 실제 경로 |
|---|---|
| `backend/scheduler.py` (루트) | `backend/scheduler/` 패키지 (`__init__.py`·`_state.py`·`jobs.py`·`schedule.py`) |
| `backend/services/storage` | `backend/services/storage/` 패키지 (`portfolio.py`·`names.py`·`schedule.py`·`dates.py`) |
| `backend/services/market` (yfinance+Naver) | `backend/services/market/` 패키지 (`__init__.py`·`format.py`·`kr.py`·`us.py`) |
| `backend/services/backlog.py` (파싱 클러스터) | 파싱 헬퍼는 `backend/services/backlog_parser.py`로 추출됨; `backlog.py`는 fetch/DB만 |

검증 결과 **로직은 보존**되어 동작 위험은 없으나, 문서 드리프트는 grep 실패를 유발한다. (참고: `CLAUDE.md`는 `services/market_indicators/` 패키지는 이미 정확히 문서화함.)

---

## 1. 종목명 dual-source — 매일 종목번호로 되돌아가던 클로버 (HIGH, task#77로 가드됨이나 구조적 fragile)

**증상(과거 버그)**: 사용자가 종목명을 고쳐도 다음날이면 다시 종목번호(`005930` 등)로 되돌아갔다.

**근본원인 — 종목명이 두 저장소에 박제됨**:
- `tickers.name`(공유 마스터, 종목관리 목록이 live로 읽음)
- `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세가 읽음)

이름을 한쪽만 갱신하면 목록↔상세가 어긋난다. 두 가지 클로버 동인이 있었다:
1. **저장 라운드트립**: `save_holdings`/`save_stocks`의 tickers UPSERT가 들어온 name으로 무조건 덮어써, 보유 추가/편집 시 name이 누락(NULL/빈값/ticker)이면 기존 실명을 ticker로 클로버.
2. **일일 배치 재박제**: `report_generator`가 스냅샷 name을 `stock.get("name", ticker)`로 박아, 스냅샷만 고쳐도 다음날 배치가 다시 종목번호로 재박제.

**task#77 가드(검증, commit 0c66d4f3·5fbe7ce1)**:
- 저장소 가드: `backend/services/storage/portfolio.py:58,124` — tickers UPSERT가 비파괴 CASE WHEN으로 변경. `name=CASE WHEN EXCLUDED.name IS NULL OR EXCLUDED.name = EXCLUDED.ticker THEN tickers.name ELSE EXCLUDED.name END`. 들어온 name이 NULL/ticker와 같으면 기존 `tickers.name` 보존.
- 배치 방어: `backend/services/report_generator.py:124,279` — name 박제를 `stock.get("name", ticker)` 대신 `mkt.resolve_name(ticker, market, exchange, stock.get("name",""), quote=quote)`로 교체. ticker형 이름이면 이미 페치한 quote의 실명(KR=키움 stk_nm/Naver, US=yfinance shortName)을 박는다.
- 실명 확정 로직: `backend/services/market/__init__.py:45` `resolve_name` — 사용자 입력이 비었거나 티커와 같으면 quote 실명으로 대체, quote도 없으면 입력/티커 보존. **단 `:59`에서 quote 실패를 `except Exception: pass`로 삼킴** → 시세 일시실패 시 이름이 티커로 박힐 수 있음.
- 동기화/백필 헬퍼: `backend/services/storage/names.py` — `refresh_snapshot_names`(단건, tickers→snapshot), `reconcile_snapshot_names`(전체 강제 동기화), `set_ticker_name`(둘 다), `update_ticker_meta`(편집 모달), `tickers_missing_name`(백필 대상 = `name='' OR name=ticker`).
- 캐시 무효화: 이름 변경 후 `_invalidate_name_caches`(`names.py:6`)가 `cache.invalidate(ticker)`+`invalidate_list()` 호출(storage→cache 순환참조 회피 지연 import). 이게 없으면 리포트 목록 캐시·스냅샷 LRU 탓에 화면 미반영.

**남은 fragile 표면(가드 후에도 주의)**:
- **이름은 여전히 두 store에 박제** — 이름을 건드리는 신규 코드는 `tickers.name`만 바꾸면 안 되고 `refresh_snapshot_names`/`reconcile_snapshot_names`로 스냅샷도 동기화해야 한다. 구조적으로 SSOT가 아니라 "박제 2벌 + 동기화 헬퍼"라 동기화 누락이 재발 가능.
- **백필 무재시도 silent skip**: `POST /api/stocks/names/backfill`(`backend/routers/stocks.py:250`, admin)는 후보(`tickers_missing_name`)를 `resolve_name`으로 채우되 **시세 일시실패 시 그 종목을 재시도 없이 조용히 스킵**(`name`이 ticker로 남아 `_one`이 None 반환 → `updated`에서 빠짐). 결과 `updated:0`이면 시세 실패일 수 있으니 **재실행**해야 한다.
- `_invalidate_name_caches`(`names.py:13`)도 `except Exception: pass` — 캐시 무효화 실패가 무성이라 "이름 고쳤는데 화면 미반영"의 원인이 추적 불가.
- 회귀 테스트 3종 존재(`test_storage.py` 클로버 가드 2 + `test_report_generator.py` 배치 방어 1)로 SQL 가드 문자열·배치 실명 박제를 고정.

---

## 2. NaN/Inf → JSON 직렬화 500 (HIGH, 부분 가드됨)

**증상**: starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 500(`Out of range float values are not JSON compliant`).
**근본원인**: 외부 시세(yfinance `Close`가 NaN, FX/usdkrw NaN 등)에서 흘러든 NaN이 합산값(`total_value`)을 오염. PostgreSQL은 `json` 컬럼에 NaN을 거부(저장 실패)하지만 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백만 통과 → DB저장 실패/파일 성공/응답 직렬화 실패로 증상이 엇갈린다.

**현재 가드 현황(검증)**:
- 소스 가드: `backend/services/digest_service.py`(`math.isfinite`로 prev_close/current/usdkrw 가드), `backend/services/recommendation/funnel.py`, `backend/services/report_generator.py`, `backend/routers/analytics.py`.
- 출력 sanitize: `backend/services/utils.py` `sanitize()`가 NaN/inf→None 재귀 치환. 소비처는 `routers/report.py`, `services/report_generator.py`, `services/lending_service.py`, `services/leverage_service.py`.

**남은 위험**: sanitize는 **전수 적용이 아니다**. float를 응답에 싣는 엔드포인트 중 sanitize/소스가드 둘 다 없는 경로(예: market quote dict를 그대로 반환하는 경로, dashboard totals 계산)는 새 NaN 소스가 끼면 다시 500날 수 있다. CLAUDE.md 권고대로 **소스 가드(math.isfinite 체크 후 "시세 없음")**가 출력 일괄 sanitize보다 깨끗하다. 사례: 다이제스트 생성 500(8cd70a42).

---

## 3. 시장지표 캐시 read/write 실패를 silent하게 삼킴 (MEDIUM)

`backend/services/market_indicators/cache.py:34,48,55`의 `_mc_load`·`_mc_save`·`_mc_delete`는 모두 `except Exception: pass`로 **DB 오류를 완전 무성(silent)으로 삼킨다**(로그 0).
- `_mc_save` 실패 시: 외부 fetch는 성공했는데 영구 저장이 조용히 실패 → 다음 요청이 캐시 미스로 매번 라이브 fetch(성능 저하)하거나 영영 빈 캐시. 진단 단서 없음.
- `_mc_load` 실패 시: 캐시가 있어도 못 읽어 fetch 경로로 폴백 — 무성이라 "왜 느린지" 추적 불가.

CLAUDE.md가 명시한 교훈(task#48 `_fetch_one_sector` silent except → all-None 박제)의 **재발 가능 표면**이다. `kr_sector_service.py`는 이미 `print(...)` 로깅으로 교정됐으나, `cache.py`의 3개 pass는 아직 무성이다. 단, 이건 인프라 헬퍼라 "실패 클래스 가드"(저장 생략·직전값 유지)는 호출부(`kr_sector_service.refresh`의 all-None skip)에 있어 데이터 박제 위험은 차단됨 — 남은 건 **진단성 부족**.

---

## 4. all-None 캐시 박제 가드는 kr_sector에만 존재 (MEDIUM)

CLAUDE.md 교훈: 배치가 빈/all-None 결과를 캐시에 박제하면 시드 가드가 "채워짐"으로 오판해 고착(task#48→#49→#50).

**검증**: `backend/services/kr_sector_service.py:76-81` `refresh()`는 모든 sector의 `return_1w/1mo/3mo`가 None이면 `save` 생략·직전값 유지(`print("[kr_sector] refresh: all-None momentum — skipping save")`, 올바름). 그러나 이 패턴은 **kr_sector 한 곳에만** 구현돼 있다. `market_indicators/` 서브모듈(`fx.py`·`commodities.py`·`earnings.py`·`exports.py`)의 `_yf_close_history`(`cache.py`)는 `hist.empty`면 `stored`(직전값) 반환으로 비어있는 저장은 막지만, **"전부 None인데도 일부 형태가 있는" 케이스**에 대한 명시 가드는 없다. yfinance/FRED가 빈 응답을 다른 형태로 줄 때 재발 가능. "의심 트리거가 아니라 실패 클래스(all-None)를 가드하라"는 교훈을 다른 배치로 일반화하지 않은 상태.

---

## 5. 비-additive 응답 reshape → 프론트 독립 fetcher 조용히 깨짐 (MEDIUM, 활성 표면)

CLAUDE.md task52 교훈: `/api/stocks/dashboard`를 배열→`{holdings,totals}`로 reshape했을 때 훅과 별개로 직접 fetch하던 `Analytics.jsx`가 깨짐.

**검증(현재도 활성)**: `/api/stocks/dashboard`를 fetch하는 곳이 **여전히 2개**다 —
- `frontend/src/hooks/usePortfolioData.js:35` (훅)
- `frontend/src/pages/Analytics.jsx:269` (독립 fetcher)

다음에 이 엔드포인트 응답을 다시 reshape하면 두 소비처를 전수 grep하지 않는 한 한쪽이 옛 형태로 조용히 깨진다. 동일 위험은 `last_scheduled_date`(단일 문자열→`{KR,US}` 객체로 reshape됨, ADR-0012)를 파싱하는 외부 Cowork에도 있음.

---

## 6. mock.call_args 오염 — additive 호출이 기존 테스트를 거짓통과시킴 (MEDIUM, 테스트 부채)

CLAUDE.md 교훈(task#66·67): 엔드포인트에 read/외부호출을 additive로 추가하면 `mock.call_args`(마지막 호출)를 단언하는 기존 테스트가 마지막 호출이 신규 호출로 바뀌며 거짓통과/오류. 대응은 `call_args_list[i].kwargs`로 인덱스 명시·`call_count`로 시퀀스 못박기.

76개 테스트 파일 중 `mock.call_args`(마지막 호출 단언) 패턴을 쓰는 테스트는 향후 additive 변경에 취약하다. 패키지 분리 retro(god-file-split)에서도 **patch-site는 grep 실측·분류가 필요**하다고 기록됨. ADR-0017로 인해 patch 경로가 서브모듈로 이전됐으므로(`services.market._naver_get`→`services.market.kr._naver_get`, `services.storage.query`→`portfolio.query`), **루트 경로로 patch하던 옛 테스트나 새로 작성하는 테스트가 잘못된 경로를 patch하면 mock이 안 닿아 라이브 호출이 새어나간다**(standalone 테스트로만 잡힘). task#77 신규 테스트는 올바르게 서브모듈 경로(`services.report_generator.mkt.*`, `services.storage.portfolio.get_connection`)를 patch한다.

---

## 7. 외부 API 라이브 호출이 요청/기동 경로에 새어들 위험 (MEDIUM, 성능)

CLAUDE.md 교훈(task#50): 배치-백킹 뷰(랭킹·KR 업종 모멘텀)는 외부 API(키움)를 요청·기동 경로에서 라이브 호출 금지 — 배치가 사전계산해 저장, 요청은 저장값만 읽어야 한다.

**검증(현재 올바름)**: `kr_sector_service.map_holdings_to_sectors`는 `load_sector_index()`로 **저장 인덱스만 읽고**, 첫 배치 전이면 graceful 빈 매핑. 시드 가드 `_seed_*_if_empty`(랭킹·kr_sector)도 존재. 패턴은 지켜지고 있으나, **신규 배치-백킹 기능 추가 시 매번 이 규약을 수동으로 지켜야 하는** 구조적 부채(아키텍처 강제장치 없음). `market/__init__.py:38` `get_quote`는 종목당 TTL 캐시(`get_quote_cached`)는 있으나 캐시 미스 시 요청 경로에서 라이브 yfinance/Naver 호출(rate-limit 의존).

---

## 8. 폴백 경로가 실패를 다르게 가림 (MEDIUM, 진단성)

여러 fetch 체인이 폴백으로 실패를 가려 "동작하는 것처럼 보이나 데이터는 stale/빈" 상태를 만든다:
- `market/__init__.py:103` US quote: yfinance 예외→KIS 백업→`_us_none_quote`(에러 dict). 폴백이 깊어 어느 단계서 실패했는지 응답만 봐선 모호.
- `market/__init__.py:210,215` `get_history_df` KR: 키움 실패를 `except Exception: pass`로 삼키고 yfinance 폴백 — 키움 실패 원인 미로깅.
- `market/__init__.py:59` `resolve_name`: quote 실패를 `except: pass`로 삼킴 → 이름이 티커로 박힐 수 있음(항목 1과 연동).
- `market/us.py`·`market/kr.py`: 다수 `except Exception: pass`.

CLAUDE.md의 KITA/KOFIA/FRED 키 미설정 시 graceful 폴백(UN Comtrade 등)도 같은 부류 — **키 미설정과 키 오류가 같은 빈 결과로 수렴**해 운영자가 "왜 데이터가 없는지" 구분 불가.

---

## 9. 데이터 파싱 오저장(×100) — backlog/단위 캡션 (MEDIUM, 가드됨이나 fragile)

CLAUDE.md 교훈(ADR-0003·0004): 단위 캡션 파싱 실패 시 "안전한 기본값(억원)" 폴백은 ×100 대형 오저장. 추출 실패는 기본값이 아니라 pending(누락)으로(‘wrong < missing’).

**검증(현재 올바름)**: `backend/services/backlog_parser.py`의 `_table_unit`은 KRW 토큰이 없으면(USD천·백만달러·줄바꿈 분리) `_DEFAULT_UNIT`(억원)이 아니라 **"기타"(비KRW)를 반환해 자동추출을 막는다**. `_EOK_FACTOR`로 조원/억원/백만원/천원/원을 정규화. 다만 `_DEFAULT_UNIT="억원"`이 코드에 상수로 존재해 **미래에 잘못 폴백으로 쓰이면 ×100 재발 위험**(현재는 캡션 추출 성공 시에만 매핑에 쓰임). CLAUDE.md 명시: **수주잔고/데이터 파싱 변경은 배포 후 전 종목 재적재 UAT 필수**(fixture 테스트로 못 잡는 실데이터 케이스).

추가 위험: `market/kr.py`·`market_indicators/` 차트는 입력을 **'억원' 단위로 가정**(`krFmt` 헬퍼, `frontend/src/components/market/marketUtils.jsx`). raw 원/주(count)를 그대로 넘기면 1e8배 오표기(과거 "35조경원" 사례). `kr.py`에서 시총을 `*100_000_000`, 매출을 `*1e8`로 변환 — 단위 변환 지점이 분산돼 있어 신규 코드가 단위를 틀리기 쉽다.

---

## 10. KR 색 관례 토큰 — 의미 배지 반전 (LOW, 가드됨)

CLAUDE.md 교훈: 이 앱은 `--up`=빨강(상승)·`--down`=파랑(하락)이라 `.badge--success`=빨강·`.badge--danger`=파랑(`frontend/src/components/ui/Badge.jsx:5-7`). 의미 상태 배지에 success/danger를 쓰면 Western(녹=좋음) 의도와 색이 반전(라이브 UAT 포착 b288f494).

**검증**: 전용 `frontend/src/components/ui/SupplyBadge.jsx`가 존재(가격 토큰 미사용으로 교정됨). `Badge.jsx`의 success/danger/warning variant는 `value >= 0 ? 'success' : 'danger'`(가격 방향, `Badge.jsx:35`)와 `Showcase.jsx`에서 사용. **남은 함정**: ① `warning` 변형은 `--color-warning`/`--warning-tint` 미정의로 **현재 깨져 있어** caution 색으로 쓸 수 없음. ② UI 리뷰가 variant 이름의 통념(success=녹)이 아니라 토큰 실제값을 대조하지 않으면 신규 의미 배지에서 재발.

**체계적 해소(task#79, 2026-06-20)**: `tokens.css` `:root`(라이트)+`[data-theme="dark"]`(다크) 양쪽에 **가격방향과 무관한 시맨틱 토큰군** — `--color-success/error/info`, `--semantic-buy/sell`, `--corr-pos/neg/zero`(WCAG 4.5:1 대비) — 을 신설하고, 앱 전반(48파일)의 서양식 하드코딩(`#81c784`녹·`#e57373`·`#ef9a9a`빨)을 **가격방향=`--up`/`--down`** vs **의미상태=시맨틱 토큰**으로 전수 분리. 상관 히트맵도 가격토큰 무관 중립 발산 팔레트(`--corr-*`)로 교체. 이로써 "의미 배지에 가격 토큰을 쓰는" 함정 ②의 표면이 대폭 축소됨. **단 신규 코드가 가격방향과 의미상태를 다시 혼동하면 재발 가능** — 적대리뷰가 잡은 critical 1건(InsiderTrades 내부자 매수/매도 신호를 `--up/--down`으로 오분류)이 정확히 그 실패모드였다(→`--semantic-buy/sell`로 교정).

---

## 11. lxml 로컬 .venv 부재 (LOW, 가드됨)

CLAUDE.md 교훈: `lxml`은 `requirements.txt`(`lxml>=4.9.0`)·Docker엔 있으나 로컬 `backend/.venv`엔 없음. HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 stdlib `html.parser`를 써야 로컬·프로덕션 모두 동작.

**검증(현재 준수)**: 전 backend 코드가 `BeautifulSoup(..., "html.parser")` 사용 — `backlog_parser.py`·`scraper.py`·`guru_scraper.py`·`market_indicators/earnings.py`. lxml 직접 사용 0건. 신규 코드가 무심코 `"lxml"`을 쓰면 로컬 pytest만 깨지므로 주의 표면 유지.

---

## 12. 배치 id/source 다표면 grep 부채 (MEDIUM, 운영 회귀 위험)

CLAUDE.md 교훈(daily_report-market-split task15·17·45 재발): 배치 id를 `batch_registry.BATCHES`에서 빼면 ① 데이터 read ② 표시 문자열(`schedule_desc`) ③ **모든 `job_runs.record(id,...)` lane(auto·manual·backfill)** ④ 그 id 단언 테스트를 전수 grep해야 한다. 한 곳이라도 옛 id면 배치 현황 실행이력에서 증발하는 회귀. 옛 id 단언 테스트는 깨진 동작을 고정(TDD green이 회귀 못 잡음). 또한 fetch 소스 변경 시 `source` 필드도 갱신해야 현황 카드가 stale 출처를 안 보임.

`backend/services/batch_registry.py`(395줄)가 단일 진실원이나, id/source/market/usage가 여러 표면에 흩어져 일관성을 **수동으로** 유지해야 하는 구조적 부채. ADR-0012(daily_report 분리)·ADR-0013(earnings/monthly 분리)이 이 위험의 누적 사례.

---

## 13. 자동 배포 폴러가 커밋 안 한 tracked 편집을 소실 (HIGH, 작업 안전)

**증상/근본원인**: launchd `com.portfolion.auto-deploy-poll`이 2분마다 `scripts/auto-deploy-poll.sh`를 실행, `origin/main`이 로컬 HEAD보다 앞서면 **`git reset --hard origin/main`**(검증: 스크립트 35행) 후 배포. → 메인 체크아웃에서 **커밋 안 한(또는 push 안 해 로컬이 origin보다 앞선) tracked 편집은 다음 폴(≤2분)에 소실**.
**완화**: 코드 변경은 commit+`git push origin main`을 묶어 즉시 반영. `.forge/` 등 **untracked 파일은 reset --hard 대상이 아니라 안전**. 단, `.forge/codebase/*.md`처럼 **tracked가 된 forge 파일은 이 보호를 못 받는다**(재생성 중 소실 위험 — 커밋되지 않은 채 폴이 돌면 덮어써짐).
- **배포 모델 부수효과**: 프론트는 `npm run build`가 즉시 라이브지만 **백엔드 변경은 폴러 재배포 후에야 라이브** — 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작.

---

## 14. 인증·권한·CORS 표면 (MEDIUM)

- **단일 서버측 키 경계**: 키움·KIS는 서버측 단일키(`.env.docker`)로 전 사용자 공유(ADR-0009/0011) — 읽기전용·조회 TR만이라 경계는 명시됐으나, 키 유출 시 영향 범위가 전역. **검증: 추적 코드에 하드코딩 시크릿 0건**, `.env.docker`는 gitignore, `.env.docker.example`은 placeholder만(실값 0).
- **CORS**: `localhost:3000`/`localhost:5173`/`FRONTEND_URL` env(`backend/main.py`). 배포 시 `FRONTEND_URL` 미설정이면 origin 누락.
- **메뉴 권한**: `user_menu_permissions`는 **프론트 nav 필터링용**(AuthContext) — 서버 엔드포인트 자체 게이팅은 admin role 의존(`UPDATE users SET role='admin'`). 프론트 nav를 숨겨도 엔드포인트를 직접 호출하면 도달 가능한지(메뉴별 서버 가드 유무)는 라우터별 `Depends` 확인 필요.
- **이벤트 화이트리스트**: `routers/events.py`의 `VALID_EVENTS` 집합으로 검증 — 신규 이벤트 추가 시 누락하면 조용히 거부.
- **FastAPI 라우트 순서**: `PUT /api/stocks/enrich/batch`(`stocks.py:218`)가 `PUT /api/stocks/{ticker}/enrich`(`stocks.py:233`)보다 **먼저** 등록됨(검증 OK) — 순서가 뒤집히면 `enrich`가 ticker로 라우팅.
- **bare list/dict Body 파라미터**: PUT/POST에서 bare list/dict는 `Body(...)` 명시 필수(미명시 시 재빌드 후 기동 불가, PR#12 사례). 신규 엔드포인트가 누락하면 기동 실패.

---

## 15. 외부 의존성 단일점 + rate-limit (MEDIUM, 성능/가용성)

- **yfinance**: US 시세·히스토리·재무·애널리스트의 1차 소스. 비공식 API라 Yahoo 장애/구조변경/rate-limit에 취약. KIS가 US 백업이나 가격만(15분 지연). 종목당 TTL 캐시(`market/__init__.py` `get_quote_cached`)로 호출 상한.
- **키움(KR 1차)**: `get_quote_kr`이 키움 우선 + KIS + Naver 폴백. 단일 서버측 키, 직렬 throttle.
- **DART**: backlog·disclosures·dividends(KR)가 `DART_API_KEY` 필수. status 013(무데이터)은 graceful. corp_code 매핑은 `backlog._get_corp_code_map` 재사용(단일점).
- **KOFIA(`KOFIA_API_KEY`)**: leverage·lending 공유 키. 미설정 시 요청 실패.
- **FRED(`FRED_API_KEY`)**: 경제지표·macro-signals. 미설정 시 수집 실패(저장값 무변경).
- **키 명명 함정**: `KITA_API_KEY`는 실제로 **관세청(Korea Customs Service)** 키 — 이름과 출처 불일치.
- 다수 외부 fetch가 ThreadPoolExecutor 병렬(calendar max 30, digest max 10, kr_sector max 4, names/backfill max 8). DB 풀 크기(maxconn=10) ≤ ThreadPool 워커여야 풀 고갈 회피(refactor-db-pool-sizing retro). 이름 백필은 워커당 2 writes(`set_ticker_name`)라 max 8로 캡됨.

---

## 16. 테스트 커버리지 공백 (LOW~MEDIUM)

76개 테스트 파일로 라우터·서비스 대부분 커버(검증: `backend/tests/`). 명시적 테스트가 **얇거나 없는** 영역:
- **패키지 re-export 표면 자체**: ADR-0017이 "전체 pytest green + 이전 전 심볼 전부 해석"을 게이트로 두나, re-export 목록 누락(특히 underscore private)을 단언하는 전용 테스트는 부재 — 서브모듈 재배치 시 표면 구멍이 런타임에만 드러남.
- **종목명 dual-source 동기화**: task#77이 저장소 가드(SQL 문자열)·배치 실명 박제 3종을 고정했으나, **`reconcile_snapshot_names`/`refresh_snapshot_names`의 동기화 정확성**(tickers↔snapshot 일치)이나 **백필의 시세 실패 재시도 누락**을 막는 계약 테스트는 부재.
- **NaN 가드 전수**: digest/funnel/report_generator엔 NaN 테스트가 있으나, sanitize 미적용 엔드포인트의 NaN 회귀를 막는 계약 테스트는 부분적.
- **프론트**: 프론트 단위 테스트 부재(UAT는 Playwright 디바이스 에뮬레이션 수동, reference-frontend-uat). 비-additive reshape 소비처 회귀는 테스트로 못 잡고 라이브 UAT/메인 세션 grep에 의존.
- **silent except 경로**: `except: pass` 다수(부록 참고)는 실패 분기 테스트 부재 — 폴백이 데이터를 가리는 케이스가 테스트로 고정되지 않음.

---

## 17. 죽은/레거시 CSS가 수정을 오도 (MEDIUM, 프론트 드리프트)

`frontend/src/styles/mobile.css`·`pc.css`에 **현재 JSX가 렌더하지 않는 클래스**와 **신규 `ui/` 프리미티브를 이기는 레거시 태그선택자**가 누적돼, "권위 있어 보이지만 실제론 안 먹는" CSS가 수정을 잘못된 곳으로 유도한다(2026-06-20 UI 폴리시 배치 #80·#83 둘 다서 분기 유발).

- **미렌더(dead) 클래스**: `.holdings-list`·`.m-cal-wk`는 mobile.css에 정의돼 있으나 실제 모바일 대시보드/캘린더는 인라인 스타일 div·`Calendar.jsx` 인라인으로 렌더된다. #80에서 에이전트가 `.holdings-list`에 하단 패딩을 줬으나 무효(dead) → 진짜 컨테이너(`<div style={{padding:'0 20px'}}>`)를 직접 고쳐야 했다. **교훈: CSS 클래스를 고치기 전 그 클래스가 실제 DOM에 렌더되는지 grep+런타임 확인**(없으면 인라인/다른 클래스가 실효 소스).
- **레거시 태그선택자 specificity**: `.m-login input`/`.login-form input`(specificity 0,1,1)이 `.ui-input`(0,1,0)을 이겨, 입력을 `ui/Input` 프리미티브로 교체해도 스타일이 통일되지 않았다(#83) → 담당 파일 내 인라인 스타일(클래스·태그선택자 모두 이김)로 우회. **교훈: ui/ 프리미티브로 이관 시 기존 태그선택자/높은 specificity 규칙이 덮는지 확인**, 안 그러면 컴포넌트만 바뀌고 시각은 그대로다.
- **잔존 dead 선언**: pc.css/mobile.css의 `.m-login input`/`.login-form input` 배경·테두리·radius는 이제 인라인에 덮여 dead. 별도 CSS 정리 패스에서 제거하고 `.ui-input` 단일 소스화 가능(후속 후보).
- **스코프 의존 스타일 lift 회귀**(task#87): `.parent .child` 형태로만 정의되고 전역 정의가 없는 스타일은, child를 부모 밖으로 옮길 때 이중 함정 — ① 그 규칙이 dead가 되고 ② child가 스타일을 통째로 잃는다. Reports 필터를 사이드바 밖 단일 호스트로 lift할 때 `.reports-sidebar .tab-cnt`(전역 정의 없음)가 그 예로, 카운트 배지가 무스타일이 될 뻔해 `.reports-filters .tab-cnt`로 retarget해 가드했다(전역 `.tab-btn`/`.sm`은 tokens.css에 전역 정의가 있어 폴백 안전 — 차이는 '전역 vs 스코프 전용'). **교훈: 컴포넌트를 컨테이너 밖으로 lift하기 전 `grep '\.<container> '`로 스코프 의존 규칙을 전수해 retarget**(안 하면 컴포넌트는 옮겨졌는데 시각만 깨진다).

**상태**: 개별 분기는 그때그때 우회했으나 mobile.css/pc.css의 dead/레거시 표면 자체는 미청소 — 다음 프론트 수정도 같은 함정에 빠질 수 있다. 근본 청소(미렌더 클래스 제거 + 레거시 태그선택자→프리미티브 단일화)는 별도 태스크 후보.

---

## 부록: silent `except ...: pass` 인벤토리 (검증, 무성 폴백 표면)

진단성 위험 순. 로깅 없이 예외를 삼키는 지점:

- `services/market_indicators/cache.py`: 3건(`_mc_load`·`_mc_save`·`_mc_delete`) — **DB I/O 무성** (가장 위험)
- `services/market/__init__.py`: 다수 (`resolve_name` 이름 폴백·`get_history_df` KR 폴백·US quote 폴백 등 8건)
- `services/market/kr.py`·`services/market/us.py`: 시총·재무·애널리스트 파싱 폴백
- `services/storage/names.py`: 1건 (`_invalidate_name_caches` — 캐시 무효화 실패 무성 → 이름 변경 화면 미반영 가능, 항목 1과 연동)
- `services/storage/portfolio.py`: JSON 파싱 (타입 한정 `json.JSONDecodeError, TypeError`)
- `services/scraper.py`·`guru_scraper.py`·`digest_service.py`·`short_sell_service.py`·`investor_service.py`·`report_generator.py`: 각 1~2건
- `routers/stocks.py`·`routers/events.py`·`routers/report.py`: 폴백 다수

대조: `scheduler/jobs.py`의 배치 잡은 **`except Exception as e: print(...)`로 모두 로깅**(검증) — 무성 아님. silent except의 위험은 "기능이 죽었는데 조용한" 데이터/캐시 경로에 집중.
