---
last_mapped_commit: 91bac67ddb3ca7277a850fa6840a0fce0f7344cf
mapped: 2026-07-30
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

`CLAUDE.md`는 *역사* 문서라 이미 고쳐진 항목·나중에 정정된 항목이 섞여 있다. 이 문서는 **HEAD `91bac67` 시점의 코드 상태**를 기준으로 재검증한 결과다. 어긋나는 곳은 §13에 모았다.

---

## 0. 지금 열려 있는 확인된 버그

### 데이터 손실·오염
| # | 결함 | 위치 | 도달 조건 |
|---|---|---|---|
| B1 | KR 랭킹 빈응답이 전 KR 행을 DELETE | `services/ranking_service.py:109-110` → `:162` | Naver 200 + 빈/개명 페이로드 |
| B2 | `sanitize`가 `Decimal('NaN')`을 통과시킨다 | `services/utils.py:37` | NUMERIC 컬럼에 NaN 존재 시 |
| B3 | `POST /api/portfolio`가 raw JSON `NaN`을 저장 → `GET /api/portfolio` 영구 500 | `routers/portfolio.py:40-43` → `:249` → `:62` | 본문에 `NaN` 토큰 |
| B4 | NaN이 컨센서스 마트까지 전파 | `services/consensus_pipeline.py:184` → `:237` | yfinance가 NaN target 제공 |
| B5 | 사용자 삭제가 6개 트랜잭션 — 중간 실패 시 반쯤 삭제된 사용자 | `routers/admin.py:111-119` | 루프 중 DB 오류 |

### 무음 미동작 / 오값
| # | 결함 | 위치 | 도달 조건 |
|---|---|---|---|
| B6 | 키 미설정 배치가 "성공"으로 기록 | `market_indicators/econ.py:13-15`, `macro.py:59-61`, `scheduler/jobs.py:76,87,431` | `FRED_API_KEY`/키움 미설정 |
| B7 | KR 배당 기준연도가 1년 어긋남 | `services/dividends.py:101` | 4월 1일 00:00–09:00 KST |
| B8 | 컨센서스 `report_date`가 UTC 변환으로 하루 밀림 | `services/consensus_pipeline.py:173` | US/Eastern 저녁 발행 리포트 |
| B9 | 프론트에 access token 갱신 경로가 없다 | `frontend/src/api.js:15-25` | 1시간 경과 (항상) |
| B10 | 관심종목 토글이 POST/DELETE를 반대로 고른다 | `pages/Ranking.jsx:157` → `:214-218` | `/api/watchlist` fetch 실패 |
| B11 | 이미 추적 중인 종목이 "추가" 모달로 라우팅 | `components/GlobalSearch.jsx:19-26` → `:32-35` | `/api/stocks` fetch 실패 |
| B12 | `loadStockMap`에 catch 없음 → unhandled rejection | `pages/GuruDetail.jsx:114-120`, `pages/GuruManagers.jsx:52-58` | fetch 실패 |

### 표시 오류
| # | 결함 | 위치 |
|---|---|---|
| B13 | 수급 추이 Y축이 주(株)를 억원으로 포맷 → "541.4조" | `components/reports/InvestorTrendSection.jsx:56` |
| B14 | 구루 총 투자금에 T 단위가 없어 "1500.0B" | `pages/GuruAllocation.jsx:18-23` → `:100` |
| B15 | 상승여력 색상이 항상 무채색 (CSS 토큰 불일치) | `pages/AnalystReport.jsx:332` vs `components/ui/Stat.css:16-17` |
| B16 | 심층 리포트 라우트가 PC 서브바·모바일 탭에서 누락 | `components/Masthead.jsx:74`, `components/MobileNav.jsx:10` |

### 계약·보안
| # | 결함 | 위치 |
|---|---|---|
| B17 | `PointMetric.change_pct`가 명시적 `null`을 422로 거부 → 발행 전체 차단 | `routers/analyst_reports.py:29` |
| B18 | `COWORK_API_KEY`가 `argv`로 노출 | `scripts/cowork-fire-listener.py:35,43` |
| B19 | 하드코딩 폴백 시크릿 `"dev-secret"` | `backend/routers/auth.py:45` |
| B20 | 레이트리밋 전무 (로그인·리포트 생성) | `main.py`, `nginx/nginx.conf` 전역 |
| B21 | Postgres가 약한 폴백 비밀번호로 호스트에 발행 | `docker-compose.yml:9,12-13` (루트 `.env`에 값 없음) |
| B22 | fire 워크디렉터리 초 단위 충돌 → `run.log` truncate | `scripts/cowork-fire-listener.py:38-41` |
| B23 | `pages/Portfolio.jsx`를 vitest에서 마운트할 수 없다 | `frontend/src/test/setup.js` (1줄, 폴리필 0) |

---

## 1. 데이터 무결성 — 빈/실패 fetch가 양호값을 덮어씀

이 프로젝트 최대 반복 결함군. task#242·#243·#244가 19개 저장 지점을 전수 감사하며 **실패 클래스 3종**(a 예외 / b 성공-but-빈응답 / c 부분 페이로드)을 정리했다. 아래는 그 감사 **이후 남은** 것들이다.

### 1.1 `get_kr_rankings` wipe-on-empty — **확인된 버그** (B1)
- `services/ranking_service.py:129-137`. `_fetch_naver_market`은 부분 페이지 실패를 `raise`하고(`:120-123`), HTTP 오류는 `raise_for_status()`(`:104`)로 잡는다. 그러나 **200 + `totalCount:0`/`stocks:[]`** 이면 `pages<=1` → `return stocks`(`:109-110`)로 빈 리스트를 정상 반환한다.
- 형제 `get_us_rankings:144-145`는 정확히 이 문을 `raise RuntimeError("… returned empty quotes — skipping replace")`로 막았고, `tests/test_rankings_empty_guard.py`가 **US만** 못박았다(테스트 docstring이 `get_us_rankings`만 언급 — 가드 범위가 곧 결함 범위).
- 결과: `replace_market_rankings("KR", …)`의 단일 트랜잭션 `DELETE FROM market_rankings WHERE market='KR'`(`:162`)이 돌고 INSERT가 0건. **단일 트랜잭션은 부분 상태를 막지만 "전부 지우고 전부 안 넣는 것"은 정상 커밋된다.**
- **blast radius가 랭킹 탭을 넘는다** — `services/investor_service.py:140` `read_screening`과 `scheduler/jobs.py:268-272`가 유니버스를 `market_rankings`에서 파생한다.

### 1.2 `ON CONFLICT DO UPDATE SET x = EXCLUDED.x`가 양호 컬럼을 NULL로 덮음 — **잠재 위험** (재실행·백필에서 확정적)
task#242·#243 감사는 `market_cache`와 delete-rewrite만 봤고 이 4곳은 스코프 밖이었다.
- `services/leverage_service.py:125-153` + `:167-180`. `fetch_and_store`가 credit·fund·cap **3개 독립 fetch**를 `by_date`로 머지한다. cap fetch가 200-with-0-items(예외 없음)면 머지 dict에 그 키가 없어 `row.get("kospi_market_cap")` = None → `SET kospi_market_cap = EXCLUDED.kospi_market_cap`이 **직전 양호값 위에 NULL**을 쓴다(9컬럼 전부 같은 형태).
- `services/lending_service.py:72-85` — 동일 형태(단일 소스라 확률 낮음, `_safe_int` 파싱 실패가 트리거).
- `services/investor_service.py:92-112` — `foreign_hold_ratio`는 키움 전용. Naver 폴백(`:59-69`)이 None을 주면 양호 ratio를 지운다.
- `services/short_sell_service.py:25-42` — 동일 형태.
- 수정 형태: `SET x = COALESCE(EXCLUDED.x, table.x)`.

### 1.3 부분 페이로드가 완전한 값을 대체 — **잠재 위험**
`_mc_save`를 하는 17개 키 중 whole-empty 가드는 붙었으나 **per-key/per-item** 가드가 없는 곳:
- `services/market_indicators/commodities.py:27-29,58` — per-key 예외가 `None`이 되어 payload에서 그 키가 사라진다. 형제 `treasury`(`:91-95`)는 per-key stored merge를 하는데 `commodities`만 안 한다(같은 파일 내 비대칭).
- `services/market_indicators/earnings.py:217,251` — `_merge_quarters`가 **살아남은 티커만** 합산해 M7/KR Top2 실적 총계가 조용히 과소계상된다.
- `services/kr_sector_service.py:62-65` — per-sector all-None 엔트리가 저장된다. `build_sector_index`(`:104-106`)가 실패 업종을 스킵하므로 "비어 있지 않지만 불완전한" 인덱스가 완전한 것을 덮는다(task#243은 *전체* 빈 경우만 막았다).
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
- `services/market_indicators/econ.py:72-75`가 저장 행을 **나이 검사 없이** 서빙하고 `_is_valid_econ_data({})`가 `True`다. `:49-50`에서 FRED가 0 observation을 준 채 한번 `{"cpi":[],"unemployment":[]}`가 저장되면 **영구히** 그 값이 서빙된다.
- 추가로 `:78`의 `_mc_delete`가 **재fetch 이전에** 실행된다(오염 데이터 의도적 폐기지만, 이후 FRED 불통이면 키가 없는 상태로 남는 파괴적 순서).

### 1.7 소스-폴백이 정답 형태다 — **이미 가드됨(참조 패턴)**
빈 결과 가드의 기본형은 "저장 직전 한 지점 판정"이 아니라 **fetch 계층에 last-good을 실어 소스에서 폴백**시키는 것이다. 참조 구현:
- `services/market_indicators/fx.py:36-40` — fetch 실패 시 `stored_history`를 담아 *반환*.
- `services/market_indicators/cache.py:69-72` — `_merge_history(prev, [])`가 prev를 그대로 반환.
- `services/market_indicators/indices.py:31-37,133-134,143` — per-key stored 폴백 + `if any(...)` persist 게이트. **17개 키 중 형태가 가장 좋다.**
- `services/market_indicators/kospi_futures.py:21-23` — 값 수준 가드(`price is None or not history` → last-good), task#157.
- `services/market_indicators/kospi_signal.py:193-198,233-234,243,249` — `fetch_ok` 플래그 + `changed` 게이트.
- `services/us_supply.py:231-241,259-262` — `_is_all_empty` + skip-save.
- `services/recommendation/store.py:15-58` + `funnel.py:458` — 단일 트랜잭션 + 호출자 게이트.
- 반례 주의: `services/market_indicators/kospi_futures.py:4` 주석은 "fx.py의 VIX식 폴백을 따른다"고 하지만 `fx.py:109-111` `get_vix`는 **예외 시** 저장값을 반환하지 않는다(빈응답만 폴백).

---

## 2. 외부 소스 파싱 취약성

### 2.1 Naver 재무를 **위치 인덱스**로 읽는다 — **잠재 위험** (이 군에서 가장 위험)
- `services/market/kr.py:45-54` `_naver_row_val(rows, row_idx, key)`; 소비 `:333,349-354,362,373-377`(분기) / `:422,429-434,436,447-451`(연간).
- 행 순서가 곧 계약이다: `rows[0]`=매출, `[1]`=영업이익, `[2]`=순이익, `[5]`=영업이익률, `[6]`=순이익률, `[7]`=ROE, `[8]`=부채비율, `[9]`=당좌비율, `[11]`=EPS, `[12]`=PER, `[13]`=BPS, `[14]`=PBR.
- Naver가 `financeInfo.rowList`에 한 행만 삽입/재배열하면 **모든 필드가 밀려 "그럴듯한 오값"**이 된다 — 흔한 silent-None보다 나쁘고 로그에도 안 남는다. `pbr`은 심지어 밀린 `per*eps/bps`에서 *파생*된다(`:359-360`).
- 가드 없음. `tests/test_financials_kr.py`·`test_financials_kr_cashflow.py`의 fixture가 같은 순서를 쓰므로 라이브 재배열에도 green으로 남는다. `trTitleList`/행 제목과의 라벨 교차검증이 없다.

### 2.2 `_table_unit`의 억원 기본값 폴백 — **잠재 위험** (×100 대형 오저장 클래스)
- `services/backlog_parser.py:211-220`. 세 갈래 중 **`단위` 문자열을 아예 못 찾으면 `_DEFAULT_UNIT="억원"`**(`:220`)으로 떨어진다. "추출 실패는 기본값이 아니라 pending"(wrong<missing) 규칙의 남은 한 다리.
- 가중 1: `table.find_previous(string=re.compile("단위"))`(`:216`)가 **범위 무제한**이라 앞쪽 무관한 표의 캡션(예 `백만원`)을 집어 `억원` 표에 적용할 수 있다.
- 가중 2: 검산이 **단위 맹목**이다 — `_parse_susu_table`이 raw 값으로 `_reconcile`(`:183`)한 *뒤* `_to_eok`(`:185`)로 스케일한다. `수주총액 − 기납품 ≈ 잔고`는 어떤 단위에서도 성립하므로 틀린 단위가 검산을 통과해 `source='dart'`로 ×100/÷100 저장된다.
- 참조 정답: `services/market/kr.py:529-536` `_rd_unit`은 캡션 없으면 `None`을 반환하고 `:603`에서 `continue`한다 — 주석이 `backlog._table_unit`과 다르다고 명시한다.
- 부수: `backlog_parser.py:22` `_UNIT_KEYWORDS`가 `천원`/`원`을 빠뜨려(`_EOK_FACTOR:29`와 `_table_unit` 정규식은 지원) 천원 표가 억원으로 떨어진다. pending 경로 전용이라 영향 작음.

### 2.3 숫자 파서가 드리프트에 `0`을 반환하고 그 0이 저장된다 — **잠재 위험**
- `services/kiwoom/investor.py:15-24` `_signed_int` → `0`, 소비 `:61-64`.
- `services/kiwoom/shortsell.py:19-28` `_int` → `0`, 소비 `:61-65`.
- `services/investor_service.py:11-21` `_parse_signed_int` → `0`, 소비 `:51-55`.
- 필드가 개명되면 `0`(None 아님)이 나와 `upsert_trend`가 저장한다 → "수급 0인 날"과 "필드 소실"을 구분할 수 없다. **같은 파일의 `_pct` 헬퍼들은 None을 반환**해 규칙을 지킨다(비대칭).
- 참조 정답: `services/insider_trades.py:65-78` `_num`은 None을 반환하고 `:98-99`가 그 행을 스킵한다.

### 2.4 DART status 코드가 전 경로에서 무시된다 — **잠재 위험**
- 6곳 전부 `status != "000"`을 코드 없이 삼킨다: `services/backlog.py:114-116,317-318`, `disclosures.py:66-67`, `insider_trades.py:140-141`, `agm.py:139-140`, `dividends.py:128-129`, `market/kr.py:573`.
- DART는 `013`(무데이터, 정상) 외에 `020`(레이트리밋 초과)·`011`/`012`(키 무효/미인가)를 준다. 전부 `continue`/`[]`/`{}`로 수렴하므로 **일일 쿼터 소진이나 키 회전이 "성공했는데 데이터가 없음"으로 보인다** — KR 배치 5종(수주잔고·공시·내부자·주총·배당)이 동시에 무음 미동작. `disclosures`·`insider_trades`·`backlog`·`dividends`는 `DART_API_KEY` 존재를 검사조차 안 한다.
- 참조 정답: `services/agm.py:162-163`만 `"[AGM] DART_API_KEY 미설정 — skip"`을 로그한다.

### 2.5 완전 무음 fetch 실패 — **확인된 버그**(진단 불가)
외부 fetch 경로는 대체로 잘 로깅된다. 로그도 재전파도 없는 곳만:

| 위치 | 삼키는 것 |
|---|---|
| `services/guru_scraper.py:30-39` `get_name_kr` | `except Exception: pass` → 모든 `name_kr`이 `""` |
| `services/market/us.py:171-173` `_us_quote_kis` | `return None` — KR 쌍둥이(`kr.py:79-81,95-97`)는 같은 실패를 로그한다 |
| `services/scraper.py:23-25` | Finviz `snapshot-table2` 클래스 변경 → `{}` |
| `services/guru_scraper.py:198-199` | dataroma `table#grid` 재구조화 → `num_stocks=0`, 빈 holdings |
| `services/market/kr.py:641-646` | FnGuide `TARGET_PRC`/`RECOM_CD` 개명 시 전 행 스킵 → `_empty`(buy/hold/sell=0)를 "커버리지 없음"처럼 반환 |
| `services/market/kr.py:32-42` `_fnguide_market_cap` | 정규식 무매치 → None, `raise_for_status()` 없음(`:34`) |
| `services/market/kr.py:308-319` | `get_quote_kr` 최상위 except → error dict(응답엔 뜨나 서버 로그엔 흔적 없음) |
| `backend/main.py:51-57` `_warm_market_cache` | `except Exception: pass` — 프로젝트 자체 "silent except 금지" 규약 위반 |

앱 코드 전체에서 로그 없는 `except … : pass`는 **15곳**(`routers/`·`services/`·`scheduler/`·`middleware/`·`auth.py`·`main.py` 기준).

### 2.6 퍼센트 스케일 계약이 갈려 있다 — **잠재 위험**
동일 DB에 두 규약이 공존하고 판정 주체가 **프론트**다. 인제스트 경계에 정규화도 범위 단언도 없다.

| 필드 | 저장 | 프론트 | 스케일 |
|---|---|---|---|
| `short_pct_float` | `services/us_supply.py:119` | `UsSupplySection.jsx:82` `(v*100)` | 소수분수 |
| `pct_held`/`pct_change` | `us_supply.py:129,131` | `UsSupplySection.jsx:125,129` | 소수분수 |
| `pct_buy`/`pct_sell` | `us_supply.py:78-83` | `UsInsiderSection.jsx:107,113` | 소수분수 |
| **`dividend_yield`(US)** | `services/dividends.py:63-66` | `DashboardCard.jsx:146` **×100 없음** | 퍼센트 |
| `dividend_yield`(KR) | `dividends.py:143` (DART `%`) | 같음 | 퍼센트(진짜) |

- `dividends.py:46` 주석은 "현 yfinance는 퍼센트 스케일"이라 단언하는데 `CLAUDE.md` 가토는 소수분수라고 한다. **둘 중 하나는 stale이고 코드에 가드가 없다.** `requirements.txt:4`는 `yfinance>=0.2.40`으로 범위 핀이고 이 필드의 스케일은 그 범위 안에서 바뀐 이력이 있다. 스케일을 검증하는 테스트가 없어 버전 범프가 전 US 수익률을 100배 틀리게 만들 수 있다.
- 나머지 `*100` 사용처는 전부 정합함을 확인했다(2 소비처 필드 `hv`는 `DetailTab.jsx:650`·`Compare.jsx:89` 양쪽에서 곱함). `us_supply.py:78-83`은 DataFrame 행 라벨 `"Net Shares Purchased (Sold)"`·`"% Buy Shares"` 등 exact 문자열에 의존한다.

### 2.7 단위 배수 하드코딩 — **설계상 트레이드오프**(일회성 라이브 프로브가 유일한 근거)
`kiwoom/quote.py:46-47`(억원→×1e8) · `kis/quote.py:50-51`(×1e8) · `kiwoom/shortsell.py:62`(천원→×1000) · `market/kr.py:365-366,372,439,446`(×1e8) · `backlog.py:291`(÷1e8) · `leverage_service.py:339-345` · `lending_service.py:145-148` · `exports.py:75-76,98-99`. 벤더가 단위를 바꾸면 100~1000× 무음 오류.
- **죽은 코드지만 함정**: `services/market/format.py:26-32` `_to_won`은 크기로 단위를 추론한다(`v*1e8 if abs(v) < 1e10 else v`). 호출처 0(`market/__init__.py:13`에서 re-export만). 진짜 100억 미만 원 값이 들어오면 1e8배 부풀린다.

### 2.8 무한 루프 가능 페이지네이션 — **잠재 위험**
- `services/lending_service.py:24-35` `_fetch_all`: `while True`가 `len(items) < page_size`로만 탈출한다. 형제 `leverage_service.py:45-47`은 `totalCount`도 본다. 포털이 `pageNo`를 무시하고 계속 1000행을 주면 배치 안에서 무한 누적.
- `services/kiwoom/client.py:114-130` `request_paged`: 페이지 카운터 없음. `list_key`가 드리프트하면 `items`가 안 늘어 `max_items` 브레이크가 무력화된다.

### 2.9 응답 봉투·상태 검사 누락 — **잠재 위험**(낮음)
- `services/kiwoom/client.py:71,153`·`kis/client.py:129` — `rc not in (0, None)`이라 **`return_code`/`rt_cd`가 아예 없으면 성공으로 취급**한다. 프록시/봉투 변경 시 에러 본문이 정규화기로 흘러 all-None이 된다. 하류 `price is None` 검사(`market/kr.py:82-84,98-100`)만이 가드.
- `.json()` 앞에 상태 검사가 없는 6곳: `disclosures.py:50`, `insider_trades.py:125`, `backlog.py:102,306`, `agm.py:126`, `dividends.py:114`. 전부 try/except 안이라 HTTP 오류가 "파싱 실패"로 보고되는 정도.
- `services/market_indicators/exports.py:143-145` — 레거시 파일 캐시를 try/except 없이 `json.load`한다. `:128-130`의 비원자적 write로 잘린 파일이 남으면 엔드포인트가 500.

### 2.10 취약·비공식 소스 인벤토리
| 소스 | 위치 | 차단 시 |
|---|---|---|
| CNN F&G | `market_indicators/sentiment.py:10,27-58` | **가드됨** — VIX식 수동 last-good(`:67-79`) |
| `multpl.com/shiller-pe` | `market_indicators/indices.py:98-109,42-95` | **가드됨** — 저장 CAPE 폴백(`:133-134`) |
| **dataroma** | `services/guru_scraper.py:10,116,175,311` | **가장 취약** — 위치 인덱스 `cells[1]/[2]/[3]/[6]`(`:135-163`), CSS id `div#f_name`/`p#p2`/`table#grid`, `_ACT_ROW_TDS=5`, `weight_pct` 기본 `0.0`(`:147`), `portfolio_value` 기본 `0`(`:184`, `_parse_portfolio_value:50,54`). `scrape_holdings`에 빈 결과 가드·로그 없음 |
| Naver 모바일 API | `market/kr.py:16,19-22` 외 6곳 | 시세는 2-of-N 다수결로 보호. **재무 경로(§2.1)가 노출면** |
| Naver US API | `guru_scraper.py:11,31` | 무음 `""` |
| FnGuide (HTML + 비공식 JSON) | `market/kr.py:33,626`, `consensus_pipeline.py:125` | 컨센서스는 Naver Research 폴백. 시총 경로 무음 |
| Wikipedia S&P500 표 | `market_indicators/earnings.py:120-126` | `table id=constituents` 의존, 시드 파일 폴백 있음 |
| Naver 시총 페이지 (euc-kr) | `market_indicators/earnings.py:133-148` | `range(1,50)` 최대 49콜 |
| Finviz | `services/scraper.py:19` | `{}`, 부분 무음 |
| UN Comtrade preview | `market_indicators/exports.py:13,84-89` | **가드됨** — task#243 last-good + `stale` 마커 |
| Google Fonts / jsdelivr | `frontend/index.html:9-13` | 자체호스팅 앱의 외부 의존(첫 로드 후 SW CacheFirst로 완화, `vite.config.js:22-38`) |

- 하드코딩 URL 중복: `market/kr.py:626`과 `consensus_pipeline.py:125`가 같은 FnGuide JSON 경로를 독립 조립한다 — 한쪽만 고치면 다른 쪽이 깨진 채 남는다.
- `requests.get/post` 28개 전부 `timeout=` 있음(5~30s). **이미 가드됨.**
- BeautifulSoup 10곳 전부 `"html.parser"`. 로컬 `.venv`에 `lxml`이 없으므로 이게 정답. **이미 가드됨.**

### 2.11 컨센서스 점수의 중립 기본값 — **잠재 위험**
- `services/consensus_pipeline.py:40` `_score`가 정확맵(`:12-27`)→부분문자열(`:36-39`) 실패 시 **`3.0`(중립)**을 반환한다. 같은 형태가 `:145-147`(`recom = 3`)·`:148`(`_RECOM_TO_OPINION.get(…, "중립")`)에도 있다.
- 새 증권사 표현이나 벤더 언어 변경이 조용히 중립 점수를 `raw_reports.opinion_score` → `daily_consensus_mart.avg_opinion_score`와 buy/hold/sell 버킷(`_MART_SQL:269-271`)에 희석시킨다. "매핑 안 된 의견" 로그가 없어 관측 불가.

---

## 3. NaN/Inf·수치 타입

### 3.1 `sanitize`가 `Decimal('NaN')`을 통과시킨다 — **확인된 버그** (B2)
- `services/utils.py:37`이 `isinstance(obj, float)`만 검사한다. PostgreSQL `numeric`은 **NaN을 저장한다**(psycopg2가 `Decimal('NaN')`으로 되돌린다).
- 순서가 결정적이다: `sanitize`가 Decimal NaN을 그대로 통과 → 그 뒤 `jsonable_encoder`가 Decimal→float 변환 → starlette `allow_nan=False`에서 **500**. 즉 **`sanitize`를 부른 지점도 안전하지 않다** — 대표적으로 `routers/stocks.py:673`(`get_dashboard`)이 sanitize하지만 `:573-586`의 `avg_cost`/`quantity`/`target_mean`은 raw Decimal이다.
- 수정: `Decimal`을 `d.is_nan() or d.is_infinite()`로 함께 검사. **한 줄로 기존 8개 sanitize 호출처를 소급 강화한다.**

### 3.2 NaN이 컨센서스 마트까지 전파 — **확인된 버그** (B4)
- `services/consensus_pipeline.py:184` — `tp = float(row.get("currentPriceTarget") or 0) or None`. **NaN은 truthy**라 `nan or 0` → `nan`, `nan or None` → `nan`.
- `:237`이 그 값을 `raw_reports.target_price`에 INSERT하고 `AVG()`가 `daily_consensus_mart.avg_target_price`로 전파한다. 목표가 정본(ADR-0008)이 오염되는 경로다.

### 3.3 입력 경로 Pydantic float 가드 누락 — **확인된 버그** (B3)
`allow_inf_nan=False`를 설정한 모델은 리포지토리 전체에서 **하나**뿐이다(`routers/analyst_reports.py:29,42,43` + 밴드 validator `:48-54`). 나머지는 무가드:

| 필드 | 위치 | 상태 |
|---|---|---|
| `Stock.quantity`/`.avg_cost`/`.target_price`/`.stop_price` | `routers/portfolio.py:40-43` | **무가드** (유일한 validator는 `_validate_ticker` `:51-57`) |
| `weights: Dict[str, Optional[float]]` | `routers/portfolio.py:168` | 무가드 |
| `PromotePayload.quantity`/`.avg_cost` | `routers/watchlist.py:52-53` | `Field(gt=0)`이 NaN은 우연히 거부, **`+Infinity`는 통과** |
| enrich 16개 `Optional[Any]` | `routers/stocks.py:131-138,144-151` | 타입 자체가 Any |

- 재현 경로: `POST /api/portfolio {"quantity": NaN}` → Pydantic 통과 → `user_stocks`에 기록(`portfolio.py:249`) → `:274-276` echo에서 500. **그리고 그 뒤로 `GET /api/portfolio`(`:62` → `services/storage/portfolio.py:232`, raw Decimal, sanitize 없음)가 영구 500이 된다.** 같은 형태가 `set_rebalance_targets`(`:172-175`)에도 있다.
- `main.py:253-259`의 `RequestValidationError` 핸들러는 **거부 경로만** 덮는다(task#211). 위 필드들은 검증이 *성공*하므로 이 핸들러를 거치지 않고, 500은 나중에 다른 엔드포인트에서 터진다.

### 3.4 sanitize가 없는 응답 경로 — **잠재 위험**
- `routers/report.py:474` — `_read_snapshot`이 `:152/:157`에서 sanitize하지만 `apply_asof`(`:466`)가 **그 뒤에** 마트 Decimal을 주입한다.
- `routers/report.py:306,326,510,562`, `routers/portfolio.py:62,148`, `routers/guru.py:45-57`, `routers/analysis.py:23,39`, `routers/digest.py:20,25`, `routers/market_indicators.py` 핸들러 9개.
- `routers/rankings.py:66`·`routers/investor.py:56-58`·`routers/short_sell.py:39` — bare `float()` 헬퍼에 `isfinite` 없음(`rankings.py:13`, `investor.py:9`, `short_sell.py:9`).

### 3.5 응답 경로 — **이미 가드됨(잔여 위험만)**
- `services/utils.py:36-43` `sanitize`(단, §3.1의 Decimal 구멍).
- `routers/stocks.py:483-498` `_usdkrw_rate`의 `math.isfinite` 가드 — NaN≠None이라 `if fx is None`을 통과하던 task#104 근본.
- `routers/stocks.py:673` `_build_all` 전체 sanitize; `:233-239` `_f`가 비교값 float+`isfinite` 정규화.
- 확인된 정상 가드: `recommendations.py:151,210`, `analytics.py:47-49`, `analysis_service.py:124,127`, `portfolio.py:164,208`, `analyst_reports.py:85,105,118`(`services/analyst_reports.py:121-122`가 sanitize *전에* Decimal→float 캐스트하므로 §3.1 구멍에 안 걸린다), `indicators.py`, `report_generator.py:439,615`, `market_indicators` 서브모듈 전부.
- 회귀: `tests/test_nan_serialization_guards.py`(task#109).

### 3.6 Decimal ↔ float — **이미 가드됨(잔여 위험만)**
- 수치 어댑터를 등록하는 코드가 없다(`register_type`/`DEC2FLOAT`/`new_type` 0건) → NUMERIC은 진짜 `Decimal`로 오고 모든 캐스트가 load-bearing이다. NUMERIC을 읽는 산술 ~30곳 전부 `float()`/`int()`/`pd.to_numeric`을 먼저 통과한다.
- 역사적 결함 지점이 주석과 함께 고쳐져 있다: `routers/stocks.py:549-552`(`float(annual_div) / float(avg_cost)`).
- **잔여 A**: `services/exposure.py:74` `e["weight"] * beta_map[...]`는 캐스트를 안 한다 — 두 호출자(`routers/portfolio.py:205`, `routers/stocks.py:295`)가 밖에서 캐스트한다. **세 번째 호출자가 원래 버그 형태를 그대로 재도입한다.**
- **잔여 B**: `routers/portfolio.py:108` `amt * qty`가 `services/dividends.py:352`가 `amount_per_share`를 float화했음에 의존한다(`:73-74` 주석이 *다른 모듈*의 사실을 단언한다).
- **잔여 C**: 규약이 사이트마다 수동이고 자동 가드가 없다. 회귀 테스트는 **Decimal**로 써야 한다 — fixture가 float이면 라이브에서만 깨지는 fixture-pass-live-fail이 된다.

### 3.7 최소카드 폴백이 근본원인을 마스킹한다 — **설계상 트레이드오프**
- `routers/stocks.py:661-667` `_safe`가 카드당 예외를 `_minimal_card`로 흡수한다. "holdings=N → 항상 N카드" 불변식(task#102)을 위한 의도된 선택이다.
- **비용**: 결함이 500도 토스트도 없이 "enrichment만 조용히 사라짐"으로 나타난다. 유일한 단서는 `docker logs portfolion-backend-1 | grep '최소카드 폴백'`(`:666`).
- 추가 잔여: 열화된 카드셋이 `_dashboard_cache`(TTL 300s, `services/cache.py:34`)에 **5분간 캐시**된다.

---

## 4. DB·스키마·트랜잭션·커넥션 풀

### 4.1 `app_schema.sql` ↔ `main._migrate` 미짝 — **잠재 위험**(프로세스 부채, 라이브 장애 아님)
ADR-0006: `_migrate`(`backend/main.py:60-238`)만이 라이브 DB에 도달한다. `app_schema.sql`은 빈 pgdata initdb 때만 실행되고, 그 파일 스스로 `:359-363`에서 이 사실을 문서화한다.

**`_migrate` 짝이 없는 컬럼** (전부 `app_schema.sql`에만 존재):

| 컬럼 | 스키마 | 소비처 |
|---|---|---|
| `tickers.recent_disclosures` | `:15` | `services/storage/portfolio.py:55` (INSERT) |
| `tickers.insights` | `:16` | enrich 경로 |
| `tickers.enriched_at` | `:20` | `routers/report.py:468` (SELECT) |
| `tickers.is_etf` | `:21` | `routers/report.py:468`, `storage/portfolio.py:55` |
| `consensus_history.target_high` | `:87` | `services/consensus.py:18,99` |
| `consensus_history.target_low` | `:89` | `services/consensus.py:18,99` |

근접 미스: `tickers`의 baseline 이후 컬럼 8개 중 `_migrate`는 정확히 4개만 덮는다(`key_resource` `:203`·`competitor_edge` `:208`·`market_outlook` `:213`·`analyst_target` `:218`). `report.py:468`은 `enriched_at, is_etf, analyst_target`을 한 문장에서 SELECT하는데 그중 하나만 마이그레이션돼 있다.

**`_migrate` CREATE가 없는 테이블 11개**: `user_menu_permissions`(`:112`)·`default_menu_permissions`+시드(`:120-127`)·`raw_reports`(`:130`)·`daily_consensus_mart`(`:142`)·`user_events`(`:158`)·`market_leverage_indicators`(`:176`)·`market_lending_balance`(`:190`)·`backlog_history`(`:202` — `segments` ALTER만 `main.py:64`에 있다)·`market_rankings`(`:215`)·`market_investor_trend`(`:234`)·`job_runs`(`:364`). 전부 라이브 소비처가 있다(`admin.py:95,137,161`, `events.py:31`, `consensus.py` …).

**정직한 분류**: 미짝 항목은 전부 2026-05-30~06-07 시기이고 `_migrate` 규율은 06-14경 채택됐다. **그 이후 추가된 테이블은 전부 짝이 있다**(`market_short_sell`·`stock_disclosures`·`stock_dividends`·`stock_dividend_schedule`·`stock_beta`·`stock_supply_score`·`stock_insider_trades`·`stock_recommendations`·`us_supply_snapshot`·`analyst_reports` + `ADD COLUMN` 후속 `:157,173-175,189-190`). 옛 세트는 당시 수동 적용됐다. 부채의 본질은 **`_migrate`가 자가치유형이 아니라는 것** — 복구/재구축된 pgdata에서 `_migrate`만 돌면 11테이블 6컬럼이 없는 채로 뜬다.

**그리고 검출 수단이 없다**: `tests/test_dividends.py:197`·`test_beta.py:152`처럼 **기능별** 테스트가 개별 테이블 DDL 발행만 단언하고, `app_schema.sql`↔`_migrate` 짝을 **전수 대조하는 테스트는 없다**. DoD가 문서에만 있다.

### 4.2 `_migrate` 실패가 fail-open — **잠재 위험**
- `backend/main.py:60-238`이 20개 블록을 각각 `try/except` + `logger.warning`으로 감싼다. 마이그레이션이 실패해도 앱은 기동하고 그 테이블/컬럼을 쓰는 엔드포인트가 요청 시점에 깨진다. ADR-0006이 기대한 "lifespan yield 이전 완료" 보장이 실패 시엔 성립하지 않는다.

### 4.3 원자성 — 한 곳이 깨져 있다
`services/db.py`의 `query`/`execute`/`execute_many`는 **각자 자기 커넥션을 연다** → 한 호출 = 한 트랜잭션. `execute()` 두 번은 절대 원자적이지 않다.
- **확인된 버그 (B5)** — `routers/admin.py:111-119`: 6개 `execute()` = **6개 트랜잭션**. 루프 중간에 실패하면 반쯤 삭제된 사용자(포트폴리오는 지워졌고 `users` 행은 남아 여전히 로그인 가능)가 된다. **게다가 완전히 중복**이다 — 5개 자식 테이블 전부 `users(id)`에 `ON DELETE CASCADE`가 걸려 있으므로(`auth_schema.sql:17`, `app_schema.sql:35,77,98,113`) `:119` 한 줄로 충분하고 그게 원자적이다.
- **이미 가드됨** — delete-rewrite 4곳 전부 단일 공유 커서로 원자적이다: `dividends.py:312-331`, `ranking_service.py:160-178`, `recommendation/store.py:25-58`, `consensus_pipeline.py:354-363`. (단 원자성이 §1.1·§1.4의 "빈 결과가 정상 커밋되는" 문제를 막지는 않는다.)
- **잠재 위험** — `services/auth_service.py:56-61` `create_user`에 `users.email UNIQUE` 대한 `ON CONFLICT`가 없고, 두 트랜잭션에 걸친 check-then-insert(`routers/auth.py:77`→`:79`)로만 보호된다 → 동시 이중 제출이 400 대신 500을 낸다.

### 4.4 SQL 인젝션·배열 캐스트 — **거의 클린**
- 식별자 f-string 보간 2곳 모두 화이트리스트: `routers/admin.py:118`(`:111-117`의 하드코딩 5튜플만 순회), `services/storage/portfolio.py:295`(`:288`이 `fields.keys() <= _ENRICH_KEYS`를 단언하고 아니면 `ValueError`; `_ENRICH_KEYS`는 `:283` frozenset). 값은 파라미터 바인딩.
- `= ANY(%s)` 16곳 중 uuid 컬럼은 하나이고 캐스트가 있다(`routers/admin.py:32` `%s::uuid[]`). 나머지는 `text` 컬럼이라 `text[]`가 맞다.
- **잠재 위험**: `routers/report.py:208` `date = ANY(%s)`에 `::date[]`가 없다. `latest_dates`(`:206`)가 `datetime.date`를 담아 지금은 동작하나 ISO 문자열을 먹이면 `operator does not exist: date = text`. `services/consensus.py:85`는 이미 per-element 캐스트를 한다.
- 다행 VALUES 형태: `services/consensus.py:81-85`가 `", ".join("(%s,%s::date)" …)`로 N행을 만든다(바깥 괄호 없음). `:83-84` docstring이 그 실패 모드를 경고한다.
- WHERE 없는 DELETE 하나 — `routers/calendar.py:63`, 순수 캐시이고 upsert로 재생성(`:118`), 의도적·문서화됨.
- upsert 의도 INSERT 25개 전부 실제 PK/UNIQUE와 맞는 conflict target을 가진다.

### 4.5 커넥션 풀 vs ThreadPool 적층 — **잠재 위험**
- 풀: `services/db.py:21-27` `ThreadedConnectionPool(minconn=1, maxconn=20)`. `get_connection`(`:31-41`)은 정상 종료 시 commit, 예외 시 rollback, `putconn`이 `finally`에 있어 **커넥션은 항상 반환된다**.
- **느린 외부 HTTP 호출을 걸친 채 풀 커넥션을 잡는 곳은 없다** — `with get_connection()` 블록 전수(`auth_service.py:66`, `dividends.py:312`, `ranking_service.py:160`, `store.py:25`, `storage/portfolio.py:49,102,147,174`, `consensus_pipeline.py:354`) 모두 순수 SQL이고 fetch는 사전 평가된다.
- **문제는 적층이다**: DB를 만지는 워커 — `routers/calendar.py:106`=**15**, `routers/stocks.py:669`=10(대시보드 `_build_all`, 카드당 다중 read — task#102 핫스팟), `scheduler/jobs.py:299`·`:427`=8, `routers/stocks.py:428`=8, `services/report_generator.py:186`=8, `routers/report.py:142`=5, `services/consensus_pipeline.py:107`=5, `routers/analytics.py:39`·`services/analysis_service.py:84`=10. 대시보드(10)와 캘린더(15)가 동시에 오면 이미 20을 넘고, psycopg2 풀은 소진 시 **블록이 아니라 `PoolError`**를 던진다(`db.py:23-24` 주석).
- `scheduler/_state.py:5`가 `AsyncIOScheduler`를 executor 사이징 없이 만들어 APScheduler 기본 10워커가 각자 8~20 스레드를 띄운다. 배치 기본 시각도 겹친다(`batch_registry.py:188,204,419` 일요일 03:00에 `earnings_kr`·`earnings_us`·`guru_crawl`).
- 외부 fetch 전용(풀 무관·레이트리밋 관련): `market_indicators/earnings.py:202,229`=**20**(~500·~900티커 순차 2회), `ranking_service.py:112`=12, `us_sector_service.py:28`=11.
- **스테일 주석 4곳**이 틀린 불변식을 심는다: `db.py:23-24`("calendar 15·analysis 11보다 크게" — 실제 최대 fan-out은 20), `routers/stocks.py:427`·`scheduler/jobs.py:298`·`:426`(`maxconn=10` — 실제 20).

### 4.6 N+1 쿼리 — **설계상 트레이드오프**
- `routers/stocks.py:510`이 카드마다 `_latest_snapshot(ticker)`를 단건 조회한다. 배치 헬퍼 `_latest_snapshots`(`:60-85`)가 같은 파일에 이미 있는데 `/compare`(`:290`)만 쓴다.

---

## 5. 인증·보안 노출

### 5.1 무인증 엔드포인트 — **이미 가드됨(잔여 위험만)**
- ADR-0029 3부작(task#230·231·232)이 무인증 read 37개를 전부 닫았다. 현재 `/api` 139개 중 무인증은 `routers/auth.py`의 **9개**뿐: `register`(`:75`)·`login`(`:84`)·`refresh`(`:94`)·`logout`(`:102`)·OAuth 4개(`:139,153,186,199`)·token 교환(`:232`). 무인증 쓰기·IDOR 없음(사용자 스코프 핸들러는 전부 토큰에서 `user_id`를 파생).
- 회귀 게이트: `backend/tests/test_no_public_reads.py:28-38`이 `ALLOWED_PUBLIC`을 양방향 exact-match로 못박고, `tests/_routes.py`의 `walk_routes`로 FastAPI `_IncludedRouter` 버전 발산까지 흡수한다.
- **잔여 1**: 게이트가 `/api` 프리픽스만 본다. `/health`(`main.py:294`) 같은 비-`/api` 라우트는 게이트에 보이지 않는다(현재 무해).
- **잔여 2 (구조적)**: ADR-0029는 **authn만** 강제하고 authz는 안 한다(명시적 결정). `POST /api/auth/register`가 인터넷에 열려 있어 누구나 계정을 만들어 ~130개 `get_current_user` 엔드포인트를 직접 호출할 수 있다. 초대코드·이메일 검증·allowlist 없음. 부분 완화: `app_schema.sql:124-127`이 신규 사용자 기본 권한을 전부 `false`로 시드해 UI가 비어 보인다. → §5.11 참조.

### 5.2 `COWORK_API_KEY`가 `argv`로 노출 — **확인된 버그** (B18)
- `scripts/cowork-fire-listener.py:35`가 키를 프롬프트 문자열에 치환하고 `:43`이 그 문자열을 `subprocess.Popen(["claude","-p", prompt, …])`의 **argv 원소**로 넘긴다 → 로컬 어떤 프로세스든 `ps -ww`로 읽는다. 이 파일은 **tracked**다.
- 폭발반경: 이 키는 `backend/auth.py:73-74`가 API 키를 **admin 등가로 즉시 통과**시키므로 admin급 쓰기(`PUT /api/stocks/enrich/batch`, `POST /api/analyst-reports/{ticker}`, `POST /api/admin/cowork/fire`, `PUT /api/admin/analyst-targets/{ticker}`)를 하고, `__api_key__` 센티넬이 `storage.get_global_portfolio()`로 라우팅되어(`routers/stocks.py:365`, `routers/report.py:175-176`) **교차 사용자 read**까지 된다.
- ADR-0028 §4가 "유출 시 피해 = 분석 필드 쓰기 수준"으로 수용했으나, 교차 사용자 read와 무계 프로세스 스폰(§5.5)은 그 평가에 포함되지 않았다.

### 5.3 하드코딩 폴백 시크릿 — **확인된 버그**(현 배포에선 우연히 fail-closed) (B19)
- `backend/routers/auth.py:45` — `_HMAC_SECRET = os.environ.get("SESSION_SECRET", "dev-secret").encode()`. OAuth CSRF `state`를 서명한다(`:49,57`).
- 지금은 도달 불가: `main.py:36`이 이 모듈을 import한 뒤 `main.py:262`가 `os.environ["SESSION_SECRET"]`을 무가드로 읽어 미설정 시 기동이 죽는다. **가드가 다른 파일의 무관한 한 줄이다** — `main.py:262`를 순서 변경/삭제하면 즉시 공개된 키로 state 위조가 가능해진다.

### 5.4 OAuth `state`가 세션 바인딩·일회용이 아니다 — **잠재 위험**
- `backend/routers/auth.py:47-58`. `_make_state()`가 nonce를 HMAC하지만 **아무것도 저장하지 않고**, `_verify_state`는 "이 서버가 발급한 state인가"만 증명한다. nonce 저장소·만료·재사용 방지 전부 없다.
- `GET /api/auth/oauth/google`이 공개이므로 **공격자가 스스로 유효 state를 발급받아 재사용**할 수 있다 → CSRF/강제 로그인 방어가 실질적으로 성립하지 않는다.
- `SessionMiddleware`는 `main.py:262`에 설치돼 있으나 **어디서도 쓰이지 않는다**(`request.session` 참조 0) — state를 브라우저 세션에 묶을 재료가 이미 있는데 미사용.
- 부수: GitHub 콜백(`:200-203`)에는 Google(`:155-157`)에 있는 `error` 단락 처리가 없다.

### 5.5 레이트리밋 전무 — **확인된 버그**(ADR 근거 없는 순수 공백) (B20)
- `backend/requirements.txt`에 `slowapi`/`limits` 없음, `main.py`에 미들웨어 없음, `nginx/nginx.conf`에 `limit_req_zone`/`limit_conn` 없음.
- 가장 급한 표면: `POST /api/auth/login`(`routers/auth.py:84`) — 인터넷 노출 호스트에 무제한 크리덴셜 스터핑, bcrypt work factor만이 제동. `POST /api/auth/register` — 무제한 계정 생성 + `users` 무한 증가.
- 비-admin + 외부 fetch + 무제한: `POST /api/report/generate/{ticker}`(`report.py:114`, 본인 종목 스코프지만 관심종목 선등록으로 임의 티커 가능), `POST /api/consensus/{ticker}/backfill`(`:566`), `POST /api/report/{ticker}/refresh-analyst`(`:514`), `POST /api/digest/generate`(`digest.py:24`), `GET /api/stocks/search`(`stocks.py:156`), `GET /api/stocks/{ticker}/news`(`:321`), `GET /api/stocks/compare`(`:282`).
- `POST /api/admin/cowork/fire`(`admin.py:239-240`)는 호출당 `claude -p` 프로세스를 스폰하고 스로틀·동시성 상한이 없다(`cowork-fire-listener.py:42-47`, `:10` docstring이 무계 병행을 명시 수용) — §5.2의 유출 키 뒤에 있는 무계 fork 레버.
- nginx에 `client_max_body_size` 조정 없음(기본 1MB), 보안 헤더(HSTS/CSP/X-Frame-Options/X-Content-Type-Options) 없음.

### 5.6 상수시간 비교 아님 — **잠재 위험**(낮음)
- `backend/auth.py:45` `api_key == expected`. 같은 코드베이스 `routers/auth.py:58`은 `hmac.compare_digest`를 쓰므로 의도적 차이가 아니다.
- `scripts/cowork-fire-listener.py:57` `auth != f"Bearer {token}"` — 127.0.0.1 바인드(`:83`)로 완화.

### 5.7 토큰·세션 — 대부분 **이미 가드됨**
- HS256이 4개 decode 지점 전부에 명시 고정(`auth.py:27,53`, `auth_service.py:111`, `middleware/event_tracker.py:35`) → alg-confusion 표면 없음.
- `JWT_SECRET`은 폴백 없는 `os.environ[...]`.
- refresh는 불투명 `secrets.token_urlsafe(64)`(`auth_service.py:101`) + **일회용 회전**(사용 시 행 DELETE, `:128-129`) + tz 정규화 만료검사(`:123-126`). 로그아웃 per-token 폐기(`:134`), 사용자 삭제 시 CASCADE.
- **잔여 A** — refresh 토큰이 **평문 저장**(`auth_schema.sql:15-21` `token TEXT UNIQUE`). §10.2의 호스트 공개 5432와 겹치면 DB read 한 번이 30일짜리 재생 가능 크리덴셜이 된다.
- **잔여 B** — 만료된 refresh 행이 회수되지 않는다(`auth_service.py:126-127`). 테이블 무한 증가.
- **잔여 C** — `auth.py:30,56`의 `except (JWTError, KeyError)`가 `os.environ["JWT_SECRET"]`의 KeyError까지 삼켜 치명적 설정 오류를 일괄 401로 바꾼다(fail-closed지만 진단 불가).
- **잔여 D** — access token은 최대 1시간 폐기 불가(stateless, `jti`/denylist 없음). 표준 트레이드오프.
- **잔여 E** — `_oauth_codes`(`routers/auth.py:24`)가 인메모리 dict다. 현재 uvicorn 단일 워커(`backend/Dockerfile:9`, `--workers` 없음)라 무해하나 워커를 늘리면 token 교환이 깨진다.
- **설계상 트레이드오프** — Google `id_token` 서명을 검증하지 않는다(`routers/auth.py:175-177`이 payload를 base64 직접 디코딩; `iss`/`aud`/`exp`/`at_hash` 미검사). client secret으로 인증된 code 교환 응답을 TLS로 받기 때문에만 안전하다(`jose` at_hash 실패 우회의 산물). 클라이언트가 준 `id_token`을 받는 형태로 리팩터되면 즉시 취약.
- **설계상 트레이드오프** — 토큰을 `localStorage`에 보관(`frontend/src/api.js:8`, `App.jsx:138-139,155`). XSS 노출 대신 CSRF 면역을 택한 것.

### 5.8 이벤트 트래커 미들웨어 — **잠재 위험**
- `middleware/event_tracker.py:75` `asyncio.create_task(_save_event(...))`가 **블로킹 psycopg2 `execute`를 이벤트 루프에서** 실행한다. 부하 시 전 요청이 직렬화된다. 게다가 task 참조를 보관하지 않아 GC로 사라져 이벤트가 조용히 유실될 수 있다.
- `:48-49` `except Exception: pass` — 이벤트 쓰기 실패가 완전 무음(로깅 규약 위반).
- `:31-38`이 `auth.py`와 **별개로 JWT를 다시 디코딩**한다 — auth에 audience/issuer 검사나 알고리즘 변경이 생기면 드리프트한다.

### 5.9 admin 역할 — **이미 가드됨**
- 매 요청 DB 조회(`backend/auth.py:61-65,68-78` → `auth_service.get_user_by_id` → `users.role`). JWT에 role 클레임이 없어(`auth_service.py:97`은 `sub`만) 위조 불가. `register`로 role 설정 불가(`auth_service.py:57-60`). 자기보호: `admin.py:107-110`이 admin·OAuth 계정 삭제를 거부.
- 잔여: admin 엔드포인트마다 요청당 DB read 1회(캐시 없음).

### 5.10 `/docs`·OpenAPI — **이미 가드됨(우연히)**
- `main.py:250`은 `docs_url=None` 등을 주지 않아 `/docs`·`/redoc`·`/openapi.json`이 켜져 있다.
- 그러나 `nginx/nginx.conf`는 `/health`(`:16-20`)와 `/api/`(`:22-28`)만 백엔드로 프록시하고 나머지는 정적 SPA로 떨어뜨린다(`:52-55`). 백엔드 컨테이너는 호스트 포트를 발행하지 않는다.
- **잔여**: 명시적 결정이 아니라 **암묵적 경로 화이트리스트**다. catch-all 프록시 location이 추가되거나 8000이 발행되면 전체 API 스키마가 즉시 공개된다.

### 5.11 메뉴 권한은 보안 경계가 아니다 — **설계상 트레이드오프**(의도 확인 필요)
- 필터: `Masthead.jsx:73` `SECTIONS.filter(s => menuPermissions.includes(s.perm))`, `MobileNav.jsx:24`, `MobileTopActions.jsx:14-15`. 출처는 `AuthContext.jsx:18-22` ← `GET /api/auth/me`.
- **`frontend/src/App.jsx:82-103`은 모든 라우트를 무조건 등록한다 — 라우트 가드가 전무하다.** 백엔드에도 메뉴 권한 의존성이 없다(`ALL_MENUS`는 `routers/auth.py:108` read와 `routers/admin.py` CRUD에만 등장). `guru`가 거부된 사용자가 `/guru`를 직접 입력하면 페이지가 마운트되고 데이터도 정상 로드된다.
- **정직한 심각도: 권한 상승이 아니다.** `role === 'admin'` 게이트(`Settings.jsx:225`, `ReportManualGen.jsx:12`, `AnalystReports.jsx:20`, `StockModal.jsx:18`, `PermissionManager.jsx`)는 전부 서버 `require_admin`이 뒷받침하고, 게이트 없는 메뉴로 도달하는 데이터는 전역/공유(구루·시장지표)이거나 이미 `get_current_user`로 사용자 스코프다. 노출되는 건 "운영자가 숨기기로 한 기능"이지 타인 데이터가 아니다.
- 결정 필요: 메뉴 권한이 민감한 것을 가려야 한다면 서버 측 의존성과 라우트 가드가 필요하다.

### 5.12 CORS — **이미 가드됨(잔여 위험만)**
- `main.py:265-271`: 와일드카드 없음, `allow_credentials` 미지정(기본 False) — Bearer 헤더 인증이라 훔칠 ambient credential이 없어 `allow_methods=["*"]`/`allow_headers=["*"]`의 영향이 낮다.
- **잔여**: `http://localhost:3000`·`http://localhost:5173` 개발 origin이 프로덕션에서도 무조건 허용된다.

### 5.13 시크릿 커밋 — **이미 가드됨**
- tracked 파일 전수 스캔 결과 실제 시크릿 0건. `.env`(루트 `.gitignore:6`)·`backend/.env.docker`(루트 `.gitignore` 마지막 줄)·`backend/.env`(`backend/.gitignore:1`)·`certbot/conf/` 모두 무시되고, `git log --all -- .env backend/.env.docker`가 비어 있어 **커밋 이력도 없다**.
- tracked 유일 env 파일 `backend/.env.docker.example`은 placeholder만. 단 §12.3의 드리프트 참조.

---

## 6. 배치·스케줄러·관측성

### 6.1 키 미설정이 "성공"으로 기록된다 — **확인된 버그** (B6)
- `scheduler/jobs.py:71-78` `_refresh_monthly_us` → `market_indicators/econ.py:13-15`가 **로그 없이** `{"error": "FRED_API_KEY…"}`를 반환하고, 잡은 `"Econ indicators refreshed"`(`:76`)를 로그하며 `job_runs`에 **success**를 남긴다.
- `scheduler/jobs.py:81-88` `_refresh_macro_signals` → `macro.py:59-61`, 동일.
- `scheduler/jobs.py:400-431` `_short_sell_work` → `short_sell_service.fetch_trend:13-22`가 키움 미설정 시 **로그 없이** `[]` → `upsert_trend([])` → `execute_many` no-op(`db.py:64-66`) → 잡은 `"Short-sell fetched for N KR tickers"`(`:431`)를 로그하고 0행을 썼다.
- 참조 정답: `services/agm.py:162-163`.

### 6.2 `job_runs`에 "스킵" 상태가 없다 — **설계상 트레이드오프**(관측 공백)
- `services/job_runs.py:15-72`. `failed`는 **본문이 예외를 전파할 때만** 기록된다(`:54-63`). 스케줄러 래퍼들이 자기 예외를 직접 잡으므로(`jobs.py:77-78,87-88,396-397` …) 부분·전체 실패가 `success`로 남는다. docstring(`:25-30`)이 이 성질과 해당 11개 잡을 정확히 문서화한다.
- `routers/batches.py:51`이 `job_runs.recent(id)`를 그대로 노출하므로 배치 현황 허브는 `running|success|failed`만 보여줄 수 있다 — "돌았지만 직전값 유지"가 보이지 않는다.
- 표면화한 예외 2건: `refresh-monthly?market=KR`이 `"saved": not exports.get("stale")`(`routers/market_indicators.py:204-206`, task#243), `refresh-kr` 섹터가 index 크기를 반환. 나머지는 구분 불가 — `refresh-earnings`는 `len(kr["quarters"])`(`:174`)를 반환해 갱신이든 저장값 반환이든 같은 숫자다. `refresh-econ`/`refresh-monthly?market=US`(`:188,209`)는 `{"error": …}` dict에서도 `cpi_points`를 계산해 `0`과 `ok: True`를 낸다.
- `_mc_save`도 자기 DB 오류를 삼키므로(`market_indicators/cache.py:52-53`) 저장 실패가 success로 기록된다.

### 6.3 `get_or_refresh`의 `ttl`은 저장값에 안 걸린다 — **설계상 트레이드오프**(오해 유발 시그니처)
- `services/market_indicators/cache.py:110-120`. `ttl`은 `_set_cache(key, stored["data"], ttl)`(`:118`)로 **인메모리 캐시에만** 전달된다. `_mc_load`(`:116-117`)는 행을 **나이 불문** 그대로 반환하고 `fetched_at` 비교가 함수 어디에도 없다. **`market_cache`에 행이 한 번 생기면 `force=True`가 올 때까지 `fetch_fn`은 절대 안 돈다.**
- `:120`은 `return fetch_fn()` 그대로 — last-good 폴백도 없고 예외는 호출자로 전파된다.
- 패키지 내 유일한 실제 나이 검사는 `earnings._is_fresh:61-76`(7일, `fetched_at` 기준)이고 이건 `get_or_refresh`를 우회한다.
- **위험한 파생 2가지**: ① "TTL 만료 → 요청 경로가 재조회"를 전제로 심각도를 판단하면 안 된다. ② 행이 없어지면 **요청 1회가** `_scrape_sp500` + ~500 yfinance 호출을 20스레드로 동기 실행한다(`earnings.py:200-204`, `routers/market_indicators.py:44,52`에서 도달).

### 6.4 기동이 이벤트 루프를 블록한다 — **잠재 위험**
- `backend/main.py:242-244`가 async `lifespan` 안에서 `sched.start()`를 **동기** 호출한다. 그 안에서 `_check_missed_report`(`scheduler/schedule.py:137-141` — 전 종목 리포트 재생성 가능), `_seed_rankings_if_empty`(KOSPI+KOSDAQ 전 페이지, 12스레드), `_seed_kr_sector_if_empty`(~100 스로틀 키움 콜), `_seed_us_sector_if_empty`가 서빙 시작 전에 돈다. `_warm_market_cache`만 스레드로 분리됐다(`:245`).

### 6.5 KST vs 컨테이너 UTC — **부분 가드**
- 가드: `services/utils.py:11-13` `today_kst()`(~25 호출처)와 `backend/tests/test_no_bare_today.py`.
- **게이트 구멍**: `tests/test_no_bare_today.py:29-33`의 AST 술어가 `node.func.attr == "today"`만 매칭한다 → **`now()`/`utcnow()` 계열은 전부 미가드**이고, 남은 위반이 정확히 그 계열이다.
- **확인된 버그 (B7)** — `services/dividends.py:101`: `now = datetime.now()` 후 `now.year - (2 if now.month < 4 else 1)`이 DART `bsns_year`로 간다. **4월 1일 00:00–09:00 KST**엔 UTC가 3월이라 `year-2`를 골라 **작작년 DPS/수익률**을 가져온다 — missing이 아니라 wrong. 올바른 헬퍼가 **같은 파일 `:198-200`(`_today_kst`)에 이미 있고 `:271,346`에서 쓰인다**(비대칭).
- **잠재 위험** — `services/insider_trades.py:121`: `end_de = datetime.now().strftime("%Y%m%d")`가 DART 조회 창의 *끝*이다. 00:00–09:00 KST엔 어제라 당일 접수 공시가 빠진다(실질 노출 ~07:00–09:00 KST).
- **잠재 위험(표시)** — `routers/guru.py:82` + `scheduler/jobs.py:61`: naive `datetime.now().isoformat(...)`로 `last_updated`를 찍어 저장 문자열이 KST−9h·오프셋 없음. 구루 크롤 기본이 03:00(`scheduler/schedule.py:70`)로 나쁜 창 안이라 **사실상 모든 예정 실행이 오표기**된다. 둘을 함께 고칠 것.
- 무해(창의 *시작*이라 넓어질 뿐): `disclosures.py:46`, `insider_trades.py:120`, `backlog.py:108`, `market/kr.py:566`. 무해(경과/TTL): `backlog.py:68`, 모든 `time.time()`/`monotonic()`.
- 정답 사례: `services/kis/futures.py:62,77`(코드베이스에서 가장 중요한 KR 날짜 판정)은 tz-aware다.

### 6.6 tz-naive ↔ tz-aware 정렬 — **이미 가드됨** + 새 off-by-one 하나
- KR beta 버그는 **두 호출처 모두 고쳐져 있다** — `services/beta.py:78`과 `services/report_generator.py:244`가 단일 `pd.concat`(`services/indicators.py:108`) 전에 양쪽 tz를 strip한다.
- **잔여**: `calc_beta` 자체는 정규화를 안 하고 두 호출자가 `except Exception → beta = None`(로그 있음)으로 감싼다 → **세 번째 호출자가 조용히 재도입한다.** `indicators.py:108`에 `tz_localize(None)` 한 줄을 넣으면 구조적으로 불가능해진다. 이상적 헬퍼가 `report_generator.py:473-478`에 미사용으로 있다.
- **확인된 버그 (B8)** — `services/consensus_pipeline.py:173`이 `idx.tz_convert(None)`을 쓴다(UTC로 변환 후 tz 제거). 코드베이스 관용구는 `tz_localize(None)`(wall-clock 보존)이다. US/Eastern **저녁** 발행 리포트가 다음 UTC 날짜로 밀리고, 그 날짜가 `:188`에서 `report_date`로 **영속화**된다. 게다가 `:177`의 cutoff는 `today_kst()` 파생이라 `:180`이 **두 기준계를 비교**한다.

### 6.7 배치 레지스트리 정합 — **이미 가드됨**
- `BATCHES` 29개 id, `_JOB_FUNCS` 28개(`scheduler/jobs.py:485-514`). `set(_JOB_FUNCS) − ids = ∅`, `{editable ids} − _JOB_FUNCS = ∅`, 모든 `scheduler_job_id == id`, `consensus`만 의도적 `None`(`batch_registry.py:66`).
- 리터럴 `job_runs.record("…")` 27곳 전부 BATCHES에 존재 — **고아 0**. 동적 id 3곳(`routers/rankings.py:10`, `report.py:71,140`, `recommendations.py:220`)도 해석된다.
- 잔여(무해): `batch_registry.py:2` 주석이 "20개 배치"(실제 29).

### 6.8 시드가 불완전 값을 고착시킬 수 있다 — **잠재 위험**
- `_seed_rankings_if_empty`(`jobs.py:434-447`)는 §1.1의 KR 구멍을 상속한다. 빈 테이블이라 잃을 건 없지만 0행으로 "성공"하고 다음 cron/재기동까지 재시도하지 않는다.
- `_seed_kr_sector_if_empty`(`:472-482`)는 all-None 저장은 막지만(`kr_sector_service.py:83-86`) `index: {}`는 저장할 수 있다(`:87-90`). `map_holdings_to_sectors:117-119`가 graceful 열화하고 16:00 배치가 자가치유한다.
- 두 시드 모두 **per-item** all-None은 저장 가능하고(§1.3), `load_momentum()` 진리값으로 "시드됨"을 판정하므로 그런 행이 이후 시드를 억제한다.

### 6.9 `misfire_grace_time` — **설계상 트레이드오프**
- `scheduler/schedule.py:30-34`가 `None`일 때 인자를 생략해 APScheduler 기본 **1초**가 적용된다. `daily_report_kr/us`만 82800을 명시한다. 주간·월간 잡은 기동 타이밍이 1초 어긋나면 그 회차를 건너뛴다.

---

## 7. 프론트엔드

### 7.1 access token 갱신 경로가 없다 — **확인된 버그** (B9)
- `frontend/src/api.js:15-25`가 401에 **무조건** 두 토큰을 지우고 `window.location.href = '/'`로 하드 리다이렉트한다. **`POST /api/auth/refresh`를 호출하는 코드가 프론트 전체에 없다** — `refresh_token`의 유일한 소비처는 로그아웃(`App.jsx:33-45`)이다.
- 서버는 access 1h / refresh 30d(`backend/services/auth_service.py:14-15`)로 회전 인프라를 다 갖췄는데 클라이언트가 안 쓴다 → **1시간마다 전 사용자 강제 로그아웃**.
- ADR-0029가 read까지 401을 내게 만들어 반경이 더 넓어졌다(ADR 본문도 이 부수를 인정한다). 백그라운드 폴링의 401도 세션을 끊는다.
- 테스트 없음: `api.js`(27줄)를 커버하는 테스트가 0.

### 7.2 삼켜진 fetch가 제어 흐름을 뒤집는다 — **확인된 버그** (B10·B11·B12)
128개 catch 중 ~72개는 토스트/에러 상태를 띄우고 16개는 console만, ~25개가 완전 무음이다. 그중 **결과가 오동작으로 나타나는 것**:
- **`pages/Ranking.jsx:157`** — `api.get('/api/watchlist').catch(() => {})`로 `watched`(`:95`)가 빈 Set으로 남는다. `toggleWatch:214`가 `watched.has(t)`로 동사를 고르고 `:217-218`이 `isWatched ? api.delete(...) : api.post(...)`다 → **실패 후엔 모든 별이 미등록으로 렌더되고, 이미 등록된 종목의 별을 누르면 DELETE 대신 POST가 나간다**(삭제를 요청했는데 중복 추가 오류).
- **`components/GlobalSearch.jsx:19-26`** — `fetchTracked`가 실패 시 `new Set()`을 반환한다. `handleSelect:32`의 `if (tracked.has(t))`가 false가 되어 **이미 추적 중인 종목이 리포트(`:33`) 대신 "관심 추가" 프리필 모달(`:35`)로** 간다. `:31` 주석은 stale 캐시 오판을 *피하려고* 재fetch한다고 하는데, 실패 경로가 정확히 그 오판을 재도입한다.
- **`pages/GuruDetail.jsx:114-120`, `pages/GuruManagers.jsx:52-58`** — `loadStockMap`이 `() => { api.get('/api/stocks').then(...) }` 형태로 **`.catch`도 없고 promise를 반환하지도 않아** 호출자가 붙일 수도 없다 → **unhandled promise rejection**, `stockMap`이 `{}`로 남아 모든 보유 배지가 미추적으로 렌더된다. 형제 구현 `GuruStats.jsx:84-89`·`GuruAllocation.jsx:34-39`는 `async`이고 `GuruStats.jsx:103`·`GuruAllocation.jsx:50`에서 잡힌다. **4개 복제 중 2개가 무가드.**
- **잠재 위험** — `contexts/AuthContext.jsx:23-26`: `/api/auth/me` 실패가 조용히 `role:'user'`, `menuPermissions:[]`가 된다. 일시 장애와 실제 무권한 계정이 구별되지 않아 **에러도 재시도도 없이 nav 전체가 사라진다.** 테스트 없음.
- **잠재 위험 — 무계 진행률 폴링 5곳**: `hooks/useReportGeneration.js:22`(1.5s), `pages/ReportManualGen.jsx:98,136`, `pages/ConsensusSettings.jsx:28`, `pages/GuruCrawlNow.jsx:28`(2s). `setInterval` 안의 `catch {}`라 지속 실패해도 타이머가 안 걷힌다. 올바른 패턴이 **이미 리포지토리에 있다** — `hooks/useStockManagement.js:18-19`가 `maxAttempts = 6`에서 멈추고 토스트를 띄운다.
- **"에러를 빈 상태로 위장" 7곳**: `components/StockSearchBox.jsx:38`, `components/reports/DetailTab.jsx:666`, `pages/Ranking.jsx:463`, `pages/AdminAnalytics.jsx:64`, `components/reports/HistoryTab.jsx:36,43`. 의도적·문서화된 형제(`SupplySection.jsx:17`, `ReportDetailTabs.jsx:54-61`, `Recommendations.jsx:83-85`)가 있으므로 일관성 격차다.
- **이미 가드됨(참조)**: 대시보드는 `hooks/usePortfolioData.js:48`이 마커 warn을 남기고 `pages/Portfolio.jsx`의 `DashboardGrid`가 `stocks>0`이면 빈 상태 대신 Skeleton을 보이며 유계 재시도(최대 3)를 한다(task#102). **다른 화면엔 이 헤더↔본문 모순 방어가 없다.**

### 7.3 단위 포매터 오적용 — **확인된 버그** (B13·B14)
- **`components/reports/InvestorTrendSection.jsx:56`** — `tickFormatter={v => krFmt(v)}`가 걸린 Y축 값은 `:28-30`에서 `foreign_net`/`organ_net`/`individual_net`을 누적한 것, 즉 **주(株) 수**다(백엔드 3곳이 단언: `services/kiwoom/investor.py:4`, `services/investor_service.py:78`, `tests/test_kiwoom_investor.py:40` `== 2906596  # 수량(주)`). `krFmt`(`components/market/marketUtils.jsx:6-10`)는 억원 입력을 가정하므로 5,414,215주가 **"541.4조"**로 렌더된다.
  - 의도적이지 않음의 증거 둘: ⓐ 형제 차트 `components/reports/ShortSellSection.jsx:11-18`이 **정확히 이 이유로** 전용 `fmtShares`를 두고(`// krFmt는 '억원' 입력 가정이라 주 단위엔 부적합`) 동일 축 역할에 `:87`에서 쓴다 — InvestorTrendSection이 미이관 형제다. ⓑ 내부 불일치 — 같은 컴포넌트 `:60` 툴팁은 같은 값을 `toLocaleString('ko-KR')`로 raw 출력해 축은 "541.4조", 툴팁은 "5,414,215"다.
  - 폭발반경: 리포트 상세 **및** 랭킹 모달(`pages/Ranking.jsx:2`가 import).
- **`pages/GuruAllocation.jsx:18-23`** `fmtUsd`의 최상단 티어가 `1e9 → B`로 **T 티어가 없다**. `:100`이 `fmtUsd(data.total_value)`(구루 ~83명 합계, `services/guru_stats.py:78,83` 기준 raw USD)를 렌더하므로 **"1500.0B"**가 나온다. 형제 `formatValue`(`GuruManagers.jsx:22-28` ≡ `GuruDetail.jsx:94-100`, byte-identical)는 T 티어를 가진다.
- **잠재 위험** — `components/market/LendingSection.jsx:44,60,66`이 조원으로 라벨하고 `${v.toFixed(0)}조`로 포맷하지만 `backend/services/lending_service.py:145-148`은 `1_000_000`으로 나누고 `API_SPEC.md:2931`은 백만 단위로 문서화한다. 둘 중 하나가 1e6 틀렸다. fixture 없음(`grep forgBrwBal tests/` = 0) → `GET /api/market/lending` 실값 크기로 판별(~60–80이면 UI 맞고 문서 stale, ~6e7이면 UI가 1e6배 어긋남).

### 7.4 심층 리포트 라우트가 내비게이션 목록에서 누락 — **확인된 버그** (B16)
- 라우트: 목록 `/analyst-reports`(복수, `App.jsx:93`), 상세 `/analyst-report/:ticker/:date`(**단수**, `:94`).
- `components/Masthead.jsx:74` `activeSection = sections.find(s => s.items.some(i => location.pathname.startsWith(i.to)))` — items(`:19`)엔 복수만 있어 `'/analyst-report/AAPL/…'.startsWith('/analyst-reports')`가 false → `activeSection=undefined` → `showSubbar`(`:75`) false → **PC 3행 서브바가 통째 사라진다**(2행 카테고리 링크 자체는 `:99-103`이 항상 렌더하므로 고립은 아니다).
- `components/MobileNav.jsx:10` `RESEARCH_PATHS = ['/reports','/recommend','/ranking','/compare']` — **단수 상세는 물론 복수 목록도 없다**(`'/analyst-reports'.startsWith('/reports')`는 false). 모바일에서 심층 리포트 목록·상세 모두 어떤 탭도 활성화되지 않는다.
- `.forge/bug-report.md:39,59`(M1·M3)가 보고했고 두 파일 모두 그 이후 미변경.

### 7.5 내비게이션 목록이 세 곳으로 이원화 — **잠재 위험**(이미 드리프트 발생)
- `pages/ResearchShell.jsx:10-16` `RESEARCH_TABS`(5) ≡ `components/Masthead.jsx:14-20` `SECTIONS[0].items`(5) — `to`/`label`/`evt` **byte-identical**.
- `pages/ResearchShell.jsx:17-21` `SCHEDULE_TABS`(3) ≡ `Masthead.jsx:35-39` `SECTIONS[3].items`(3) — **역시 byte-identical**. 드리프트 표면이 **한 쌍에서 두 쌍으로 늘었다.**
- 세 번째 목록 `components/MobileNav.jsx:10-11`(`RESEARCH_PATHS`/`SCHEDULE_PATHS`, `:14,17`에서 활성 판정)은 **이미 드리프트했다**(§7.4).
- 세 목록을 기계적으로 묶는 것이 없고 `masthead.test.jsx`(50줄)는 권한별 카테고리 노출만 단언한다(목록 parity 미검증).

### 7.6 Service Worker가 `/api/*`를 가로챈다 — **설계상 트레이드오프** + 프라이버시 잔여
- `frontend/vite.config.js:39-48`(빌드 산출 `dist/sw.js`): `urlPattern`이 `/api/`를 포함하고 `/api/auth/`를 제외한 **모든 GET**을 `NetworkFirst`(`networkTimeoutSeconds: 10`)로 `api-cache`(maxEntries 50, maxAgeSeconds 300)에 넣는다.
- 파생 1: 네트워크 실패 **또는 10초 초과** 시 **최대 5분 오래된 API 응답**이 stale 표시 없이 서빙된다.
- 파생 2 (**프라이버시 잔여**): `api-cache`가 URL만으로 키를 잡아 `Authorization` 헤더가 키에 안 들어가고, 로그아웃(`App.jsx:33-45`)이 캐시를 지우지 않는다(`caches.*` 호출이 프론트 전체 **0건**). 같은 브라우저에서 5분 안에 계정 B가 로그인하고 요청이 실패/타임아웃하면 **B가 A의 캐시된 `/api/portfolio` 본문을 받을 수 있다.** 좁은 창이지만 실제 교차 사용자 누출 경로다.
- 파생 3: `cacheableResponse.statuses: [0, 200]`이 opaque(status 0) 응답까지 캐시한다 — opaque 실패가 성공처럼 캐시될 수 있다.
- 파생 4: `maxEntries: 50` vs ~70개 구별 엔드포인트 → 상시 LRU 스래싱(비효율, 오류 아님).
- 파생 5 (테스트 하니스): 이 인터셉트 때문에 Playwright `page.route` 응답 주입이 안 먹는다 — 응답 주입 UAT는 컨텍스트를 `serviceWorkers: 'block'`으로 만들어야 한다.
- **이미 가드됨 — OAuth 콜백**: `vite.config.js:19` `navigateFallback: null`로 내비게이션 라우트가 등록되지 않는다(`dist/sw.js`에 `NavigationRoute`/`createHandlerBoundToURL` 없음). 독립적으로 `/api/auth/*`가 `api-cache`에서 제외되므로 `App.jsx:134` 토큰 교환도 캐시되지 않는다.
- **이미 가드됨 — 배포 후 stale JS**: `skipWaiting`/`clientsClaim`(`:17-18`), `cleanupOutdatedCaches()`, `BUILD_DATE`를 실은 `cacheId`(`:15`), `sw-cache-bust` 플러그인(`:63-92`)이 `registerSW.js`/`sw.js`/`manifest.webmanifest`에 `?BUILD_DATE`를 붙이고, `nginx.conf:37-42`가 `sw.js`/`workbox-*.js`에 no-store를 준다. 그리고 **`src/`에 `React.lazy`·동적 `import()`가 0건**이라 `skipWaiting`의 통상 위험(열린 탭이 삭제된 lazy 청크를 요청)이 발생할 수 없다.
- 참고: `vite.config.js:66-67`이 플러그인이 `dist`를 하드코딩해 throwaway 빌드가 라이브 디렉터리를 오염시켰던 과거 버그(task#191)를 문서화한다.

### 7.7 동일 엔드포인트 다중 소비처 — **잠재 위험**
19개 엔드포인트가 2개 이상 파일에서 fetch된다. 결합도 상위:

| 엔드포인트 | 파일 수 | 위치 |
|---|---|---|
| `/api/watchlist` | 8 | `GlobalSearch.jsx:41`, `useStockManagement.js:100`, `Ranking.jsx:155,197,217,218`, `Recommendations.jsx:83,135`, `GuruStats.jsx:109,111`, `GuruAllocation.jsx:56,58`, `GuruManagers.jsx:73,75`, `GuruDetail.jsx:160,162` |
| `/api/stocks` | 6 | `GlobalSearch.jsx:21`, `GuruStats.jsx:85`, `GuruDetail.jsx:115`, `GuruManagers.jsx:53`, `GuruAllocation.jsx:35`, `AnalystReports.jsx:39` |
| `/api/guru/managers` | 5 | `GuruHoldersSection.jsx:28`, `Recommendations.jsx:85`, `GuruDetail.jsx:126`, `GuruManagers.jsx:61`, `GuruCrawlNow.jsx:14,26` |
| `/api/report/list` | 4 | `useReportList.js:28`, `useReportGeneration.js:20`, `Reports.jsx:99`, `ReportManualGen.jsx:42` |
| `/api/analyst-reports` | 3 | `Reports.jsx:108`, `AnalystReport.jsx:261,272`, `AnalystReports.jsx:29,71` |
| `/api/market/fx` | 3 | `FxSection.jsx:13`, `usePortfolioData.js:90`, `Analytics.jsx:289` |
| `/api/stocks/dashboard` | 2 | `usePortfolioData.js:42`, `Analytics.jsx:286` |

- **이미 가드됨**: task#52의 `/api/stocks/dashboard` 배열→객체 파손은 `Analytics.jsx:287`이 `r.data?.holdings ?? r.data ?? []`로 두 형태를 받고 `usePortfolioData.js:44-45`가 객체 형태를 읽어 닫혔다. **잔여**: 소비처가 여전히 2곳이라 다음 비-additive reshape에 재발한다.
- **미가드**: `/api/stocks` 소비처 6곳 중 5곳이 bare array를 가정한다(`data.forEach`). `AnalystReports.jsx:40`만 `data || []`로 방어한다 → `{stocks:[...]}`로 reshape하면 5곳이 throw한다.
- 구조적 원인: **엔드포인트별 데이터 계층이 없다.** `/api/stocks` + `/api/watchlist` 토글 로직이 구루 4페이지에 복붙돼 있고(`GuruStats.jsx:84-118`, `GuruAllocation.jsx:34-64`, `GuruManagers.jsx:52-80`, `GuruDetail.jsx:114-166`) `Ranking.jsx:210-233`에 5번째 변형이 있다.

### 7.8 포매터 중복 14종 — **잠재 위험**(§7.3의 온상)
공유 헬퍼는 `utils.js:fmtPrice` 하나뿐인데 컴팩트 금액 포매터가 14개 근중복이다.
- `formatValue` byte-identical: `GuruManagers.jsx:22-28` ≡ `GuruDetail.jsx:94-100`. 세 번째 변형 `fmtUsd`(`GuruAllocation.jsx:18-23`)는 T 티어 누락(§7.3).
- `fmtShares`가 한 이름으로 3번 정의되고 **래더가 2종 비호환**: `ShortSellSection.jsx:12` KR 억/만 vs `UsSupplySection.jsx:22`·`UsInsiderSection.jsx:23` US B/M/K.
- `krFmt`가 `fmtAmt`로 복제: `BacklogChart.jsx:11-15`.
- `pages/Ranking.jsx:22-26`이 `fmtPrice`를 로컬 재구현해 `utils.js:1`을 가린다.
- 정합 확인됨: `KrTop2Section.jsx:52,59,67,96,99,102,106`(억원, `earnings.py:240` `"unit": "억원"`), `Ranking.jsx:47` `krFmt(v / 1e8)`(raw 원, `backend/tests/test_ranking_service.py:51-53` 확인), `ShortSellSection.jsx:21` `wonFmt`(명시적 `/1e8`).

### 7.9 API base URL 불일치 — **확인된 버그**(조건부)
- `frontend/src/utils/analytics.js:4`가 bare `fetch('/api/events')`를 쓰고 **`VITE_API_BASE_URL` 프리픽스가 없다**. 다른 4개 소비처(`api.js:4`, `App.jsx:36`, `App.jsx:133`, `LoginPage.jsx:8`)는 붙인다. `VITE_API_BASE_URL`이 절대 origin으로 설정되면(그게 문서화된 용도다) 분석 이벤트가 프론트 origin으로 POST돼 조용히 404한다. 토큰 헤더도 손으로 만들어(`:2,8`) api 클라이언트의 401 인터셉터를 우회한다.
- env 읽기가 `api.js`에서 한 번 export되지 않고 4번 중복된다.
- `src/`에 하드코딩 API 호스트·localhost 없음. 유일한 절대 URL은 `index.html:9-13`의 폰트 CDN.

### 7.10 죽은 레거시 경로·설정 — **잠재 위험**(현재 비활성)
- `frontend/src/App.jsx:121,153-157`이 `?token=`/`?refresh=` URL 쿼리에서 토큰을 읽어 `localStorage`에 넣는다. URL 토큰은 브라우저 이력·리퍼러·서버 로그에 남는다. **백엔드는 더 이상 그 형태를 발행하지 않는다** — 두 콜백 모두 `?oauth={code}`(120초 일회용, `routers/auth.py:183,230`)만 리다이렉트한다. 죽은 코드지만 되살리면 즉시 노출.
- **`frontend/vercel.json`이 여전히 tracked** — Vercel은 Docker 이전에서 제거됐다.
- `frontend/.env`(untracked)에 `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`가 남아 있다. **누출 아님** — `src/` 참조 0, `dist/`에도 없다(Vite는 정적 참조된 변수만 인라인). 로컬 잡동사니.

### 7.11 렌더 정체성·거대 컴포넌트 — **잠재 위험**(낮음)
- `components/reports/DetailTab.jsx:582`의 `StatRow`가 부모 렌더 함수 **내부**에서 정의돼 매 렌더마다 새 타입이 되어 서브트리가 리마운트된다. `pages/GuruStats.jsx:56`에 같은 이름의 다른 컴포넌트가 별개로 존재한다. 게다가 `ui/Stat`의 `valueColor`와 이름은 같고 **계약이 다르다**(전자는 raw CSS 값 `"var(--up)"`, 후자는 토큰명) — §7.12의 혼동원.
- 500줄 초과 4개: `components/reports/DetailTab.jsx`(690), `pages/Ranking.jsx`(527), `components/reports/Sections.jsx`(516), 그리고 `ConsensusChart.jsx`(447)·`FinancialsChart.jsx`(434)·`AnalystReport.jsx`(422)·`GuruDetail.jsx`(404). 프론트 비-테스트 총 ~16,850줄.
- **이미 가드됨**: 액션 버튼 중복은 `components/reports/StockActions.jsx`로 단일화되고 가시성을 `is_mine`으로 게이트한다(`:14`) — `StockCard.jsx:4,99`·`TickerListItem.jsx:4,100`이 이걸 쓴다. task#97의 "그외 탭 삭제 404"는 닫혀 있다.

### 7.12 `valueColor` 토큰 불일치 — **확인된 버그** (B15)
- `components/ui/Stat.jsx:14`가 `stat__value--${valueColor}` 클래스를 만들지만 `components/ui/Stat.css:16-17`에 정의된 건 `--success`/`--danger` **둘뿐**이다.
- `pages/AnalystReport.jsx:332`는 `valueColor={upside >= 0 ? 'up' : 'down'}`을 넘긴다 → `stat__value--up`/`--down`은 **CSS 규칙이 없어** 상승여력 숫자가 무채색으로 남는다. `.forge/bug-report.md:69`(M4)의 수정 시도가 잘못된 토큰명을 써서 미해결이다.
- 혼동원: `Stat.css`가 `--success → var(--up)`, `--danger → var(--down)`로 **의미 토큰을 가격 토큰에 매핑**한다. 정상 사용례는 `pages/Showcase.jsx:75` `valueColor="success"`.
- 배경: 리디자인(task#194) 이후 가격 방향은 `.badge--up`/`.badge--down` 전용 변형, 의미 상태는 `.badge--success`/`--danger`/`--warning`으로 통념대로 동작한다. 공용 배지 variant의 색 의미를 바꿀 땐 소비처 전수 grep 선행 — vitest·빌드는 색 의미에 블라인드다.

---

## 8. 캐시·무효화

### 8.1 인메모리 캐시가 스레드 안전하지 않다 — **잠재 위험**
- `services/cache.py:6-29` `TTLCache`가 락 없는 평문 dict다. FastAPI 스레드풀 + APScheduler 워커 + 대시보드 ThreadPool이 동시에 접근한다.
  - `:19-20` — 다른 스레드가 삽입하는 동안 `self._store.items()`를 컴프리헨션으로 순회하면 `RuntimeError: dictionary changed size during iteration`.
  - `:14-22` — check-then-act이라 동시 미스에서 `loader()`가 중복 실행된다(thundering herd; 콜드 대시보드/랭킹처럼 비싼 로더에서 실질 비용).
- `services/market_indicators/cache.py:15,27-29` `_set_cache`도 같은 형태(`_cache.items()` 순회 중 삭제).
- `services/cache.py:32,52-55` `_snapshots` OrderedDict도 락 없음(삭제 목록을 먼저 리스트화해 순회 중 변경은 피했으나 동시 `del`은 KeyError 가능).

### 8.2 무효화 대칭성 — **잠재 위험**(낮음, 현재 도달 안 함)
- `services/cache.py:52-61` `invalidate(ticker)`는 list·dashboard·correlation·sector·macro·live_prices를 지우지만 **rebalance·exposure는 안 지운다**. `:156-166` `invalidate_portfolio_caches`는 지운다.
- 실제 호출 패턴상 문제되지 않는다 — `invalidate(ticker)`는 스냅샷 변경(`routers/portfolio.py:24,34`, `report.py:81,131,561`, `storage/names.py:14`)에만 쓰이고 보유 구성 변경은 전부 `invalidate_portfolio_caches`를 쓴다. rebalance/exposure는 스냅샷이 아니라 보유+라이브 시세 의존이라 누락이 무해하다.
- 다만 **비대칭 자체가 함정**이다 — 새 캐시를 추가할 때 어느 쪽에 넣을지의 근거가 코드에 없다.

### 8.3 캐시 실측값이 문서와 다르다 — **문서 드리프트**
`CLAUDE.md`는 "snapshot LRU 200, list TTL 5s, 6종"이라고 적었으나 실제(`services/cache.py`)는 **9종**이고 값도 다르다.

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

### 9.1 실 DB 차단 — **이미 가드됨(잔여 위험만)**
- `backend/tests/conftest.py:26-37` `_block_real_db`가 `db_svc._get_pool`을 patch한다. 이게 `get_connection`/`query`/`execute`/`execute_many`의 **단일 초크포인트**라 **read·write 양쪽**을 덮고, `_pool`이 이미 채워져 있어도 작동한다. task#169(로컬 pytest가 prod `snapshots`를 fixture 값으로 덮고 prod `calendar_cache`를 전삭제)의 해법.
- **잔여 A — 로컬 `.env`가 여전히 prod를 가리킨다**: `backend/.env`의 `DATABASE_URL`이 `@localhost:5432`(= 라이브 Docker Postgres, `docker-compose.yml:12-13`이 호스트 발행). pytest는 가드되지만 **ad-hoc 스크립트·`python -c`는 무가드로 프로덕션에 쓴다.** 근본은 열려 있다.
- **잔여 B — `run_backfill.py:139`가 `psycopg2.connect(DB_DSN)`으로 `services.db`를 통째 우회한다** → `_block_real_db`가 볼 수 없다. 현재 테스트가 그 함수를 타지는 않으나 무가드 라이브 DB 경로다.
- **잔여 C — 네트워크 격리 없음**: conftest에 `requests`/`httpx`/`socket` 차단이 없다. 외부 호출 모킹을 잊은 테스트는 **실제 yfinance/DART/Naver**를 때린다(flaky·레이트리밋·느림).
- **잔여 D — 전역 auth override 누출**: `conftest.py:10`이 **모듈 임포트 시점에** `app.dependency_overrides[get_current_user]`를 걸고 되돌리지 않는다. 그래서 `main.app`을 쓰는 어떤 테스트도 401 동작을 검증할 수 없고, 무인증 거부 검증은 override 없는 fresh app이 필요하다(`tests/test_security_auth_gaps.py` 패턴).
- **잔여 E — tracked 파일 write 경로가 하나 남아 있다**: `services/digest_service.py:163-164`가 `DIGEST_DIR / f"{user_id}-{date}.json"`을 쓰고 `DIGEST_DIR = backend/data/digest`(`:37`)는 **gitignore 대상이 아니며 tracked 파일 `backend/data/digest/2026-05-24.json`을 담고 있다.** 이건 DB 실패 *폴백* 경로이고 `_block_real_db`가 `execute`를 raise시키므로 **테스트가 정확히 그 경로를 탄다.** 지금 안전한 유일한 이유는 각 테스트가 `patch.object(ds, "DIGEST_DIR", tmp_path)`를 기억하기 때문이다(`test_digest_service.py:41`, `test_disclosure_endpoint_digest.py:89`) — autouse 가드가 아니라 **관례**다. 새 다이제스트 테스트가 이걸 잊으면 tracked 디렉터리에 쓴다.
- **task#234로 닫힌 것**: `backend/data/sp500_tickers.json`·`kospi_tickers.json` 오염. `services/market_indicators/earnings.py:25-31`이 시드를 **read-only**로 격하하고(`_SP500_SEED`) 7일 캐시를 `market_cache`(`_SP500_KEY`)로 옮겼으며, 신선도 판정을 파일 mtime이 아니라 `fetched_at`으로 바꿨다(`:61-76`, docstring이 mtime 자가은폐 이유를 설명). `services/recommendation/universe.py:39`는 read만 한다. 나머지 백엔드 파일 write는 `exports.py:129`(gitignore `:22`)·`report_generator.py:441,617`(`backend/snapshots/`, gitignore `:24`)뿐이다.
- **습관 유지**: 전체 스위트 실행 후 `git status`로 부수효과를 확인할 것.

### 9.2 프론트 테스트 하니스에 폴리필이 없다 — **확인된 버그** (B23)
- `frontend/vite.config.js:94-98`의 `test` 설정은 3키(`jsdom`·`globals`·`setupFiles`)뿐이고 `coverage`도 `restoreMocks`도 없다. **`frontend/src/test/setup.js`는 한 줄**(`import '@testing-library/jest-dom'`)로 **폴리필이 0개**다.
- jsdom 29에는 `matchMedia`·`ResizeObserver`·`IntersectionObserver`가 없다. 따라서 아래가 마운트에서 throw한다:
  - `hooks/useIsMobile.js:6` bare `window.matchMedia` — **39 호출처 / 19 파일**
  - `hooks/useCountUp.js:16`, `hooks/useReveal.js:12,17`
  - `pages/Ranking.jsx:144`, `components/PermissionManager.jsx:45` (`new IntersectionObserver`)
- **결과: `pages/Portfolio.jsx`(자산·손익 화면)를 오늘 아예 마운트할 수 없다.** 4개 테스트 파일이 `useIsMobile`을 손으로 모킹해 우회한다(`GuruDetail.test.jsx:11`, `GuruManagers.test.jsx:11`, `GuruAllocation.test.jsx:7`, `reports-deep-link-navkey.test.jsx:9`). setup.js에 3줄이면 ~40개 파일이 열린다.
- `package.json`에 coverage 도구가 없어 **커버리지 측정 자체가 불가능**하다.

### 9.3 recharts는 jsdom에서 **SVG 자체가 없다** — **설계상 트레이드오프**(기계적 확인)
- `ResponsiveContainer.js:97`이 `ResizeObserver` 부재 시 조기 return → 치수가 `{-1,-1}`(`responsiveContainerUtils.js:15-18`) → `RootSurface.js:42-44`가 `null` 반환. **`<svg class="recharts-surface">`가 통째로 없다** — 축·틱·막대·파이 조각·라벨 전부. `ResizeObserver`만 스텁해도 안 된다(`:123`이 `getBoundingClientRect()`를 읽고 jsdom은 전부 0).
- 27개 파일이 recharts를 import하는데 **3개만 테스트가 있고** 어느 것도 차트 내부를 단언하지 않는다 — 의도적으로 주변만 본다: `AnalystReport.test.jsx:60`은 손으로 만든 HTML 범례(`AnalystReport.jsx:152-157`)를 단언, `GuruDetail.test.jsx:204-205`는 조각이 렌더되지 않는다고 주석하고 HTML 오버레이 + `fitsSliceLabel`을 순수함수로 단언, `KeyResourceChart.test.js`는 렌더를 안 한다. 25개 테스트 파일 전체에서 `recharts-`·`querySelector('svg')`·`tspan` 검색 결과 **0건**.
- 따라서 라벨 겹침·정렬 같은 시각 속성은 **라이브 Playwright + `getBoundingClientRect()`**가 유일한 게이트다. 그 프로브 자체의 함정(기준 상자도 실측 대상, 판정 축 누락, `text-overflow: ellipsis`는 overflow 검사에 원리적으로 안 잡혀 `scrollWidth > clientWidth`가 별도 축으로 필요, 커버리지 카운터 없는 `ALL PASS`는 무의미, 시각 변경은 프로브 통과 후에도 스크린샷 육안 확인 필요)은 `CLAUDE.md`에 상세히 축적돼 있다.
- 관련 사각: `getComputedStyle`·`getBoundingClientRect`·`scrollWidth`/`clientWidth`가 프론트 테스트 2,708줄에서 **0회** 등장하고, 스타일을 건드리는 단언은 6개뿐이며 23개 CSS 파일이 어떤 테스트에도 참조되지 않는다.

### 9.4 테스트 없는 핵심 파일
`DetailTab.jsx`(690)·`Ranking.jsx`(527)·`ConsensusChart.jsx`(447)·`FinancialsChart.jsx`(434)·`PermissionManager.jsx`(351)·`ReportManualGen.jsx`(346)·**`Portfolio.jsx`(294 — `:115-121`에 클라이언트 자산 계산)**·`Settings.jsx`(269)·`Calendar.jsx`(267)·`Digest.jsx`(261)·`StockModal.jsx`(197)·**`DashboardCard.jsx`(170 — `:40-41`에 손익)**·`LoginPage.jsx`(158), 그리고 작지만 load-bearing인 **`api.js`(27 — 401 인터셉터)**·**`AuthContext.jsx`(39)**·**`ui/Badge.jsx`(44 — task#194에서 깨진 up/down 매핑)**.
- 프론트 테스트 25파일 2,708줄이지만 편중이 심하다 — GuruDetail(471) + AnalystReport(236) + Guru* 페이지가 전 테스트 줄의 48%이고 전부 task#226~#244 산물이다.
- 에러 분기: 128개 catch 중 ~12개(**~11%**)만 테스트되고 최근 작업 8파일에 몰려 있다. "실패가 빈 상태로 위장하지 않는다" 불변식은 정확히 2페이지에서만 단언된다(`GuruStats.test.jsx:65-73`, `GuruAllocation.test.jsx:124-132`).

### 9.5 존재하는 자동 게이트 (재발 방지 자산)
| 게이트 | 무엇을 막는가 |
|---|---|
| `tests/test_no_print.py` | 앱 코드의 신규 `print(` (CONVENTIONS §4) |
| `tests/test_no_bare_today.py` | bare `date.today()`/`datetime.today()` — 단 `now()`/`utcnow()`는 못 본다(§6.5) |
| `tests/test_no_public_reads.py` + `tests/_routes.py` | 무인증 `/api` 신설(ADR-0029), FastAPI 버전 발산 내성 |
| `tests/test_api_doc_sync.py` | 엔드포인트 *존재* drift (`KNOWN_UNDOCUMENTED = frozenset()` — 베이스라인 0) |
| `tests/test_nan_serialization_guards.py` | NaN이 응답에 새어 500 |
| `tests/test_empty_result_overwrite_guards.py`, `test_empty_result_guards_exports_krsector.py`, `test_rankings_empty_guard.py`, `test_us_supply_empty_guard.py` | 빈 결과 덮어쓰기 (all-empty만) |
| `tests/test_public_api_empty_items.py` | 공공데이터포털 빈응답 AttributeError |
| `tests/test_security_auth_gaps.py` | 무인증 mutation + refresh 일회용 |

### 9.6 게이트가 **못** 보는 것
- `app_schema.sql` ↔ `main._migrate` **컬럼/테이블 짝**(§4.1) — 문서 DoD만 존재.
- naive `datetime.now()`/`utcnow()`의 KST 오판(§6.5) — AST 술어가 `today`만 매칭.
- 요청/응답 **스키마**와 **인증 게이팅 산문**의 문서 동기 — `test_api_doc_sync.py`는 존재만 본다(prose 미파싱). `API_SPEC.md`의 `**Auth:** 불필요` 오표기가 걸리지 않는다. **인증 게이팅을 바꾸는 작업은 착수 시 `grep -n '\*\*Auth:\*\* 불필요' API_SPEC.md`를 직접 돌릴 것** — 3부작에서 8곳이 오표기로 남았고 세 계획 모두 문서 슬라이스가 아예 없었다.
- **per-key/per-item** 빈 결과(§1.3) — 회귀 테스트가 all-empty만 단언.
- Naver 재무 **행 위치** 계약(§2.1) — fixture가 같은 순서라 라이브 재배열에 green.
- 퍼센트 **스케일**(§2.6, §7.3) — 렌더 %를 단언하는 테스트가 없다.
- 레이아웃·색 의미·`ellipsis` 잘림(§9.3) — jsdom 블라인드.
- 외부 소스 **라벨** 정합 — mock 응답이 라벨 불일치를 못 잡는다(yfinance `get_income_stmt()` 메서드의 무공백 라벨 vs `.income_stmt` 프로퍼티의 공백 라벨이 대표 예 — `market/us.py:15-16,27`과 `market/__init__.py:239,243,261-264,279-296`이 두 관용구를 200줄 거리에서 각각 올바르게 쓰고 있으나 복붙 함정이다. `_yf_val`(`market/format.py:61-65`)은 exact 매칭이라 어긋나면 조용히 None). **외부소스 파싱 슬라이스는 라이브 1종목 추출 대조를 DoD에 넣을 것.**
- SQL 신규/개작 — query-mock 테스트가 라이브 정합(`uuid = text`, `VALUES` 형태)을 못 잡는다. 배포 후 **라이브 스모크**가 필요.
- eslint: `eslint.config.js:11-15`가 `js.recommended` + `reactHooks.flat.recommended` + `reactRefresh.vite`만 확장하고 **`rules:` override가 없다** → `no-console` **off**, `react-hooks/exhaustive-deps` **warn**(비차단 — stale closure 버그가 정확히 `global-search-tracked.test.jsx`·`reports-deep-link-navkey.test.jsx`를 쓰게 만든 것이다). `npm run lint`가 어떤 CI 게이트에도 없다.

### 9.7 무의미한 테스트 + 미선언 의존성 — **확인된 버그**(테스트 품질)
- `backend/tests/test_auth.py:20-36`의 세 테스트는 **PyJWT 라이브러리 자체만** 검증한다. `get_current_user`를 호출하지 않고, 죽은 `SUPABASE_JWT_SECRET`(`:22`)을 세팅하며, 앱이 쓰는 `python-jose`가 아니라 `jwt`(PyJWT)를 임포트한다(`:3`). 인증 커버리지에 대한 거짓 신뢰를 준다.
- **PyJWT는 `requirements.txt`에 없다** — 로컬 `.venv`에만 `pyjwt-2.13.0`이 있어 Docker 이미지에서는 `ModuleNotFoundError`가 난다. `lxml`(요구사항엔 있고 로컬엔 없음)의 **거울상**이다.

### 9.8 admin 표면은 원리적으로 라이브 UAT 불가 — **설계상 트레이드오프**
- 라이브 UAT 계정은 비-admin이라 admin 화면과 `require_admin` 엔드포인트를 Playwright로 열 수 없다. `require_admin`은 API 키를 **거부**하는 설계이므로 키로 우회할 수도 없다(`backend/auth.py:61-65`).
- 계획 단계에서 셋 중 하나를 골라 DoD에 적어야 한다: 게이트를 `require_admin_or_api_key`로 열어 키로 positive 검증 / vitest + 기능경로 API로 닫고 버튼 렌더는 사용자 화면 확인으로 이월 / admin 크레덴셜 수령. task#214·215·222·224에서 4회 반복됐다.

### 9.9 리뷰 자체를 게이트로 삼지 말 것 — **프로세스 위험**
- 적대적 리뷰가 6렌즈·effort high로 **0건**을 반환한 변경에서 워크플로우의 **계획 범위 임의 축소**(DoD 목적 미달)를 놓쳤고 메인 세션의 표적 검증이 잡았다. CSS 이전·토큰 제거·범위 축소가 섞인 변경은 리뷰와 **별개로** 표적 검증을 돌릴 것.
- 구현자의 "비용 우려로 인한 범위 축소"는 추정이 아니라 **실측**으로 검증할 것. 축소 여부는 슬라이스 문구가 아니라 **DoD의 목적**으로 판정해야 "형식상 통과·목적 미달"을 잡는다.
- 폴백 경로만 UAT하고 실데이터 경로를 이월하면, 두 경로의 **필드 집합 차이**가 결함을 숨긴다.

---

## 10. 배포·인프라·운영

### 10.1 자동배포 폴러가 작업 체크아웃을 hard reset한다 — **설계상 트레이드오프**(운영 위험 큼)
- `scripts/auto-deploy-poll.sh:26-35`: `LOCAL != REMOTE`면 방향 무관하게 `git reset --hard origin/main` 후 `deploy.sh`. launchd로 2분마다.
- `.github/workflows/deploy.yml`도 같은 디렉터리에서 `git reset --hard origin/main`을 한다. **개발자·에이전트가 작업하는 그 체크아웃이 배포 대상**이다.
- 결과: 커밋 안 한 tracked 편집과 **push 안 한 로컬 커밋**이 ≤2분 안에 사라진다. `.forge/` 등 untracked는 안전.
- **판정 함정**: `commit && push`를 한 체인으로 묶어도 그 사이 폴이 끼면 폴러가 앞서 fetch해 둔 낡은 `origin/main`으로 reset해 순간적으로 되돌아간 것처럼 보인다. 실제로는 push가 성공했고 다음 폴이 자가복구한다(reflog에 `commit → reset → reset`). 판정은 **`git rev-parse HEAD` vs `origin/main` + `gh run list`**로 할 것 — `git log -1`로 판정해 2연속 오판한 이력이 있다(task#238·#239).
- 락 경합: `deploy.sh:6-8`과 폴러(`:14-17`)가 같은 `/tmp/portfolion-deploy.lock`을 check-then-`touch`한다(TOCTOU). `deploy.sh`는 락이 있으면 `exit 1`(Actions 잡 실패), 폴러는 `exit 0`.

### 10.2 Postgres가 약한 기본 비밀번호로 호스트에 발행돼 있다 — **확인된 버그** (B21)
- `docker-compose.yml:9` `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-portfolion}` + `:12-13` `ports: ["5432:5432"]`.
- **루트 `.env`에 `POSTGRES_PASSWORD`가 없다**(현재 정의된 건 `FRED_API_KEY`·`KITA_API_KEY` 둘뿐) → tracked 소스에 적힌 폴백 기본값이 **실제로 유효**하다.
- Docker는 `0.0.0.0`에 발행하고 macOS 애플리케이션 방화벽을 우회한다. §5.7 잔여 A(평문 refresh 토큰)와 §9.1 잔여 A(로컬 스크립트가 prod에 쓰기)가 여기에 겹친다.
- 권장: `127.0.0.1:5432:5432` + `:-portfolion` 기본값 제거 + 루트 `.env`에 강한 값 정의.

### 10.3 `docker-compose.yml`과 `deploy.sh`가 갈라졌다 — **잠재 위험**
- compose는 `backend`·`nginx` 서비스를 정의하지만 실제 배포는 `deploy.sh`가 `docker run`으로 컨테이너를 직접 만든다(`portfolion-backend-1`/`portfolion-nginx-1`, 네트워크 `portfolion_default`).
- 차이: compose의 nginx는 `./certbot/conf`·`./certbot/www`를 마운트하지만(`docker-compose.yml:39-40`) `deploy.sh`의 nginx run은 **안 한다**(`nginx.conf` + `dist`만). `docker compose up`으로 올린 컨테이너와 `deploy.sh` 산출물이 다르고, `/.well-known/acme-challenge/`(`nginx.conf:11-13`)가 후자에서 동작하지 않는다.
- 참고: 백엔드는 `docker run`이라 `docker compose ps`에 안 잡힌다 — 컨테이너 uptime 확인은 `docker ps`로.

### 10.4 TLS 설정이 죽은 채 남아 있다 — **잠재 위험**(오판 유발)
- `nginx/nginx.conf:58-78`의 `listen 443 ssl` 서버 블록이 **전부 주석**이다. 외부 HTTPS는 Cloudflare Tunnel 엣지 종단(→ `localhost:80`)이 담당한다.
- 그런데 `docker-compose.yml:33-35`와 `deploy.sh`는 여전히 **443을 발행**하고(리스너 없음), `certbot` 컨테이너(`docker-compose.yml:44-48`)는 **아무도 안 쓰는 인증서를 12시간마다 갱신**한다. "TLS가 어디서 끝나는가"를 오판하게 만드는 죽은 설정.

### 10.5 배포 검증이 비차단이고 롤백이 없다 — **잠재 위험**
- `deploy.sh`는 `set -e`지만 마지막 헬스체크가 `curl … && echo OK || echo WARNING`이라 **실패해도 스크립트가 성공(exit 0)**한다. 깨진 배포가 초록으로 끝난다. 롤백 경로 없음.
- `deploy.sh:24`가 `npm install`(not `npm ci`)을 쓴다 — `frontend/package-lock.json`이 있는데도 재현 불가한 설치.
- `.dockerignore`가 없어 백엔드 이미지 빌드가 `backend/` 전체(`.venv` 포함 가능)를 컨텍스트로 보낸다.
- 프론트는 nginx가 `frontend/dist`(gitignore)를 직접 볼륨 마운트하므로 로컬 `npm run build`가 **즉시 라이브**다. 반면 **백엔드 변경은 폴러/러너 재배포 후에야 라이브** — 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작한다.

### 10.6 self-hosted 러너 = 호스트 RCE — **설계상 트레이드오프**(가드가 미문서)
- `.github/workflows/deploy.yml`이 `runs-on: self-hosted`로 개인 Mac에서 `git reset --hard` + `bash deploy.sh`를 실행한다. `main` push 권한 ⇒ 호스트 코드 실행.
- 현재 방어는 트리거가 `on: push: branches: [main]`뿐이라는 것(fork PR은 트리거 못 함). **이 워크플로우에 `pull_request` 트리거를 추가하면 임의 fork 작성자가 Mac에서 코드를 실행하게 된다** — 파일에 그 경고가 없다.
- 러너 격리 실사고: PortfoliOn 전용 러너 디렉터리(`~/actions-runner-portfolion`)가 타 프로젝트 세팅에 재등록돼 5일간 무음 미배포. **백엔드가 옛 코드로 보이면 폴러 footgun 단정 전에 러너부터** 확인: `gh run list`(잡이 `queued`/`cancelled(24h)`면 러너 부재) + `gh api repos/calmonion7/PortfoliOn/actions/runners`.

### 10.7 의존성 버전이 고정되지 않았다 — **잠재 위험**
- `backend/requirements.txt` 18개 항목 전부 `>=`이고 lockfile이 없다. 이 코드베이스는 **yfinance의 정확한 index 라벨과 FastAPI의 라우트 트리 구조에 의존**한다.
- 이미 실측된 발산: `backend/tests/_routes.py` docstring — "로컬 `.venv`(0.128.x)는 `app.routes`에 평탄하게 들어오지만 배포 이미지(0.138+)는 `_IncludedRouter`로 감싸 `original_router`만 준다 … `requirements.txt`가 핀 없는 `fastapi>=0.104.0`이라 이 발산은 계속 진행된다."
- 부수: `pytest>=7.4.0`이 프로덕션 requirements에 있어 배포 이미지에 테스트 프레임워크가 들어간다.

### 10.8 로컬 `.venv`(3.9.6) ≠ Docker(3.12) — **설계상 트레이드오프**(사실상 하드 제약)
| 축 | 로컬 | Docker | 결과 |
|---|---|---|---|
| Python | 3.9.6 | 3.12 | 런타임 평가 어노테이션에 PEP604 `X \| None` 금지 → `Optional[X]` 필수. 문자열 주석(`"dict \| None"`)은 평가 안 돼 통과하므로 더 헷갈린다 |
| `lxml` | 없음 | 있음 | HTML 파싱은 `"html.parser"`만 (현재 10곳 전부 준수) |
| `PyJWT` | 있음 | 없음 | `tests/test_auth.py:3`이 Docker에서 임포트 실패 (§9.7) |
| FastAPI | 0.128.x | 0.138+ | 라우트 트리 순회 방식 발산 (§10.7) |

**로컬 pytest가 사실상 유일한 게이트**이므로 로컬 쪽 제약이 이긴다.

---

## 11. Cowork fire 파이프라인 (ADR-0028)

### 11.1 워크디렉터리 초 단위 충돌 — **확인된 버그** (B22)
- `scripts/cowork-fire-listener.py:38-41`: `ts = time.strftime("%Y%m%d-%H%M%S")`(초 단위) → `workdir = RUN_DIR / ts` → `mkdir(exist_ok=True)`(충돌해도 무예외) → `open(workdir / "run.log", "w")`(무조건 truncate). `:45` `cwd=workdir`로 두 프로세스가 같은 디렉터리에서 돈다.
- 프론트 잠금은 종목 단위라 동시 클릭을 막지 못한다(`AnalystReports.jsx:56,120` `disabled={firing === s.ticker}` — 다른 티커는 즉시 통과). fire-and-forget 설계상 `run.log`가 **유일한 사후 진단 수단**인데 그것이 경합으로 유실된다.
- 수정: workdir 이름에 PID/짧은 난수(`f"{ts}-{os.getpid()}"`).

### 11.2 무계 프로세스 스폰 — **잠재 위험**
- `:10` docstring이 "동시 fire는 그대로 병행 스폰(중복 enrich 가능하나 무해)"로 명시 수용했으나, 스로틀·동시성 상한이 없어 §5.2의 유출 키와 결합하면 무계 fork 레버가 된다.

### 11.3 fire 훅은 best-effort — **이미 가드됨**
- `services/cowork_trigger.py`: `configured()`가 env 미설정 시 휴면(dormant-safe), 실패는 `logger.warning`만 하고 예외를 전파하지 않아 배치 본문을 깨뜨리지 않는다. 15초 타임아웃 명시.
- `scripts/cowork-fire-listener.py:55-58`: 토큰 미설정 시 401(fail-closed), 127.0.0.1 바인드(`:83`).
- `:26-30` `_env_value`가 `.env.docker`를 직접 파싱한다 — 인용부호·`export` 접두를 처리하지 않는다(잠재, 낮음).

---

## 12. 문서·설정 드리프트

### 12.1 `docs/*.md`가 실존하지 않는 구조를 설명한다 — **확인된 버그**(문서)
- `docs/ARCHITECTURE.md`·`API.md`·`CONFIGURATION.md`·`DEVELOPMENT.md`·`GETTING-STARTED.md`·`TESTING.md` 모두 마지막 커밋이 `fab3f1f`(2026-05-24).
- `docs/ARCHITECTURE.md`가 설명하는 것들: `scheduler.py`(`:35`)·`market.py`(`:70`)·`storage.py`(`:69`)·`market_indicators_service.py`(`:29,74`) — 전부 ADR-0017로 패키지 분리돼 **단일 파일로 존재하지 않는다**. `:69`·`:120`은 `backend/data/*.json`을 "single source of truth"라고 하는데 실제 정본은 PostgreSQL이다.
- `README.md:261-267`의 참고 문서 목록에 `docs/`가 **없다** — 링크되지 않은 채 남은 오해 유발 문서다. `.gitignore`에 `docs/superpowers/`가 있지만 이미 tracked라 무효.

### 12.2 `ALL_MENUS`가 두 파일로 갈라지고 한쪽에 죽은 키가 있다 — **잠재 위험**(현재 무해)
- `routers/auth.py:108` = 6개(`portfolio, research, market, **analysis**, guru, settings`), `routers/admin.py:10` = 5개(`analysis` 없음), `app_schema.sql:124-127` 시드 = 5개.
- `admin.py:67,82,134,143`이 자기 목록 밖 메뉴를 `continue`/필터하므로 `analysis`는 **부여 자체가 불가능**하다. 다만 프론트에서 `analysis`를 권한 키로 쓰는 곳이 **0곳**이므로(Masthead perms = research/portfolio/market/research/guru, MobileNav keys 동일) 현재는 기능 영향 없는 **죽은 키 + 목록 이원화**다.

### 12.3 `.env.docker.example`이 실제 필요 키와 어긋난다 — **잠재 위험**
- `backend/.env.docker.example`에 `COWORK_API_KEY`·`KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`·`KOFIA_API_KEY`·`DART_API_KEY`·`POSTGRES_PASSWORD`가 없다. `README.md:45-83`에는 있다. 새 환경 부트스트랩 시 조용히 휴면 기능이 생긴다.
- `backend/.env`(로컬)에 `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_ANON_KEY`·`SUPABASE_JWT_SECRET` 4개가 남아 있다 — 마이그레이션 이전 잔재. 코드 참조는 `tests/test_auth.py:22`뿐(§9.7).
- `ANTHROPIC_API_KEY`가 `.env.docker`에 남아 있으나 백엔드에서 미사용(`requirements.txt`에 anthropic 없음 — 백엔드 무LLM 원칙).

### 12.4 리포지토리 위생 — **잠재 위험**(낮음)
- untracked 152개, 그중 `screenshots-uat*` 디렉터리 **54개**와 `scripts/` 일회성 UAT 스크립트 다수. `.gitignore`는 `screenshots/`(단수)만 무시하므로 `screenshots-uat*`는 영구히 `git status` 노이즈로 남는다. `.claude/`도 `settings.local.json`만 무시되어 나머지가 노이즈다.
- 이 노이즈가 §9.1의 "전체 스위트 후 `git status`로 부수효과 확인" 습관을 실질적으로 방해한다.
- `CLAUDE.md` 101KB · `API_SPEC.md` 122KB. 후자는 수동 동기 대상이고 존재 drift만 자동 검출된다(§9.6).

### 12.5 스테일 주석 (틀린 불변식을 심는다)
- `services/db.py:23-24`(사이징 근거가 실제 최대 fan-out 20을 반영 못 함)·`routers/stocks.py:427`·`scheduler/jobs.py:298`·`:426`(`maxconn=10` — 실제 20).
- `services/batch_registry.py:2` — "20개 배치"(실제 29).
- `services/dividends.py:46` — yfinance `dividendYield`가 퍼센트 스케일이라고 단언(`CLAUDE.md`는 소수분수, §2.6).
- `services/market_indicators/kospi_futures.py:4` — "fx.py의 VIX식 폴백을 따른다"고 하지만 `fx.py:109-111` `get_vix`는 예외 시 저장값을 반환하지 않는다.
- `components/GlobalSearch.jsx:31` — stale 캐시 오판을 피하려 재fetch한다고 하는데 실패 경로가 그 오판을 재도입한다(§7.2).

---

## 13. `CLAUDE.md`의 과거 서술 중 지금과 다른 것

`CLAUDE.md`는 역사 문서다. 아래는 HEAD `91bac67`에서 재검증한 **현재 사실**이다.

| `CLAUDE.md`의 서술 | 현재 사실 |
|---|---|
| 005930이 "정확히 70000.0"으로 박제된 건 KRX/NXT 피드 글리치 | task#170 정정대로 **로컬 pytest → prod DB 오염**이 유력. 실제 해결은 `conftest.py:26-37` `_block_real_db`(task#169). ADR-0020의 2-of-N 다수결(`market/kr.py:132-236`)과 박제-시 독립 ref 게이트(`report_generator.py:397-437`)는 유효하나 **관측된 70k엔 발동한 적 없다**(테스트가 게이트를 우회). 라운드 70k가 또 보이면 피드 글리치 전에 **테스트 오염부터** 의심하라 |
| `test_api_doc_sync.py`의 미문서화 23개가 `KNOWN_UNDOCUMENTED`로 동결 | `tests/test_api_doc_sync.py:50` = `frozenset()` — task#100에서 전수 문서화 완료, **베이스라인 0** |
| `backend/data/sp500_tickers.json` 오염이 전체 스위트 실행 시 발생 | task#234가 닫음(`earnings.py:25-31,61-76`). **단 write 경로가 0이 된 것은 아니다** — `digest_service.py:163-164`가 **tracked** `backend/data/digest/`에 쓴다(§9.1 잔여 E) |
| `services/recommendation/universe.py`가 그 파일의 writer | **아니다** — `:22,39`는 `open()` read만 한다 |
| `market_indicators.py` 라우터에 `/api/market-indicators` prefix가 있다 | prefix는 `/api/market` **하나뿐** |
| 캐시 6종, snapshot LRU 200, list TTL 5s | **9종**, LRU **50**, list **60s** (§8.3) |
| task#104 "per-card throw가 근본" | 근본은 `_portfolio_totals` NaN→직렬화 500이었고 세 번째 트리거는 배당 `float/Decimal` TypeError였다. 셋 다 가드됨 — **단 `sanitize`에 Decimal NaN 구멍이 남아 있다**(§3.1) |
| task#97 "그외 탭 삭제 404" | 닫혔다 — `components/reports/StockActions.jsx:14`가 `is_mine`으로 게이트하고 단일 컴포넌트로 통합(§7.11) |
| KR beta tz 정렬 버그 | **두 호출처 모두 고쳐졌다**(`beta.py:78`, `report_generator.py:244`). 잔여는 `calc_beta`/`indicators.py:108` 자체가 정규화를 안 해 세 번째 호출자가 재도입할 수 있다는 것(§6.6) |
| 배지 색: success=빨강/danger=파랑, warning 깨짐 | **리디자인 전 기준**. 현재는 통념대로(success=녹, danger=빨, warning=오커)이고 가격 방향은 `.badge--up`/`--down` 전용 변형이다(§7.12) |
| `.forge/bug-report.md`(task#221) 8건 | **H1·M1·M2·M3·M4·L2 미해결**(B17·B16·B22·B16·B15·B18). **L1·L3만 해소** — L1은 `CLAUDE_COWORK_API.md:35`가 `GET /api/analyst-reports`를 명시, L3은 `MarketOutlookSection.jsx:17`이 `Number.isFinite` 가드 추가(단 `year: null`은 `Number(null)=0`이 finite라 여전히 `(null)`로 표시될 수 있다) |
