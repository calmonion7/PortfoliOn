---
last_mapped_commit: 47521121f10ac1c057fe9cf8ed5fc43ab5ca596c
mapped: 2026-07-31
---

# CONCERNS — 기술부채·버그·리스크 지도

이 문서는 **구현 사실**만 담는다. 용어 정의는 `.forge/CONTEXT.md`, 결정의 근거는 `.forge/adr/`에 있다.

각 항목은 다음 4개 중 하나로 표시된다. **과장 금지** — 가드된 설계 선택을 열린 버그로 승격하지 않고, 이미 고쳐진 것을 열린 것처럼 쓰지 않는다.

| 표시 | 뜻 |
|---|---|
| **확인된 버그** | 코드를 직독해 재현 경로가 확정된 결함. 도달 조건도 함께 적었다. |
| **잠재 위험** | 지금 깨져 있지는 않으나, 특정 입력·외부 변화·재실행에서 깨진다. |
| **설계상 트레이드오프** | 의도된 선택(대개 ADR 근거 있음). 비용을 알고 쓰라는 뜻. |
| **이미 가드됨(잔여 위험만)** | 과거 사고가 코드로 막혔다. **재제기 금지** — 남는 잔여만 적었다. |

`CLAUDE.md`는 *역사* 문서라 이미 고쳐진 항목·나중에 정정된 항목이 섞여 있다. 이 문서는 **HEAD `4752112` 시점의 코드 상태**를 기준으로 전 항목을 재검증한 결과다. 어긋나는 곳은 §13에 모았다.

> ⚠️ **섹션 번호를 함부로 바꾸지 말 것.** 코드 주석 8곳과 `API_SPEC.md`가 `CONCERNS §N`을 직접 인용하며, 그중 절반이 이미 옛 번호를 가리키고 있다(§12.6). 항목 추가는 하위번호(§N.M)로, 대분류(§0~§14) 번호는 고정으로 유지한다.

> 🔒 **이 문서는 git 추적 대상이다** — 실제 키·토큰·비밀번호 **값**은 쓰지 않는다. 환경변수 *이름*만 적는다. (지난 판이 `docker-compose.yml`의 폴백 비밀번호 값을 인라인했던 자리는 이번에 마스킹했다 — §10.2.)

---

## 0. 지금 열려 있는 확인된 버그

번호는 지난 매핑(`91bac67`)과 **연속**이다 — 해소된 것은 아래 "해소" 표로 내리고 번호를 재사용하지 않는다.

> **재검증: 2026-08-02 (task#272) — 이 절만 갱신됨.** 8차 버그 헌트가 기존 "열림" 21건을 전수 재검증해 5건(B10~B14)을 해소로 내리고, 새로 확정된 13건(B27~B39)을 추가했다. 판정 근거·현재 코드 인용은 `.forge/bug-report.md`(8차)의 「B목록 재검증」 절에 있다.
> **문서의 나머지 절(§1~§14)은 여전히 `last_mapped_commit: 4752112`(07-31) 기준**이며 이번에 검증되지 않았다.
>
> **갱신: 2026-08-02 (task#273·#274) — §0의 표만.** task#273이 B27·B32를 닫고 B24를 절반 닫았고(`ranking_watch_toggle`만 등록, `nav_analytics`는 잔존), task#274가 구루 크롤 3건(B28·B29·B31)을 닫았다. 아래 §1~§14 본문의 해당 절 서술은 **아직 옛 코드 기준**이다.

### 데이터 손실·오염
| # | 결함 | 위치 | 도달 조건 |
|---|---|---|---|
| B1 | KR 랭킹 빈응답이 전 KR 행을 DELETE | `services/ranking_service.py:109-110` → `:162` | Naver 200 + 빈/개명 페이로드 |
| B5 | 사용자 삭제가 6개 트랜잭션 — 중간 실패 시 반쯤 삭제된 사용자 | `routers/admin.py:111-119` | 루프 중 DB 오류 |

### 무음 미동작 / 오값
| # | 결함 | 위치 | 도달 조건 |
|---|---|---|---|
| B6 | 키 미설정 배치가 "성공"으로 기록 | `market_indicators/econ.py:13-15`, `macro.py:59-61`, `scheduler/jobs.py:76,87,431` | `FRED_API_KEY`/키움 미설정 |
| B7 | KR 배당 기준연도가 1년 어긋남 | `services/dividends.py:101-102` | 4월 1일 00:00–09:00 KST |
| B8 | 컨센서스 `report_date`가 UTC 변환으로 하루 밀림 | `services/consensus_pipeline.py:173` → `:188` | US/Eastern 저녁 발행 리포트 |
| B9 | 프론트에 access token 갱신 경로가 없다 | `frontend/src/api.js:15-26` | 1시간 경과 (항상) |
| **B24** | (**부분 해소**, task#273) `nav_analytics`가 아직 백엔드 화이트리스트에 없어 **200 OK로 무음 폐기** — `ranking_watch_toggle`은 등록됨(`events.py:16`) | `routers/events.py:11-18,45-46` ← `components/Masthead.jsx:84`·`MobileTopActions.jsx:15` | 항상 |
| **B25** | FX 저장 payload가 `usdkrw` history만 담아 `usdjpy`/`eurusd`의 last-good 폴백이 **원리적으로 발동 불가** | `services/market_indicators/fx.py:79` (폴백은 `:36-40`) | 항상(+매 실행 1y 전량 재조회) |
| **B30** | 티커 유니버스 캐시가 **축소된**(빈 것은 아닌) 스크레이프를 무검증 저장 → rest 커버리지 임계가 **이미 틀린 분모**로 통과 | `market_indicators/earnings.py:94-117`(`:110` `if tickers:`) → `:205`,`:225`,`:269` | `_scrape_kospi`의 `if not codes: break`(`:149-150`) 조기종료 등 예외 없는 부분 축소 |
| **B33** | `any(snap_dist.values())`가 스냅샷의 **진짜 0/0/0**을 결측으로 보고 mart 값으로 대체 → `base_date` 귀속 불일치 | `routers/analyst_reports.py:79` (귀속은 `:102-103`) | `market/kr.py:639-647`에서 `RECOM_CD`만 전량 파싱 실패 |

### 표시 오류
| # | 결함 | 위치 |
|---|---|---|
| **B34** | `fmtSharesUs`가 음수에서 축약 없이 전액 표기 — 형제 `fmtSharesKr`(`:32-40`)의 부호보존이 US판에 미적용 | `frontend/src/utils.js:43-50` ← `components/reports/UsInsiderSection.jsx:90` |

### 계약·보안
| # | 결함 | 위치 |
|---|---|---|
| B19 | 하드코딩 폴백 시크릿(OAuth state 서명 키) | `backend/routers/auth.py:45` |
| B20 | 레이트리밋 전무 (로그인·회원가입·리포트 생성) | `main.py`, `nginx/nginx.conf` 전역 |
| B21 | Postgres가 tracked 폴백 비밀번호로 호스트 전 인터페이스에 발행 | `docker-compose.yml:9` + `:10-11` |
| B23 | `pages/Portfolio.jsx`를 vitest에서 마운트할 수 없다 | `frontend/src/test/setup.js` (1줄, 폴리필 0) |
| **B26** | tracked UAT 스크립트 **16개**가 라이브 테스트 계정 크리덴셜을 평문 하드코딩 (task#272 실측 — 이전 표기 15는 과소) | `scripts/uat*.mjs` 다수 (값은 이 문서에 인용하지 않음) |

### 검증장치·문서

| # | 결함 | 위치 |
|---|---|---|
| **B35** | 구루 크롤 완전성 경로(`guru_scraper.py`·`routers/guru.py`·`services/storage/`)를 **소유한 에이전트 카드가 없다** + `batch-cache-guard`가 적은 `schedule.py`는 **동명이인**(`backend/scheduler/schedule.py` ≠ `backend/services/storage/schedule.py`) | `.claude/agents/batch-cache-guard.md:15-16` (7개 카드 전수 grep 0건) |
| **B36** | 날짜 스코프 회귀 테스트가 `call_args`를 안 봐서 스코프가 아니라 "`get_report`가 None이면"만 검증 — 라우터가 다른 날짜로 조회해도 green | `backend/tests/test_analyst_reports.py:473-484` |
| **B37** | `CLAUDE.md` 가토의 예시 코드 인용이 실제 리터럴과 다름(`'완료: 갱신됨'` ≠ `'완료: 매니저 데이터 갱신됨'`) — 승급 시점부터 부정확 | `CLAUDE.md:127` ↔ `pages/GuruCrawlNow.jsx:35` |
| **B38** | 에이전트 카드가 읽기전용 표방을 `tools` 프론트매터로 강제하지 않음(키 자체 부재 → Edit/Write 상속). ADR-0024 개정문이 지목한 실패 양식의 재발 | `.claude/agents/live-forensics.md` (프론트매터) |
| **B39** | 애니메이션 게이팅(`isFirstLoad`)에 회귀 테스트 **0건** — 유일하게 클래스명을 아는 스크립트는 애니메이션을 *무효화*하는 성능 프로브다 | `pages/GuruAllocation.jsx:55`,`:212`,`:214` |

### 지난 매핑 이후 **해소**된 확인된 버그 (재제기 금지)
| 옛 # | 결함 | 무엇이 닫았나 |
|---|---|---|
| B15 | 상승여력 색상이 항상 무채색 | `components/ui/Stat.css:18-19`에 `.stat__value--up`/`--down` 신설, `Showcase.jsx:75`도 `up`으로 이관 (task#254) |
| B16 | 심층 리포트 라우트가 PC 서브바·모바일 탭에서 누락 | `frontend/src/navSections.js` 단일 소스 + `match: '/analyst-report'`, 회귀 게이트 `test/nav-active-matching.test.jsx` (task#251) |
| B17 | `PointMetric.change_pct`가 명시적 `null`을 422로 거부 | `routers/analyst_reports.py:31` `Optional[float]`화 (`allow_inf_nan=False` 유지, task#250) |
| B18 | `COWORK_API_KEY`가 `argv`로 노출 | `scripts/cowork-fire-listener.py:47-55` — 프롬프트를 argv에서 빼고 **stdin**으로 전달 (task#254) |
| B22 | fire 워크디렉터리 초 단위 충돌 → `run.log` truncate | `scripts/cowork-fire-listener.py:44-46` `mkdtemp(prefix=ts+"-", dir=RUN_DIR)` (task#254) |
| B10 | 관심종목 토글이 POST/DELETE를 반대로 고른다 | `pages/Ranking.jsx:149-162`(`watchUnknown` 도입)·`:214-224` — 토글이 fetch 결과가 아니라 *알려진 상태*로 결정 (task#266, 재검증 task#272) |
| B11 | 이미 추적 중인 종목이 "추가" 모달로 라우팅 | `components/GlobalSearch.jsx:19-29`(`fetchTracked`가 실패 시 null 반환)·`:31-45` — 라우팅이 unknown을 별도 분기 (task#266, 재검증 task#272) |
| B12 | `loadStockMap`에 catch 없음 → unhandled rejection | 옛 인라인 로직 소멸, `hooks/useTrackedStocks.js:29-45`의 `reload()`로 **이동하며 닫힘** — `try/catch`(`:30`,`:38`)로 감싸 내부 처리 후 `false` 반환이라 reject 불가 (task#266, 재검증 task#272) |
| B13 | 수급 추이 Y축이 주(株)를 억원으로 포맷 → "541.4조" | `components/reports/InvestorTrendSection.jsx:55-56` — 주(株) 입력에 `fmtSharesKr` 적용 (task#271, 재검증 task#272) |
| B14 | 구루 총 투자금에 T 단위가 없어 `$1,077.0B` | `pages/GuruAllocation.jsx:10`,`:148`,`:176`,`:219` — T 티어를 가진 `fmtUsdCompact`로 교체 (task#271, 재검증 task#272) |
| B27 | 랭킹 마켓 토글 레이스 — 원화가 `$` 포맷으로 고착 | `pages/Ranking.jsx:79-81`(`genRef`)·`:104-105`·`:114`,`:123`,`:128` — 세대번호 가드로 낡은 응답의 `setItems`·`finally`를 함께 차단(reset은 뮤텍스 우회) (task#273) |
| B32 | `Recommendations.jsx` 관심목록 조회 실패가 성공-빈배열로 위장 | `pages/Recommendations.jsx:9`,`:90` — 조회·pending·실패 표시를 `hooks/useTrackedStocks`로 통합해 unknown을 별도 상태로 노출 (task#273) |
| B28 | 구루 명부의 부분 열화가 '은퇴'로 오분류돼 생존 매니저가 통째 drop | `services/storage/schedule.py`의 `_ROSTER_MIN_COVERAGE = 0.8` — 명부가 직전 저장분의 80% 미만이면 그 회차 드롭을 보류(`held`) (task#274) |
| B29 | 구루 크롤 `dropped`를 읽는 코드가 0건 — 매니저 삭제가 초록 "완료" | `routers/guru.py`·`scheduler/jobs.py` 두 경로가 `held`→`partial`+warning, `dropped`→초록 유지+숫자 보고로 분기 (task#274) |
| B31 | 구루 크롤의 스킵·부분·실패가 `job_runs`에 항상 `success` | `services/job_runs.py`의 `Run` 핸들(`set_status`)로 본문이 종료 상태를 지정 — 구루 2경로 배선(skipped/partial/failed) (task#274) |
| B2 | `sanitize`가 `Decimal('NaN')`을 통과시킨다 | `services/utils.py:37`에 `isinstance(obj, Decimal) and (obj.is_nan() or obj.is_infinite())` 가드 추가 — float과 동일하게 `None`화, 기존 sanitize 호출처 전부 소급 강화(`tests/test_utils_sanitize_decimal.py`) (task#278) |
| B3 | `POST /api/portfolio`가 raw JSON `NaN`을 저장 → `GET /api/portfolio` 영구 500 | `routers/portfolio.py` `Stock`/`set_rebalance_targets` + `routers/watchlist.py` `PromotePayload`에 `allow_inf_nan=False` 입력 가드 + `main.py`의 기존 `RequestValidationError` sanitizing 핸들러가 422 detail echo를 방지. 드리프트 가드 `tests/test_nan_input_guards.py`가 라우터 전수 float 필드를 열거로 단언 (task#278) |
| B4 | NaN이 컨센서스 마트까지 전파 | `services/consensus_pipeline.py`의 `upsert_raw_reports`(단일 INSERT 통로)에 `math.isfinite` 정규화 초크포인트 추가 — NaN/Infinity `target_price`를 필터 앞에서 `None`화(`tests/test_consensus_target_nan.py`) (task#278) |

---

## 1. 데이터 무결성 — 빈/실패 fetch가 양호값을 덮어씀

이 프로젝트 최대 반복 결함군. task#242·#243·#244가 19개 저장 지점을 전수 감사하며 **실패 클래스 3종**(a 예외 / b 성공-but-빈응답 / c 부분 페이로드)을 정리했다. 아래는 그 감사 **이후 남은** 것들이다.

### 1.1 `get_kr_rankings` wipe-on-empty — **확인된 버그** (B1)
- `services/ranking_service.py:129-137`. `_fetch_naver_market`은 부분 페이지 실패를 `raise`하고(`:120-123`), HTTP 오류는 `raise_for_status()`(`:104`)로 잡는다. 그러나 **200 + `totalCount:0`/`stocks:[]`** 이면 `pages<=1` → `return stocks`(`:109-110`)로 빈 리스트를 정상 반환한다.
- 형제 `get_us_rankings:144-145`는 정확히 이 문을 `raise RuntimeError("… returned empty quotes — skipping replace")`로 막았고, `tests/test_rankings_empty_guard.py`가 **US만** 못박았다(`:1` docstring·`:10`·`:17`·`:24` 세 테스트 전부 `get_us_rankings`만 언급 — 가드 범위가 곧 결함 범위).
- 결과: `replace_market_rankings("KR", …)`의 단일 트랜잭션 `DELETE FROM market_rankings WHERE market='KR'`(`:162`)이 돌고 INSERT가 0건. **단일 트랜잭션은 부분 상태를 막지만 "전부 지우고 전부 안 넣는 것"은 정상 커밋된다.**
- **blast radius가 랭킹 탭을 넘는다** — `services/investor_service.py:140`(`read_screening`, def는 `:132`)과 `scheduler/jobs.py:269`가 유니버스를 `market_rankings`에서 파생한다.

### 1.2 `ON CONFLICT DO UPDATE SET x = EXCLUDED.x`가 양호 컬럼을 NULL로 덮음 — **잠재 위험** (재실행·백필에서 확정적)
task#242·#243 감사는 `market_cache`와 delete-rewrite만 봤고 아래는 스코프 밖이었다. 이번 전수 스윕으로 **4곳 → 6곳**으로 늘었다.

| 위치 | None이 들어오는 경로 |
|---|---|
| `services/leverage_service.py:125-153` + `:167-180` | credit·fund·cap **3개 독립 fetch**를 `by_date`로 머지. cap이 빠지면 `row.get("kospi_market_cap")`(`:147`) = None → 9컬럼 전부 같은 형태 |
| `services/leverage_service.py:116-121` + `:176-177` | **더 날카로운 트리거** — `_parse_market_cap`이 각 날짜를 `{"kospi_market_cap": None, "kosdaq_market_cap": None}`로 선-시드(`:117`)하고 **한글 지수명 substring 일치**로만 채운다(`:118-121`). KOFIA가 지수 문자열을 개명하면 `cap_rows`는 **비어 있지 않은데** 두 값이 명시적 None이고, `:177` `update(row)`가 머지 dict를 그 None으로 덮고 `if by_date:`(`:179`)를 통과한다. **빈 응답이 아니라 라벨 드리프트만으로도 충분하다** |
| `services/lending_service.py:72-85` | 단일 소스라 확률 낮음, `_safe_int` 파싱 실패가 트리거 |
| `services/investor_service.py:92-112` | `foreign_hold_ratio`는 키움 전용. Naver 폴백(`:59-69`)이 None을 주면 양호 ratio를 지운다 |
| `services/short_sell_service.py:25-42` | 동일 형태 |
| **`services/dividends.py:151-163`** (`:160`) | **신규 발견 — 5번째.** `fetch_us_dividend`가 `dividendRate`는 있고 `dividendYield`가 없거나 파싱 실패면(`:63-67`) `"dividend_yield": None`(`:70`)을 반환 → 부분적인 yfinance `t.info`가 직전 양호 수익률을 지운다 |
| **`services/supply_score.py:181`** (def `:168`) | **신규 발견 — 낮은 심각도.** `as_of = EXCLUDED.as_of`에 `as_of: dict | None`이 None이면 양호 JSONB를 덮는다(`band`/`flags`는 필수라 영향 제한) |
| `services/agm.py:223` | `meeting_date = EXCLUDED.meeting_date` — None 산출 경로를 추적하진 못했다. 스윕에 남은 미감사 지점으로만 기록 |

- 수정 형태: `SET x = COALESCE(EXCLUDED.x, table.x)`.
- **정상으로 확인된 곳(재제기 금지)**: `services/beta.py:93-94`(호출측 `:134` `if beta is not None` 가드), `services/storage/portfolio.py:58,124,139`(이미 `CASE WHEN`/`COALESCE`), `services/backlog.py:228`(`CASE WHEN`).

### 1.3 부분 페이로드가 완전한 값을 대체 — **잠재 위험**
`_mc_save`를 하는 17개 키 중 whole-empty 가드는 붙었으나 **per-key/per-item** 가드가 없는 곳:
- `services/market_indicators/commodities.py:27-29,58` — per-key 예외가 `None`이 되어 payload에서 그 키가 사라진다. 형제 `treasury`(`:91-95`)는 per-key stored merge를 하는데 `commodities`만 안 한다(같은 파일 내 비대칭).
- `services/market_indicators/earnings.py:217,251` — `_merge_quarters`(호출 `:205-206`, `:232-233`)가 **살아남은 티커만** 합산해 M7/KR Top2 실적 총계가 조용히 과소계상된다.
- `services/kr_sector_service.py:62-65` — per-sector all-None 엔트리가 저장된다. `build_sector_index`(`:104-106`)가 실패 업종을 스킵하므로 "비어 있지 않지만 불완전한" 인덱스가 완전한 것을 덮는다(task#243은 *전체* 빈 경우(`:83-86`)만 막았다).
- `services/us_sector_service.py:33` — per-ETF all-None(`services/analysis_service.py:50-53`)이 저장된다.
- `services/market_indicators/sentiment.py:71` — score는 있고 `history`가 빈 응답이면 저장된 60포인트 시계열을 덮는다.
- `services/guru_scraper.py:378-408` + `services/storage/schedule.py:23-35` — `save_guru_managers`는 **전체 빈 경우만** 게이트한다. 83명 중 40명만 성공한 부분 크롤이 저장되어 나머지 43명을 지운다. `:408`이 비율을 로그로 남기지만 아무도 그 값으로 분기하지 않는다.
- 회귀 테스트(`tests/test_empty_result_overwrite_guards.py`, `test_empty_result_guards_exports_krsector.py`)는 **all-empty만** 단언한다 — 남은 구멍이 정확히 그 사각에 있다.

### 1.4 배당 스케줄 delete-rewrite — **설계상 트레이드오프**(판별 불가한 실패 클래스)
- task#160이 클래스 (a)를 닫았다: `services/dividends.py:228-233`이 fetch 예외를 **전파**하고 `:389`가 fetch를 `replace_schedule` 진입 *전에* 평가한다(소스-폴백 구조).
- 남는 것: yfinance는 실패를 예외가 아니라 **빈 Series**로 주는 일이 흔하고, `:235-236`이 `len(s)==0 → []`, `:260-261`이 `len(hist)<2 → []` → `replace_schedule(ticker, [])` → `DELETE`(`:314`). `:310` docstring이 "rows 비면 삭제만(genuine 무배당 정리)"라고 이 판별 불가를 명시 수용한다.
- 즉 "진짜 무배당"과 "빈 응답"을 구분할 신호가 소스에 없다. 닫으려면 fetch 성공 여부를 별도 플래그로 올려야 한다.

### 1.5 `_filter_outliers`가 저장 시계열을 영구 손상 — **잠재 위험**
- `services/market_indicators/cache.py:75-82`, 호출 `:91,97,107`. `max_ratio=5.0`으로 중앙값 5배 밖 포인트를 버리는데, 이 필터가 신규 포인트뿐 아니라 **저장된 stored 시계열에도 매 저장마다** 적용된다.
- `^VIX`(`fx.py:99`)처럼 평시 중앙값 ~15에 스파이크 60~80이 정상인 시계열은 진짜 스파이크가 영구 제거된다. `commodities`/`indices`/`kospi_signal` 드라이버도 같은 경로.

### 1.6 `econ_indicators` 고착 — **잠재 위험**
- `services/market_indicators/econ.py:72-75`가 저장 행을 **나이 검사 없이** 서빙하고 `_is_valid_econ_data({})`(`:55-60`)가 `True`다. `:49-50`에서 FRED가 0 observation을 준 채 한번 `{"cpi":[],"unemployment":[]}`가 저장되면 **영구히** 그 값이 서빙된다.
- 추가로 `:78`의 `_mc_delete`가 **재fetch 이전에** 실행된다(오염 데이터 의도적 폐기지만, 이후 FRED 불통이면 키가 없는 상태로 남는 파괴적 순서).

### 1.7 소스-폴백이 정답 형태다 — **이미 가드됨(참조 패턴)**
빈 결과 가드의 기본형은 "저장 직전 한 지점 판정"이 아니라 **fetch 계층에 last-good을 실어 소스에서 폴백**시키는 것이다. 참조 구현:
- `services/market_indicators/fx.py:36-40` — fetch 실패 시 `stored_history`를 담아 *반환*. **단 B25 참조 — `usdkrw` 외 2키는 stored가 항상 비어 이 분기가 죽어 있다.**
- `services/market_indicators/cache.py:69-72` — `_merge_history(prev, [])`가 prev를 그대로 반환.
- `services/market_indicators/indices.py:31-37,133-134,143` — per-key stored 폴백 + `if any(...)` persist 게이트. **17개 키 중 형태가 가장 좋다.**
- `services/market_indicators/macro.py:70-73,76,79` — per-key stored merge + 실패 시 stored 반환. (지난 판이 §1.3 구멍 목록에 잘못 넣었던 곳 — **참조 목록이 맞다.**)
- `services/market_indicators/kospi_futures.py:21-23,55-58` — 값 수준 가드(`price is None or not history` → last-good), task#157.
- `services/market_indicators/kospi_signal.py:189,197,233-234,243,249` — `fetch_ok` 플래그 + `changed` 게이트(`_mc_save`는 `:250`).
- `services/us_supply.py:231-241,259-262` — `_is_all_empty` + skip-save.
- `services/recommendation/store.py:15` + `funnel.py:459` — 단일 트랜잭션 + 호출자 게이트.

---

## 2. 외부 소스 파싱 취약성

### 2.1 Naver 재무를 **위치 인덱스**로 읽는다 — **잠재 위험** (이 군에서 가장 위험)
- `services/market/kr.py:45-54` `_naver_row_val(rows, row_idx, key)`; 소비 `:333,349-354,362,373-377`(분기) / `:422,429-434,436,447-451`(연간).
- 행 순서가 곧 계약이다: `rows[0]`=매출, `[1]`=영업이익, `[2]`=순이익, `[5]`=영업이익률, `[6]`=순이익률, `[7]`=ROE, `[8]`=부채비율, `[9]`=당좌비율, `[11]`=EPS, `[12]`=PER, `[13]`=BPS, `[14]`=PBR.
- Naver가 `financeInfo.rowList`에 한 행만 삽입/재배열하면 **모든 필드가 밀려 "그럴듯한 오값"**이 된다 — 흔한 silent-None보다 나쁘고 로그에도 안 남는다. `pbr`은 심지어 밀린 `per*eps/bps`에서 *파생*된다(`:359-360`).
- 가드 없음. `tests/test_financials_kr.py`·`test_financials_kr_cashflow.py`의 fixture가 같은 순서를 쓰므로 라이브 재배열에도 green으로 남는다. `trTitleList`/행 제목과의 라벨 교차검증이 없다.

### 2.2 `_table_unit`의 억원 기본값 폴백 — **잠재 위험** (×100 대형 오저장 클래스)
- `services/backlog_parser.py:211-220`. 세 갈래 중 **`단위` 문자열을 아예 못 찾으면 `_DEFAULT_UNIT="억원"`**(`:220`)으로 떨어진다. "추출 실패는 기본값이 아니라 pending"(wrong<missing) 규칙의 남은 한 다리.
- 가중 1: `table.find_previous(string=re.compile("단위"))`(`:216`)가 **범위 무제한**이라 앞쪽 무관한 표의 캡션을 집어 다른 표에 적용할 수 있다.
- 가중 2: 검산이 **단위 맹목**이다 — `_parse_susu_table`이 raw 값으로 `_reconcile`(`:183`)한 *뒤* `_to_eok`(`:185`)로 스케일한다. `수주총액 − 기납품 ≈ 잔고`는 어떤 단위에서도 성립하므로 틀린 단위가 검산을 통과해 `source='dart'`로 ×100/÷100 저장된다.
- 참조 정답: `services/market/kr.py:529-536` `_rd_unit`은 캡션 없으면 `None`을 반환하고 `:603`에서 `continue`한다 — 주석이 `backlog._table_unit`과 다르다고 명시한다.
- 부수: `backlog_parser.py:22` `_UNIT_KEYWORDS`가 `천원`/`원`을 빠뜨려(`_EOK_FACTOR:29`와 `_table_unit` 정규식은 지원) 천원 표가 억원으로 떨어진다. pending 경로 전용이라 영향 작음.

### 2.3 숫자 파서가 드리프트에 `0`을 반환하고 그 0이 저장된다 — **잠재 위험**
- `services/kiwoom/investor.py:15-24` `_signed_int` → `0`, 소비 `:61-64`.
- `services/kiwoom/shortsell.py:19-28` `_int` → `0`, 소비 `:61-65`.
- `services/investor_service.py:11-21` `_parse_signed_int` → `0`, 소비 `:51-55`.
- 필드가 개명되면 `0`(None 아님)이 나와 `upsert_trend`가 저장한다 → "수급 0인 날"과 "필드 소실"을 구분할 수 없다. **같은 파일의 `_pct` 헬퍼들은 None을 반환**해 규칙을 지킨다(`investor.py:27-36`, `shortsell.py:31-40` — 비대칭).
- 참조 정답: `services/insider_trades.py:65-78` `_num`은 None을 반환하고 `:98-99`가 그 행을 스킵한다.

### 2.4 DART status 코드가 전 경로에서 무시된다 — **잠재 위험**
- 6곳 전부 `status != "000"`을 코드 없이 삼킨다: `services/backlog.py:114`, `:317`, `disclosures.py:66`, `insider_trades.py:140`, `agm.py:139`, `market/kr.py:573`.
- DART는 `013`(무데이터, 정상) 외에 `020`(레이트리밋 초과)·`011`/`012`(키 무효/미인가)를 준다. 전부 `continue`/`[]`/`{}`로 수렴하므로 **일일 쿼터 소진이나 키 회전이 "성공했는데 데이터가 없음"으로 보인다** — KR 배치 5종(수주잔고·공시·내부자·주총·배당)이 동시에 무음 미동작. `disclosures`·`insider_trades`·`backlog`·`dividends`는 `DART_API_KEY` 존재를 검사조차 안 한다.
- 참조 정답: `services/agm.py:163`만 `"[AGM] DART_API_KEY 미설정 — skip"`을 로그한다.

### 2.5 완전 무음 fetch 실패 — **확인된 버그**(진단 불가)
외부 fetch 경로는 대체로 잘 로깅된다. 로그도 재전파도 없는 곳만:

| 위치 | 삼키는 것 |
|---|---|
| `services/guru_scraper.py:23-39` `get_name_kr`(`pass`는 `:37-38`) | 모든 `name_kr`이 `""` |
| `services/market/us.py:171-173` `_us_quote_kis` | `return None` — KR 쌍둥이(`kr.py:79-81,95-97`)는 같은 실패를 로그한다 |
| `services/scraper.py:23-25` | Finviz `snapshot-table2` 클래스 변경 → `{}` |
| `services/guru_scraper.py:198-199` | dataroma `table#grid` 재구조화 → `num_stocks=0`, 빈 holdings |
| `services/market/kr.py:639-647`(`:642-643`, `:646-647`) | FnGuide `TARGET_PRC`/`RECOM_CD` 개명 시 전 행 스킵 → `_empty`(`:622`, buy/hold/sell=0)를 "커버리지 없음"처럼 반환 |
| `services/market/kr.py:30-42` `_fnguide_market_cap` | 정규식 무매치 → None, `raise_for_status()` 없음(`:34`) |
| `services/market/kr.py:308-319` | `get_quote_kr` 최상위 except → error dict(응답엔 뜨나 서버 로그엔 흔적 없음) |
| `backend/main.py:51-57` `_warm_market_cache` | `except Exception: pass` — 프로젝트 자체 "silent except 금지" 규약 위반 |

앱 코드 전체에서 로그 없는 `except … : pass`는 **14곳**: `routers/calendar.py:162`, `scraper.py:34`, `scraper.py:39`, `guru_scraper.py:38`, `report_generator.py:47`, `market_indicators/earnings.py:192`, `storage/portfolio.py:20`, `market_indicators/indices.py:57`, `indices.py:86`, `market/kr.py:643`, `kr.py:647`, `main.py:57`, `middleware/event_tracker.py:49`, `event_tracker.py:71`.

### 2.6 퍼센트 스케일 계약이 갈려 있다 — **잠재 위험**
동일 DB에 두 규약이 공존하고 판정 주체가 **프론트**다. 인제스트 경계에 정규화도 범위 단언도 없다.

| 필드 | 저장 | 프론트 | 스케일 |
|---|---|---|---|
| `short_pct_float` | `services/us_supply.py:119` | `market/UsSupplySection.jsx:82` `(v*100)` | 소수분수 |
| `pct_held`/`pct_change` | `us_supply.py:129,131` | `UsSupplySection.jsx:125,129` | 소수분수 |
| `pct_buy`/`pct_sell` | `us_supply.py:78-83` | `UsInsiderSection.jsx:107,113` | 소수분수 |
| **`dividend_yield`(US)** | `services/dividends.py:63-66` | `portfolio/DashboardCard.jsx:146` **×100 없음** | 퍼센트 |
| `dividend_yield`(KR) | `dividends.py:143` (DART `%`) | 같음 | 퍼센트(진짜) |

- **모순이 문서 두 곳에 박혀 있다**: `services/dividends.py:46`(및 `:4`)은 "현 yfinance는 퍼센트 스케일"이라 단언하는데, `CLAUDE.md:233`은 `info.dividendYield`를 **소수분수(0~1)** 목록에 명시 포함한다. **둘 중 하나는 stale이고 코드에 가드가 없다.** `requirements.txt:4`는 `yfinance>=0.2.40` 범위 핀이고 이 필드의 스케일은 그 범위 안에서 바뀐 이력이 있다 → 버전 범프가 전 US 수익률을 100배 틀리게 만들 수 있다.
- 나머지 `*100` 사용처는 정합함을 확인했다(`hv`는 `reports/DetailTab.jsx:650`·`Compare.jsx:89` 양쪽에서 곱함). `us_supply.py:78-83`은 DataFrame 행 라벨 exact 문자열(`:75` `"Net Shares Purchased (Sold)"`, `:78` `"% Buy Shares"`)에 의존한다.

### 2.7 단위 배수 하드코딩 — **설계상 트레이드오프**(일회성 라이브 프로브가 유일한 근거)
`kiwoom/quote.py:47`(억원→×1e8) · `kis/quote.py:51`(×1e8) · `kiwoom/shortsell.py:62`(천원→×1000) · `market/kr.py:365-366,372,439,446`(×1e8) · `backlog.py:291`(÷1e8) · `leverage_service.py:339-345` · `lending_service.py:145-148` · `exports.py:75-76,98-99`. 벤더가 단위를 바꾸면 100~1000× 무음 오류.
- **죽은 코드지만 함정**: `services/market/format.py:26-32` `_to_won`은 크기로 단위을 추론한다(`v*1e8 if abs(v) < 1e10 else v`). 호출처 0(`market/__init__.py:13`에서 re-export만). 진짜 100억 미만 원 값이 들어오면 1e8배 부풀린다.

### 2.8 무한 루프 가능 페이지네이션 — **잠재 위험**
- `services/lending_service.py:24-35` `_fetch_all`: `while True`가 `len(items) < page_size`로만 탈출한다. 형제 `leverage_service.py:45`은 `totalCount`도 본다. 포털이 `pageNo`를 무시하고 계속 1000행을 주면 배치 안에서 무한 누적.
- `services/kiwoom/client.py:114-130` `request_paged`: 페이지 카운터 없음(break는 `:128`). `list_key`가 드리프트하면 `items`가 안 늘어 `max_items` 브레이크가 무력화된다.

### 2.9 응답 봉투·상태 검사 누락 — **잠재 위험**(낮음)
- `services/kiwoom/client.py:71,153`·`kis/client.py:129` — `rc not in (0, None)`이라 **`return_code`/`rt_cd`가 아예 없으면 성공으로 취급**한다. 프록시/봉투 변경 시 에러 본문이 정규화기로 흘러 all-None이 된다. 하류 `price is None` 검사(`market/kr.py:82-84,98-100`)만이 가드.
- `.json()` 앞에 상태 검사가 없는 6곳 — 요청은 `disclosures.py:50`, `insider_trades.py:125`, `backlog.py:102`, `:306`, `agm.py:126`, `dividends.py:114`이고 실제 파싱은 각각 `:61`, `:135`, `:113`, `:316`, `:135`, `:124`. 전부 try/except 안이라 HTTP 오류가 "파싱 실패"로 보고되는 정도.
- `services/market_indicators/exports.py:143-145` — 레거시 파일 캐시를 try/except 없이 `json.load`한다. `:128-130`의 비원자적 write로 잘린 파일이 남으면 엔드포인트가 500.

### 2.10 취약·비공식 소스 인벤토리
| 소스 | 위치 | 차단 시 |
|---|---|---|
| CNN F&G | `market_indicators/sentiment.py:10,27-58` | **가드됨** — VIX식 수동 last-good(`:75-78`) |
| `multpl.com/shiller-pe` | `market_indicators/indices.py:98-109,42-95` | **가드됨** — 저장 CAPE 폴백(`:133-134`) |
| **dataroma** | `services/guru_scraper.py:10,116,175,308` | **가장 취약** — 위치 인덱스 `cells[1]/[2]/[3]/[6]`(`:135-163`), CSS id `div#f_name`/`p#p2`/`table#grid`, `_ACT_ROW_TDS=5`(`:222`), `weight_pct` 기본 `0.0`(`:148`), `portfolio_value` 기본 `0`(`:184`, `_parse_portfolio_value:50,54`). `scrape_holdings`에 빈 결과 가드·로그 없음 |
| Naver 모바일 API | `market/kr.py:16,19-22` 외 6곳 | 시세는 2-of-N 다수결로 보호. **재무 경로(§2.1)가 노출면** |
| Naver US API | `guru_scraper.py:11,31` | 무음 `""` |
| FnGuide (HTML + 비공식 JSON) | `market/kr.py:33,626`, `consensus_pipeline.py:125` | 컨센서스는 Naver Research 폴백. 시총 경로 무음 |
| Wikipedia S&P500 표 | `market_indicators/earnings.py:117,121` | `table id=constituents` 의존, 시드 파일 폴백 있음 |
| Naver 시총 페이지 (euc-kr) | `market_indicators/earnings.py:135,143` | `range(1,50)` 최대 49콜 |
| Finviz | `services/scraper.py:19` | `{}`, 부분 무음 |
| UN Comtrade preview | `market_indicators/exports.py:13,84-89` | **가드됨** — task#243 last-good + `stale` 마커 |
| Google Fonts / jsdelivr | `frontend/index.html:45-49` | 자체호스팅 앱의 외부 의존(첫 로드 후 SW CacheFirst로 완화, `vite.config.js:22-38`) |

- 하드코딩 URL 중복: `market/kr.py:626`과 `consensus_pipeline.py:125`가 같은 FnGuide JSON 경로를 독립 조립한다 — 한쪽만 고치면 다른 쪽이 깨진 채 남는다.
- `requests.get/post` — **47개 호출 지점**(지난 판 "28개"는 stale). 스팟 확인한 다중행 호출은 전부 `timeout=`을 갖지만, 개수가 늘어 **한 줄 grep으로 "전부 가드됨"을 재확인할 수 없다** — 새 호출을 추가할 때 `timeout=`을 눈으로 확인할 것.
- BeautifulSoup 10곳 전부 `"html.parser"`. 로컬 `.venv`에 `lxml`이 없으므로 이게 정답. **이미 가드됨.**

### 2.11 중립 기본값이 실패를 정상값으로 둔갑시킨다 — **잠재 위험 + 설계상 트레이드오프**
- **잠재 위험** — `services/consensus_pipeline.py:40` `_score`가 정확맵(`:12-27`)→부분문자열(`:36-39`) 실패 시 **`3.0`(중립)**을 반환한다. 같은 형태가 `:145-147`(`recom = 3`)·`:148`(`_RECOM_TO_OPINION.get(…, "중립")`)에도 있다. 새 증권사 표현이나 벤더 언어 변경이 조용히 중립 점수를 `raw_reports.opinion_score` → `daily_consensus_mart.avg_opinion_score`와 buy/hold/sell 버킷(`_MART_SQL` `:246`, 버킷 `:269-271`)에 희석시킨다. "매핑 안 된 의견" 로그가 없어 관측 불가.
- **설계상 트레이드오프(ADR-0016)** — `services/recommendation/scoring.py:23` `_NEUTRAL = 0.5`을 결측군에 채운다(`:44`, `:136-139`, `:144`). 재정규화 대신 중립 채움을 택해 "근거 완전성이 점수에 반영"되게 한 의도된 선택이고 `:136-138` 주석이 근거를 담는다. 비용: 데이터가 거의 없는 종목이 중간 점수를 받는다.

---

## 3. NaN/Inf·수치 타입

### 3.1 `sanitize`가 `Decimal('NaN')`을 통과시킨다 — **해소** (B2, task#278)
- `services/utils.py:37`이 `isinstance(obj, float)`만 검사하던 문제. PostgreSQL `numeric`은 **NaN을 저장한다**(psycopg2가 `Decimal('NaN')`으로 되돌린다).
- 수정: `isinstance(obj, Decimal) and (obj.is_nan() or obj.is_infinite())`를 float 검사에 나란히 추가 → `None`화. **한 줄로 기존 sanitize 호출처 전부가 소급 강화됐다**(`routers/stocks.py:673`의 `get_dashboard` 등 raw Decimal이 섞여 있던 지점 포함).
- 정상 `Decimal` 값은 float으로 캐스트되지 않고 타입 그대로 통과한다(`type(v) is Decimal` 확인).
- 부수: `sanitize`는 여전히 tuple·set을 순회하지 않는다(현재 응답에 그 타입이 없어 무해, 미변경).
- 회귀: `tests/test_utils_sanitize_decimal.py`(5건).

### 3.2 NaN이 컨센서스 마트까지 전파 — **해소** (B4, task#278)
- `services/consensus_pipeline.py:184` — `tp = float(row.get("currentPriceTarget") or 0) or None`. **NaN은 truthy**라 `nan or 0` → `nan`, `nan or None` → `nan`이던 문제.
- 수정: 같은 파일의 `upsert_raw_reports`(개별 fetcher 3개가 아니라 그 앞의 **단일 INSERT 통로**)에 `math.isfinite` 정규화 초크포인트를 추가 — NaN/Infinity `target_price`를 `None`화하고, 그 정규화를 `opinion 있거나 target 있으면 통과` 필터 **앞**에 배치(순서를 docstring에 명시). `raw_reports.target_price`→`AVG()`→`daily_consensus_mart.avg_target_price`(ADR-0008 정본) 경로가 더 이상 NaN에 오염되지 않는다.
- 회귀: `tests/test_consensus_target_nan.py`(NaN·Infinity 정규화, 정상값·기존 None 불변 확인 3건).

### 3.3 입력 경로 Pydantic float 가드 누락 — **해소** (B3, task#278)
`allow_inf_nan=False`를 설정한 곳이 **한 파일·두 모델·세 필드**(`analyst_reports.py`만)였던 상태가 해소됐다. 현재:

| 필드 | 위치 | 상태 |
|---|---|---|
| `PointMetric.change_pct`/`fair_value_low`/`high` | `routers/analyst_reports.py:31,44,45` | 가드(task#250, 밴드 validator `:50-56`) |
| `Stock.quantity`/`.avg_cost`/`.target_price`/`.stop_price` | `routers/portfolio.py` `Stock`(`model_config = ConfigDict(allow_inf_nan=False)`) | 가드 |
| `weights: Dict[str, Optional[float]]` | `routers/portfolio.py` `set_rebalance_targets`(`Annotated[float, Field(allow_inf_nan=False)]`) | 가드 |
| `PromotePayload.quantity`/`.avg_cost` | `routers/watchlist.py` (`model_config = ConfigDict(allow_inf_nan=False)`, 기존 `Field(gt=0)` 유지) | 가드 |
| enrich 16개 `Optional[Any]` | `routers/stocks.py:131-138,144-151` | 타입 자체가 Any — 스코프 밖, 무가드 잔존 |

- **드리프트 가드 신설**: `tests/test_nan_input_guards.py`가 `routers/` 패키지를 순회해 각 모듈이 직접 정의한(임포트 아닌) `BaseModel` 서브클래스를 수집하고, `typing.get_args`로 float을 포함하는 필드 애너테이션을 재귀 탐지해 `allow_inf_nan=False`(모델 `ConfigDict` 또는 필드 `Field(...)` 메타데이터, 속성으로 확인)로 가드됐는지 열거로 단언한다. **신규 float 필드가 무가드로 추가되면 이 테스트가 즉시 실패**하므로, 표 갱신을 잊어도 재발은 스위트가 막는다.
- ⚠️ **422 행동 테스트는 자체-app(`FastAPI()`)이 아니라 conftest의 `client`(=`main.app`)로 돌려야 한다** — `main.py:272` 근처의 `RequestValidationError` sanitizing 핸들러가 그 안에만 배선돼 있고, 자체-app 테스트(`test_portfolio_router.py:9-12`·`test_watchlist_router.py:9-12`)엔 없어 422 detail의 NaN echo가 500으로 재발한다.
- 회귀: `tests/test_nan_input_behavior.py`(3표면 행동 핀 + 모델 레벨 핀, 12건).

### 3.4 sanitize가 없는 응답 경로 — **잠재 위험**
- `routers/report.py:474` — `_read_snapshot`이 `:152/:157`에서 sanitize하지만 `apply_asof`(`:466`)가 **그 뒤에** 마트 Decimal을 주입한다.
- `routers/report.py:306,326,510,562`, `routers/analysis.py:23,39`, `routers/digest.py:20,25`. (`routers/portfolio.py:62,148`는 task#278에서 `sanitize()`로 감싸 §3.5로 이동 — `get_portfolio`/`get_portfolio_prices`.)
- `routers/guru.py` — sanitize 없는 핸들러 **6개**: `:23`, `:35`, `:44`, `:50`, `:56-61`, `:65`.
- `routers/market_indicators.py` — **`@router.get` 17개 전부 sanitize 0회**(`:33,41,49,57,65,73,81,89,97,105,113,122,143,214,222,244,250`). 지난 판의 "핸들러 9개"는 과소집계였다.
- `routers/rankings.py:66`·`routers/investor.py:58`·`routers/short_sell.py:39` — bare `float()` 헬퍼에 `isfinite` 없음(`rankings.py:13`, `investor.py:9`, `short_sell.py:9`).

### 3.5 응답 경로 — **이미 가드됨(잔여 위험만)**
- `services/utils.py:36-43` `sanitize`(단, §3.1의 Decimal 구멍).
- `routers/stocks.py:483-498` `_usdkrw_rate`의 `math.isfinite` 가드(`:498`) — NaN≠None이라 `if fx is None`을 통과하던 task#104 근본.
- `routers/stocks.py:673` `_build_all` 전체 sanitize; `:233-239` `_f`가 비교값 float+`isfinite` 정규화(`:237`).
- 확인된 정상 가드: `recommendations.py:151,210`, `analytics.py:47-49`, `analysis_service.py:124,127`, `portfolio.py:168,212`, `analyst_reports.py:69,87,107,120`(`services/analyst_reports.py:121-122`가 sanitize *전에* Decimal→float 캐스트하므로 §3.1 구멍에 안 걸린다), `indicators.py`, `report_generator.py:507,683`.
- ⚠️ **정정 — `market_indicators` 서브모듈이 "전부" 가드된 게 아니다**: sanitize를 하는 것은 **12개 중 4개**(`kospi_futures.py:50`, `indices.py:138`, `kospi_signal.py:248,278`, `sentiment.py:70`). `commodities.py`·`earnings.py`·`econ.py`·`exports.py`·`fx.py`·`macro.py`·`cache.py`는 `_mc_save` 전에 sanitize하지 않는다. 나눗셈은 전부 `if prev else 0.0`으로 가드되고(`fx.py:30,39`, `commodities.py:25`) 소스는 `dropna`를 타므로 **현재 라이브 위험은 낮다** — 고칠 것은 코드가 아니라 이 문장이다.
- 회귀: `tests/test_nan_serialization_guards.py`(task#109).

### 3.6 Decimal ↔ float — **이미 가드됨(잔여 위험만)**
- 수치 어댑터를 등록하는 코드가 없다(`register_type`/`DEC2FLOAT`/`new_type` 0건) → NUMERIC은 진짜 `Decimal`로 오고 모든 캐스트가 load-bearing이다. NUMERIC을 읽는 산술 ~30곳 전부 `float()`/`int()`/`pd.to_numeric`을 먼저 통과한다.
- 역사적 결함 지점이 주석(`:546`)과 함께 고쳐져 있다: `routers/stocks.py:549-552`(`float(annual_div) / float(avg_cost)`).
- **잔여 A**: `services/exposure.py:74` `e["weight"] * beta_map[...]`는 캐스트를 안 한다 — 두 호출자(`routers/portfolio.py:209`, `routers/stocks.py:295`)가 밖에서 캐스트한다. **세 번째 호출자가 원래 버그 형태를 그대로 재도입한다.**
- **잔여 B**: `routers/portfolio.py:110` `amt * qty`가 `services/dividends.py:352`가 `amount_per_share`를 float화했음에 의존한다(`:75-76` 주석이 *다른 모듈*의 사실을 단언한다).
- **잔여 C**: 규약이 사이트마다 수동이고 자동 가드가 없다. 회귀 테스트는 **Decimal**로 써야 한다 — fixture가 float이면 라이브에서만 깨지는 fixture-pass-live-fail이 된다.

### 3.7 최소카드 폴백이 근본원인을 마스킹한다 — **설계상 트레이드오프**
- `routers/stocks.py:661-667` `_safe`가 카드당 예외를 `_minimal_card`(`:631`)로 흡수한다. "holdings=N → 항상 N카드" 불변식(task#102)을 위한 의도된 선택이다.
- **비용**: 결함이 500도 토스트도 없이 "enrichment만 조용히 사라짐"으로 나타난다. 유일한 단서는 `docker logs portfolion-backend-1 | grep '최소카드 폴백'`(`:666`).
- 추가 잔여: 열화된 카드셋이 `_dashboard_cache`(TTL 300s, `services/cache.py:34`)에 **5분간 캐시**된다.

---

## 4. DB·스키마·트랜잭션·커넥션 풀

### 4.1 `app_schema.sql` ↔ `main._migrate` 미짝 — **잠재 위험**(프로세스 부채, 라이브 장애 아님)
ADR-0006: `_migrate`(`backend/main.py:60-238`)만이 라이브 DB에 도달한다. `app_schema.sql`은 빈 pgdata initdb 때만 실행되고, 그 파일 스스로 `:359-363`에서 이 사실을 문서화한다.

**`_migrate` 짝이 없는 컬럼 6개** (전부 `app_schema.sql`에만 존재):

| 컬럼 | 스키마 | 소비처 |
|---|---|---|
| `tickers.recent_disclosures` | `:15` | `services/storage/portfolio.py:55`(INSERT), `:223`(read) |
| `tickers.insights` | `:16` | `storage/portfolio.py:224` |
| `tickers.enriched_at` | `:20` | `routers/report.py:468`(SELECT), `storage/portfolio.py:293`(write) |
| `tickers.is_etf` | `:21` | `report.py:468`, `storage/portfolio.py:55,204,228` |
| `consensus_history.target_high` | `:87` | `services/consensus.py:18,69,99,106` |
| `consensus_history.target_low` | `:89` | `services/consensus.py:18,69,99,108` |

근접 미스: `tickers`의 baseline 이후 컬럼 8개 중 `_migrate`는 정확히 4개만 덮는다(`key_resource :17`→`main.py:203`·`competitor_edge :18`→`:208`·`market_outlook :19`→`:213`·`analyst_target :22`→`:218`). `report.py:468`은 `enriched_at, is_etf, analyst_target`을 한 문장에서 SELECT하는데 그중 하나만 마이그레이션돼 있다.

**⚠️ 테이블 쪽 규모를 정정한다 — 11개가 아니라 21개다.** `app_schema.sql`은 **32테이블**을 선언하고 `_migrate`의 `CREATE TABLE IF NOT EXISTS`는 **11개**뿐이다(`batch_schedules main.py:69`·`market_short_sell :74`·`stock_disclosures :84`·`stock_dividends :94`·`stock_dividend_schedule :105`·`stock_beta :120`·`stock_supply_score :129`·`stock_insider_trades :140`·`stock_recommendations :162`·`us_supply_snapshot :181`·`analyst_reports :223`).

- `_migrate` 규율(06-14경) **이후** 추가돼 짝이 없는 것: 없음 — 규율은 지켜지고 있다.
- 규율 **이전** 시기(2026-05-30~06-07)라 짝이 없는 것 11개: `user_menu_permissions`(`:112`) · `default_menu_permissions`+시드(`:120-127`) · `raw_reports`(`:130`) · `daily_consensus_mart`(`:142`) · `user_events`(`:158`) · `market_leverage_indicators`(`:176`) · `market_lending_balance`(`:190`) · `backlog_history`(`:202` — `segments` ALTER만 `main.py:64`에 있다) · `market_rankings`(`:215`) · `market_investor_trend`(`:234`) · `job_runs`(`:364`).
- 그보다 더 이전의 **baseline 10개**도 CREATE가 없다: `tickers :6` · `snapshots :26` · `user_stocks :34` · `schedules :48` · `guru_managers :56` · `guru_schedules :63` · `digests :76` · `consensus_history :84` · `calendar_cache :97` · `market_cache :105`.
- 지난 판이 baseline 10개를 목록에서 뺀 것은 "ADR-0006 이전"이라 방어할 수 있으나, **실패 모드를 과소평가하게 만든다** — 복구/재구축된 pgdata에서 `_migrate`만 돌면 **21테이블 6컬럼**이 없는 채로 기동한다. 부채의 본질은 `_migrate`가 자가치유형이 아니라는 것이다.

**그리고 검출 수단이 없다**: `app_schema` 문자열을 참조하는 테스트가 **0개**다. `tests/test_dividends.py:205`·`test_beta.py:160`처럼 **기능별** 테스트가 개별 테이블 DDL 발행만 단언하고, 짝을 **전수 대조하는 테스트는 없다**. DoD가 문서에만 있다.

### 4.2 `_migrate` 실패가 fail-open — **잠재 위험**
- `backend/main.py:60-238`이 **18개** 블록을 각각 `try/except` + `logger.warning`으로 감싼다(지난 판 "20개"는 stale). 마이그레이션이 실패해도 앱은 기동하고 그 테이블/컬럼을 쓰는 엔드포인트가 요청 시점에 깨진다. ADR-0006이 기대한 "lifespan yield 이전 완료" 보장이 실패 시엔 성립하지 않는다.

### 4.3 원자성 — 한 곳이 깨져 있다
`services/db.py`의 `query`/`execute`/`execute_many`(`:46`/`:54`/`:67`)는 **각자 자기 커넥션을 연다** → 한 호출 = 한 트랜잭션. `execute()` 두 번은 절대 원자적이지 않다.
- **확인된 버그 (B5)** — `routers/admin.py:111-119`: 6개 `execute()` = **6개 트랜잭션**. 루프 중간에 실패하면 반쯤 삭제된 사용자(포트폴리오는 지워졌고 `users` 행은 남아 여전히 로그인 가능)가 된다. **게다가 완전히 중복**이다 — 5개 자식 테이블 전부 `users(id)`에 `ON DELETE CASCADE`가 걸려 있으므로(`auth_schema.sql:17`, `app_schema.sql:35,77,98,113`) `:119` 한 줄로 충분하고 그게 원자적이다.
- **이미 가드됨** — delete-rewrite 4곳 전부 단일 공유 커서로 원자적이다: `dividends.py:312-331`, `ranking_service.py:160-178`, `recommendation/store.py:25-58`, `consensus_pipeline.py:354-363`. (단 원자성이 §1.1·§1.4의 "빈 결과가 정상 커밋되는" 문제를 막지는 않는다.)
- **잠재 위험** — `services/auth_service.py:56-61` `create_user`에 `users.email UNIQUE` 대한 `ON CONFLICT`가 없고, 두 트랜잭션에 걸친 check-then-insert(`routers/auth.py:77`→`:79`)로만 보호된다 → 동시 이중 제출이 400 대신 500을 낸다.

### 4.4 SQL 인젝션·배열 캐스트 — **거의 클린**
- 식별자 f-string 보간 2곳 모두 화이트리스트: `routers/admin.py:118`(`:111-117`의 하드코딩 5튜플만 순회), `services/storage/portfolio.py:295`(`:288`이 `fields.keys() <= _ENRICH_KEYS`를 단언하고 아니면 `:289` `ValueError`; `_ENRICH_KEYS`는 `:283` frozenset). 값은 파라미터 바인딩.
- `= ANY(%s)` **16곳** 중 uuid 컬럼은 하나이고 캐스트가 있다(`routers/admin.py:32` `%s::uuid[]`). 나머지는 `text` 컬럼이라 `text[]`가 맞다.
- **잠재 위험**: `routers/report.py:208` `date = ANY(%s)`에 `::date[]`가 없다. `latest_dates`(`:206`)가 `datetime.date`를 담아 지금은 동작하나 ISO 문자열을 먹이면 `operator does not exist: date = text`. `services/consensus.py:85`는 이미 per-element 캐스트를 한다.
- 다행 VALUES 형태: `services/consensus.py:81-85`가 `", ".join("(%s,%s::date)" …)`로 N행을 만든다(바깥 괄호 없음). `:83-84` docstring이 그 실패 모드를 경고한다.
- WHERE 없는 DELETE 하나 — `routers/calendar.py:63`, 순수 캐시이고 upsert로 재생성(`:118`), 의도적·문서화됨.
- `ON CONFLICT`는 **40개 문장 / 25개 모듈**에 있다(지난 판 "INSERT 25개"는 *모듈* 수였다). conflict target 정합성은 이번에 재검증하지 않았다 — 신규 upsert를 추가할 땐 실제 PK/UNIQUE와 대조할 것.

### 4.5 커넥션 풀 vs ThreadPool 적층 — **잠재 위험**
- 풀: `services/db.py:21-27` `ThreadedConnectionPool(minconn=1(:22), maxconn=20(:25))`. `get_connection`(`:31-41`)은 정상 종료 시 commit, 예외 시 rollback, `putconn`이 `finally`에 있어 **커넥션은 항상 반환된다**.
- **느린 외부 HTTP 호출을 걸친 채 풀 커넥션을 잡는 곳은 없다** — `with get_connection()` 블록 9곳(`auth_service.py:66`, `dividends.py:312`, `ranking_service.py:160`, `store.py:25`, `storage/portfolio.py:49,102,147,174`, `consensus_pipeline.py:354`) 모두 순수 SQL이고 fetch는 사전 평가된다.
- **문제는 적층이다** — DB를 만지는 워커:

| 위치 | max_workers |
|---|---|
| `routers/calendar.py:106` | **15** |
| `routers/stocks.py:669` (대시보드 `_build_all`, 카드당 다중 read — task#102 핫스팟) | 10 |
| `routers/analytics.py:39` (`parallel_map`) | 10 |
| `services/analysis_service.py:84` (`parallel_map`) | 10 |
| `routers/stocks.py:428` (이름 백필, 워커당 write 2회) | 8 |
| `scheduler/jobs.py:299` · `:427` | 8 |
| `services/report_generator.py:253` | 8 |
| `routers/report.py:142` (`parallel_map`) | 5 |
| `services/consensus_pipeline.py:107` | 5 |
| `services/kr_sector_service.py:71` (`parallel_map`) | 4 |

  대시보드(10)와 캘린더(15)가 동시에 오면 이미 20을 넘고, psycopg2 풀은 소진 시 **블록이 아니라 `PoolError`**를 던진다(`db.py:23-24` 주석).
- `scheduler/_state.py:5`가 `AsyncIOScheduler`를 executor 사이징 없이 만들어 APScheduler 기본 10워커가 각자 4~15 스레드를 띄운다. 배치 기본 시각도 겹친다(`batch_registry.py:188,204,419` 일요일 03:00에 `earnings_kr`·`earnings_us`·`guru_crawl`).
- 외부 fetch 전용(풀 무관·레이트리밋 관련): `market_indicators/earnings.py:202`·`:229`=**20**(~500·~900티커 순차 2회), `ranking_service.py:112`=12, `us_sector_service.py:28`=11, `exports.py:68`=6, `commodities.py:85`=4·`:43`=3, `fx.py:62`=3. `services/parallel.py:5` 기본값=10.
- **스테일 주석 4곳**이 틀린 불변식을 심는다: `db.py:23-24`(사이징 근거를 "calendar 15·analysis 11"로 적었으나 전체 최대 fan-out은 20 — 게다가 `CONCERNS §4.2`를 인용하는데 이 내용은 §4.5다), `routers/stocks.py:427`·`scheduler/jobs.py:298`·`:426`(`maxconn=10` — 실제 20).

### 4.6 N+1 쿼리 — **설계상 트레이드오프**
- `routers/stocks.py:510`이 카드마다 `_latest_snapshot(ticker)`를 단건 조회한다. 배치 헬퍼 `_latest_snapshots`(`:60-85`)가 같은 파일에 이미 있는데 `/compare`(`:290`)만 쓴다.

---

## 5. 인증·보안 노출

### 5.1 무인증 엔드포인트 — **이미 가드됨(잔여 위험만)**
- ADR-0029 3부작(task#230·231·232)이 무인증 read 37개를 전부 닫았다. 현재 `/api` **139개** 중 무인증은 `routers/auth.py`의 **9개**뿐: `register`(`:75`)·`login`(`:84`)·`refresh`(`:94`)·`logout`(`:102`)·OAuth 4개(`:139,153,186,199`)·token 교환(`:232`). 무인증 쓰기·IDOR 없음(사용자 스코프 핸들러는 전부 토큰에서 `user_id`를 파생).
- 회귀 게이트: `backend/tests/test_no_public_reads.py:28-38`이 `ALLOWED_PUBLIC` 9개를 양방향 exact-match로 못박고, `tests/_routes.py`의 `walk_routes`로 FastAPI `_IncludedRouter` 버전 발산까지 흡수한다.
- **잔여 1**: 게이트가 `/api` 프리픽스만 본다(`test_no_public_reads.py:62`). `/health`(`main.py:294`) 같은 비-`/api` 라우트는 게이트에 보이지 않는다(현재 무해).
- **잔여 2 (구조적)**: ADR-0029는 **authn만** 강제하고 authz는 안 한다(명시적 결정). `POST /api/auth/register`가 인터넷에 열려 있어 누구나 계정을 만들어 ~130개 `get_current_user` 엔드포인트를 직접 호출할 수 있다. 초대코드·이메일 검증·allowlist 없음. 부분 완화: `app_schema.sql:124-127`이 신규 사용자 기본 권한을 전부 `false`로 시드해 UI가 비어 보인다. → §5.11 참조.

### 5.2 Cowork API 키의 폭발반경 — **설계상 트레이드오프**(키 유출 경로 자체는 §11에서 닫혔다)
- ⚠️ **B18 해소** — `scripts/cowork-fire-listener.py`는 프롬프트를 argv에서 빼고 **stdin**으로 넘긴다(`:39-42` 조립 → `:47-52` `Popen`(프롬프트 없음) → `:54` `proc.stdin.write` → `:55` `close`). `ps -ww` 노출은 사라졌다.
- **남는 폭발반경은 그대로다**: `backend/auth.py:73-74`가 API 키를 **admin 등가로 즉시 통과**시키므로 이 키 하나로 admin급 쓰기(`PUT /api/stocks/enrich/batch` `stocks.py:379`, `POST /api/analyst-reports/{ticker}`, `PUT /api/admin/analyst-targets/{ticker}` `admin.py:225`, `POST /api/admin/cowork/fire` `admin.py:239-240`)가 되고, `__api_key__` 센티넬이 `storage.get_global_portfolio()`로 라우팅되어(`routers/stocks.py:365`, `routers/report.py:175-176`) **교차 사용자 read**까지 된다.
- **잔여 위험**: 키는 여전히 `.env.docker`에서 읽혀(`:31-35`, `:39`) 메모리상 프롬프트 문자열에 렌더되고, `run.log`(`:46`)가 자식 stdout을 파일로 받으므로 자식이 키를 에코하면 디스크에 남는다.
- ADR-0028 §4가 "유출 시 피해 = 분석 필드 쓰기 수준"으로 수용했으나, 교차 사용자 read와 무계 프로세스 스폰(§11.2)은 그 평가에 포함되지 않았다.

### 5.3 하드코딩 폴백 시크릿 — **확인된 버그**(현 배포에선 우연히 fail-closed) (B19)
- `backend/routers/auth.py:45` — `SESSION_SECRET` 미설정 시 tracked 소스에 적힌 폴백 문자열로 떨어진다(값은 여기 인용하지 않음). OAuth CSRF `state`를 서명한다(`:49,57`).
- 지금은 도달 불가: `main.py:36`이 이 모듈을 import한 뒤 `main.py:262`가 `os.environ["SESSION_SECRET"]`을 무가드로 읽어 미설정 시 기동이 죽는다. **가드가 다른 파일의 무관한 한 줄이다** — `main.py:262`를 순서 변경/삭제하면 즉시 공개된 문자열로 state 위조가 가능해진다.

### 5.4 OAuth `state`가 세션 바인딩·일회용이 아니다 — **잠재 위험**
- `backend/routers/auth.py:47-58`. `_make_state()`가 nonce를 HMAC하지만 **아무것도 저장하지 않고**, `_verify_state`는 "이 서버가 발급한 state인가"만 증명한다. nonce 저장소·만료·재사용 방지 전부 없다.
- `GET /api/auth/oauth/google`이 공개이므로 **공격자가 스스로 유효 state를 발급받아 재사용**할 수 있다 → CSRF/강제 로그인 방어가 실질적으로 성립하지 않는다.
- `SessionMiddleware`는 `main.py:262`에 설치돼 있으나 **어디서도 쓰이지 않는다**(`request.session` 참조 0) — state를 브라우저 세션에 묶을 재료가 이미 있는데 미사용.
- 부수: GitHub 콜백(`:199-203`)에는 Google(`:155-157`)에 있는 `error` 단락 처리가 없다.

### 5.5 레이트리밋 전무 — **확인된 버그**(ADR 근거 없는 순수 공백) (B20)
- `slowapi`/`limits`(requirements)·미들웨어(`main.py`)·`limit_req_zone`/`limit_conn`(`nginx/nginx.conf`) — **세 파일 전체에서 0 매치**. 보안 헤더(HSTS/CSP/X-Frame-Options/X-Content-Type-Options)와 `client_max_body_size` 조정도 0(기본 1MB).
- 가장 급한 표면: `POST /api/auth/login`(`routers/auth.py:84`) — 인터넷 노출 호스트에 무제한 크리덴셜 스터핑, bcrypt work factor만이 제동. `POST /api/auth/register` — 무제한 계정 생성 + `users` 무한 증가.
- 비-admin + 외부 fetch + 무제한: `POST /api/report/generate/{ticker}`(`report.py:114`, 본인 종목 스코프지만 관심종목 선등록으로 임의 티커 가능), `POST /api/report/{ticker}/refresh-analyst`(`:514`), `POST /api/consensus/{ticker}/backfill`(`:566`), `POST /api/digest/generate`(`digest.py:24`), `GET /api/stocks/search`(`stocks.py:156`), `GET /api/stocks/{ticker}/news`(`:321`), `GET /api/stocks/compare`(`:282`).
- `POST /api/admin/cowork/fire`(`admin.py:239-240`)는 호출당 `claude -p` 프로세스를 스폰하고 스로틀·동시성 상한이 없다(`cowork-fire-listener.py:47-52`, `:14` docstring이 무계 병행을 명시 수용) — §5.2의 admin 등가 키 뒤에 있는 무계 fork 레버.

### 5.6 상수시간 비교 아님 — **잠재 위험**(낮음)
- `backend/auth.py:45` `api_key == expected`. 같은 코드베이스 `routers/auth.py:58`은 `hmac.compare_digest`를 쓰므로 의도적 차이가 아니다.
- `scripts/cowork-fire-listener.py:65` `auth != f"Bearer {token}"` — 127.0.0.1 바인드(`:91`)로 완화.

### 5.7 토큰·세션 — 대부분 **이미 가드됨**
- HS256이 4개 decode 지점 전부에 명시 고정(`auth.py:27,53`, `auth_service.py:111`, `middleware/event_tracker.py:35`) → alg-confusion 표면 없음.
- `JWT_SECRET`은 폴백 없는 `os.environ[...]`.
- refresh는 불투명 `secrets.token_urlsafe(64)`(`auth_service.py:101`) + **일회용 회전**(사용 시 행 DELETE, `:129`) + tz 정규화 만료검사(`:123-126`). 로그아웃 per-token 폐기(`:134`), 사용자 삭제 시 CASCADE.
- **잔여 A** — refresh 토큰이 **평문 저장**(`auth_schema.sql:15-21`, `:18` `token TEXT UNIQUE`). §10.2의 호스트 공개 5432와 겹치면 DB read 한 번이 30일짜리 재생 가능 크리덴셜이 된다.
- **잔여 B** — 만료된 refresh 행이 회수되지 않는다(`auth_service.py:126-127`). 테이블 무한 증가.
- **잔여 C** — `auth.py:30,56`의 `except (JWTError, KeyError)`가 `os.environ["JWT_SECRET"]`의 KeyError까지 삼켜 치명적 설정 오류를 일괄 401로 바꾼다(fail-closed지만 진단 불가). `event_tracker.py:37`도 같은 형태.
- **잔여 D** — access token은 최대 1시간 폐기 불가(stateless, `jti`/denylist 없음). 표준 트레이드오프.
- **잔여 E** — `_oauth_codes`(`routers/auth.py:24`)가 인메모리 dict다. 현재 uvicorn 단일 워커(`backend/Dockerfile:10`, `--workers` 없음)라 무해하나 워커를 늘리면 token 교환이 깨진다. 같은 형태의 인프로세스 상태가 `services/progress.py`(락은 있음)·키움/KIS 토큰 싱글톤에도 있다.
- **설계상 트레이드오프** — Google `id_token` 서명을 검증하지 않는다(`routers/auth.py:175-177`이 payload를 base64 직접 디코딩; `iss`/`aud`/`exp`/`at_hash` 미검사). client secret으로 인증된 code 교환 응답을 TLS로 받기 때문에만 안전하다(`jose` at_hash 실패 우회의 산물). 클라이언트가 준 `id_token`을 받는 형태로 리팩터되면 즉시 취약.
- **설계상 트레이드오프** — 토큰을 `localStorage`에 보관. XSS 노출 대신 CSRF 면역을 택한 것. **쓰기 경로가 이동했다**: `frontend/src/hooks/useAuthBootstrap.js:55,73` + `frontend/src/pages/LoginPage.jsx:50-51`(`App.jsx`는 이제 refresh read `:40`와 clear `:48-49`만). 읽는 곳: `api.js:8`, `utils/analytics.js:2`, `hooks/useBfcacheAuthGuard.js:39`.

### 5.8 이벤트 트래커 미들웨어 — **잠재 위험**
- `middleware/event_tracker.py:75` `asyncio.create_task(_save_event(...))`가 **블로킹 psycopg2 `execute`(`:44-47`)를 이벤트 루프에서** 실행한다. 부하 시 전 요청이 직렬화된다. 게다가 task 참조를 보관하지 않아 GC로 사라져 이벤트가 조용히 유실될 수 있다.
- `:48-49` `except Exception: pass` — 이벤트 쓰기 실패가 완전 무음(로깅 규약 위반). `:70-71`도 동일.
- `:31-38`이 `auth.py`와 **별개로 JWT를 다시 디코딩**한다 — auth에 audience/issuer 검사나 알고리즘 변경이 생기면 드리프트한다.

### 5.9 admin 역할 — **이미 가드됨**
- 매 요청 DB 조회(`backend/auth.py:61-65,68-78` → `auth_service.get_user_by_id` → `users.role`). JWT에 role 클레임이 없어(`auth_service.py:97`은 `sub`만) 위조 불가. `register`로 role 설정 불가(`auth_service.py:57-60`이 `email`·`password_hash`만 INSERT). 자기보호: `admin.py:108,110`이 admin·OAuth 계정 삭제를 거부.
- 잔여: admin 엔드포인트마다 요청당 DB read 1회(캐시 없음).

### 5.10 `/docs`·OpenAPI — **이미 가드됨(우연히)**
- `main.py:250`은 `docs_url=None` 등을 주지 않아 `/docs`·`/redoc`·`/openapi.json`이 켜져 있다.
- 그러나 `nginx/nginx.conf`는 `/health`(`:16-20`)와 `/api/`(`:22-28`)만 백엔드로 프록시하고 나머지는 정적 SPA로 떨어뜨린다(`:52-55`). 백엔드 컨테이너는 호스트 포트를 발행하지 않는다(`deploy.sh`의 backend `docker run`에 `-p` 없음).
- **잔여**: 명시적 결정이 아니라 **암묵적 경로 화이트리스트**다. catch-all 프록시 location이 추가되거나 8000이 발행되면 전체 API 스키마가 즉시 공개된다.

### 5.11 메뉴 권한은 보안 경계가 아니다 — **설계상 트레이드오프**(의도 확인 필요)
- 필터: `components/Masthead.jsx:46` `NAV_SECTIONS.filter(s => menuPermissions.includes(s.perm))`, `components/MobileNav.jsx:21`, `components/MobileTopActions.jsx:14`. 출처는 `contexts/AuthContext.jsx:18-22` ← `GET /api/auth/me`.
- **`frontend/src/App.jsx:86-107`은 모든 라우트를 무조건 등록한다 — 라우트 가드가 전무하다.** 백엔드에도 메뉴 권한 의존성이 없다(`ALL_MENUS`는 `routers/auth.py:108` read와 `routers/admin.py` CRUD에만 등장). `guru`가 거부된 사용자가 `/guru`를 직접 입력하면 페이지가 마운트되고 데이터도 정상 로드된다.
- **정직한 심각도: 권한 상승이 아니다.** `role === 'admin'` 게이트(`pages/Settings.jsx:258`, `pages/ReportManualGen.jsx:12`, `pages/AnalystReports.jsx:20`, `components/StockModal.jsx:18`, `components/PermissionManager.jsx`)는 전부 서버 `require_admin`이 뒷받침하고, 게이트 없는 메뉴로 도달하는 데이터는 전역/공유(구루·시장지표)이거나 이미 `get_current_user`로 사용자 스코프다. 노출되는 건 "운영자가 숨기기로 한 기능"이지 타인 데이터가 아니다.
- 결정 필요: 메뉴 권한이 민감한 것을 가려야 한다면 서버 측 의존성과 라우트 가드가 필요하다.

### 5.12 CORS — **이미 가드됨(잔여 위험만)**
- `main.py:265-271`: 와일드카드 없음(`:268` `allow_origins`), `allow_credentials` 미지정(기본 False) — Bearer 헤더 인증이라 훔칠 ambient credential이 없어 `allow_methods=["*"]`/`allow_headers=["*"]`의 영향이 낮다.
- **잔여**: `http://localhost:3000`·`http://localhost:5173` 개발 origin이 프로덕션에서도 무조건 허용된다.

### 5.13 시크릿·크리덴셜 커밋 — **부분 가드됨**
- **가드됨**: tracked 파일 전수 스캔 결과 API 키·토큰 실값 0건. `.env`(`.gitignore:6`)·`backend/.env.docker`(`.gitignore:63`)·`backend/.env`·`certbot/conf/` 모두 무시되고, `git log --all -- .env backend/.env.docker`가 비어 있어 **커밋 이력도 없다**. tracked 유일 env 파일 `backend/.env.docker.example`은 placeholder만(단 §12.3 드리프트).
- **확인된 버그 (B26)** — tracked UAT 스크립트 **15개**(`scripts/uat*.mjs`)가 라이브 테스트 계정의 이메일·비밀번호를 **평문 하드코딩**한다(값은 이 문서에 인용하지 않음). 그 계정은 프로덕션 인스턴스에 실제로 로그인되는 계정이고, 스크립트는 공개 리포지토리에 커밋된다. 완화 형태: env 변수(`UAT_EMAIL`/`UAT_PASSWORD`)로 빼고 미설정 시 즉시 exit. 참고로 `scripts/ddns_update.sh:8`은 이미 env 방식(`CF_API_TOKEN`)이라 같은 파일 트리에 정답 선례가 있다.

---

## 6. 배치·스케줄러·관측성

### 6.1 키 미설정이 "성공"으로 기록된다 — **확인된 버그** (B6)
- `scheduler/jobs.py:71-78` `_refresh_monthly_us` → `market_indicators/econ.py:13-15`가 **로그 없이** `{"error": "FRED_API_KEY…"}`를 반환하고, 잡은 `"Econ indicators refreshed"`(`:76`)를 로그하며 `job_runs`에 **success**를 남긴다.
- `scheduler/jobs.py:81-88` `_refresh_macro_signals` → `macro.py:59-61`, 동일.
- `scheduler/jobs.py:400-431` `_short_sell_work` → `short_sell_service.fetch_trend:13-22`가 키움 미설정 시 **로그 없이** `[]` → `upsert_trend([])` → `execute_many` no-op(`db.py:64-66`) → 잡은 `"Short-sell fetched for N KR tickers"`(`:431`)를 로그하고 0행을 썼다.
- 참조 정답: `services/agm.py:163`.

### 6.2 `job_runs`에 "스킵" 상태가 없다 — **설계상 트레이드오프**(관측 공백)
- `services/job_runs.py:15-72`. `failed`는 **본문이 예외를 전파할 때만** 기록된다(`:54-63`). 스케줄러 래퍼들이 자기 예외를 직접 잡으므로(`jobs.py:77-78,87-88,396-397` …) 부분·전체 실패가 `success`로 남는다. docstring(`:25-30`)이 이 성질과 해당 11개 잡을 정확히 문서화한다.
- `routers/batches.py:51`이 `job_runs.recent(id)`를 그대로 노출하므로 배치 현황 허브는 `running|success|failed`만 보여줄 수 있다 — "돌았지만 직전값 유지"가 보이지 않는다.
- 표면화한 예외: `refresh-monthly?market=KR`이 `"saved": not exports.get("stale")`(`routers/market_indicators.py:204-206`, task#243), `refresh-kr` 섹터가 index 크기를 반환. 나머지는 구분 불가 — `refresh-earnings`는 `len(kr["quarters"])`(`:174`)를 반환해 갱신이든 저장값 반환이든 같은 숫자다. `refresh-econ`/`refresh-monthly?market=US`(`:188,209`)는 `{"error": …}` dict에서도 `cpi_points`를 계산해 `0`과 `ok: True`를 낸다.
- `_mc_save`도 자기 DB 오류를 삼키므로(`market_indicators/cache.py:52-53`) 저장 실패가 success로 기록된다.
- **부분 완화(task#243 이월 해소)**: 프론트 `pages/Settings.jsx`의 배치 '지금 실행'이 이제 응답 본문을 화면에 표시해 "갱신됨↔저장 생략"을 눈으로 구분할 수 있다 — 단 그 판정이 프론트 휴리스틱이다(§7.13).

### 6.3 `get_or_refresh`의 `ttl`은 저장값에 안 걸린다 — **설계상 트레이드오프**(오해 유발 시그니처)
- `services/market_indicators/cache.py:110-120`. `ttl`은 `_set_cache(key, stored["data"], ttl)`(`:118`)로 **인메모리 캐시에만** 전달된다. `_mc_load`(`:116-117`)는 행을 **나이 불문** 그대로 반환하고 `fetched_at` 비교가 함수 어디에도 없다. **`market_cache`에 행이 한 번 생기면 `force=True`가 올 때까지 `fetch_fn`은 절대 안 돈다.**
- `:120`은 `return fetch_fn()` 그대로 — last-good 폴백도 없고 예외는 호출자로 전파된다.
- 패키지 내 유일한 실제 나이 검사는 `earnings._is_fresh:61-76`(7일, `fetched_at` 기준)이고 이건 `get_or_refresh`를 우회한다.
- **위험한 파생 2가지**: ① "TTL 만료 → 요청 경로가 재조회"를 전제로 심각도를 판단하면 안 된다. ② 행이 없어지면 **요청 1회가** `_scrape_sp500` + ~500 yfinance 호출을 20스레드로 동기 실행한다(`earnings.py:200-204`, `routers/market_indicators.py:44,52`에서 도달).

### 6.4 기동이 이벤트 루프를 블록한다 — **잠재 위험**
- `backend/main.py:242-244`가 async `lifespan` 안에서 `sched.start()`를 **동기** 호출한다. 그 안에서 `_check_missed_report`(`scheduler/schedule.py:137-141` — 전 종목 리포트 재생성 가능), `_seed_rankings_if_empty`(KOSPI+KOSDAQ 전 페이지, 12스레드), `_seed_kr_sector_if_empty`(~100 스로틀 키움 콜), `_seed_us_sector_if_empty`가 서빙 시작 전에 돈다. `_warm_market_cache`만 스레드로 분리됐다(`:245`).
- 관측된 증상: 배포 직후 컨테이너가 `Up`이고 로그도 활발한데 포트 8000이 수 분간 `Connection refused`. 실측 총 ~5분 15초(기동 배치가 예정 시각과 겹칠 때 증폭). **정확한 메커니즘(GIL/이벤트 루프 기아)은 미확정** — lifespan 자체는 0.6초로 끝난다. 배포 후 라이브 스모크는 포트 바인딩을 폴링한 뒤 실행할 것.

### 6.5 KST vs 컨테이너 UTC — **부분 가드**
- 가드: `services/utils.py:11-13` `today_kst()`(~25 호출처)와 `backend/tests/test_no_bare_today.py`.
- **게이트 구멍**: `tests/test_no_bare_today.py:29-33`의 AST 술어가 `node.func.attr == "today"`만 매칭한다 → **`now()`/`utcnow()` 계열은 전부 미가드**이고, 남은 위반이 정확히 그 계열이다. `utils.py:12` docstring도 `date.today()`만 언급해 이 구멍을 문서화하지 않는다.
- **확인된 버그 (B7)** — `services/dividends.py:101-102`: `now = datetime.now()` 후 `now.year - (2 if now.month < 4 else 1)`이 DART `bsns_year`로 간다. **4월 1일 00:00–09:00 KST**엔 UTC가 3월이라 `year-2`를 골라 **작작년 DPS/수익률**을 가져온다 — missing이 아니라 wrong. 올바른 헬퍼가 **같은 파일 `:198-200`(`_today_kst`)에 이미 있고 `:271,346`에서 쓰인다**(비대칭).
- **잠재 위험** — `services/insider_trades.py:121`: `end_de = datetime.now().strftime("%Y%m%d")`가 DART 조회 창의 *끝*이다. 00:00–09:00 KST엔 어제라 당일 접수 공시가 빠진다(실질 노출 ~07:00–09:00 KST).
- **잠재 위험(표시)** — `routers/guru.py:86` + `scheduler/jobs.py:61`: naive `datetime.now().isoformat(...)`로 `last_updated`를 찍어 저장 문자열이 KST−9h·오프셋 없음. 구루 크롤 기본이 03:00(`scheduler/schedule.py:70`)로 나쁜 창 안이라 **사실상 모든 예정 실행이 오표기**된다. 둘을 함께 고칠 것.
- 무해(창의 *시작*이라 넓어질 뿐): `disclosures.py:46`, `insider_trades.py:120`, `backlog.py:108`, `market/kr.py:566`. 무해(경과/TTL): `backlog.py:68`, 모든 `time.time()`/`monotonic()`.
- 정답 사례: `services/kis/futures.py:62,77`(코드베이스에서 가장 중요한 KR 날짜 판정)은 tz-aware다.

### 6.6 tz-naive ↔ tz-aware 정렬 — **이미 가드됨** + off-by-one 하나
- KR beta 버그는 **두 호출처 모두 고쳐져 있다** — `services/beta.py:78`(strip은 `:58`·`:76`)과 `services/report_generator.py:311`(strip은 `:304`·`:310`)이 단일 `pd.concat`(`services/indicators.py:108`) 전에 양쪽 tz를 strip한다.
- **잔여**: `calc_beta`(`indicators.py:105`) 자체는 정규화를 안 하고 두 호출자가 `except Exception → beta = None`(로그 있음)으로 감싼다 → **세 번째 호출자가 조용히 재도입한다.** `indicators.py:108`에 `tz_localize(None)` 한 줄을 넣으면 구조적으로 불가능해진다.
  - ⚠️ 지난 판의 "이상적 헬퍼가 미사용으로 있다"는 **stale**이다 — `report_generator.py:541-546` `_normalize_index`는 이제 `:571-577`에서 **6회 사용**된다. 남은 격차는 그 헬퍼가 **beta 경로엔 적용되지 않았다**는 것뿐(`:304`·`:310`이 손으로 strip).
- **확인된 버그 (B8)** — `services/consensus_pipeline.py:173`이 `idx.tz_convert(None)`을 쓴다(UTC로 변환 후 tz 제거). 코드베이스 관용구는 `tz_localize(None)`(wall-clock 보존)이다. US/Eastern **저녁** 발행 리포트가 다음 UTC 날짜로 밀리고, 그 날짜가 `:188`에서 `report_date`로 **영속화**된다. 게다가 `:177`의 cutoff는 `today_kst()` 파생이라 `:180`이 **두 기준계를 비교**한다.

### 6.7 배치 레지스트리 정합 — **이미 가드됨**
- `BATCHES` **29개** id, `_JOB_FUNCS` **28개**(`scheduler/jobs.py:485-514`, 엔트리 `:486-513`). `set(_JOB_FUNCS) − ids = ∅`, `ids − _JOB_FUNCS = {"consensus"}`(의도적 `scheduler_job_id: None`, `batch_registry.py:66`), 모든 `scheduler_job_id == id`.
- 리터럴 `job_runs.record("…")`는 **50개 호출 지점 / 27개 distinct id**이고 27개 전부 `BATCHES`에 존재 — **고아 0**. 동적 id 4곳(`routers/rankings.py:10`→`:42`, `report.py:71`→`:72`, `report.py:140`→`:141`, `recommendations.py:220`→`:223`)도 해석된다.
- 잔여(무해): `batch_registry.py:2` 주석이 "20개 배치"(실제 29).

### 6.8 시드가 불완전 값을 고착시킬 수 있다 — **잠재 위험**
- `_seed_rankings_if_empty`(`jobs.py:434-447`)는 §1.1의 KR 구멍을 상속한다. 빈 테이블이라 잃을 건 없지만 0행으로 "성공"하고 다음 cron/재기동까지 재시도하지 않는다.
- `_seed_kr_sector_if_empty`(`:472-482`)는 all-None 저장은 막지만(`kr_sector_service.py:83-86`) `index: {}`는 저장할 수 있다(`:87-90`). `map_holdings_to_sectors:117-119`가 graceful 열화하고 16:00 배치가 자가치유한다.
- 두 시드 모두 **per-item** all-None은 저장 가능하고(§1.3), `load_momentum()` 진리값으로 "시드됨"을 판정하므로 그런 행이 이후 시드를 억제한다.

### 6.9 `misfire_grace_time` — **설계상 트레이드오프**
- `scheduler/schedule.py:30-34`가 `None`일 때 인자를 생략해 APScheduler 기본 **1초**가 적용된다. `daily_report_kr/us`만 82800을 명시한다(`batch_registry.py:26`·`:47`). 주간·월간 잡은 기동 타이밍이 1초 어긋나면 그 회차를 건너뛴다.

### 6.10 FOMC 날짜가 하드코딩 정적 목록 — **설계상 트레이드오프**(소진 경고는 있음)
- `routers/calendar.py:30-36` `_FOMC_DATES`가 **2027-12-08까지**만 담는다(현재 기준 잔여 ~16개월). 소진되면 FOMC 이벤트가 무음 미표시(`:29` 주석이 명시).
- 완화: `:41-45` `_fomc_coverage`가 마지막 날짜와 today를 비교해 `GET /api/batches`(`routers/batches.py:60`)로 '갱신 필요'를 노출한다 → 배치 허브가 경고를 띄운다. **자동 크롤은 없고 연 1회 수동 갱신 전제.**

---

## 7. 프론트엔드

### 7.1 access token 갱신 경로가 없다 — **확인된 버그** (B9)
- `frontend/src/api.js:15-26`이 401에 **무조건** 두 토큰을 지우고 `window.location.replace('/')`(`:22`)로 하드 리다이렉트한다. **`POST /api/auth/refresh`를 호출하는 코드가 프론트 전체에 없다**(`grep auth/refresh src/` = 0) — `refresh_token`의 유일한 read 소비처는 로그아웃(`App.jsx:36-49` `doLogout`)이고 write는 `useAuthBootstrap.js:56,75`이다.
- 서버는 access 1h / refresh 30d(`backend/services/auth_service.py:14-15`)로 회전 인프라를 다 갖췄는데 클라이언트가 안 쓴다 → **1시간마다 전 사용자 강제 로그아웃**.
- ADR-0029가 read까지 401을 내게 만들어 반경이 더 넓어졌다(ADR 본문도 이 부수를 인정한다). 백그라운드 폴링의 401도 세션을 끊는다.
- **부분 진전**: 지난 판의 "`api.js` 커버 테스트 0"은 이제 거짓 — `test/back-to-login-guard.test.jsx:118-132`가 응답 인터셉터를 직접 단언한다(401/비401 2케이스). **요청 인터셉터(`api.js:7-13`)는 여전히 미커버.**

### 7.2 삼켜진 fetch가 제어 흐름을 뒤집는다 — **확인된 버그** (B10·B11·B12)
프론트 비테스트 `catch` **128개** 중 ~72개는 토스트/에러 상태를 띄우고 16개는 console만, ~25개가 완전 무음이다. 그중 **결과가 오동작으로 나타나는 것**:
- **`pages/Ranking.jsx:154-156`** — `api.get('/api/watchlist')`(`:154`)에 `.catch(() => {})`(`:156`)로 `watched`(`:95`)가 빈 Set으로 남는다. `toggleWatch`(`:210`)가 `watched.has(t)`(`:214`)로 동사를 고르고 `:217-218`이 `isWatched ? api.delete(...) : api.post(...)`다 → **실패 후엔 모든 별이 미등록으로 렌더되고, 이미 등록된 종목의 별을 누르면 DELETE 대신 POST가 나간다**(삭제를 요청했는데 중복 추가 오류).
- **`components/GlobalSearch.jsx:19-26`** — `fetchTracked`가 실패 시 `new Set()`을 반환한다(`:24`). `handleSelect:32`의 `if (tracked.has(t))`가 false가 되어 **이미 추적 중인 종목이 리포트(`:33`) 대신 "관심 추가" 프리필 모달(`:35`)로** 간다. `:31` 주석은 stale 캐시 오판을 *피하려고* 재fetch한다고 하는데, 실패 경로가 정확히 그 오판을 재도입한다.
- **`pages/GuruDetail.jsx:114-120`, `pages/GuruManagers.jsx:52-58`** — `loadStockMap`이 `() => { api.get('/api/stocks').then(...) }` 형태로 **`.catch`도 없고 promise를 반환하지도 않아** 호출자가 붙일 수도 없다(호출부 `GuruDetail.jsx:133,164`·`GuruManagers.jsx:64,77` 전부 bare) → **unhandled promise rejection**, `stockMap`이 `{}`로 남아 모든 보유 배지가 미추적으로 렌더된다. 형제 구현 `GuruStats.jsx:87-92`(`:106`)·`GuruAllocation.jsx:59-64`(`:68`)는 `async`이고 잡힌다. **4개 복제 중 2개가 무가드.**
- **잠재 위험** — `contexts/AuthContext.jsx:23-26`: `/api/auth/me` 실패가 조용히 `role:'user'`, `menuPermissions:[]`가 된다. 일시 장애와 실제 무권한 계정이 구별되지 않아 **에러도 재시도도 없이 nav 전체가 사라진다.** 테스트 없음(39줄).
- **잠재 위험 — 무계 진행률 폴링 5곳**: `hooks/useReportGeneration.js:22`(`catch {}`, `:23` 1.5s), `pages/ReportManualGen.jsx:98,136`, `pages/ConsensusSettings.jsx:29`, `pages/GuruCrawlNow.jsx:28`(2s). `setInterval` 안의 `catch {}`라 지속 실패해도 타이머가 안 걷힌다. 올바른 패턴이 **이미 리포지토리에 있다** — `hooks/useStockManagement.js:18-19`가 `maxAttempts = 6`에서 멈추고 토스트를 띄운다.
- **"에러를 빈 상태로 위장" 7곳**: `components/StockSearchBox.jsx:38`, `components/reports/DetailTab.jsx:666`, `pages/Ranking.jsx:463`, `pages/AdminAnalytics.jsx:64`, `components/reports/HistoryTab.jsx:36,43`. 의도적·문서화된 형제(`SupplySection.jsx:17`, `ReportDetailTabs.jsx:54-61`, `Recommendations.jsx:83-85`)가 있으므로 일관성 격차다.
- **이미 가드됨(참조)**: 대시보드는 `hooks/usePortfolioData.js:48`이 마커 warn을 남기고 `pages/Portfolio.jsx`의 `DashboardGrid`가 `stocks>0`이면 빈 상태 대신 Skeleton을 보이며 유계 재시도(최대 3)를 한다(task#102). **다른 화면엔 이 헤더↔본문 모순 방어가 없다.**

### 7.3 단위 포매터 오적용 — **확인된 버그** (B13·B14)
- **`components/reports/InvestorTrendSection.jsx:56`** — `tickFormatter={v => krFmt(v)}`가 걸린 Y축 값은 `:28-30`에서 `foreign_net`/`organ_net`/`individual_net`을 누적한 것, 즉 **주(株) 수**다(백엔드 3곳이 단언: `services/kiwoom/investor.py:4`, `services/investor_service.py:78`, `tests/test_kiwoom_investor.py:40` `== 2906596  # 수량(주)`). `krFmt`(`components/market/marketUtils.jsx:6-10`)는 억원 입력을 가정하므로 5,414,215주가 **"541.4조"**로 렌더된다.
  - 의도적이지 않음의 증거 둘: ⓐ 형제 차트 `components/reports/ShortSellSection.jsx:11-18`이 **정확히 이 이유로** 전용 `fmtShares`를 두고(`// krFmt는 '억원' 입력 가정이라 주 단위엔 부적합`) 동일 축 역할에 `:87`에서 쓴다 — InvestorTrendSection이 미이관 형제다. ⓑ 내부 불일치 — 같은 컴포넌트 `:60` 툴팁은 같은 값을 `toLocaleString('ko-KR')`로 raw 출력해 축은 "541.4조", 툴팁은 "5,414,215"다.
  - 폭발반경: 리포트 상세 **및** 랭킹 모달(`pages/Ranking.jsx:2`가 import).
- **`pages/GuruAllocation.jsx:24-29`** `fmtUsd`의 최상단 티어가 `v >= 1e9 → B`(`:26`)로 **T 티어가 없다**. `:173`(총 투자금)·`:201`(설명란 분모)·`:244`(행 값)가 이걸 쓰고, 총계는 구루 ~83명 합계(`services/guru_stats.py` raw USD)라 **`$1,077.0B`**가 나온다 — 그 실측 문자열이 `GuruAllocation.jsx:166-167` 주석에 라이브 근거로 박혀 있다(현상은 확인됐고 수정은 안 됐다). 형제 `formatValue`(`GuruManagers.jsx:22-28` ≡ `GuruDetail.jsx:94-100`, byte-identical)는 T 티어를 가진다.
- **잠재 위험** — `components/market/LendingSection.jsx:44,60,66`이 조원으로 라벨하고 `${v.toFixed(0)}조`로 포맷하지만 `backend/services/lending_service.py:145-148`은 `1_000_000`으로 나누고 `API_SPEC.md:2931`은 백만 단위로 문서화한다. 둘 중 하나가 1e6 틀렸다. fixture 없음(`grep forgBrwBal tests/` = 0) → `GET /api/market/lending` 실값 크기로 판별(~60–80이면 UI 맞고 문서 stale, ~6e7이면 UI가 1e6배 어긋남).

### 7.4 내비게이션 단일 소스 — **이미 가드됨(잔여 위험만)**
지난 판의 §7.4(B16 심층 리포트 라우트 누락)·§7.5(nav 목록 3중 복제)는 **둘 다 닫혔다**. `frontend/src/navSections.js`(52줄)가 `NAV_SECTIONS`(5섹션) + `matchesItem`(`:48`)·`matchesSection`(`:50`)·`sectionByKey`(`:52`)를 export하고 세 소비처가 파생한다: `Masthead.jsx:7,46,94`, `MobileNav.jsx:21,29`, `ResearchShell.jsx:11-12,17-20`. 회귀 게이트 `frontend/src/test/nav-active-matching.test.jsx`(70줄)가 목록 `/analyst-reports`·상세 `/analyst-report/000660/2026-07-30` × 3소비처 6케이스를 단언한다.

**남는 잔여 4가지:**
1. **접두사 매칭이 세그먼트 경계를 안 본다** — `navSections.js:48` `pathname.startsWith(item.match ?? item.to)`. 현재 5섹션에 형제 접두사 쌍은 없고(`'/analyst-reports'.startsWith('/reports')`는 false) `:8-11` 주석이 그 천장을 선언하지만, **강제하는 단언이 없다.** 새 형제가 접두사 관계로 들어오면 조용히 두 탭이 동시 active가 된다.
2. **드리프트 표면이 소멸한 게 아니라 "경로 목록"에서 "key→아이콘 매핑"으로 이동했다** — 아이콘은 소비처별 2중 복제다(`Masthead.jsx:12-18` sketches / `MobileNav.jsx:10-16` ui/icons, 의도적 분기이고 각 파일 주석이 근거를 담는다). **폴백이 없어** `NAV_SECTIONS`에 섹션을 추가하고 한쪽 `ICONS`를 빠뜨리면 `Icon`이 `undefined`가 되어 `Masthead.jsx:29`/`MobileNav.jsx:30`에서 **렌더 throw**한다.
3. **라우트↔nav 커버리지 게이트가 없다** — `nav-active-matching.test.jsx`는 `/analyst-report(s)` 2경로만 고정한다. `App.jsx:90-106`의 신규 라우트가 `NAV_SECTIONS`에서 빠지는 B16 **원형**은 여전히 무가드(현재는 전 라우트 커버, 의도적 예외는 `/dev/showcase` `App.jsx:110`).
4. **`settings`·`admin-analytics`는 `NAV_SECTIONS` 밖의 4번째 목록**이다(`Masthead.jsx:78-84`, `MobileTopActions.jsx:14-15`가 각자 하드코딩). `navSections.js:35` schedule 섹션은 `perm: 'research'`라 일정·인컴에 독립 권한을 줄 수 없다.

### 7.5 이벤트 화이트리스트 탈락 — **확인된 버그** (B24)
- `backend/routers/events.py:45-46`은 `VALID_EVENTS`(`:11-18`)에 없는 이벤트를 **`{"ok": True}`로 반환하고 버린다**(요청은 성공, 이벤트만 사라진다).
- 프론트가 실제로 쏘는데 화이트리스트에 없는 이벤트 **2종**: `nav_analytics`(`components/Masthead.jsx:84`, `components/MobileTopActions.jsx:15`) · `ranking_watch_toggle`(`pages/Ranking.jsx:226`).
- 관측 공백 추가 3건: `navSections.js`의 `/recommend`(`:17`)·`/dividends`(`:38`)·`/analyst-reports`(`:20`)에 `evt` 필드가 없어 그 탭 클릭은 아무 이벤트도 쏘지 않는다.
- 구조적 원인: 이벤트명이 프론트 문자열 리터럴과 백엔드 집합에 **이원화**돼 있고 대조하는 테스트가 없다. task#251에서 `MobileNav`의 `key` 필드가 권한 필터 겸 이벤트명 소스로 **겸직**하던 것을 `section.perm` 파생으로 바꿔 5탭 이벤트명을 바이트 동일하게 보존했지만(`MobileNav.jsx:28` `trackEvent('nav_' + section.perm)`), 그 보존을 지키는 게이트도 없다.

### 7.6 Service Worker가 `/api/*`를 가로챈다 — **설계상 트레이드오프** + 프라이버시 잔여
- `frontend/vite.config.js:39-48`(빌드 산출 `dist/sw.js`): `urlPattern`(`:40`)이 `/api/`를 포함하고 `/api/auth/`를 제외한 **모든 GET**을 `NetworkFirst`(`:44` `networkTimeoutSeconds: 10`)로 `api-cache`(`:45` maxEntries 50, maxAgeSeconds 300)에 넣는다.
- 파생 1: 네트워크 실패 **또는 10초 초과** 시 **최대 5분 오래된 API 응답**이 stale 표시 없이 서빙된다.
- 파생 2 (**프라이버시 잔여**): `api-cache`가 URL만으로 키를 잡아 `Authorization` 헤더가 키에 안 들어가고, 로그아웃(`App.jsx:36-49`)이 캐시를 지우지 않는다(`caches.*` 호출이 프론트 전체 **0건**). 같은 브라우저에서 5분 안에 계정 B가 로그인하고 요청이 실패/타임아웃하면 **B가 A의 캐시된 `/api/portfolio` 본문을 받을 수 있다.** 좁은 창이지만 실제 교차 사용자 누출 경로다.
- 파생 3: `:46` `cacheableResponse.statuses: [0, 200]`이 opaque(status 0) 응답까지 캐시한다.
- 파생 4: `maxEntries: 50` vs ~70개 구별 엔드포인트 → 상시 LRU 스래싱(비효율, 오류 아님).
- 파생 5 (테스트 하니스): 이 인터셉트 때문에 Playwright `page.route` 응답 주입이 안 먹는다 — 응답 주입 UAT는 컨텍스트를 `serviceWorkers: 'block'`으로 만들어야 한다.
- **이미 가드됨 — OAuth 콜백**: `vite.config.js:19` `navigateFallback: null`로 내비게이션 라우트가 등록되지 않는다(`dist/sw.js`에 `NavigationRoute`/`createHandlerBoundToURL` 없음). 독립적으로 `/api/auth/*`가 `api-cache`에서 제외되므로 `useAuthBootstrap.js:51` 토큰 교환도 캐시되지 않는다.
- **이미 가드됨 — 배포 후 stale JS**: `skipWaiting`/`clientsClaim`(`:17-18`), `cleanupOutdatedCaches()`, `BUILD_DATE`를 실은 `cacheId`(`:15`), `sw-cache-bust` 플러그인(`:63-92`, name `:64`)이 `registerSW.js`/`sw.js`/`manifest.webmanifest`에 `?BUILD_DATE`를 붙이고, `nginx.conf:39-44`가 `sw.js`/`workbox-*.js`에 no-store를 준다. 그리고 **`src/`에 `React.lazy`·동적 `import()`가 0건**이라 `skipWaiting`의 통상 위험(열린 탭이 삭제된 lazy 청크를 요청)이 발생할 수 없다.
- 참고: `vite.config.js:66-67`이 플러그인의 `dist` 하드코딩이 throwaway 빌드로 라이브 디렉터리를 오염시켰던 과거 버그(task#191)를 문서화한다.

### 7.7 동일 엔드포인트 다중 소비처 — **잠재 위험**
19개 엔드포인트가 2개 이상 파일에서 fetch된다. 결합도 상위:

| 엔드포인트 | 파일 수 | 위치 |
|---|---|---|
| `/api/watchlist` | 8 | `GlobalSearch.jsx:41`, `useStockManagement.js:100`, `Ranking.jsx:155,197,217,218`, `Recommendations.jsx:83,135`, `GuruStats.jsx:112,114`, `GuruAllocation.jsx:115,117`, `GuruManagers.jsx:73,75`, `GuruDetail.jsx:160,162` |
| `/api/stocks` | 6 | `GlobalSearch.jsx:21`, `GuruStats.jsx:88`, `GuruDetail.jsx:115`, `GuruManagers.jsx:53`, `GuruAllocation.jsx:60`, `AnalystReports.jsx:39` |
| `/api/guru/managers` | 5 | `GuruHoldersSection.jsx:28`, `Recommendations.jsx:85`, `GuruDetail.jsx:126`, `GuruManagers.jsx:61`, `GuruCrawlNow.jsx:14,26` |
| `/api/report/list` | 4 | `useReportList.js:28`, `useReportGeneration.js:20`, `Reports.jsx:99`, `ReportManualGen.jsx:42` |
| `/api/analyst-reports` | 3 | `Reports.jsx:108`, `AnalystReport.jsx:261,272`, `AnalystReports.jsx:29,71` |
| `/api/market/fx` | 3 | `FxSection.jsx:13`, `usePortfolioData.js:90`, `Analytics.jsx:289` |
| `/api/stocks/dashboard` | 2 | `usePortfolioData.js:42`, `Analytics.jsx:286` |

- **이미 가드됨**: task#52의 `/api/stocks/dashboard` 배열→객체 파손은 `Analytics.jsx:287`이 `r.data?.holdings ?? r.data ?? []`로 두 형태를 받고 `usePortfolioData.js:44-45`가 객체 형태를 읽어 닫혔다. **잔여**: 소비처가 여전히 2곳이라 다음 비-additive reshape에 재발한다.
- **미가드**: `/api/stocks` 소비처 6곳 중 5곳이 bare array를 가정한다(`data.forEach`). `AnalystReports.jsx:40`만 `data || []`로 방어한다 → `{stocks:[...]}`로 reshape하면 5곳이 throw한다.
- 구조적 원인: **엔드포인트별 데이터 계층이 없다.** `/api/stocks` + `/api/watchlist` 토글 로직이 구루 4페이지에 복붙돼 있고(`GuruStats.jsx:87-121`, `GuruAllocation.jsx:59-124`(handleToggle이 `:112`로 분리), `GuruManagers.jsx:52-80`, `GuruDetail.jsx:114-166`) `Ranking.jsx:210-233`에 5번째 변형이 있다. **5중 복제 그대로.**

### 7.8 포매터 중복 15종 — **잠재 위험**(§7.3의 온상)
공유 헬퍼는 `utils.js:fmtPrice` 하나뿐인데 컴팩트 금액 포매터가 15개 근중복이다.
- `formatValue` byte-identical: `GuruManagers.jsx:22-28` ≡ `GuruDetail.jsx:94-100`. 세 번째 변형 `fmtUsd`(`GuruAllocation.jsx:24-29`)는 T 티어 누락(§7.3).
- `fmtShares`가 한 이름으로 3번 정의되고 **래더가 2종 비호환**: `ShortSellSection.jsx:12` KR 억/만 vs `UsSupplySection.jsx:22`·`UsInsiderSection.jsx:23` US B/M/K.
- `krFmt`가 `fmtAmt`로 복제: `BacklogChart.jsx:11-15`.
- `pages/Ranking.jsx:22-26`이 `fmtPrice`를 로컬 재구현해 `utils.js:1`을 가린다.
- **15번째(신규)**: `components/reports/MarketOutlookSection.jsx:14-24`의 `_blank` 헬퍼(`:15`)가 `Number(null) === 0`·`Number('') === 0` 함정을 막지만 **로컬 정의**다 — 같은 함정을 가진 위 14종에 미이관.
- 정합 확인됨: `KrTop2Section.jsx:52,59,67,96,99,102,106`(억원, `earnings.py:240` `"unit": "억원"`), `Ranking.jsx:47` `krFmt(v / 1e8)`(raw 원, `backend/tests/test_ranking_service.py:51-53` 확인), `ShortSellSection.jsx:21` `wonFmt`(명시적 `/1e8`).

### 7.9 API base URL 불일치 — **확인된 버그**(조건부)
- `frontend/src/utils/analytics.js:4`가 bare `fetch('/api/events')`를 쓰고 **`VITE_API_BASE_URL` 프리픽스가 없다**. 다른 4개 소비처(`api.js:4`, `App.jsx:40`, `useAuthBootstrap.js:50`, `LoginPage.jsx:11`)는 붙인다. `VITE_API_BASE_URL`이 절대 origin으로 설정되면(그게 문서화된 용도다) 분석 이벤트가 프론트 origin으로 POST돼 조용히 404한다. 토큰 헤더도 손으로 만들어(`:2,8`) api 클라이언트의 401 인터셉터를 우회한다.
- env 읽기가 `api.js`에서 한 번 export되지 않고 4번 중복된다.
- `src/`에 하드코딩 API 호스트·localhost 없음. 유일한 절대 URL은 `index.html:45-49`의 폰트 CDN.

### 7.10 죽은 레거시 경로·설정 — **잠재 위험**(현재 비활성)
- `?token=`/`?refresh=` URL 쿼리에서 토큰을 읽어 `localStorage`에 넣는 경로가 살아 있다 — **파일이 이동했다**: `frontend/src/hooks/useAuthBootstrap.js:40-41`(파싱) + `:61-65`(`setItem` 2회 + `replaceState`). URL 토큰은 브라우저 이력·리퍼러·서버 로그에 남는다. **백엔드는 더 이상 그 형태를 발행하지 않는다** — 두 콜백 모두 `?oauth={code}`(120초 일회용, `routers/auth.py:183,230`)만 리다이렉트한다. 죽은 코드지만 되살리면 즉시 노출.
- **`frontend/vercel.json`이 여전히 tracked** — Vercel은 Docker 이전에서 제거됐다.
- `frontend/.env`(untracked)에 `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`가 남아 있다. **누출 아님** — `src/` 참조 0, `dist/`에도 없다(Vite는 정적 참조된 변수만 인라인). 로컬 잡동사니.

### 7.11 렌더 정체성·거대 컴포넌트 — **잠재 위험**(낮음)
- `components/reports/DetailTab.jsx:582`의 `StatRow`가 부모 렌더 함수 **내부**에서 정의돼 매 렌더마다 새 타입이 되어 서브트리가 리마운트된다. `pages/GuruStats.jsx:58`에 같은 이름의 다른 컴포넌트가 별개로 존재한다. 게다가 `ui/Stat`의 `valueColor`와 이름은 같고 **계약이 다르다**(`DetailTab.jsx:585,599-600,629`는 raw CSS 값 `"var(--up)"`, `ui/Stat`은 토큰명 `'up'`) — §7.12의 혼동원이고 §7.12가 닫혀도 이 이중 계약은 남는다.
- 500줄 초과 3개 + 400줄대 4개: `components/reports/DetailTab.jsx`(690), `pages/Ranking.jsx`(527), `components/reports/Sections.jsx`(516), `ConsensusChart.jsx`(447)·`FinancialsChart.jsx`(434)·`AnalystReport.jsx`(422)·`GuruDetail.jsx`(404). 프론트 비-테스트 총 **~17,195줄**(지난 판 16,850 → +345, `GuruAllocation.jsx` 118→270 등).
- **이미 가드됨**: 액션 버튼 중복은 `components/reports/StockActions.jsx`로 단일화되고 가시성을 `is_mine`으로 게이트한다(`:14`, 근거 주석 `:5-6`) — `StockCard.jsx`·`TickerListItem.jsx`가 이걸 쓴다. task#97의 "그외 탭 삭제 404"는 닫혀 있다.

### 7.12 접미사 조립 클래스에 화이트리스트가 없다 — **이미 가드됨(잔여 위험만)**
- ⚠️ **B15 해소** — `components/ui/Stat.css`에 이제 `.stat__value--up`(`:18`)·`.stat__value--down`(`:19`)이 존재하고, 옛 `--success`/`--danger`는 **삭제**됐다(그 자리 `:16-17`은 "의미 상태 variant는 두지 않는다"는 사유 주석). `pages/AnalystReport.jsx:332`가 넘기는 `'up'`/`'down'`이 이제 매칭되고(+`upside == null` 가드), 유일한 옛 소비처 `pages/Showcase.jsx:75`도 `valueColor="up"`으로 함께 이관돼 고아 소비처가 없다.
- **잔여 위험(구조적)**: `components/ui/Stat.jsx:14`가 여전히 `` `stat__value--${valueColor}` ``로 **문자열 조립**하고 **허용값 화이트리스트가 없다**. `up`/`down` 밖의 값은 예외 없이 존재하지 않는 클래스가 되어 **조용한 무채색**으로 회귀한다. 어떤 자동 게이트도 이걸 못 본다 — vitest는 클래스명을 단언하니 수정 전에도 통과하고, jsdom은 스타일시트를 적용하지 않으며, 빌드는 미사용 CSS 클래스를 모른다. 라이브 `getComputedStyle`(`scripts/uat254-analyst-upside-color.mjs`)이 유일한 검출 수단이고, 소비처 2곳 모두 vitest에서 색을 단언하지 않는다.
- task#254 회고가 화이트리스트 도입을 "소비처 2곳뿐이라 YAGNI"로 명시 보류했다 — **소비처가 늘면 재검토할 자리.**
- 같은 부류의 "색 의미가 두 곳에 분산": `pages/GuruStats.jsx:38-43`이 배경은 CSS로 옮기고 `color`(`:41`)는 JSX 인라인에 남겼다.
- 배경: 리디자인(task#194) 이후 가격 방향은 `.badge--up`/`.badge--down` 전용 변형, 의미 상태는 `.badge--success`/`--danger`/`--warning`으로 통념대로 동작한다. 공용 배지 variant의 색 의미를 바꿀 땐 소비처 전수 grep 선행 — vitest·빌드는 색 의미에 블라인드다.

### 7.13 구루 투자금 탭 전량 렌더 — **잠재 위험**(계측 완료·처방 미적용)
- `pages/GuruAllocation.jsx:238-265`가 `rows.map`으로 **전 행(전체 스코프 1,723행)을 무조건 렌더**하고, 각 행이 `WatchlistBtn`(`GuruStats.jsx:11-13`, 인스턴스마다 `useState` 2개)을 포함한다 → **~1,723개 상태 보유 컴포넌트**. `GuruAllocation.jsx`·`GuruStats.jsx`에 `useMemo`/`React.memo`/윈도잉 **0건**이고, `:143-150` 검색 필터는 매 키입력마다 `data.rows` 전량 재map/filter를 한다.
- **실측(task#255, CPU 4x·전체 스코프, `scripts/uat255-guru-alloc-perf.mjs`)**: 스코프 전환 **596ms**(임계 200ms) — 내부 분해 `Script 109 vs RecalcStyle 120 + Layout 155`. 즉 지배 비용은 JS 재조정이 아니라 **초기 레이아웃**이다.
- **`content-visibility`는 적용했다 되돌렸다 — 재시도 금지**: `frontend/src/styles/guru.css:158-167`이 그 자리에 수치와 이유를 남긴다. ② 596→332ms(여전히 임계 미달)인데 ③ 스크롤 최장 longtask가 71→**132ms**로 임계 100ms를 **초과 회귀**했다(끝까지 스크롤 1,101→2,961ms) → 오프스크린 스킵은 비용을 *제거*하지 않고 **스크롤로 이연**한다. FAIL 축이 1→2로 늘어 순손실. 곁가지: `contain-intrinsic-size`는 content-box라 border-box 실측(68.8px)을 넣으면 문서가 33,545→42,389px로 부푼다(재시도 시 PC 46.8·모바일 54.1).
- **남은 수단은 가상화(윈도잉)뿐**이고, 그건 「화면 행 수 == 코호트 크기」계약 3종(`GuruAllocation.test.jsx:112`, `scripts/uat247-guru-cohort.mjs:271`, `scripts/uat-guru-row-ux.mjs` 111단언)을 정면으로 깬다 — 그 재설계가 도입 비용의 절반이다. 계획된 후속: §14.
- 참고: 성능 프로브는 **회귀 게이트가 아니다**(머신·부하 의존, 파일 상단 주석이 명시).

### 7.14 OAuth 되감기가 완료를 관측하지 않는다 — **잠재 위험**(cross-layer 결합)
- `frontend/src/utils/oauthHistory.js:53` `window.history.go(-delta)`는 비동기이고 성공/실패 콜백이 없다. 착지 문서가 재평가되는 근거는 **"라이브 `/`가 no-store"**라는 전제(`:6-8` 주석)이고, 그 전제는 `nginx/nginx.conf:31-36`(`location = /index.html` no-store, `/`는 `:52-55` `try_files`의 내부 리다이렉트로 그 블록을 탄다)에 종속된다. **프론트 정확성이 nginx 설정에 걸려 있고 이를 검증하는 테스트가 없다.**
- bfcache로 복원되면 `hooks/useBfcacheAuthGuard.js:16`가 replace로 이어받지만, **둘 다 불발하는 브라우저 조합에서는 화면이 로그인 상태로 멈출 수 있다**(task#253 회고가 이 잔여를 명시). 그리고 **Playwright로는 bfcache 복원을 검증할 수 없다**(3엔진 대조군으로 확정, task#246) — 이 분기는 합성 `pageshow` 또는 실기기 확인만 가능하다.
- `useAuthBootstrap.js:49`이 `history.replaceState({}, '', '/')`를 **fetch(`:41`) 이전에** 실행하므로, 코드 교환이 400(`:50-52`)이나 네트워크 실패(`:54-57`)로 끝나면 코드가 이미 URL에서 사라져 **재시도가 원리적으로 불가**하다(현재 UX는 로그인 화면 복귀로 수렴하므로 오동작은 아니고 무음 실패다 — `:30-31` 주석이 통지 제외를 의도로 명시).

### 7.15 배치 '지금 실행' 결과 판정이 프론트 휴리스틱 — **잠재 위험**
- `pages/Settings.jsx:105`가 `Object.entries(result||{}).filter(([k]) => k !== 'ok')`로 응답 필드를 순회하고 `isWeak(v) = v === false || v === 0`(`:75`)을 **24개 manual endpoint 전부에** 일괄 적용한다. `:72-74` 주석이 "이 24개의 응답 필드는 전부 saved/건수 의미"라고 근거를 대지만, **그 불변식을 지키는 백엔드 게이트가 없다** — 새 manual endpoint가 `skipped: 0`처럼 "0이 정상"인 필드를 반환하면 조용히 경고색이 된다. `Settings.test.jsx`(88줄)는 `ManualRunButton`만 커버한다(그 목적으로 `Settings.jsx:83`에 `export`가 추가됐다).

---

## 8. 캐시·무효화

### 8.1 인메모리 캐시가 스레드 안전하지 않다 — **잠재 위험**
- `services/cache.py:6-29` `TTLCache`가 락 없는 평문 dict다. FastAPI 스레드풀 + APScheduler 워커 + 대시보드 ThreadPool이 동시에 접근한다.
  - `:19-20` — 다른 스레드가 삽입하는 동안 `self._store.items()`를 컴프리헨션으로 순회하면 `RuntimeError: dictionary changed size during iteration`.
  - `:14-22` — check-then-act이라 동시 미스에서 `loader()`가 중복 실행된다(thundering herd; 콜드 대시보드/랭킹처럼 비싼 로더에서 실질 비용).
- `services/market_indicators/cache.py:15,27-29` `_set_cache`도 같은 형태(`_cache.items()` 순회 중 삭제).
- `services/cache.py:32,52-55` `_snapshots` OrderedDict도 락 없음(삭제 목록을 먼저 리스트화해 순회 중 변경은 피했으나 동시 `del`은 KeyError 가능).
- **참조 정답이 같은 리포지토리에 있다**: `services/progress.py`의 `ProgressTracker`는 전 메서드를 `threading.Lock`으로 감싼다.

### 8.2 무효화 대칭성 — **잠재 위험**(낮음, 현재 도달 안 함)
- `services/cache.py:52-61` `invalidate(ticker)`는 list·dashboard·correlation·sector·macro·live_prices 6종을 지우지만 **rebalance·exposure는 안 지운다**. `:156-166` `invalidate_portfolio_caches`는 지운다.
- 실제 호출 패턴상 문제되지 않는다 — `invalidate(ticker)`는 스냅샷 변경(`routers/portfolio.py:24,34`, `report.py:81,131,561`, `storage/names.py:14`)에만 쓰이고 보유 구성 변경은 전부 `invalidate_portfolio_caches`를 쓴다. rebalance/exposure는 스냅샷이 아니라 보유+라이브 시세 의존이라 누락이 무해하다.
- 다만 **비대칭 자체가 함정**이다 — 새 캐시를 추가할 때 어느 쪽에 넣을지의 근거가 코드에 없다.

### 8.3 캐시 실측값 — **문서 드리프트**(코드는 정상)
`CLAUDE.md`는 "snapshot LRU 200, list TTL 5s, 6종"이라고 적었으나 실제(`services/cache.py`)는 **9종**이고 값도 다르다. (`TTLCache` 기본 `maxsize=200`(`:7`)이 "LRU 200"의 출처로 보인다.)

| 캐시 | 실제 | 위치 |
|---|---|---|
| snapshot LRU | **50** (200 아님) | `:36` `_MAX = 50` |
| list | **60.0s** (5s 아님) | `:33` |
| dashboard / correlation / sector / macro | 300.0s | `:34,35,88,89` |
| quote | 60.0s | `:110` |
| live_prices | 15.0s | `:124` |
| rebalance / exposure | 300.0s | `:136,137` |

---

## 9. 테스트·검증 게이트의 사각

현재 규모: 백엔드 **131파일 / 22,736줄**, 프론트 **30파일 / 3,444줄**.

### 9.1 실 DB 차단 — **이미 가드됨(잔여 위험만)**
- `backend/tests/conftest.py:26-37` `_block_real_db`가 `db_svc._get_pool`을 patch한다. 이게 `get_connection`/`query`/`execute`/`execute_many`의 **단일 초크포인트**라 **read·write 양쪽**을 덮고, `_pool`이 이미 채워져 있어도 작동한다. task#169(로컬 pytest가 prod `snapshots`를 fixture 값으로 덮고 prod `calendar_cache`를 전삭제)의 해법.
- **잔여 A — 로컬 `.env`가 여전히 prod를 가리킨다**: `backend/.env`의 `DATABASE_URL`이 `@localhost:5432`(= 라이브 Docker Postgres, `docker-compose.yml:10-11`이 호스트 발행). pytest는 가드되지만 **ad-hoc 스크립트·`python -c`는 무가드로 프로덕션에 쓴다.** 근본은 열려 있다.
- **잔여 B — `backend/run_backfill.py:139`가 `psycopg2.connect(DB_DSN)`으로 `services.db`를 통째 우회한다** → `_block_real_db`가 볼 수 없다. 현재 테스트가 그 함수를 타지는 않으나 무가드 라이브 DB 경로다.
- **잔여 C — 네트워크 격리 없음**: conftest에 `requests`/`httpx`/`socket` 차단이 없다. 외부 호출 모킹을 잊은 테스트는 **실제 yfinance/DART/Naver**를 때린다(flaky·레이트리밋·느림).
- **잔여 D — 전역 auth override 누출**: `conftest.py:10`이 **모듈 임포트 시점에** `app.dependency_overrides[get_current_user]`를 걸고 되돌리지 않는다. 그래서 `main.app`을 쓰는 어떤 테스트도 401 동작을 검증할 수 없고, 무인증 거부 검증은 override 없는 fresh app이 필요하다(`tests/test_security_auth_gaps.py` 패턴).
- **잔여 E — tracked 파일 write 경로가 하나 남아 있다**: `services/digest_service.py:163-164`가 `DIGEST_DIR / f"{user_id}-{date}.json"`을 쓰고 `DIGEST_DIR = backend/data/digest`(`:37`)는 **gitignore 대상이 아니며 tracked 파일 `backend/data/digest/2026-05-24.json`을 담고 있다**(`git ls-files backend/data/`가 이 파일 + 두 시드 티커 JSON만 반환). 이건 DB 실패 *폴백* 경로이고 `_block_real_db`가 `execute`를 raise시키므로 **테스트가 정확히 그 경로를 탄다.** 지금 안전한 유일한 이유는 각 테스트가 `patch.object(ds, "DIGEST_DIR", tmp_path)`를 기억하기 때문이다(`test_digest_service.py:41`, `test_disclosure_endpoint_digest.py:89`) — autouse 가드가 아니라 **관례**다.
- **task#234로 닫힌 것**: `backend/data/sp500_tickers.json`·`kospi_tickers.json` 오염. `services/market_indicators/earnings.py:25-31`이 시드를 **read-only**로 격하하고(`_SP500_SEED`) 7일 캐시를 `market_cache`(`_SP500_KEY`)로 옮겼으며, 신선도 판정을 파일 mtime이 아니라 `fetched_at`으로 바꿨다(`:61-76`). `services/recommendation/universe.py:39`는 read만 한다. 나머지 백엔드 파일 write는 `exports.py:129`(gitignore)·`report_generator.py`(`backend/snapshots/`, gitignore)뿐이다.
- **습관 유지**: 전체 스위트 실행 후 `git status`로 부수효과를 확인할 것.

### 9.2 프론트 테스트 하니스에 폴리필이 없다 — **확인된 버그** (B23)
- `frontend/vite.config.js:94-98`의 `test` 설정은 3키(`:95` jsdom·`:96` globals·`:97` setupFiles)뿐이고 `coverage`도 `restoreMocks`도 없다. **`frontend/src/test/setup.js`는 한 줄**(`import '@testing-library/jest-dom'`)로 **폴리필이 0개**다.
- jsdom 29에는 `matchMedia`·`ResizeObserver`·`IntersectionObserver`가 없다. 따라서 아래가 마운트에서 throw한다:
  - `hooks/useIsMobile.js:6` bare `window.matchMedia` — **39 호출처 / 20 파일**
  - `hooks/useCountUp.js:16`, `hooks/useReveal.js:12,17`
  - `pages/Ranking.jsx:144`, `components/PermissionManager.jsx:45` (`new IntersectionObserver`)
- **결과: `pages/Portfolio.jsx`(자산·손익 화면)를 오늘 아예 마운트할 수 없다.** **6개** 테스트 파일이 `useIsMobile`을 손으로 모킹해 우회한다(`GuruDetail.test.jsx:11`, `GuruManagers.test.jsx:11`, `GuruAllocation.test.jsx:7`, `reports-deep-link-navkey.test.jsx:9`, `back-to-login-guard.test.jsx:14`, `nav-active-matching.test.jsx:13`) — 우회 사본이 4개→6개로 **늘고 있다**. setup.js에 3줄이면 ~40개 파일이 열린다.
- `package.json`에 coverage 도구가 없어 **커버리지 측정 자체가 불가능**하다.

### 9.3 recharts는 jsdom에서 **SVG 자체가 없다** — **설계상 트레이드오프**(기계적 확인)
- `ResponsiveContainer`가 `ResizeObserver` 부재 시 조기 return → 치수가 `{-1,-1}` → 루트가 `null` 반환. **`<svg class="recharts-surface">`가 통째로 없다** — 축·틱·막대·파이 조각·라벨 전부. `ResizeObserver`만 스텁해도 안 된다(`getBoundingClientRect()`를 읽고 jsdom은 전부 0).
- **27개 파일이 recharts를 import하는데 3개만 테스트가 있고** 어느 것도 차트 내부를 단언하지 않는다 — 의도적으로 주변만 본다: `AnalystReport.test.jsx:60`은 손으로 만든 HTML 범례를 단언, `GuruDetail.test.jsx:204-205`는 조각이 렌더되지 않는다고 주석하고 HTML 오버레이 + `fitsSliceLabel`을 순수함수로 단언, `KeyResourceChart.test.js`는 렌더를 안 한다. 전 테스트에서 `recharts-`·`querySelector('svg')`·`tspan` 검색 결과 **0건**.
- 따라서 라벨 겹침·정렬 같은 시각 속성은 **라이브 Playwright + `getBoundingClientRect()`**가 유일한 게이트다. 그 프로브 자체의 함정(기준 상자도 실측 대상 / 판정 축 누락 / `text-overflow: ellipsis`는 overflow 검사에 원리적으로 안 잡혀 `scrollWidth > clientWidth`가 별도 축으로 필요 / flex 압축은 `Range.getClientRects().length`로 재야 함 / 요소 *간* 간격은 넘침·잘림·접힘 어느 축에도 안 잡힘 / 적용 안 된 스타일은 `getComputedStyle`만 잡음 / 커버리지 카운터 없는 `ALL PASS`는 무의미 / 조건부 단언은 무음 스킵 장치 / 시각 변경은 프로브 통과 후에도 스크린샷 육안 확인 필요)은 `CLAUDE.md`에 상세히 축적돼 있다.
- 관련 사각: `getComputedStyle`·`getBoundingClientRect`·`scrollWidth`/`clientWidth`가 프론트 테스트 3,444줄에서 **0회** 등장하고, 23개 CSS 파일이 어떤 테스트에도 참조되지 않는다.

### 9.4 테스트 없는 핵심 파일
**여전히 무테스트(현재 줄수 기준)**: `DetailTab.jsx`(690) · `Ranking.jsx`(527) · `Sections.jsx`(516 — `Sections.test.jsx`가 3섹션만 import, **부분**) · `ConsensusChart.jsx`(447) · `FinancialsChart.jsx`(434) · `PermissionManager.jsx`(351) · `ReportManualGen.jsx`(346) · **`Analytics.jsx`(312)** · **`Portfolio.jsx`(294 — `:115-121`에 클라이언트 자산 계산)** · `Calendar.jsx`(267) · `Digest.jsx`(261) · **`ReportDetailTabs.jsx`(229)** · `StockModal.jsx`(197) · **`KospiSignalSection.jsx`(197)** · **`BatchScheduleEditor.jsx`(196)** · **`StockCard.jsx`(190)** · `BacklogChart.jsx`(185) · **`DashboardCard.jsx`(170 — `:40-41`에 손익)** · **`AuthContext.jsx`(39)** · **`ui/Badge.jsx`(44 — task#194에서 깨진 up/down 매핑)**.
- **해소/부분 해소**: `api.js`(28, 응답 인터셉터만) · `LoginPage.jsx`(167) · `Settings.jsx`(301, `ManualRunButton`만 — **부분**).
- 편중이 심하다 — GuruDetail(471) + GuruAllocation(373) + GuruManagers(219) + GuruStats(97) + AnalystReport(236) = 1,396줄 = 전체의 **40.5%**(지난 판 48%에서 완화)이고 전부 task#226~#255 산물이다.
- 에러 분기: 128개 catch 중 ~12개(**~11%**)만 테스트된다. "실패가 빈 상태로 위장하지 않는다" 불변식은 정확히 2페이지에서만 단언된다(`GuruStats.test.jsx:65-73`, `GuruAllocation.test.jsx:124-132`).

### 9.5 존재하는 자동 게이트 (재발 방지 자산)
| 게이트 | 무엇을 막는가 |
|---|---|
| `tests/test_no_print.py` | 앱 코드의 신규 `print(` (CONVENTIONS §4) |
| `tests/test_no_bare_today.py` | bare `date.today()`/`datetime.today()` — 단 `now()`/`utcnow()`는 못 본다(§6.5) |
| `tests/test_no_public_reads.py` + `tests/_routes.py` | 무인증 `/api` 신설(ADR-0029), FastAPI 버전 발산 내성 |
| `tests/test_api_doc_sync.py` | 엔드포인트 *존재* drift (`:50` `KNOWN_UNDOCUMENTED = frozenset()` — 베이스라인 0) |
| `tests/test_nan_serialization_guards.py` | NaN이 응답에 새어 500 |
| `tests/test_empty_result_overwrite_guards.py`, `test_empty_result_guards_exports_krsector.py`, `test_rankings_empty_guard.py`, `test_us_supply_empty_guard.py` | 빈 결과 덮어쓰기 (all-empty만, KR 랭킹 제외) |
| `tests/test_public_api_empty_items.py` | 공공데이터포털 빈응답 AttributeError |
| `tests/test_security_auth_gaps.py` | 무인증 mutation + refresh 일회용 |
| `tests/test_cowork_fire_listener.py` | fire workdir 격리·키 stdin 전달 (task#254) |
| `tests/test_report_valuation_multiples.py` | 피어 멀티플 가드 기준 표본(ADR-0030) |
| `frontend/src/test/nav-active-matching.test.jsx` | nav 3소비처 × 목록·상세 active 판정 (task#251) |
| `frontend/src/utils/oauthHistory.test.js`, `test/auth-bootstrap.test.jsx`, `test/back-to-login-guard.test.jsx` | OAuth 되감기·세션 부트스트랩 분기 (task#252·253) |

### 9.6 게이트가 **못** 보는 것
- `app_schema.sql` ↔ `main._migrate` **컬럼/테이블 짝**(§4.1) — 문서 DoD만 존재. `app_schema` 문자열을 참조하는 테스트 0개.
- naive `datetime.now()`/`utcnow()`의 KST 오판(§6.5) — AST 술어가 `today`만 매칭.
- 요청/응답 **스키마**와 **인증 게이팅 산문**의 문서 동기 — `test_api_doc_sync.py`는 존재만 본다(prose 미파싱). **현재 `API_SPEC.md`의 `**Auth:** 불필요`는 1곳이고 그건 정당한 `GET /api/auth/oauth/token`이며 `CLAUDE_COWORK_API.md`엔 0곳이다** — 3부작이 남긴 8곳 오표기는 청소됐다. 다만 게이트가 없으므로 **인증 게이팅을 바꾸는 작업은 착수 시 `grep -n '\*\*Auth:\*\* 불필요' API_SPEC.md`를 직접 돌릴 것.**
- **per-key/per-item** 빈 결과(§1.3) — 회귀 테스트가 all-empty만 단언.
- Naver 재무 **행 위치** 계약(§2.1) — fixture가 같은 순서라 라이브 재배열에 green.
- 퍼센트 **스케일**(§2.6, §7.3) — 렌더 %를 단언하는 테스트가 없다.
- 프론트 **이벤트명 ↔ 백엔드 `VALID_EVENTS`**(§7.5) — 대조하는 테스트가 없고, 탈락은 200 OK로 무음이다.
- `ui/Stat` 같은 **접미사 조립 클래스의 허용값**(§7.12) — vitest·jsdom·빌드 전부 블라인드.
- 레이아웃·색 의미·`ellipsis` 잘림·flex 압축·요소 간 간격(§9.3) — jsdom 블라인드.
- 외부 소스 **라벨** 정합 — mock 응답이 라벨 불일치를 못 잡는다(yfinance `get_income_stmt()` 메서드의 무공백 라벨 vs `.income_stmt` 프로퍼티의 공백 라벨이 대표 예. `_yf_val`(`market/format.py:61-65`)은 exact 매칭이라 어긋나면 조용히 None). **외부소스 파싱 슬라이스는 라이브 1종목 추출 대조를 DoD에 넣을 것.**
- SQL 신규/개작 — query-mock 테스트가 라이브 정합(`uuid = text`, `VALUES` 형태)을 못 잡는다. 배포 후 **라이브 스모크**가 필요.
- eslint: `eslint.config.js:11-15`가 `js.recommended` + `reactHooks.flat.recommended` + `reactRefresh.vite`만 확장하고 **`rules:` override가 없다** → `no-console` **off**, `react-hooks/exhaustive-deps` **warn**(비차단). `npm run lint`가 어떤 CI 게이트에도 없다.

### 9.7 무의미한 테스트 + 미선언 의존성 — **확인된 버그**(테스트 품질)
- `backend/tests/test_auth.py:20-36`의 세 테스트는 **PyJWT 라이브러리 자체만** 검증한다. `get_current_user`를 호출하지 않고, 죽은 `SUPABASE_JWT_SECRET`(`:22`)을 세팅하며, 앱이 쓰는 `python-jose`(`requirements.txt:15`)가 아니라 `jwt`(PyJWT)를 임포트한다(`:3`). 인증 커버리지에 대한 거짓 신뢰를 준다.
- **PyJWT는 `requirements.txt`에 없다** — 로컬 `.venv`에만 있어 Docker 이미지에서는 `ModuleNotFoundError`가 난다. `lxml`(요구사항엔 있고 로컬엔 없음)의 **거울상**이다. 실무 영향은 제한적 — `backend/.dockerignore:9`가 `tests/`를 이미지에서 제외한다.

### 9.8 admin 표면은 원리적으로 라이브 UAT 불가 — **설계상 트레이드오프**
- 라이브 UAT 계정은 비-admin이라 admin 화면과 `require_admin` 엔드포인트를 Playwright로 열 수 없다. `require_admin`은 API 키를 **거부**하는 설계이므로 키로 우회할 수도 없다(`backend/auth.py:61-65`).
- 계획 단계에서 넷 중 하나를 골라 DoD에 적어야 한다: 게이트를 `require_admin_or_api_key`로 열어 키로 positive 검증 / vitest + 기능경로 API로 닫고 버튼 렌더는 사용자 화면 확인으로 이월 / admin 크레덴셜 수령 / **in-container 자체 호출**(컨테이너가 자기 env의 키로 `127.0.0.1:8000`을 때려 시크릿을 세션에 노출하지 않는다 — 무쓰기 게이트와 짝지을 것). task#214·215·222·224에서 4회 반복됐다.

### 9.9 리뷰 자체를 게이트로 삼지 말 것 — **프로세스 위험**
- 적대적 리뷰가 6렌즈·effort high로 **0건**을 반환한 변경에서 워크플로우의 **계획 범위 임의 축소**(DoD 목적 미달)를 놓쳤고 메인 세션의 표적 검증이 잡았다. CSS 이전·토큰 제거·범위 축소가 섞인 변경은 리뷰와 **별개로** 표적 검증을 돌릴 것.
- 구현자의 "비용 우려로 인한 범위 축소"는 추정이 아니라 **실측**으로 검증할 것. 축소 여부는 슬라이스 문구가 아니라 **DoD의 목적**으로 판정해야 "형식상 통과·목적 미달"을 잡는다.
- 폴백 경로만 UAT하고 실데이터 경로를 이월하면, 두 경로의 **필드 집합 차이**가 결함을 숨긴다.
- **셀프 리뷰가 자진 기록한 한계를 "후속 후보"로 강등하지 말 것** — task#248이 "peer 3개면 정상 행까지 결측된다… 실측은 peer 4개라 해당 없음"으로 미뤘고 4일 뒤 사용자가 경쟁사를 하나 빼자 정확히 그 케이스가 라이브에서 발동했다(task#249, ADR-0030). 트리거가 **사용자가 바꿀 수 있는 데이터**면 "실측엔 해당 없음"은 면제 근거가 아니다.

### 9.10 프로브 자산 자체가 부채 — **잠재 위험**(낮음)
- `scripts/`에 tracked 23개(그중 `uat*.mjs` 13개 + `probe*.py` 2개), untracked **97개**. UAT 프로브는 성격상 일회성인데 회귀 게이트로 재사용되는 것(`uat247-guru-cohort.mjs`·`uat-guru-row-ux.mjs`·`uat255-guru-alloc-perf.mjs`)과 그렇지 않은 것이 파일명으로 구별되지 않고, 어떤 CI에도 연결돼 있지 않다 — **재실행 책임이 사람 기억에 있다.**
- 성능 프로브는 리터럴 임계값을 봉인하지 않는다(머신·부하 의존, 파일 상단 주석) → "회귀 게이트가 아니다"가 문서에만 있다.
- B26(테스트 계정 크리덴셜 하드코딩)이 이 자산 전반에 걸쳐 있다(§5.13).

---

## 10. 배포·인프라·운영

### 10.1 자동배포 폴러가 작업 체크아웃을 hard reset한다 — **설계상 트레이드오프**(운영 위험 큼)
- `scripts/auto-deploy-poll.sh:24-36`: `LOCAL != REMOTE`면 방향 무관하게 `git reset --hard origin/main`(`:35`) 후 `deploy.sh`(`:36`). launchd로 2분마다.
- `.github/workflows/deploy.yml:15`도 같은 디렉터리에서 `git reset --hard origin/main`을 한다. **개발자·에이전트가 작업하는 그 체크아웃이 배포 대상**이다.
- 결과: 커밋 안 한 tracked 편집과 **push 안 한 로컬 커밋**이 ≤2분 안에 사라진다. `.forge/` 등 untracked는 안전.
- **판정 함정**: `commit && push`를 한 체인으로 묶어도 그 사이 폴이 끼면 폴러가 앞서 fetch해 둔 낡은 `origin/main`으로 reset해 순간적으로 되돌아간 것처럼 보인다. 실제로는 push가 성공했고 다음 폴이 자가복구한다(reflog에 `commit → reset → reset`). 판정은 **`git rev-parse HEAD` vs `origin/main` + `gh run list`**로 할 것 — `git log -1`로 판정해 2연속 오판한 이력이 있다(task#238·#239).
- **파생 규칙**: 프론트 라이브 UAT를 포함하는 계획은 **commit+push → build → 프로브** 순서여야 한다. nginx가 `frontend/dist`를 직접 서빙하므로 빌드 전 프로브는 옛 번들을 재고(task#253 D1), commit+push를 build보다 먼저 묶어야 폴러 reset 창이 줄어든다.
- 락 경합: `deploy.sh:6-8`(check)과 `:32`(`touch`)가 TOCTOU이고 폴러(`:14-17`)도 같은 `/tmp/portfolion-deploy.lock`을 본다. `deploy.sh`는 락이 있으면 `exit 1`(Actions 잡 실패), 폴러는 `exit 0`.

### 10.2 Postgres가 tracked 폴백 비밀번호로 호스트에 발행돼 있다 — **확인된 버그** (B21)
- `docker-compose.yml:9`이 `POSTGRES_PASSWORD`에 **소스에 적힌 폴백 기본값**을 쓰고(값은 이 문서에 인용하지 않음) `:10-11`이 `5432:5432`를 발행한다.
- **루트 `.env`에 `POSTGRES_PASSWORD` 키가 없다**(현재 정의된 건 `FRED_API_KEY`·`KITA_API_KEY` 둘뿐) → tracked 소스의 폴백이 **실제로 유효**하다.
- Docker는 `0.0.0.0`에 발행하고 macOS 애플리케이션 방화벽을 우회한다. §5.7 잔여 A(평문 refresh 토큰)와 §9.1 잔여 A(로컬 스크립트가 prod에 쓰기)가 여기에 겹친다.
- 권장: `127.0.0.1:5432:5432` + 폴백 기본값 제거 + 루트 `.env`에 강한 값 정의.

### 10.3 `docker-compose.yml`과 `deploy.sh`가 갈라졌다 — **잠재 위험**
- compose는 `backend`·`nginx` 서비스를 정의하지만 실제 배포는 `deploy.sh`가 `docker run`으로 컨테이너를 직접 만든다(`portfolion-backend-1`/`portfolion-nginx-1`, 네트워크 `portfolion_default`).
- 차이: compose의 nginx는 `./certbot/conf`·`./certbot/www`를 마운트하지만(`docker-compose.yml:39-40`) `deploy.sh:50-53`의 nginx run은 **안 한다**(`nginx.conf` + `dist`만). `docker compose up`으로 올린 컨테이너와 `deploy.sh` 산출물이 다르고, `/.well-known/acme-challenge/`(`nginx.conf:12-14`)가 후자에서 동작하지 않는다.
- 참고: 백엔드는 `docker run`이라 `docker compose ps`에 안 잡힌다 — 컨테이너 uptime 확인은 `docker ps`로.

### 10.4 TLS 설정이 죽은 채 남아 있다 — **잠재 위험**(오판 유발)
- `nginx/nginx.conf:58-78`의 `listen 443 ssl` 서버 블록이 **전부 주석**이다. 외부 HTTPS는 Cloudflare Tunnel 엣지 종단(→ `localhost:80`)이 담당한다.
- 그런데 `docker-compose.yml:33-35`와 `deploy.sh:53`은 여전히 **443을 발행**하고(리스너 없음), `certbot` 컨테이너(`docker-compose.yml:45-50`)는 **아무도 안 쓰는 인증서를 12시간마다 갱신**한다. "TLS가 어디서 끝나는가"를 오판하게 만드는 죽은 설정.

### 10.5 배포 검증이 비차단이고 롤백이 없다 — **잠재 위험**
- `deploy.sh`는 `set -e`지만 마지막 헬스체크(`:63`)가 `curl … && echo OK || echo WARNING`이라 **실패해도 스크립트가 성공(exit 0)**한다. 깨진 배포가 초록으로 끝난다. 롤백 경로 없음.
- `deploy.sh:25`가 `npm install`(not `npm ci`)을 쓴다 — `frontend/package-lock.json`이 있는데도 재현 불가한 설치.
- 프론트는 nginx가 `frontend/dist`(gitignore)를 직접 볼륨 마운트하므로 로컬 `npm run build`가 **즉시 라이브**다. 반면 **백엔드 변경은 폴러/러너 재배포 후에야 라이브** — 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작한다.
- 배포 직후 라이브 스모크는 포트 바인딩을 폴링한 뒤 실행할 것(§6.4).
- ⚠️ 지난 판의 "`.dockerignore`가 없어 `.venv`가 빌드 컨텍스트로 간다"는 **사실이 아니었다** — `backend/.dockerignore`는 2026-05-30부터 tracked이고 `.venv`(`:3`)·`.env`(`:4`)·`tests/`(`:9`)를 제외한다. 이 주장은 폐기.

### 10.6 self-hosted 러너 = 호스트 RCE — **설계상 트레이드오프**(가드가 미문서)
- `.github/workflows/deploy.yml:9`이 `runs-on: self-hosted`로 개인 Mac에서 `git reset --hard` + `bash deploy.sh`를 실행한다. `main` push 권한 ⇒ 호스트 코드 실행.
- 현재 방어는 트리거가 `:3-5` `on: push: branches: [main]`뿐이라는 것(fork PR은 트리거 못 함). **이 워크플로우에 `pull_request` 트리거를 추가하면 임의 fork 작성자가 Mac에서 코드를 실행하게 된다** — 파일에 그 경고가 없다.
- 러너 격리 실사고: PortfoliOn 전용 러너 디렉터리(`~/actions-runner-portfolion`)가 타 프로젝트 세팅에 재등록돼 5일간 무음 미배포. **백엔드가 옛 코드로 보이면 폴러 footgun 단정 전에 러너부터** 확인: `gh run list`(잡이 `queued`/`cancelled(24h)`면 러너 부재) + `gh api repos/calmonion7/PortfoliOn/actions/runners`.

### 10.7 의존성 버전이 고정되지 않았다 — **잠재 위험**
- `backend/requirements.txt` 18개 항목 중 17개가 `>=`이고 **`:18` `python-dotenv`는 버전 지정자가 아예 없다**. lockfile도 없다. 이 코드베이스는 **yfinance의 정확한 index 라벨과 FastAPI의 라우트 트리 구조에 의존**한다.
- 이미 실측된 발산: `backend/tests/_routes.py` docstring — "로컬 `.venv`(0.128.x)는 `app.routes`에 평탄하게 들어오지만 배포 이미지(0.138+)는 `_IncludedRouter`로 감싸 `original_router`만 준다 … `requirements.txt`가 핀 없는 `fastapi>=0.104.0`이라 이 발산은 계속 진행된다."
- 부수: `pytest>=7.4.0`(`:11`)이 프로덕션 requirements에 있어 배포 이미지에 테스트 프레임워크가 들어간다(테스트 *파일*은 `.dockerignore`로 빠진다).

### 10.8 로컬 `.venv`(3.9.6) ≠ Docker(3.12) — **설계상 트레이드오프**(사실상 하드 제약)
| 축 | 로컬 | Docker | 결과 |
|---|---|---|---|
| Python | 3.9.6 (`backend/.venv/pyvenv.cfg:3`) | 3.12 (`backend/Dockerfile:1`) | 런타임 평가 어노테이션에 PEP604 `X \| None` 금지 → `Optional[X]` 필수 |
| `lxml` | 없음 | 있음 | HTML 파싱은 `"html.parser"`만 (현재 10곳 전부 준수) |
| `PyJWT` | 있음 | 없음 | `tests/test_auth.py:3` (§9.7) |
| FastAPI | 0.128.x | 0.138+ | 라우트 트리 순회 방식 발산 (§10.7) |

**로컬 pytest가 사실상 유일한 게이트**이므로 로컬 쪽 제약이 이긴다.
- **잠재 함정 — 문자열 주석 우회가 4곳에 쓰이고 있다**: `routers/stocks.py`는 `from __future__ import annotations`가 **없는데** `| None`을 쓴다 — `:242`, `:483`, `:600`, `:607`이 전부 **인용부호로 감싼 문자열 주석**(`"dict | None"` 등)이라 런타임 평가를 피한다. 넷 다 private 헬퍼라 `get_type_hints`를 타지 않아 현재 안전하지만, **누가 "정리"하며 인용부호를 지우면 로컬 py3.9가 즉시 `TypeError`**를 낸다. 나머지 백엔드 파일은 전부 `from __future__ import annotations`를 갖는다.

---

## 11. Cowork fire 파이프라인 (ADR-0028)

### 11.1 워크디렉터리 격리 — **이미 가드됨(잔여 위험만)**
- ⚠️ **B22 해소** — `scripts/cowork-fire-listener.py:45`가 `Path(tempfile.mkdtemp(prefix=ts + "-", dir=str(RUN_DIR)))`로 **원자적 고유 디렉터리**를 만든다(`:44` `RUN_DIR.mkdir(parents=True, exist_ok=True)`가 부모 보장, `:46` `run.log` open, `:50` `cwd=workdir`). `:9-11` docstring이 옛 실패 모드를 기록한다. 초 단위 충돌로 실행 중 프로세스의 `run.log`가 truncate되는 일은 사라졌다.
  - 계획이 제안했던 `f"{ts}-{os.getpid()}"`는 **무효였다** — 리스너가 launchd 장수 단일 프로세스라 PID가 늘 같다. 버그리포트의 "제안 수정"은 증상 관찰과 신뢰도가 다르다는 사례.
- **잔여**: 프론트 잠금은 여전히 종목 단위다(`pages/AnalystReports.jsx:165` `disabled={firing === s.ticker}`, state `:25`, POST `:83`) — 다른 티커는 즉시 통과하므로 동시 fire는 그대로 가능하다. `run.log` 유실 결과는 없어졌지만 §11.2의 무계 스폰은 남는다.

### 11.2 무계 프로세스 스폰 — **잠재 위험**
- `:14` docstring이 "동시 fire는 그대로 병행 스폰(중복 enrich 가능하나 무해)"로 명시 수용했으나, 스로틀·동시성 상한이 파일 어디에도 없어 §5.2의 admin 등가 키와 결합하면 무계 fork 레버가 된다.

### 11.3 fire 훅은 best-effort — **이미 가드됨**
- `services/cowork_trigger.py`: `configured()`(`:21`)가 env 미설정 시 휴면(dormant-safe), 실패는 `logger.warning`(`:38`, `:43`)만 하고 예외를 전파하지 않아 배치 본문을 깨뜨리지 않는다. 타임아웃 명시(`:35`).
- `scripts/cowork-fire-listener.py:63-66`: 토큰 미설정 시 401(fail-closed), 127.0.0.1 바인드(`:91`).
- `:31-35` `_env_value`가 `.env.docker`를 직접 파싱한다 — 인용부호·`export` 접두를 처리하지 않는다(잠재, 낮음).
- **관측 한계(ADR-0028 §명시 수용)**: fire-and-forget이라 루틴 실행 *결과*를 실시간으로 알 수 없다. 사후 관측은 `enriched_at`(`GET /api/stocks`에 additive 노출, `Reports.jsx`·`Ranking.jsx`가 표시)과 발행물이다 — 이건 **기록된 트레이드오프**이고 5차 버그헌트에서 결함으로 오분류돼 기각(R1)됐다. 재제기 금지.

---

## 12. 문서·설정 드리프트

### 12.1 `docs/*.md`가 실존하지 않는 구조를 설명한다 — **확인된 버그**(문서)
- `docs/ARCHITECTURE.md`·`API.md`·`CONFIGURATION.md`·`DEVELOPMENT.md`·`GETTING-STARTED.md`·`TESTING.md` 모두 마지막 커밋이 `fab3f1f`(2026-05-24).
- `docs/ARCHITECTURE.md`가 설명하는 것들: `scheduler.py`(`:35`)·`storage.py`(`:69`)·`market.py`(`:70`)·`market_indicators_service.py`(`:74`) — 전부 ADR-0017로 패키지 분리돼 **단일 파일로 존재하지 않는다**. `:69`·`:120`은 `backend/data/*.json`을 "single source of truth"라고 하는데 실제 정본은 PostgreSQL이다.
- `README.md:261-267`의 참고 문서 목록에 `docs/`가 **없다** — 링크되지 않은 채 남은 오해 유발 문서다. `.gitignore:30`에 `docs/superpowers/`가 있지만 5개 파일이 이미 tracked라 무효.

### 12.2 `ALL_MENUS`가 두 파일로 갈라지고 한쪽에 죽은 키가 있다 — **잠재 위험**(현재 무해)
- `routers/auth.py:108` = 6개(`portfolio, research, market, **analysis**, guru, settings`), `routers/admin.py:10` = 5개(`analysis` 없음), `app_schema.sql:124-127` 시드 = 5개.
- `admin.py:20,42,48,50,67,82,96`이 자기 목록 밖 메뉴를 `continue`/필터하므로 `analysis`는 **부여 자체가 불가능**하다. 프론트에서 `analysis`를 권한 키로 쓰는 곳이 **0곳**(nav perms는 `navSections.js:14,24,28,35,43` = research/portfolio/market/research/guru)이므로 현재는 기능 영향 없는 **죽은 키 + 목록 이원화**다.

### 12.3 `.env.docker.example`이 실제 필요 키와 어긋난다 — **잠재 위험**(드리프트가 지난 판의 2배)
- `backend/.env.docker.example`은 13개 키를 담고, `README.md:51-79` 대비 **12개**가 빠져 있다: `POSTGRES_PASSWORD`, `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIWOOM_BASE_URL`, `KIS_BASE_URL`, `KOFIA_API_KEY`, `DART_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `COWORK_API_KEY`, `COWORK_ROUTINE_FIRE_URL`, `COWORK_ROUTINE_FIRE_TOKEN`. 그중 백엔드가 실제로 읽는 것은 `COWORK_ROUTINE_FIRE_TOKEN`·`DART_API_KEY`·`KIWOOM_APP_KEY`·`KIWOOM_SECRET_KEY`·`KOFIA_API_KEY`다 → 새 환경 부트스트랩 시 **조용히 휴면 기능**이 생긴다.
- `backend/.env`(로컬)에 `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_ANON_KEY`·`SUPABASE_JWT_SECRET` 4개가 남아 있다 — 마이그레이션 이전 잔재. 코드 참조는 `tests/test_auth.py:22`뿐(§9.7).
- `ANTHROPIC_API_KEY`가 example에 남아 있으나 백엔드에서 미사용(`requirements.txt`에 anthropic 없음 — 백엔드 무LLM 원칙).

### 12.4 리포지토리 위생 — **잠재 위험**(낮음, 악화 중)
- untracked **169개**(지난 판 152), 그중 `screenshots-uat*` **63개**(54 → 63) + `screenshots-guru-row-ux/` 1개, `scripts/` untracked 97개(`scripts/package.json`·`package-lock.json` 포함). `.gitignore:59`는 `screenshots/`(단수)만, `:60`은 `scripts/node_modules/`만 무시하므로 나머지는 영구히 `git status` 노이즈다. `.gitignore:41`은 `.claude/settings.local.json`만 무시해 `.claude/` 나머지도 노이즈다.
- 이 노이즈가 §9.1의 "전체 스위트 후 `git status`로 부수효과 확인" 습관을 실질적으로 방해한다.
- `CLAUDE.md` **131KB** · `API_SPEC.md` **121KB**. 후자는 수동 동기 대상이고 존재 drift만 자동 검출된다(§9.6).
- `.gitignore:14` 주석이 "Supabase is source of truth"라고 적혀 있다 — Supabase는 제거됐다.

### 12.5 스테일 주석 (틀린 불변식을 심는다)
- `services/db.py:23-24` — 사이징 근거를 "calendar 15·analysis 11"로 적었으나 전체 최대 fan-out은 20.
- `routers/stocks.py:427`·`scheduler/jobs.py:298`·`:426` — `maxconn=10`(실제 20).
- `services/batch_registry.py:2` — "20개 배치"(실제 29).
- `services/dividends.py:46`(및 `:4`) — yfinance `dividendYield`가 퍼센트 스케일이라고 단언(`CLAUDE.md:233`은 소수분수, §2.6).
- `components/GlobalSearch.jsx:31` — stale 캐시 오판을 피하려 재fetch한다고 하는데 실패 경로가 그 오판을 재도입한다(§7.2).
- ⚠️ **폐기**: `market_indicators/kospi_futures.py:4`의 "fx.py의 VIX식 폴백" 서술은 이제 없다 — `:3-5`가 "sentiment.py 방식으로 직전 저장값 폴백(get_or_refresh는 stale-fallback 안 함)"으로 정정됐고 코드도 `:55-58`에서 실제로 그렇게 한다.

### 12.6 코드 주석이 이 문서의 섹션 번호를 인용하고 절반이 stale — **잠재 위험**(신규)
9곳이 `CONCERNS §N`을 직접 인용한다. **번호가 시대별로 달라 이미 어긋나 있다.**

| 위치 | 인용 | 현재 |
|---|---|---|
| `backend/main.py:256` | §3 | ✅ NaN = §3 |
| `backend/routers/stocks.py:497` | §3 | ✅ |
| `backend/routers/stocks.py:672` | §3 | ✅ |
| `backend/tests/test_stocks_router.py:638` | §3 | ✅ |
| `backend/routers/recommendations.py:209` | §1 | ❌ NaN은 §3 |
| `backend/routers/calendar.py:43` | §7 | ❌ FOMC 커버리지·무음 미표시는 §6.10(§7은 프론트) |
| `backend/routers/batches.py:60` | §7 | ❌ 위와 동일 |
| `backend/services/db.py:24` | §4.2 | ❌ 풀/ThreadPool은 §4.5 |
| `API_SPEC.md:2285` | §7 | ❌ 위와 동일 |

→ **대분류 번호(§0~§14)를 고정으로 유지**하고, 새 주제는 하위번호로 추가한다. 위 5곳은 다음 손댈 때 함께 고칠 것.

---

## 13. `CLAUDE.md`·지난 판의 서술 중 지금과 다른 것

`CLAUDE.md`는 역사 문서다. 아래는 HEAD `4752112`에서 재검증한 **현재 사실**이다.

| 서술 | 현재 사실 |
|---|---|
| 005930이 "정확히 70000.0"으로 박제된 건 KRX/NXT 피드 글리치 | task#170 정정대로 **로컬 pytest → prod DB 오염**이 유력. 실제 해결은 `conftest.py:26-37` `_block_real_db`(task#169). ADR-0020의 2-of-N 다수결과 박제-시 독립 ref 게이트는 유효하나 **관측된 70k엔 발동한 적 없다**(테스트가 게이트를 우회). 라운드 70k가 또 보이면 피드 글리치 전에 **테스트 오염부터** 의심하라 |
| `test_api_doc_sync.py`의 미문서화 23개가 `KNOWN_UNDOCUMENTED`로 동결 | `:50` = `frozenset()` — task#100에서 전수 문서화 완료, **베이스라인 0** |
| `API_SPEC.md`에 `**Auth:** 불필요` 오표기 8곳 | **청소됐다** — 현재 1곳이고 그건 정당한 `GET /api/auth/oauth/token`(`API_SPEC.md:178`). `CLAUDE_COWORK_API.md`는 0곳. 자동 게이트는 여전히 없다(§9.6) |
| `backend/data/sp500_tickers.json` 오염이 전체 스위트 실행 시 발생 | task#234가 닫음(`earnings.py:25-31,61-76`). **단 write 경로가 0이 된 것은 아니다** — `digest_service.py:163-164`가 **tracked** `backend/data/digest/`에 쓴다(§9.1 잔여 E) |
| `services/recommendation/universe.py`가 그 파일의 writer | **아니다** — `:39`는 `open()` read만 |
| `market_indicators.py` 라우터에 `/api/market-indicators` prefix가 있다 | prefix는 `/api/market` **하나뿐** |
| 캐시 6종, snapshot LRU 200, list TTL 5s | **9종**, LRU **50**, list **60s** (§8.3) |
| task#104 "per-card throw가 근본" | 근본은 `_portfolio_totals` NaN→직렬화 500이었고 세 번째 트리거는 배당 `float/Decimal` TypeError였다. 셋 다 가드됨 — **단 `sanitize`에 Decimal NaN 구멍이 남아 있다**(§3.1) |
| task#97 "그외 탭 삭제 404" | 닫혔다 — `components/reports/StockActions.jsx:14`가 `is_mine`으로 게이트(§7.11) |
| KR beta tz 정렬 버그 | **두 호출처 모두 고쳐졌다**(`beta.py:78`, `report_generator.py:311`). 잔여는 `calc_beta`/`indicators.py:108` 자체가 정규화를 안 한다는 것이고, **"이상적 헬퍼가 미사용"은 stale** — `_normalize_index`(`report_generator.py:541-546`)는 이제 6회 쓰인다(beta 경로만 미적용, §6.6) |
| 배지 색: success=빨강/danger=파랑, warning 깨짐 | **리디자인 전 기준**. 현재는 통념대로(success=녹, danger=빨, warning=오커)이고 가격 방향은 `.badge--up`/`--down` 전용 변형(§7.12) |
| `nav` 경로 목록이 "PC/모바일 두 곳"에 이원화 | **세 곳이었고(그 부정확이 결함 원인이었다) 이제 한 곳이다** — `frontend/src/navSections.js`(§7.4). 남는 것은 접두사 매칭·아이콘 맵 2중 복제·라우트 커버리지 게이트 부재 |
| `.forge/bug-report.md`(5차, task#221) 8건 중 6건 미해결 | **8건 전부 해소** — H1→task#250, M1+M3→#251, M2·M4·L3→#254, L2→#254, L1→#222. 루트 `bug-report.md`는 아직 5차 내용이고 6차(task#256)가 덮어쓸 예정(§14) |
| 지난 판 §10.5 "`.dockerignore`가 없다" | **틀렸다** — `backend/.dockerignore`가 tracked이고 `.venv`·`.env`·`tests/`를 제외한다(§10.5) |
| 지난 판 §1.7 "`kospi_futures.py:4` 주석이 fx.py를 잘못 인용" | **정정됐다** — 지금은 sentiment.py 방식을 정확히 서술하고 코드도 일치(§12.5) |
| 지난 판 §3.5 "`market_indicators` 서브모듈 전부 sanitize 가드됨" | **12개 중 4개만** 한다. 나눗셈 가드·`dropna` 덕에 라이브 위험은 낮다(§3.5) |
| 지난 판 §4.1 "`_migrate` CREATE 없는 테이블 11개" | **21개**다(11 + baseline 10). 재구축 pgdata 실패 반경이 그만큼 넓다(§4.1) |
| 지난 판 §2.10 "`requests` 28개 전부 timeout" | 호출 지점이 **47개**로 늘어 한 줄 grep으로 재확인할 수 없다(스팟 확인은 통과, §2.10) |

---

## 14. 계획됐지만 미실행인 것 (`.forge/backlog/`)

아래 4건은 **이미 계획서가 있다** — 같은 문제를 새로 발굴하지 말고 그 계획을 먼저 읽을 것.

| task | slug | 무엇 | 이 문서의 어디 |
|---|---|---|---|
| #256 | `bug-hunt-cycle6` | `4393dde..4752112`(78커밋) 5렌즈 버그 헌트. 루트 `bug-report.md`를 6차로 덮어쓴다 | 전 섹션 |
| #257 | `guru-alloc-scope-switch-animation-cost` | 스코프 전환 596ms 중 `.anim-fade-up` 1,723개 동시 시작 몫을 대조군으로 분리, ≥50ms면 첫 진입 1회로 게이팅 | §7.13 |
| #258 | `self-multiple-timeseries-observation` | 자사 멀티플을 자기 과거 스냅샷 중앙값과 대조해 **로그만** 남기는 관측 장치(ADR-0030의 50% breakdown 전제 실증) | §1·§9.9 |
| #259 | `mobile-tabbar-overlap-axis` | `uat-guru-row-ux.mjs`에서 통째로 빠진 하단 탭바 겹침 축을 `.tabbar` 실측으로 복원 | §9.3·§9.10 |

`#257`·`#259`의 계획서에는 이 문서가 담지 않은 **실측 수치와 재시도 금지 조건**이 들어 있다(예: `content-visibility` 재시도 금지 근거, 「화면 행 수 == 코호트 크기」계약 3종의 파일·행). 가상화 착수 전 필독.
