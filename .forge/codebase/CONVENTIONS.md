---
last_mapped_commit: c72a7c9e0a5d11a7cf5ccbe8f6e370220a3d19b5
mapped: 2026-08-22
---

# CONVENTIONS — 코드 규약 지도

이 문서는 **구현 사실**만 담는다(도메인 용어 정의는 `.forge/CONTEXT.md` 소관). 각 규약은 가능하면
**그 규약을 강제하는 파일**과 함께 적고, 자동 가드가 없는 규약은 그렇게 명기한다.
테스트/가드의 실행 방법·모킹 패턴은 형제 문서 `.forge/codebase/TESTING.md`를 본다.

⚠️ **섹션 번호는 안정적이다 — 재배열하지 말 것.** 코드·프로브·계획 문서가 이 번호를 직접 인용한다:
`backend/tests/test_no_print.py`(docstring·assert 메시지에서 `CONVENTIONS §4`),
`backend/tests/test_tech_reports_service.py`(`CONVENTIONS §7`), `backend/main.py`의
`_configure_logging` docstring(`CONVENTIONS.md 참조`), `.forge/quick/LOG.md`(`§4.3`),
`.forge/done/2026-08-04-nan-defense-3fix/`(`§5.2`).
인용은 **앱 코드로도 번졌다** — `services/market_indicators/{econ,formation,labor,inflation}.py`의
`_fetch_and_save_*` docstring이 `CONVENTIONS §1.3`을 근거로 달고,
`backend/tests/test_{business_formation,labor_surveys,trimmed_inflation}.py`가 같은 번호를
파일 첫 줄에 적으며, `backend/tests/test_batch_observability.py`가 `source`/`usage` 방향을
`§8`로, 프론트 `components/market/*Section.test.jsx`·`components/tech/ShareChart.jsx`·
`pages/TechReports.jsx`·`hooks/useTechIndex.js`가 `§9.6`·`§9.7`·`§4`를 인용한다.

⚠️ **파일을 인용할 때 줄번호 대신 심볼명을 쓴다.** 이 저장소는 줄번호 참조 drift가 반복 문제였고
(`.forge/done/260810-121024-oauth-boot-timing-breakdown/run.md` 8번 항목: 선재 drift 14건),
시프트는 부위별로 균일하지 않아 산술 보정이 원리적으로 불가능하다. 이 문서는 줄번호를 쓰지 않는다.
가장 짧은 반증 사례가 `backend/tests/test_session_secret_no_fallback.py` docstring에 있다 —
**같은 wave의 형제 슬라이스가 그 위에 34줄을 넣어, 적어 둔 줄번호가 그 사이클 안에서 거짓이 됐다.**
즉 drift는 "나중에" 생기는 것이 아니라 병렬 작업에서는 즉시 생긴다.

---

## §1 핵심 원칙

### 1.1 표면 보존 리팩터 (ADR-0017)

god-file을 패키지로 쪼갤 때 **호출부를 한 줄도 바꾸지 않는다.** 패키지 `__init__.py`가
서브모듈의 공개 심볼 + *외부에서 참조되는 private 심볼*까지 루트로 re-export해,
`from services.market import X` 와 `from services import market; market.X` 두 접근을 모두 보존한다.

적용된 4패키지 — `backend/services/market/`, `backend/services/storage/`,
`backend/scheduler/`, `backend/services/market_indicators/`.

`backend/services/storage/__init__.py`의 주석이 이유를 명시한다: 직접 심볼 import는 0건이지만
**외부 소비처가 모듈 속성(`storage.X`)으로 조회**하므로 모든 심볼이 패키지 루트에 존재해야 한다.
그래서 `_ANALYST_KEYS`·`_parse_json_field` 같은 underscore 심볼까지 re-export 목록에 들어간다.

`backend/scheduler/__init__.py`는 그 함정을 한 줄로 적어 뒀다 — **`import *`는 underscore를
건너뛰므로** `_generate_kr`·`_JOB_FUNCS` 등을 **명시 나열**해야 한다.

### 1.2 additive 우선

응답·본문 스키마를 바꿀 땐 **필드 추가**를 우선하고, 형태 변경(배열→객체 등)은 최후수단이다.
`backend/routers/tech_reports.py`의 `Market.estimates` 주석이 그 관례를 명시한다("선택·additive").

additive에도 두 종류의 파장이 있다:

- **소비처 파장** — 응답 형태를 바꾸면 그 엔드포인트를 fetch하는 *모든* 프론트 소비처를
  `grep -rn '<엔드포인트 경로>' frontend/src/`로 전수 감사해야 한다(독립 fetcher가 훅과 별개로 존재).
- **테스트 파장** — additive는 응답 shape뿐 아니라 **외부 호출 시퀀스**도 늘린다.
  `mock.call_args`(마지막 호출)를 단언하는 기존 테스트가 조용히 오염되므로,
  단언을 `call_args_list[i].kwargs`로 옮기거나 입력이 비면 신규 호출을 생략한다(`TESTING.md §4`).

### 1.3 wrong < missing — 빈 결과가 직전 양호값을 덮지 않는다

**틀린 값보다 없는 값이 낫다.** 외부 fetch가 실패했을 때 축소·공백 결과를 저장소에 박제하지 않는다.

**가드의 기본형은 "저장 직전 한 지점"이 아니라 *소스-폴백*이다.** 구조적으로 안전한 3형태:

| 파일·심볼 | 방식 |
|---|---|
| `backend/services/market_indicators/fx.py` `_fetch_fx` | fetch 실패 시 `stored_history`를 담아 **반환**한다 |
| `backend/services/market_indicators/cache.py` `_merge_history` | `_merge_history(prev, [])`는 **prev를 그대로** 돌려준다 |
| `backend/services/dividends.py` | `fetch_dividend_schedule(...)`를 `replace_schedule` **진입 전에** 평가한다 |

빈 결과가 각 필드에 닿기 전에 이미 직전값으로 채워져 있으므로, 마지막 저장이 무엇을 쓰든 잃을 게 없다.

**⚠️ 가드의 *baseline*을 관용 로더로 읽으면 그 가드가 스스로 꺼진다(2026-08 신설 규약).**
`market_indicators/cache.py::_mc_load`는 조회 예외를 warning 후 `None`으로 접으므로
**「DB 오류」와 「한 번도 저장 안 됨」이 같은 값**이 된다. 완전성·커버리지·축소 가드는 전부
직전 저장값을 기준으로 판정하는데, 그 읽기가 조용히 `None`이 되면 **기준이 0으로 붕괴해 판정이
항상 통과**한다 — 가드가 있는데 없는 것과 같아진다. `_mc_save`는 `execute`, `_mc_load`는 `query`라
**SELECT만 일시 실패하고 INSERT는 성공하는 조합이 실제로 성립**한다.

→ 누적·기준 읽기는 **`_mc_load_strict`**(같은 파일, 조회 실패를 *전파*하고 행 부재만 `None`)를 쓴다.
전파된 예외는 `_mc_save`에 도달하지 못하게 만들어 직전값을 보존하고, `job_runs.record`가 스스로
`failed`를 기록해 관측성까지 함께 준다. 현재 사용처: `kospi_signal.refresh_kospi_signal`(누적
series 파괴 방지) · `econ._fetch_and_save_econ_indicators`(`_merge_history` 누적) ·
`us_sector_service._load_momentum_strict`(백필 baseline) · `earnings._tickers_with_cache`(축소 판정
baseline — 단 이쪽만은 **전파하지 않고** `baseline_known=False`로 내려 *저장만 생략*한다. 폴백
체인을 가진 read 경로라 전파하면 일시 DB 오류가 배치를 통째로 죽인다).
`_mc_load`는 **additive로 보존**됐다(앱 36곳·18모듈 + patch하는 테스트 17파일의 계약 불변).

**끝 가드를 쓸 수밖에 없으면 실패 클래스 3종을 모두 물어야 한다:**

1. **예외** — `try/except`
2. **성공-but-빈응답** — 외부 API가 `rt_cd=0`/200을 주면서 0건. 예외 가드를 그냥 통과한다.
   `backend/services/market_indicators/kospi_futures.py`가 값 수준 가드(price None·빈 history면
   fetch 실패 취급)를 두는 이유.
3. **부분 페이로드** — 한 payload의 *일부 필드*만 가드. `backend/services/kr_sector_service.py`가
   `sectors`만 보고 같은 payload의 `index`를 빠뜨려 보유→업종 매핑을 지운 사례.

**처방도 집합의 성격으로 3갈래다:**

| 집합 성격 | 처방 | 구현 |
|---|---|---|
| 고정 명명 집합의 합(M7 7종·KR Top2 2종) | **완전성** 요구 | `backend/services/market_indicators/earnings.py` |
| 유동적 대규모 집합(S&P500 나머지 ~490종) | **커버리지 임계** | 같은 파일 `_REST_MIN_COVERAGE = 0.5` |
| 독립 항목(구루 매니저·원자재 심볼·업종) | **실패분만 개별 백필** | `backend/services/storage/schedule.py` `save_guru_managers` |

`if not X:` all-or-nothing 게이트는 셋 중 어디에도 해당하지 않는다 — 유동 집합에 그것만 걸면
83명 중 40명 성공을 "비어있지 않음"으로 통과시켜 43명을 소멸시킨다(`save_guru_managers` docstring).

**⚠️ 판정 순서: 전량실패 판정은 반드시 백필 *앞*이고, 판정 대상은 백필 후 결과가 아니라 raw
fetch 결과다.** 뒤로 가면 백필이 목록을 채워 그 분기가 영영 발동하지 않는다. `save_guru_managers`가
이 함정을 주석으로 못박아 두었다. `backend/services/market_indicators/commodities.py`의
`get_treasury()`는 **한때 반대 순서(백필 → 판정)라 가드가 죽어 있었으나 task#269(BH7-L1, `e88e9c2`)에서
교정됐다** — 지금은 형제 `get_commodities()`와 **같은 순서**이고 둘 다 `if not any(results.values())`로
raw 결과를 본다. 즉 이제 어느 쪽을 "동형 이식" 참조로 골라도 된다(옛 판이 `get_treasury`를 반례로
지목했으니 그 서술을 인용하지 말 것).

**delete-rewrite(replace) 갱신은 더 위험하다** — 저장을 `DELETE+INSERT`로 하는 store에서
fetch 실패를 빈 결과로 삼키면 save 생략이 아니라 **직전 양호값 파괴**가 된다. fetch 함수는
예외를 삼키지 말고 *전파*해 호출측이 replace를 통째 스킵하게 한다.

**저장을 스킵할 땐 로그·응답이 "갱신됨"과 "생략·직전값 유지"를 구분해야 한다.**
`backend/services/job_runs.py`의 `record`는 본문이 예외를 *전파*할 때만 `failed`로 기록하므로,
스킵은 그냥 두면 초록으로 남는다 → `run.set_status("skipped"|"partial", err)`로 직접 말할 것.

### 1.3.1 `wrong < missing`은 면제부가 아니다

이 교리는 "**틀린 값을 보여주기 vs 안 보여주기**"의 선택 규칙이고, "**정상값을 지우기 vs
보여주기**"에는 적용되지 않는다. 지표가 통째 사라지면 규칙상 합격이어도 사용자 가치로는 손실이다.

셀프 리뷰가 한계를 찾으면 `wrong < missing` 합격 여부가 아니라 **"그 케이스에서 사용자가 무엇을
잃는가"**로 심각도를 판정한다. 그리고 트리거가 **사용자가 바꿀 수 있는 데이터**(경쟁사 목록·보유
종목 수 등)이면 "실측엔 해당 없음"을 면제 근거로 쓰지 않는다. 실사례: 피어 멀티플 이상치 가드가
peer 3개일 때 정상 peer를 결측시키는 한계를 알고도 "과보수적일 뿐 틀리지 않다"로 미뤘다가,
사용자가 경쟁사 하나를 빼자 PBR 비교 칩이 통째 사라졌다(ADR-0030).

한계를 테스트로 못박을 때는 **"의도된 트레이드오프"인지 "미룬 결함"인지 이름·주석에 구분**해 남긴다.

### 1.3.2 파싱 실패의 폴백은 **필드 성격**이 정한다 — 시세는 `None`, 수량은 `0`

`0`은 어떤 필드에서는 유효값이고 어떤 필드에서는 **실패의 위장**이다. 그래서 "실패 → 0"을
파일 단위·함수 단위로 정하면 반드시 한쪽이 틀린다.

| 필드 성격 | 폴백 | 이유 |
|---|---|---|
| 수량·금액·건수(순매수·거래량·거래대금·잔량·시총) | **`0`** | 「거래 없음」·「순매수 없음」이 실제로 0이다 |
| 시세·비율·단가(현재가·종가·비중·목표가) | **`None`** | 0원 종가·0% 비중은 존재하지 않는다 → 0은 실패의 위장 |

- **한 함수가 두 성격을 겸하게 두지 말 것.** `kiwoom/investor.py::_signed_int`는 순매수 3필드(0 폴백)와
  `close_price`(None이어야 함)를 함께 파싱하고 있었다 → 시세 전용 `_close_price`를 분리했다.
  같은 결함이 `kiwoom/shortsell.py::_int`(형제 파일 복제)·`ranking_service.py::_parse_int`(랭킹 `price`)에도 있었다.
- **리터럴 `0`도 결측으로 볼 것** — 소스가 결측을 `"0"`으로 채우면 파싱은 *성공*하므로 센티널·예외·
  비유한 가드를 **전부 통과**한다. 라이브 실측: Naver KOSPI 응답 2478행 중 **54행**이
  `closePriceRaw='0'`(거래 0인 채권형 ETF·ETN)이고 같은 응답의 `fluctuationsRatio`도 그 0에서 파생된 `-100.00`이다.
- **같은 컬럼에 쓰는 writer를 전수 세라.** `market_investor_trend.close_price`의 writer는 셋이다
  (`kiwoom/investor.py::_close_price`·`kiwoom/shortsell.py::_close_price`·`investor_service.py::_parse_close_price`).
  하나만 고치면 소스별로 0과 None이 섞여 **어느 쪽이 결함인지 코드로 판정할 수 없게 된다.**
- **`except`만으로는 비유한값을 못 막는다** — `float("nan")`·`float("Infinity")`는 `ValueError`를 던지지 않고
  `bool(float("nan")) is True`라 진리값 가드도 통과한다. `math.isfinite`를 쌍으로 둘 것(§3).
  그리고 `int(float("Infinity"))`는 `ValueError`가 아니라 **`OverflowError`**다 — `except ValueError`만
  두면 파싱 함수가 raise되고 호출측 broad except가 그 대상의 데이터를 조용히 비운다.

### 1.4 graceful degradation — 부가기능은 본문을 깨뜨리지 않는다

계측·캐시 워밍·enrichment 같은 부가 경로는 실패해도 본문을 통과시킨다.

- `backend/services/job_runs.py` `record` — "계측은 관측 전용, 본문(배치)을 절대 깨뜨리지 않는다".
  enter INSERT 실패 시 경고만 남기고 `run_id=None` 센티넬로 본문을 그대로 실행하며,
  종료 UPDATE 실패도 삼킨다. `recent`/`recent_map`은 예외 시 `[]`/빈 map을 돌려준다.
- `backend/main.py` `_migrate` — DDL마다 개별 `try/except` + `logger.warning("[Migrate] …")`.
  하나가 실패해도 나머지 마이그레이션과 기동이 진행된다.
- `backend/main.py` `_warm_market_cache` — 데몬 스레드에서 bare `except: pass`.
  (앱 전체에서 몇 안 되는 bare pass. 신규 코드에는 쓰지 말 것 — §4.2)
- `backend/routers/stocks.py`의 대시보드 빌드 — 카드당 `_safe`가 예외를 잡아 `_minimal_card`로
  폴백하고 `logger.warning("[Dashboard] … 최소카드 폴백: …")`을 남긴다.
  불변식은 **holdings=N → 항상 N카드**(500-to-empty 금지).

⚠️ **폴백은 근본원인을 마스킹한다.** `_minimal_card` 폴백은 500도 안 내고 토스트도 없이
enrichment만 조용히 사라지므로, 증상이 보이면 컨테이너 로그의 `최소카드 폴백` 마커가 유일한 단서다.
그래서 §4의 마커 규약이 이 관용구와 짝을 이룬다.

⚠️ **무거운 복구 동작을 가벼운 것으로 바꿀 땐 "그게 부수적으로 무엇을 고쳐주고 있었나"를 먼저 묻는다.**
전체 리로드·프로세스 재시작·캐시 전량 무효화는 겨냥한 문제 하나만 고치지 않고 그 시점의 *모든*
상태 결함을 함께 리셋한다. bfcache 인증 가드의 `location.replace('/')`를 in-place `setSession`
뒤집기로 바꾸자(ADR-0035), 리로드가 매번 세탁하던 `useAuthBootstrap`의 `authLoading` 데드엔드가
처음으로 드러났다. 반대로 **덮개를 새로 넣을 때는 "그 덮개가 언제·누구에 의해 걷히는가"를 센다** —
`frontend/index.html`의 정적 스플래시는 React `createRoot().render()` 첫 커밋에서 지워지므로
`frontend/src/App.jsx`의 early-return과 `frontend/src/oauthSplash.js`가 인계를 이어받아야 한다.

### 1.5 중복 제거·단일 소스화 전에 "겸직 필드"를 센다

같아 보이는 필드를 합치기 전에 **그 필드가 겸하던 역할 수**를 소비처 grep으로 센다.

관측된 겸직 3쌍:

- `frontend/src/navSections.js` — 섹션의 `key`(React key·아이콘 매핑) vs `perm`(권한 필터)
  vs 항목의 `evt`(analytics 이벤트명). `MobileNav`가 예전에 `key` 하나로 권한 필터와 이벤트명을
  겸했고, 단일 소스화 때 `section.key`를 골랐으면 이벤트명이 바뀌어 백엔드
  `backend/routers/events.py`의 `VALID_EVENTS` 화이트리스트에서 조용히 탈락했을 자리다
  (요청은 성공하고 이벤트만 사라진다). 실제 파생 소스는 `section.perm`이다.
- `backend/services/batch_registry.py` — `source`(데이터 fetch 출처) vs `usage`(소비 UI).
  방향이 반대인데 이름이 비슷하다.
- `tickers.name`(공유 마스터) vs `snapshots.data.name`(리포트 생성 시 박제) — dual-source.

파생 소스는 "이름이 비슷한 것"이 아니라 **소비처가 요구하는 값**으로 고른다.
이 클래스는 vitest·빌드·라이브 프로브 어느 것도 안 잡는다(화면은 정상으로 보인다).

같은 "세라" 가족의 다른 표면 — **레이스 가드를 한 함수에 넣으면 그 훅·모듈의 *형제 비동기
경로*를 전수 센다.** `frontend/src/pages/Ranking.jsx`의 `fetchPage`에 세대 가드를 넣을 때
`frontend/src/hooks/useTrackedStocks.js`의 `reload()`에 같은 결함이 남아 있었다.

### 1.6 같은 집합이 여러 소스에 적혀 있으면 **교차 대조 테스트**로 못박는다

§1.5가 "합치기 전에 역할을 세라"라면 이건 "**합칠 수 없는 것은 대조하라**"다. 백엔드·프론트·
스키마에 같은 집합이 각각 적혀야 하는 자리(언어 경계·DB 시드)에서는 단일 소스화가 불가능하므로,
드리프트를 **테스트가 관측**하게 만든다. 안 하면 드리프트가 **어떤 신호도 내지 않는다.**

| 집합 | 소스 수 | 가드 | 무신호 이유 |
|---|---|---|---|
| 메뉴 권한 키(5키, ADR-0025) | 4 — `routers/auth.py::ALL_MENUS` · `routers/admin.py::ALL_MENUS` · `components/PermissionPanel.jsx::ALL_MENUS` · `app_schema.sql`의 `default_menu_permissions` 시드 | `backend/tests/test_all_menus_single_source.py` | 여분 키는 그냥 아무 메뉴도 안 켜니 화면이 정상으로 보인다(실제로 `auth.py`만 6번째 키 `analysis`로 드리프트해 있었다) |
| analytics 이벤트명 | 2 — `routers/events.py::VALID_EVENTS` ↔ 프론트 발신부 | `backend/tests/test_valid_events_matches_frontend.py` | `track_event`가 화이트리스트 밖 이벤트를 **200 OK로 돌려주고 저장만 생략**한다 — 요청·콘솔·서버로그 전부 무음(실사례 `nav_analytics`) |

**교차 대조 수집기는 리터럴만 훑어서는 안 된다** — 이벤트명은 `section.key`가 아니라
**`section.perm`**에서 파생되므로(§1.5) 수집기가 그 파생 규칙까지 재현해야 하고, **분류되지 않는
호출 형태가 하나라도 나오면 실패**해야 한다(새 파생 형태가 조용히 사각으로 들어오는 것을 막는 이빨).

---

## §2 백엔드 모듈·패키지 구조

### 2.1 `__init__.py` re-export 3스타일

| 스타일 | 패키지 | 형태 |
|---|---|---|
| **전 심볼 평탄 re-export**(표면 보존형, ADR-0017) | `services/storage/`, `services/market/` | private 포함 전 심볼 나열, `__all__` 없음 |
| **공개 API + `__all__`** | `services/recommendation/`, `services/market_indicators/` | 소비처가 쓰는 것만 |
| **명시 나열(underscore 포함)** | `scheduler/` | `import *`가 underscore를 건너뛰므로 개별 나열 |

`services/market/__init__.py`와 `services/storage/__init__.py`는 파일 상단 주석에 그 이유를 적어 둔다.
`services/market_indicators/__init__.py`는 `__all__`에 `_fetch_and_save_*`·`_mc_delete`·`_cache`처럼
**배치와 테스트가 쓰는 private**도 명시적으로 포함한다.

### 2.2 지연 import (함수 안 import)

순환참조 회피와 기동 비용 절감을 위해 **함수 본문 안에서 import**하는 관용구가 흔하다.

- `backend/services/cache.py` `invalidate_portfolio_caches` — `from routers import calendar as
  calendar_router`(services→routers 역방향 순환 회피).
- `backend/main.py` `_migrate` — 각 `try` 블록 안에서 `from services.db import execute`.
- `backend/services/market_indicators/cache.py` `_mc_save` — 함수 안에서 `datetime` import.
- `backend/services/storage/names.py` 계열 — storage→cache 무효화가 지연 import로 순환을 끊는다.

⚠️ **지연 import는 테스트 patch 타깃을 바꾼다** — 모듈 상단 import면 `patch("소비모듈.심볼")`이
먹지만, 함수 안 import면 원본 모듈(`patch("services.db.execute")`)을 잡아야 한다(`TESTING.md §4`).

### 2.3 모듈 레벨 import + dotted 호출 (patch 가능성 확보)

라우터는 보통 **모듈을 import해서 dotted로 호출**한다(`from services import storage` →
`storage.get_full_portfolio(...)`). 그래야 테스트가 `patch("routers.stocks.storage.get_full_portfolio")`로
소비처 경로를 잡을 수 있다. 실제 patch 타깃 상위 항목이 전부 이 형태다:
`routers.recommendations.storage.get_full_portfolio`(30회), `routers.stocks.query`(21회),
`services.digest_service.get_quotes_batch`(19회).

심볼을 직접 import한 경우(`from services.db import query`)에는 **소비 모듈 경로**로 patch한다
(`patch("services.consensus.query")` 27회 · `patch("routers.report.query")` 24회).

**모듈에서 심볼을 제거·개명하면 그 심볼을 patch하는 테스트를 파일 불문 전수 grep**한다
(`grep -rn "모듈경로.심볼" backend/tests/`) — mock 타깃은 "그 기능의 주 테스트 파일"에만 있지 않다.

### 2.4 ADR·task 역참조 주석

코드 주석에 **결정 근거를 역참조**하는 것이 이 저장소의 강한 관례다(`task#NNN` 참조가
백엔드 306건 · 프론트 702건 = **1,008건**). 형태는 `(ADR-0033)`, `(task#251)`,
`(CONCERNS §4.2)`, `(CLAUDE.md gotcha/task#157)`.
ADR 정본은 `.forge/adr/0001-…` ~ `0047-…`(+ 날짜형 `260821-…` 1건).

특히 **"왜 이 순서인가", "왜 이 값이 아닌가"**를 적는다 — `save_guru_managers`의 docstring이
전형(임계가 아니라 개별 백필인 이유, 보류에 탈출구를 두지 않는 이유까지).

---

## §3 명명·타입 규약

### 3.1 식별자는 영문, 주석·docstring·사용자 문자열은 한국어

- 파이썬 식별자 snake_case, 클래스 PascalCase. JS 변수·함수 camelCase, 컴포넌트 PascalCase.
- **docstring·주석은 한국어**가 지배적이며, 길고 서술적이다(결정 근거·함정·반례 포함).
- 사용자 대면 문자열은 한국어 리터럴로 소스에 직접 박는다(i18n 라이브러리 없음 — §9.9).
- 로그 메시지도 한국어(`logger.warning(f"[Earnings] M7 rest 성공률 미달(...) — 저장 생략, 저장값 유지")`).
- 테스트 함수명은 영문 snake_case(`test_save_guru_managers_skips_execute_on_empty`),
  vitest `describe`/`it` 설명문은 한국어.

### 3.2 접두 관례

**백엔드**

| 접두/접미 | 뜻 | 예 |
|---|---|---|
| `_` | 모듈 private (단, 패키지 re-export 대상이면 외부도 씀) | `_mc_load`, `_build_all` |
| `get_` / `save_` / `replace_` | 읽기 / 쓰기 / 전량 교체 | `get_holdings`, `save_stocks`, `replace_recommendations` |
| `_fetch_and_save_` | 외부 fetch + 저장(배치·수동 갱신 진입점) | `_fetch_and_save_m7_earnings` |
| `_mc_` | `market_cache` 테이블 접근 | `_mc_load`, `_mc_save`, `_mc_delete` |
| `_run_` / `_fetch_` / `_refresh_` / `_seed_` | 스케줄러 잡 함수 | `_run_guru_crawl`, `_fetch_dividends`, `_seed_rankings_if_empty` |
| `_yf_` / `_naver_` / `_kr_` | 소스별 어댑터 | `_yf_sym`, `_naver_get`, `_kr_basic_kis` |

**프론트엔드**

| 접두 | 뜻 | 위치 |
|---|---|---|
| `use*` | 훅 | `frontend/src/hooks/` |
| `fmt*` | 표시 포매터 — **이름에 입력 단위를 박는다**(ADR-0031) | `frontend/src/utils.js` |
| `Sketch*` / `Icon*` | 손그림 일러스트 / 아이콘 컴포넌트 | `frontend/src/components/sketches/` |
| `*Section` | 화면 한 절 단위 컴포넌트 | `components/market/`, `components/reports/` |
| `*Tab` | 허브 내부 탭 페이지 | `frontend/src/pages/SectorTab.jsx` 등 |

`frontend/src/utils.js` 헤더 주석이 ADR-0031의 근거를 적는다 — `fmtEokWon`(억원)·`fmtSharesKr`(주)·
`fmtUsdCompact`(USD 원단위)처럼 **단위를 이름에 박아 호출부에서 단위 오적용이 문법적으로 눈에
걸리게** 한다. 빈값은 5종 모두 `—`(em dash)로 통일.

### 3.3 타입 어노테이션 — 로컬 3.9.6 / 배포 3.12 발산이 하드 제약

로컬 `backend/.venv`는 **Python 3.9.6**, Docker 컨테이너는 **3.12**다. 로컬 pytest가 게이트이므로
3.9에서 깨지는 문법은 사실상 금지다.

**규칙:**

- **런타임 평가되는 어노테이션에 PEP604 `X | None` 금지 → `Optional[X]` 사용.**
  Pydantic 모델 필드, FastAPI 엔드포인트 시그니처가 여기 해당한다(3.9는 `TypeError`).
  현재 `backend/routers/*.py`의 PEP604 사용 0건, `Optional[...]` 94건.
- **`from __future__ import annotations`가 있는 모듈**에서는 어노테이션이 문자열로 남아 평가되지
  않으므로 PEP604·builtin generic이 안전하다. 앱 코드 112개 파일 중 71개가 이 import를 갖는다.
  예: `backend/services/db.py`의 `_pool: ThreadedConnectionPool | None`,
  `def query(...) -> list[dict]`; `backend/services/market_indicators/cache.py`의 `-> dict | None`.
- ⚠️ **문자열 주석(`"dict | None"`)은 평가되지 않아 3.9에서도 통과하므로 더 헷갈린다** —
  "동작한다"가 "3.9 안전"을 뜻하지 않는다. 판단 기준은 **그 자리가 런타임 평가되는가**다.
- 로컬 `.venv` ≠ Docker는 *패키지 유무*로도 갈린다: `lxml`은 `requirements.txt`에 있고 이미지엔
  있지만 로컬 venv엔 없다 → HTML 파싱은 `BeautifulSoup(html, "html.parser")`(stdlib)를 쓴다.
- 버전차는 *같은 패키지의 API 형태*도 바꾼다: 배포 FastAPI(0.138+)는 `include_router` 라우트를
  `_IncludedRouter`로 감싸 `app.routes` 평탄 순회가 **0개를 세며 조용히 통과**한다.
  `requirements.txt`가 핀 없는 `fastapi>=0.104.0`이라 이 발산은 계속된다 →
  라우트 열거는 반드시 `backend/tests/_routes.py`의 `walk_routes`를 거친다(§11).

**타입 어노테이션의 커버리지 자체는 부분적이다** — 서비스 계층 함수 시그니처엔 붙어 있지만
전면 강제는 아니고, mypy 등 정적 타입 검사기는 도입돼 있지 않다.

---

## §4 로깅 방출 규약

### 4.1 방출 메커니즘 — 모듈 `logger` 통일, `print` 금지

앱 코드(`backend/main.py`·`routers/`·`services/`·`scheduler/`·`middleware/`)는 **모듈 레벨
`logger = logging.getLogger(__name__)`**로 통일한다. 현재 65개 모듈이 이 선언을 갖는다.

- **`print(` 신규 금지** — 앱 코드 `print(` 0건이며 `backend/tests/test_no_print.py`가 ast로
  `print()` 호출 노드만 탐지해 단언한다(문자열·주석·`pprint` 오탐 없음).
  `tests/`·`scripts/`·`data/`는 대상 외.
- 변수명은 `logger`가 표준. 유일한 예외가 `backend/services/job_runs.py`의 `log` —
  신규 코드는 `logger`를 쓴다.

### 4.2 레벨 의미

| 레벨 | 언제 | 예 |
|---|---|---|
| `warning` | **graceful 담화** — 폴백했다·저장을 생략했다·부분 실패다 | `[Cache] _mc_load key=… 실패`, `[Earnings] … 저장 생략, 저장값 유지`, `[Dashboard] … 최소카드 폴백` |
| `error` | 예상치 못함·데이터 손실. **아껴 쓴다** | 드묾 |
| `info` | 배치·라이프사이클 | 스케줄러 잡 시작/종료 |

- 스택트레이스가 필요하면 `exc_info=True`(`job_runs.py`가 `log.warning(..., exc_info=True)` 사용).
- **broad `except: pass`는 지양** — 외부 정렬·파싱 실패를 삼키면 기능이 예외 없이 조용히 꺼진다.
  최소한 진단 로그를 남기거나 좁은 예외만 잡는다(현재 bare pass는 `main._warm_market_cache` 등 극소수).

### 4.3 포맷·마커

```python
logger.warning(f"[Component] <무엇> (<ids>): {e}")
```

- `[Component]`는 **PascalCase, 개념당 1스펠링**. 공백을 넣지 않는다
  (`[KIS Quote]` → `[KISQuote]`로 통일한 전례가 `.forge/quick/LOG.md`에 있다).
- 마커는 **모듈명이 아니라 개념명**이다 — 한 모듈이 여러 마커를 낼 수 있다
  (`services/market_indicators/commodities.py`가 `[Commodities]`·`[Treasury]` 둘 다 방출).
  그래서 로그 grep의 개념 앵커가 된다.
- 현재 방출량 상위: `[Scheduler]` 77 · `[Migrate]` 20 · `[Earnings]` 16 · `[Any]` 16 ·
  `[Report]` 13 · `[Guru]` 11 · `[Funnel]` 11.
- 포매터 자체는 `%(levelname)s %(name)s: %(message)s`이므로 **레벨과 모듈 경로는 이미 붙는다** —
  `[Component]`는 그 위에 얹는 *개념* 축이다(모듈≠개념일 때 값을 한다).
- 자동 가드는 "print 금지"뿐이다. **마커 유무·스펠링을 강제하는 테스트는 없다**(리뷰 의존).

### 4.4 노이즈 제어 — 루트 로거 1회 배선

`backend/main.py`의 `_configure_logging()`이 import 시점에 1회 호출된다(라우터 import보다 먼저).

- `logging.basicConfig(level=INFO, format="%(levelname)s %(name)s: %(message)s")`
  — config가 없으면 root `lastResort`가 WARNING+만 내보내 `logger.info`가 `docker logs`에 안 뜬다.
- `urllib3`·`yfinance`·`apscheduler`·`asyncio` → `WARNING`으로 억제.
- `uvicorn`·`uvicorn.error`·`uvicorn.access` → `propagate = False`로 double-emit 방지.

### 4.5 프론트 로깅 (`console.*`)

- 레벨 의미는 백엔드와 같은 축: **`console.warn` = graceful 폴백/예상된 실패**,
  **`console.error` = 예상외**. 현재 `frontend/src`의 비테스트 코드 기준 `console.warn` 27건 ·
  `console.error` 12건 · **`console.log` 0건**(신규도 지양).
- 마커는 **소스 모듈/훅 실명**을 대괄호로 — hook은 camelCase 그대로, 컴포넌트/페이지는 PascalCase.
  실사용: `[usePortfolioData]`(5) · `[AnalystReports]`(6) · `[useTrackedStocks]`(2) ·
  `[useReportList]` · `[GlobalSearch]` · `[PermissionPanel]` 등.
  **백엔드의 개념명 마커와 달리 여기선 파일/훅 이름 그대로**다.
- 사용자 대면 실패는 로그와 별개로 **토스트**를 함께 낸다
  (`frontend/src/components/Toast.jsx`의 `useToast().showToast(msg, 'error')`).
- **자동 가드 없음** — eslint 설정(`frontend/eslint.config.js`)에 `no-console` 규칙이 없다.

---

## §5 에러 처리·직렬화 방어 (백엔드)

### 5.1 예외 팩토리와 `HTTPException`

- `backend/services/errors.py`가 `not_found(ticker, context)` / `already_exists(ticker, context)`
  두 팩토리를 제공한다(404 / 400). 그 외에는 라우터에서 `HTTPException`을 직접 raise한다.
- 실사용 상태코드: 201(발행 생성) · 202(비동기 배치 시작) · 400 · 403 · 404 · 409 · 422 ·
  500 · 502 · 503.
- **`response_model`은 앱 전체에서 0건** — 엔드포인트는 평문 dict를 반환하고, 직렬화 방어는
  §5.2의 `sanitize`로 한다. 응답 스키마의 정본은 코드가 아니라 `API_SPEC.md`다(§10).
- **미포착 예외는 앱 전역 핸들러가 구조화 JSON 500으로 바꾼다** —
  `backend/main.py`의 `@app.exception_handler(Exception)` `_unhandled_exception_handler`가
  `{"detail": "Internal Server Error"}`만 내보내고 원인은 서버 로그에만 남긴다
  (`wrong < missing`의 응답판 — 클라이언트에겐 *없는* 정보가 *위험한* 정보보다 낫다).
  핸들러가 없으면 starlette 기본 경로가 `text/plain` raw 500을 내고 내부 메시지·스택 흔적이
  새어나갈 수 있으며, JSON을 기대하는 클라이언트는 파싱에도 실패한다.
  ⚠️ **이 핸들러는 `HTTPException`을 삼키지 않는다** — starlette는 `Exception`/500 키의 핸들러만
  `ServerErrorMiddleware`로 보내고 `HTTPException`·`RequestValidationError`는 `ExceptionMiddleware`에
  남기므로, 404·401·403과 §5.2 ③의 422 핸들러는 그대로 동작한다(`backend/tests/test_global_exception_handler.py`가
  이 경계를 4축으로 못박는다). 이 검증은 자체-app으로는 불가하고 conftest `client` 픽스처로만 된다
  (`TESTING.md §3`).

### 5.2 NaN/inf 3중 방어 (출력·입력·전역)

starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 **500**이
난다. 방어는 세 층이다.

**① 출력 — `services/utils.sanitize`**

`backend/services/utils.py`의 `sanitize(obj)`가 dict/list를 재귀 순회해 비유한 `float`**과 `Decimal`**을
`None`으로 바꾼다. Decimal까지 보는 이유가 docstring에 있다 — PostgreSQL `numeric`은 NaN을 저장할
수 있고 psycopg2가 그걸 `Decimal`로 돌려주므로 float만 검사하면 안전하지 않다.
정상 `Decimal`은 float 캐스트하지 않고 보존한다(정밀도 손실 방지).

적용 지점(라우터 반환 감싸기): `routers/portfolio.py`(포트폴리오·prices·rebalance·exposure),
`routers/stocks.py`(dashboard·metrics), `routers/analyst_reports.py`, `routers/tech_reports.py`,
`routers/recommendations.py`, `routers/report.py`(모듈 로컬 `_sanitize`).

**시세/합산을 응답에 싣는 엔드포인트는 sanitize 또는 소스 `math.isfinite` 가드가 필수**다.
가드는 소스에서 하는 쪽이 깨끗하다(예: FX 비유한값을 "시세 없음"으로 처리).

**② 입력 — Pydantic `allow_inf_nan=False`**

raw JSON 본문의 `NaN`/`Infinity` 토큰은 ⓐ `json.loads`가 허용하고 ⓑ Pydantic v2 float 필드가
기본 `allow_inf_nan=True`로 통과시키고 ⓒ `low <= high` 같은 범위 검증이 NaN에서 **항상 False**라
조건을 뒤집어도 안 걸린다 — 3중으로 새어 불변 문서에 NaN이 저장된다.

현재 명시된 필드: `routers/analyst_reports.py`의 `PublishBody.fair_value_low/high`,
`PointMetric.change_pct`; `routers/tech_reports.py`의 `MoneyValue.value`, `Market.cagr_pct`,
`Player.share_pct`, `PointMetric.change_pct`; `routers/watchlist.py`의 `PromotePayload`는
`model_config = ConfigDict(allow_inf_nan=False)`로 모델 단위 적용.

**③ 전역 — 422 detail sanitize**

NaN을 거부하면 FastAPI 기본 검증 에러 응답이 **입력 NaN을 그대로 echo**하고, starlette가
`allow_nan=False`라 422가 **500**으로 터진다. `backend/main.py`의
`@app.exception_handler(RequestValidationError)` `_validation_error_handler`가
`sanitize(jsonable_encoder(exc.errors()))`로 앱 전역에서 막는다 — 엔드포인트별 문제가 아니다.

**폴백이 다르게 가린다는 점도 기억할 것** — PostgreSQL은 `json` 컬럼에 NaN을 거부하지만
파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과한다.
그래서 "DB 저장 실패 → 파일 성공 → 응답 직렬화 실패"로 증상이 엇갈린다.

### 5.3 "best-effort, 절대 호출자를 깨지 않는다" 관용구

```python
try:
    ...
except Exception as e:
    logger.warning(f"[Component] <무엇> (<ids>): {e}")
    return <직전값 또는 빈 기본값>
```

`job_runs.recent`(→`[]`), `market_indicators/cache._mc_load`(→`None`),
`_mc_save`/`_mc_delete`(→ 무시) 전부 이 형태다.
**단, 빈 기본값을 *저장*에 쓰면 §1.3 위반**이 되니 "읽기 실패의 빈값"과 "쓰기 대상의 빈값"을 구분한다.

### 5.4 선택 필드는 `Optional[X] = Field(None)` — 생략/명시적 null의 비대칭

pydantic v2는 `validate_default=False`가 기본이라 기본값 `None`은 검증을 안 타지만,
클라이언트가 **명시적으로 보낸 `null`**은 선언 타입(`float`)의 검증을 탄다 →
`float_type` 422. 그래서 `x: float = Field(None)`은 **키 생략은 통과하고 명시적 `null`만 422**가
되며, 그 필드가 중첩 배열 안에 있으면 **칩 하나 때문에 요청 전체가 막힌다.**

→ 선택 필드는 반드시 `Optional[X] = Field(None, ...)`.
`routers/tech_reports.py`의 `Market.estimates` 주석이 이 규칙을 인용한다
("`Optional[List] = Field(None)` 필수").

`Optional`로 바꿔도 `allow_inf_nan=False`의 NaN 차단은 유지된다(생략→None · `null`→None ·
`NaN`/`Infinity`→422 `finite_number`).

**⚠️ 스칼라와 배열은 같은 함정의 두 표현형이다 — 한 목록으로 세라.** 배열형은
`List[X] = Field(default_factory=list)` / `Field([])`이고, 로컬 실측(pydantic 2.13.4)에서
키 생략 → OK · `[]` → OK · **명시적 `null` → 422 `list_type`**으로 스칼라와 똑같이 갈린다.
→ **선택 배열도 예외 없이 `Optional[List[X]] = Field(None, ...)`**(ADR-0034 보정 ③).
현재 `backend/routers/tech_reports.py`가 전 배열 필드를 이 형태로 두고
(`estimates`·`metrics`·`examples`·`leaders`·`used_in`·`producers`·`tech`·`minerals`·`experts`·
`key_points`·`milestones`·`variants`·`watch_items`), `Market.estimates` 위 주석이 이유를 못박는다.
`routers/stocks.py`의 `sources`·`segments`도 같은 형태다.

**남은 위반은 1건이고 dormant다** — `backend/routers/analyst_reports.py`의
`ReportPoint.metrics`가 `List[PointMetric] = Field(default_factory=list, max_length=4)`로 남아
있다(주석: "additive — 구 판 호환"). 바로 위 형제 `PointMetric.change_pct`는 이 규약을 인용해
`Optional`로 고쳐져 있으므로 **한 줄 차이로 갈린 상태**다. 발동 조건은 루틴이 포인트 하나에
`"metrics": null`을 넣는 것이고, 현재 루틴 프롬프트는 항상 배열을 넣도록 지시하되 「없으면
생략하라」를 적지 않았다(형제 tech 절은 그것을 명시한다) — 즉 프롬프트 한 줄이 방어의 전부다.

**⚠️ 탐지 grep을 좁히면 그 감사는 통과해도 무의미하다.** 스칼라 패턴
`grep -rn "= Field(None\|= Field(default=None" backend/routers/ backend/services/`는 **배열형을
한 글자도 잡지 못한다**(실측: 38건 히트 중 배열 위반 0건). 둘을 함께 돌릴 것:

```
grep -rn  "= Field(None\|= Field(default=None"                       backend/routers/ backend/services/
grep -rnE "List\[.*\] = Field\((default_factory=list|\[\])"          backend/routers/ backend/services/
```

---

## §6 라우터·API 규약

**라우터 1모듈 = `APIRouter(prefix=..., tags=[...])` 1개.** 20개 라우터가 모두 이 형태다.

| prefix | 라우터 |
|---|---|
| `/api/admin` `/api/auth` `/api/analysis` `/api/analytics` `/api/events` `/api/guru` `/api/portfolio` `/api/recommendations` `/api/stocks` `/api/watchlist` `/api/analyst-reports` `/api/tech-reports` | 동명 모듈 |
| `/api/market` | `routers/market_indicators.py` — ⚠️ **`/api/market-indicators`는 존재하지 않는다** |
| `/api`(경로를 함수에서 완성) | `calendar` `batches` `investor` `digest` `rankings` `short_sell` `report` |

- `backend/main.py`의 `include_router`는 **`prefix` 인자를 쓰지 않는다** → 라우터가 선언한 경로가
  최종 경로다(`backend/tests/_routes.py` 주석이 이 사실에 의존).
- **라우트 순서: 리터럴 경로가 파라미터 경로보다 먼저.**
  `PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 **먼저** 선언해야
  FastAPI가 `enrich`를 ticker 값으로 라우팅하지 않는다.
- **인증 게이팅** — 모든 `/api` 엔드포인트는 `backend/auth.py`의 4개 의존성 중 하나를 단다:
  `get_current_user`(75) · `require_admin`(46) · `get_current_user_or_api_key`(12) ·
  `require_admin_or_api_key`(8). 예외는 `routers/auth.py`의 공개 9개뿐(ADR-0029).
  `backend/tests/test_no_public_reads.py`가 양방향 exact-match로 강제한다.
  ⚠️ `require_admin`은 **API 키를 거부**한다 — Cowork/스크립트가 키로 호출해야 하면
  게이트가 `require_admin_or_api_key`여야 한다.
  ⚠️ **`get_current_user_or_api_key`는 이름대로 OR이어야 한다** — `X-API-Key`가 *있지만 틀리면*
  유효한 Bearer를 검사하지도 않고 401로 거부하던 결함이 있었다(키 회전 직후 로그인한 사용자가
  조용히 401). 회귀 축은 4조합이 아니라 **6조합**이다 — 「유효한 한쪽 + 무효한 다른 쪽」 경로를
  지나야 이 결함을 볼 수 있다(`backend/tests/test_api_key_bearer_or_eval.py`).
- **경로 파라미터 검증** — 열거형은 `Literal` 별칭(`routers/tech_reports.py`의 `SlugPath`),
  날짜는 pydantic `field_validator`로 ISO 강제. `routers/tech_reports.py`의 `_iso_date_only`
  docstring이 이유를 적는다: plain `str`이면 psycopg2 바인딩 시 서버 `DateStyle`(기본 MDY)이
  `"03/08/2026"`을 8월 3일로 해석해 **불변 발행물에 잘못된 날짜가 조용히 저장**된다.
- **모델 간 제약은 `@model_validator(mode="after")`** — 예: `share_pct`가 있으면
  `market.share_basis`가 있어야 그 수치가 해석 가능하다(ADR-0033).
- **티커 정규화**: 경로 티커는 `.upper()`, 형식 검증은 `services/utils.is_valid_ticker`
  (strip·upper 후 `^[A-Za-z0-9.\-]{1,15}$`).
- **비동기 시작은 202 + progress 폴링** — `services/progress.py`의 `ProgressTracker`
  (`running`/`done`/`total`/`current`/`failed`, 락 보호)를 GET 진행 엔드포인트가 노출한다.
  ⚠️ `done`은 *시도* 총계다(저장 건수 아님) — 응답 필드 의미를 문서 표에 명시한다(§10).

---

## §7 DB·SQL 규약

**접근은 `backend/services/db.py` 3함수로만** — `query(sql, params) -> list[dict]`(RealDictCursor),
`execute(sql, params) -> rowcount`, `execute_many(sql, params_list)`(psycopg2 `execute_batch`,
빈 리스트는 no-op).

- 커넥션은 `ThreadedConnectionPool(minconn=1, maxconn=20)`. `get_connection()` 컨텍스트매니저가
  성공 시 commit·예외 시 rollback·항상 putconn. **maxconn=20은 최대 ThreadPool 동시성보다 크게**
  잡은 값이다(psycopg2 풀은 소진 시 블록이 아니라 `PoolError`를 던진다) — 새 ThreadPool을 늘릴 땐
  이 값과 대조할 것. 현재 최대 워커: `earnings` **20**(2곳) · `calendar` 15 · `ranking` 12 ·
  `us_sector` 11 · `parallel_map` 기본 10 · 나머지는 8 이하.
- ⚠️ **워커 상한을 정당화하는 주석 3곳이 `maxconn=10`을 근거로 든다** —
  `routers/stocks.py`의 이름 백필, `scheduler/jobs.py`의 investor_trend·shortsell 루프가
  "max_workers ≤ 8: 워커가 DB 풀(maxconn=10)을 점유 → 풀 초과 방지"라고 적는데
  **`services/db.py`의 실제 값은 20**이다. 주석이 상한을 *가두고 있으므로 그 주석은 코드다* —
  이 값을 근거로 워커 수를 계산하려면 `db.py`를 먼저 직독할 것(§7 첫 항). 상한 8 자체는
  보수적이어서 무해하지만, "풀이 10이니까 8"이라는 **추론을 재사용하면 틀린 결론이 번진다.**
- **파라미터는 항상 `%s` 바인딩.** f-string으로 SQL에 값을 끼워 넣지 않는다.
- **JSONB 파라미터는 호출측에서 `json.dumps(..., ensure_ascii=False)`**
  (`services/analyst_reports.py`, `services/backlog.py`, `services/supply_score.py`,
  `services/us_supply.py`, `services/report_generator.py`).
  `backend/tests/test_tech_reports_service.py`가 이 규약을 `CONVENTIONS §7`로 인용한다.
- **upsert는 `ON CONFLICT (…) DO UPDATE SET …=EXCLUDED.…`** (services 10여 곳).
  클로버 방지가 필요하면 `CASE WHEN`으로 기존값 보존을 넣는다(`tickers.name` 패턴).
- **리스트 조건은 `= ANY(%s)`.** ⚠️ **uuid 컬럼엔 반드시 캐스트** —
  `= ANY(%s::uuid[])`(`routers/admin.py`의 `user_menu_permissions` 조회).
  캐스트 없이 파이썬 `str` 리스트를 넘기면 `text[]`가 돼 `operator does not exist: uuid = text`로
  라이브에서 즉사한다(단건 `= %s`는 암묵 캐스트돼 *동작하던* 것이 배치화에서 깨진다).
- **VALUES 다행은 바깥 괄호로 감싸지 않는다** — `VALUES ((a,b),(c,d))`는 N행이 아니라
  record 컬럼 1행이 된다. 행별 `(a,b), (c,d)` 나열만.
- **replace(=delete+insert)는 단일 트랜잭션** + fetch 실패 시 delete 자체를 스킵(§1.3).

**동시성 — 읽기-계산-쓰기 (task#330)**

`query()`·`execute()`는 **호출마다 독립 커넥션·트랜잭션**을 열고 즉시 커밋한다. 그래서
`query`로 읽고 계산해 `execute`로 쓰는 형태는 두 호출 **사이**에 다른 요청·배치가 끼어들면
둘 다 같은 직전값을 읽고 나중 쓰기가 앞선 신선분을 되돌린다(**lost update**). 함수 하나가
「원자적으로 보인다」는 것은 보장이 아니다 — 문장 수만큼 트랜잭션이 있다.

- **다중 문장이 원자적이어야 하면 `get_connection()` 하나로 감싼다**(성공 시 commit·예외 시
  전체 rollback). 예: `routers/admin.py::delete_user`는 DELETE 6문장 — 예전엔 확인 `query` 1 +
  `execute` 6 = **독립 트랜잭션 7개**였고, 중간 실패가 「로그인은 되는데 종목·권한이 사라진
  계정」이나 고아 행을 영구히 남겼다.
- **가드 read가 그 판정으로 쓰기를 좌우하면 같은 트랜잭션에 넣고 `FOR UPDATE`로 행을 잠근다.**
  확인과 쓰기가 다른 트랜잭션이면 그 틈의 권한 변경(admin 승격 등)이 `403` 가드를 **우회**한다.
- **단일 JSONB 행을 읽기-병합-쓰기하는 경로는 프로세스 내 락으로 직렬화**한다
  (`services/storage/schedule.py::_guru_save_lock` — `guru_managers`는 id=1 단일 행이라 한 번의
  쓰기가 명부 전체를 치환한다). 겹치는 호출자를 셀 것: 수동 크롤은 `BackgroundTasks` 스레드,
  자동 크롤은 APScheduler 스레드이고 **자동 경로는 라우터의 409 가드를 보지 않는다.**
  ⚠️ 락은 **프로세스 내** 상호배제다 — 현재 배선(`uvicorn main:app`, 워커 1)에서만 전체
  상호배제이고 `--workers N`으로 가면 **DB advisory lock**이 필요해진다.
- ⚠️ **커넥션 모델 자체(호출당 커넥션)는 바꾸지 않는다** — 소비처가 전면적이라 범위가
  통제 불가로 커진다. 원자성이 필요한 자리에서 `get_connection()`으로 감싸는 것이 정석이다.
- **동시성 축의 회귀 테스트는 `threading.Barrier`로 강제 인터리빙**해 재현한다
  (`backend/tests/test_concurrency_locks.py`). 「운 좋게 안 겹쳤다」로 통과하는 축은 이빨이 없다.

**동시성 — 프로세스 내 공유 상태 (락 규율, task#330)**

- **락은 dict·리스트 조작 구간만 감싼다. 느린 `loader()`는 락 밖에서 돈다** — 대시보드 loader는
  카드당 10-워커 ThreadPool을 쓰는 수 초짜리 작업이라 락 안에 넣으면 다른 사용자의 조회와
  `invalidate()`가 그만큼 막힌다(`services/cache.py::TTLCache`).
- **그 대가는 세대 카운터로 되받는다** — loader 실행 중 들어온 `invalidate()`를 감지해 적재를
  건너뛴다. 무효화가 조용히 no-op이 되는 것은 **stale 값을 되살리는 정합 결함**이다.
- **만료 정리는 in-place 삭제**(`del`)로 한다. `self._store = {…}` **재바인딩은 금지** —
  그 창에 실행된 `invalidate(key)`가 버려질 dict에 적용돼 유실된다.
- **락은 다른 락을 잡은 채 획득하지 않는다**(중첩 0 → 데드락 불가). `cache.invalidate(ticker)`도
  `_snap_lock`을 놓은 뒤에 파생 캐시를 무효화한다.
- **진행상태처럼 「이미 실행 중」을 거부하는 상태는 회수 경로를 함께 둔다** —
  `ProgressTracker.try_start`는 무활동 상한(`_STALE_AFTER`)을 넘긴 `running=True`를 고착으로
  보고 회수한다. 판정은 경과시간이 아니라 **무활동 시간**이라 오래 걸리는 정상 작업은 영향받지
  않는다(⑷ 대조군). 회수 경로가 없으면 백그라운드가 시작조차 못 한 호출자가 **프로세스 재시작
  전까지 영구 409**가 된다.

**스키마 변경 (ADR-0006)**

신규 컬럼·테이블은 **`backend/app_schema.sql`과 `backend/main.py`의 `_migrate()` 두 곳에 쌍으로**
넣는다. 스키마 파일은 신규 설치용이고 **라이브 DB는 기동 idempotent 마이그레이션만 탄다** —
한쪽만 고치면 배포 직후 그 컬럼을 쓰는 SQL이 깨진다.

`_migrate()` 형태: DDL마다 개별 `try/except` + `logger.warning("[Migrate] … 실패: {e}")`,
DDL은 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF NOT EXISTS` /
`CREATE INDEX IF NOT EXISTS`만. 이미 `CREATE TABLE`을 지난 라이브 테이블에 컬럼을 더할 땐
**ALTER를 따로** 넣어야 반영된다(`tech_reports`의 `key_points`·`milestones`가 그 주석과 함께 있다).

인증 스키마는 `backend/auth_schema.sql`을 `app_schema.sql`보다 **먼저** 실행한다.

---

## §8 배치·스케줄러 규약

**레지스트리 = `backend/services/batch_registry.py`의 `BATCHES`** — 현재 **33개** 배치의 정적
메타데이터 리스트.

각 항목 키: `id` · `label` · `category` · `schedule_desc` · `usage`(소비 UI) · `source`(fetch 출처) ·
`editable` · `trigger_kinds` · `manual_endpoint` · `scheduler_job_id` · `timezone` ·
`misfire_grace_time` · `market`(`KR`/`US`/`공통`, 출처국 기준 — ADR-0013) · `default_schedule`.

**규약:**

- `id`는 **스케줄러 잡 id 및 `services/job_runs.record(id, …)` 호출 id와 반드시 일치**한다.
- **fetch 소스를 바꾸면 `source`도 같은 변경에서 갱신**한다(DoD). `GET /api/batches`가 그대로
  노출하므로 안 고치면 현황 카드가 stale 출처를 보인다. `usage`와 방향이 반대임에 주의(§1.5).
- **id를 은퇴시키면 그 id를 쓰는 모든 표면을 전수 grep**한다 — ① 스케줄 소비처 ② 표시 문자열
  (`schedule_desc`) ③ **`job_runs.record` 모든 lane(auto·manual·backfill)** ④ 그 id를 단언하는 테스트.
  한 곳이라도 옛 id면 배치 현황 실행이력에서 조용히 사라진다.
  단 **옛 id를 읽는 시드 마이그레이션은 정당한 잔존**이다("잔존 0"은 stale *소비* 기준).
- **id를 추가할 때도** count/set 하드코딩 단언을 전수 확인한다 — 현재 **4파일 9지점**이 `33`과
  id 집합·시장별 개수를 박고 있다. 지점 목록과 각 형태(그리고 옛 탐지 grep이 그중 4지점을
  **원리적으로 못 보는** 이유)는 `TESTING.md §5.6`에 표로 있다. **게이트는 grep이 아니라 전체
  스위트**이고 grep은 "어느 파일을 볼지"만 좁힌다.

**스케줄러 패키지 = `backend/scheduler/`**(단일 파일 아님)

| 모듈 | 역할 |
|---|---|
| `__init__.py` | 심볼 배선 + `start()`/`stop()`/`reload(job_id)` |
| `jobs.py` | 잡 함수 전체 + `_JOB_FUNCS` 매핑 |
| `schedule.py` | `_build_trigger`·`_reschedule_job`·`_seed_batch_schedules`·누락복구(`_check_missed_report`) |
| `_state.py` | 공유 `_scheduler` 인스턴스·상수(leaf 모듈 — 부분초기화 순환 회피) |

`start()`는 `_seed_batch_schedules()` → `editable` 배치 재스케줄 → `_check_missed_report()` →
`_seed_*_if_empty()` 3종 → `_scheduler.start()` 순.

**실행 계측 = `backend/services/job_runs.py`의 `record(job_id, trigger)` 컨텍스트매니저**

```python
with job_runs.record("daily_report_kr", "auto") as run:
    ...
    run.set_status("partial", err)   # 선택 — 미지정이면 success
```

- yield 값은 `Run` 핸들(`run_id`·`status`·`error`, `set_status`)이다. 상태 어휘:
  `running` | `success` | `partial` | `skipped` | `failed`.
- **본문이 예외를 전파하면 `failed`가 지정 상태를 이긴다.**
- ⚠️ **예외를 삼키고 정상 종료하는 잡은 부분/전체 실패여도 `success`로 기록된다** —
  `record`의 docstring이 그런 잡을 이름으로 나열해 둔다(`_refresh_monthly_kr`·
  `_refresh_macro_signals`·`_fetch_leverage`·`_fetch_lending`·`_run_digest`·
  `_fetch_investor_trend` + 워커 `report._run_*`·`leverage_service.backfill_with_progress`).
  그 잡들의 success를 "내부 오류 없음"으로 읽지 말 것.
- **`set_status` 배선은 2경로 예외에서 지배형으로 뒤집혔다** — 현재 `with … as run:` 형태가
  **25곳**이고 `set_status` 호출은 **41곳**이다. 배선된 계열: 구루 크롤 · 창업신청 · 고용조사 ·
  절사평균물가 · FRED 경제지표 · 환율 · 발굴추천 · 랭킹 · 코스피신호 · US 섹터 모멘텀 —
  **각 계열이 auto(`scheduler/jobs.py`)와 manual(`routers/…`) 두 레인 모두** 배선돼 있다
  (한 레인만 하면 수동 갱신이 계속 초록이다). 새 배치의 템플릿은 이 계열 중에서 고를 것.
- ⚠️ **아직 부채인 형태 — `_refresh_earnings_kr`/`_us`는 예외만 배선돼 있다.**
  본문의 저장 생략 4경로(고정집합 불완전·rest 유니버스 공백·rest 커버리지 미달·마감분기 없음)는
  직전 저장값을 그대로 반환하므로 **반환값으로 구별할 수 없고**, 그 절반은 여전히 `success`다.
  `record` docstring이 이 예외를 이름으로 적어 두는 것 자체가 부채 목록 역할을 한다.
- 상태를 반환값에 실을 때는 **`_mc_save` *뒤에* 새 dict로** 붙인다(`{**merged, "_status": …}`).
  `merged`를 mutate하면 저장 캐시가 오염된다. 그리고 read 엔드포인트가 그 키를 응답에 흘리지
  않는지 테스트로 못박는다(`test_batch_observability.py::test_get_econ_indicators_never_leaks_status_key`).
- job_id별 최근 **20건**만 보관(enter 시 prune).

**시각·타임존**

- KR 시장-날짜 판정은 `backend/services/utils.py`의 `today_kst()`
  (`datetime.now(ZoneInfo("Asia/Seoul")).date()`). 컨테이너에 TZ env가 없어 bare `date.today()`는
  UTC라 00:00~09:00 KST에 하루 어긋난다.
- **bare `.today()` 호출은 `backend/tests/test_no_bare_today.py`가 ast로 금지**한다(앱 코드 전체).
- 모듈 상수 `_KST = ZoneInfo("Asia/Seoul")` 패턴도 병용(`services/market_indicators/kospi_signal.py`).

**요청경로 vs 배치경로**

배치-백킹 뷰(랭킹·KR/US 업종 모멘텀 등)는 **배치가 사전계산해 저장하고 요청은 저장값만 읽는다.**
요청·기동 경로에서 외부 API를 N콜 직렬 호출하지 않는다.
기동 시 빈 캐시는 `_seed_*_if_empty` 패턴으로 채운다.

반면 vix·commodities·indices는 **요청경로 증분**(TTL캐시 → `_mc_load` → 라이브 fetch →
`_mc_save`)이라 스케줄 배치가 없다 — `batch_registry`에도 없다.
⚠️ **fx는 2026-08 이후 예외다** — 요청경로 증분을 유지하면서 `fx_fetch` 배치(매일 06:40 KST)를
함께 갖는다. 소비자가 시장지표 탭 밖에도 있고(`routers/stocks.py::_usdkrw_rate` ·
`services/digest_service.py`) 그쪽은 나이 검사 없는 raw `_mc_load("fx")`라, 배치가 없으면
아무도 탭을 안 열 때 포트폴리오 KRW 환산이 무기한 stale해진다.

⚠️ `services/market_indicators/cache.py`의 `get_or_refresh(key, fetch_fn, ttl)`에서 **`ttl`은
저장값에 걸리지 않는다** — `_mc_load`가 행을 주면 나이 불문 그대로 반환하고 `ttl`은 인메모리
캐시 수명만 지배한다. 즉 한 번 `market_cache`에 저장되면 `force=True`가 올 때까지 영구 서빙이다.
"TTL 만료 → 요청 경로가 재조회한다"를 전제로 설계·심각도를 판단하지 말 것.

---

## §9 프론트엔드 규약

React 19 + Vite 8(rolldown) + react-router-dom 7 + recharts 3 + axios. **plain CSS**
(TailwindCSS·CSS-in-JS 없음). TypeScript 아님(`.js`/`.jsx`).

### 9.1 파일·명명

```
frontend/src/
  api.js               axios 인스턴스(인터셉터 2개)
  apiCachePurge.js     SW 런타임 캐시 퍼지 (ADR-0036 — 인증 API는 캐시하지 않는다)
  App.jsx              라우팅 + 셸(Masthead·MobileNav·Toast·InstallPrompt·DiagLog)
  navSections.js       nav IA 단일 소스 (§9.5)
  routes.js            구 URL 리다이렉트 맵(REDIRECTS, ADR-0025)
  routes/              라우트 래퍼 컴포넌트(현재 AnalystReportsRoute.jsx 1개)
                       ⚠️ `routes.js`(리다이렉트 맵)와 **이름이 한 글자 차이**다 — 다른 것이다
  utils.js             표시 포매터 정본 (ADR-0031)
  themeBoot.js         index.html 인라인 사본의 정본 (twin 테스트로 동일성 강제)
  oauthSplash.js       index.html 스플래시 사본의 정본 (동일)
  pages/               라우트 단위 화면 (PascalCase.jsx)
  components/          ui/ · market/ · reports/ · tech/ · portfolio/ · recommendations/ · sketches/
  hooks/               use*.js (현재 18개 — 신규 useActiveChapter · useTechIndex)
  contexts/            AuthContext.jsx
  utils/               analytics · diag · guruName · marketHours · oauthHistory · priceFlash · pwa
  glossary/            terms.js + match.js
  styles/              tokens.css · pc.css · mobile.css · guru.css · motion.css
  test/                교차관심사 테스트 (`TESTING.md §2`)
```

- 컴포넌트 전용 CSS는 **컴포넌트 옆에 콜로케이트**하고 컴포넌트가 직접 `import './X.css'`한다
  (`ui/Badge.css`, `portfolio/DashboardCard.css`, `tech/TechKpiStrip.css`).
  화면 전역 스타일만 `styles/`에 둔다.
- `components/ui/index.js`가 프리미티브 배럴을 제공한다(`Button`·`Card`/`CardHeader`·`Badge`/
  `MarketBadge`/`ChangeBadge`·`Stat` + `icons` 전량 re-export).

### 9.2 스타일·디자인 토큰

- `frontend/src/index.css`가 `styles/tokens.css` → `pc.css` → `mobile.css` → `guru.css` 순으로
  import한다. `App.css`는 `App.jsx`가 따로 import.
- **토큰 정본은 `styles/tokens.css`** — 에디토리얼 아이덴티티(ADR-0026). light가 기본 테마,
  dark는 warm night-print 변형. 토큰군: 폰트(`--font-sans/-mono/-serif`)·타이포 스케일 ·
  배경/표면(`--bg`·`--bg-elev`·`--bg-elev-2`·`--surface-hover`) · 텍스트(`--text`·`--text-2`·`--text-3`) ·
  악센트 · 반경 · 그림자.
- **KR 색 관례가 의미색과 분리돼 있다:**

  | 축 | 토큰 | 컴포넌트 변형 |
  |---|---|---|
  | 가격 방향 | `--up`(#b3372b 버밀리온) / `--down`(#2b5c9e 프러시안) | `.badge--up` / `.badge--down`, `.stat__value--up` / `--down` |
  | 의미 상태 | `--color-success` / `--color-error`(=`--color-danger`) / `--warn` / `--color-info` | `.badge--success` / `--danger` / `--warning` / `--info` |

  `ui/Badge.jsx`의 `ChangeBadge`가 `value >= 0 ? 'up' : 'down'`을 고르며 주석으로 못박는다 —
  **의미색(success/danger)과 교차 사용 금지.**
  ⚠️ 공용 배지 variant의 색 의미를 바꿀 땐 **소비처 전수 grep 선행**(vitest·빌드는 색 의미에 블라인드).
- 클래스 명명은 **BEM 유사** — 블록 `badge`/`stat`, 요소 `stat__label`·`badge__icon`,
  변형 `badge--success`·`stat--md`.
- ⚠️ **variant 클래스를 문자열로 조립하는 컴포넌트는 오타가 조용히 무색이 된다.**
  `ui/Stat.jsx`가 `stat__value--${valueColor}`를 만드는데 `Stat.css`엔 `--up`/`--down`만 있다 —
  CSS에 없는 값을 넘기면 클래스만 붙고 **아무도 죽지 않는다**. variant 이름을 바꿀 땐 CSS 규칙과
  소비처를 같은 커밋에서 대조할 것(§9.7 ⑪).
- 일회성 레이아웃은 `style={{ … }}` 인라인을 쓴다(`App.jsx`의 헤더 flex 등). 재사용되면 CSS로 승격.
- ⚠️ **조건부 인라인 스타일에서 `undefined`는 「미지정」이 아니다** — 객체 스프레드는 **키 존재만으로**
  덮으므로 `{...base, opacity: busy ? 0.6 : undefined}`가 `base.opacity`를 지운다(React는 `undefined`를
  빈 문자열로 적용한다). 값이 없으면 **키 자체를 넣지 말 것**(`...(busy ? { opacity: 0.6 } : {})`).
  이 형태로 「모름」 배지의 흐림(`opacity: 0.5`)이 조용히 사라진 전례가 있다(task#331).

### 9.3 데이터 fetch

- **`frontend/src/api.js`의 axios 인스턴스가 정본.** `baseURL = import.meta.env.VITE_API_BASE_URL || ''`
  (미설정 시 상대경로 → nginx/Vite proxy).
- 요청 인터셉터: `localStorage.access_token` → `Authorization: Bearer`.
- 응답 인터셉터: **401이면 토큰 2종 제거 + `window.location.replace('/')`**.
  `replace`인 이유가 주석에 있다 — 만료 시점 딥링크 엔트리를 히스토리에 남기지 않아
  재로그인 후 뒤로가기 재진입을 차단한다.
- 로그아웃만 `fetch`를 직접 쓴다(`App.jsx`의 `doLogout`, `.catch(() => {})`로 best-effort).
- **fetch는 훅이 소유하고 컴포넌트는 소비한다** — `useTrackedStocks`·`usePortfolioData`·
  `useReportList`·`useReportGeneration` 등. 실패는 `console.warn` + 토스트(§4.5).

### 9.4 훅·컨텍스트

- 컨텍스트 2개 — `contexts/AuthContext.jsx`(세션·메뉴 권한), `components/Toast.jsx`
  (`ToastProvider` + `useToast`).
- **레이스 가드 관용구**(`hooks/useTrackedStocks.js`가 전형):
  - `reloadGenRef` **세대 번호** — 호출마다 `++`, 응답은 자기 세대가 최신일 때만 상태 반영.
    ⚠️ `.then`뿐 아니라 **`.finally`도 게이트**해야 낡은 응답이 로딩 플래그를 열지 않는다.
    ⚠️ 그 게이트의 회귀 축은 **새 요청을 in-flight로 붙잡은 채** 낡은 응답을 착지시켜야 이빨이 생긴다 —
    새 요청을 먼저 해소하는 픽스처는 두 `.finally`가 같은 값을 써서 관측 차이가 **원리적으로** 안 생긴다
    (그 순서에서는 게이트를 지워도 전 축이 초록이었다, task#331).
  - `pendingRef`(Set) **같은 틱 중복 클릭 가드** — state는 리렌더 후에야 반영돼 못 막는다.
  - ⚠️ **뮤텍스(`if (loadingRef.current) return`)는 레이스 가드가 아니다** — 리셋 호출을
    no-op시켜 오히려 옛 응답이 화면을 소유하게 만든다. reset은 뮤텍스를 우회하고 세대를 올려야 한다.
  - ⚠️ **세대 가드는 「늦은 착지」만 막고 「보존」은 막지 않는다** — 옛 데이터가 *이미* 착지한 뒤
    식별자(prop)만 갈리면 경합 없이 **결정적으로** 옛 데이터가 새 화면을 소유한다. 식별자 변경 시
    상태를 **`null`(미조회)로 되돌리는** 것이 쌍으로 필요하다(`[]`로 되돌리면 「0건」이라는 거짓
    진술이 된다 — 아래 3상태 규율).
  - ⚠️ **뮤텍스·`pending`은 호출부에 노출돼야 가드다** — 삼킨 클릭을 화면이 알리지 않으면
    (배지 비활성화·`aria-busy` 없음 + `onClick`이 반환값을 버림) 사용자에겐 **무음 미동작**이다.
    같은 티커가 여러 카드에 등장하는 화면은 **티커 단위로 잠그고 그 상태를 그 티커의 모든 배지**에
    반영할 것(task#331 B58).
- **"모름"을 1급 상태로 둔다** — `useTrackedStocks`는 보유/관심/미추적 외에 `unknown`을 별도로
  들고, 모름이면 액션을 제시하지 않는다(`wrong < missing`의 어포던스 판).
  **조회 성공 + 빈 결과는 미추적이지 모름이 아니다.**
- **목록을 채우는 훅은 3상태를 구별해 반환한다 — 미조회 · 0건 · 실패.**
  실패를 `[]`로 붕괴시키면 소비처가 「없습니다」라는 **거짓 진술**을 렌더한다(사용자는 그것을
  투자 판단에 쓰는 *사실*로 읽는다). `ready`(로딩 여부) 하나로는 부족하다 — 빈 배열의 의미가
  셋이기 때문이다. 정본 형태는 `frontend/src/hooks/useTechIndex.js`다:

  | 상태 | fetcher 반환 | 훅 반환 | 소비처 |
  |---|---|---|---|
  | 미조회 | — | `ready=false` | 아무것도 안 그린다 |
  | 0건(조회 성공) | `[]` | `ready=true`·`failed=false` | 빈 상태 안내를 그린다(사실이다) |
  | 실패 | **`null`**(≠ `[]`) | `ready=true`·**`failed=true`** | **카드 자체를 숨긴다**(단정문을 내지 않는다) |

  즉 **구별은 fetcher가 `null`/`[]`로 만들고, 훅이 그것을 `failed` 불리언으로 번역**한다
  (훅의 `index`는 소비처 편의상 항상 배열이다 — 그래서 `failed`가 없으면 구별이 사라진다).
  ⚠️ **실패는 캐시하지 않는다** — 다음 마운트가 재시도할 수 있어야 한다(성공만 모듈 캐시에 담고,
  동시 마운트는 `_inflight` promise를 공유한다).
  ⚠️ **자동 게이트가 이 클래스에 원리적으로 블라인드하다**(타입도 맞고 렌더도 정상이다) →
  실패 경로를 테스트로 못박는다(`frontend/src/test/failure-vs-empty.test.jsx`).
- 토글 성공 후 재조회가 실패해도 `trusted` ref로 `unknown` 복귀를 막는다 — 방금 사용자가 한
  행동의 결과를 화면에서 잃지 않기 위함.
- 실패는 **re-throw하지 않고 토스트 + `false` 반환**(호출부 계약).

### 9.5 라우팅 — nav IA는 `navSections.js` 단일 소스

`frontend/src/navSections.js`가 5섹션(`research`·`portfolio`·`market`·`schedule`·`guru`)의
경로·라벨 데이터와 매칭 헬퍼(`matchesItem`·`matchesSection`·`sectionByKey`)를 export한다.

- **소비처 3곳이 파생한다** — `components/Masthead.jsx`(PC 카테고리+서브바),
  `components/MobileNav.jsx`(모바일 하단 탭바), `pages/ResearchShell.jsx`(모바일 seg).
  탭 추가·개명·삭제는 **`navSections.js` 한 곳만** 고친다.
- 아이콘 셋이 소비처마다 다르므로(`sketches` vs `ui/icons`) 공유 모듈엔 **순수 경로·라벨만** 둔다.
- 매칭은 **접두사**(`pathname.startsWith(item.match ?? item.to)`). `match`는 `to`와 다를 때만 단다 —
  `/analyst-report`(단수) 하나가 목록 `/analyst-reports`와 상세를 함께 덮는 것이 **의도**다
  (상세에서 부모 탭을 강조하는 게 앱 관례, `/guru/:id`와 동일).
  천장: 형제 항목끼리 접두사 관계가 생기면 그때 세그먼트 경계 매칭으로 올린다.
- 구 URL은 `frontend/src/routes.js`의 `REDIRECTS`(ADR-0025)로 처리하고 `App.jsx`와 회귀 테스트가 공유.
- 회귀 가드: `frontend/src/test/nav-active-matching.test.jsx`(3소비처 × 목록·상세).

### 9.6 차트 (recharts)

- 수익/수출 계열(`components/market/M7EarningsSection.jsx`·`KrTop2Section.jsx`·`KrExportsSection.jsx`)은
  **dual Y-axis** — 좌 `yAxisId="left"`(금액), 우 `yAxisId="right"`(비중 %).
- 축소 포맷은 `frontend/src/utils.js`의 `fmt*` 사용 — **입력 단위 확인 필수**
  (`fmtEokWon`은 억원 입력, 원 단위를 그대로 넘기면 1e8배 오표기).
- `index.css`가 `.recharts-wrapper`/`.recharts-surface`의 `outline`·tap-highlight를 제거한다.
- 청크: `vite.config.js`의 `manualChunks(id)`가 `recharts`/`/d3-`/`victory-vendor`를 `charts`로 분리.
  ⚠️ **Vite 8(rolldown)은 `manualChunks`를 함수로만 받는다**(객체형은 빌드 실패).
- ⚠️ **jsdom에서 recharts는 렌더되지 않는다**(`ResponsiveContainer` 0크기) → 단위 테스트의 관측점은
  SVG가 아니라 **캡션·testid·주변 DOM**이다(`TESTING.md §6`). 시각 속성은 라이브 프로브 몫.
- 퍼센트를 폭으로 쓰는 비율 막대(`components/tech/MarketEstimates.jsx` 계열)는 **트랙 폭이 행마다
  같아야** 의미가 성립한다 — 값·배지 같은 비축약 요소의 폭을 행 전체에서 예약하고(`max(len)ch`),
  숨김은 `visibility: hidden`으로(`display: none`이면 박스가 사라져 원인이 재발).

### 9.7 레이아웃·시각은 추정하지 않는다 — 6개의 독립 판정축

레이아웃 수치는 **실측**한다(`getBoundingClientRect()`). `minmax`·열 수·폭 임계값을 정하는
변경은 배포 전 실측 1회를 근거로 삼는다 — flex 형제가 먹는 폭을 놓쳐 295px로 추정한 가용폭이
실제 237px이었던 전례가 있다.

**아래 6축은 서로 독립이다 — 하나가 통과해도 나머지는 아무 말도 하지 않는다:**

| 축 | 결함 형태 | 계측 |
|---|---|---|
| ① 넘침 | 자식이 컨테이너를 벗어남 | `getBoundingClientRect()` 교차 |
| ② 잘림 | `text-overflow: ellipsis`가 **박스 안에서** 내용을 지움 | `scrollWidth > clientWidth` — **텍스트 leaf**와 **`overflow:hidden` 컨테이너** 두 계열 |
| ③ 접힘 | flex 압축으로 텍스트가 **박스 안에서** 여러 줄이 됨 | 실제 렌더 줄 수 = 서로 다른 `top` 값의 개수 |
| ④ 간격 | 박스는 정상인데 **요소 *간* 거리**가 의미를 왜곡 | 쌍 간 `left − right` 임계 |
| ⑤ 색 | 클래스는 붙었는데 CSS 규칙이 없어 색이 사라짐 | 라이브 `getComputedStyle(el).color` |
| ⑥ 좌표계 | SVG `viewBox` 좌표는 맞는데 화면 픽셀이 읽을 수 없이 작음 | `getBoundingClientRect().height ≥ 10px` |

구현 쪽 짝:

- **ellipsis는 문자열 *끝*을 먹는다** → 줄어도 되는 것(이름)만 ellipsis 상자에 넣고, 줄면 안 되는
  것(수치·배지)은 `flex-shrink: 0` 형제로 고정한다. **한국어 자유 서술 필드(event·note·title)는
  자르지 않는다** — 한국어는 술어가 끝에 와서 잘리면 "무슨 일이 일어났는가"가 먼저 사라진다.
  **목록·카드도 예외가 아니다** — 이 금지를 상세 화면에만 적어 둔 사이 주요기술 **목록** 카드가
  같은 `title`을 한 줄 ellipsis로 자르고 있었다(task#331 B54). 자르지 않기의 구현 쌍은
  `word-break: keep-all` + `overflow-wrap: break-word`이고, 안전망을 `anywhere`로 쓰면 안 되는
  이유와 그 반례(`components/tech/PlayerTable.jsx`)는 `frontend/CLAUDE.md`에 있다.
- 접힘 방지는 **`flex-wrap: wrap`(컨테이너) + `white-space: nowrap`(자식)** 조합.
- **정렬을 `margin-left:auto`·`space-between` 같은 "남는 공간"에 맡기지 않는다** —
  같은 규칙이 310px에선 "우측 정렬"이고 1400px에선 "1,000px 유기"가 된다.
  인접해야 할 쌍은 `gap`으로 직접 묶는다.
- **넓은 다이어그램은 축소하지 말고** `minWidth`로 설계 크기를 지키고 자체 `overflow-x: auto`
  스크롤러에 담는다(페이지 본문은 가로 스크롤하지 않는다).
- **열 수를 건드리는 변경은 양쪽 뷰포트가 반대로 움직인다** — 모바일에서 열을 줄이면 PC에서
  카드가 넓어져 밀도가 내려간다. PC/모바일을 같이 캡처할 것.

**검증 방법·프로브 규약은 `TESTING.md §7`·`§9`.** vitest·빌드는 이 6축 전부에 블라인드하다.
**육안으로 잡은 결함은 반드시 축으로 승격**시켜 다음번엔 프로브가 잡게 한다.

### 9.8 Lint

`frontend/eslint.config.js`(flat config) — `js.configs.recommended` +
`eslint-plugin-react-hooks` flat recommended + `eslint-plugin-react-refresh` vite 프리셋.
`globalIgnores(['dist'])`, 브라우저 globals, JSX 파서 옵션. 실행은 `npm run lint`.

**커스텀 규칙 없음** — `no-console`도 없고(§4.5), 테스트 파일 전용 설정도 없다.
백엔드에는 린터·포매터가 없다(black/ruff/flake8 미도입).

### 9.9 i18n·접근성

- **i18n 라이브러리 없음.** UI 문자열은 한국어 리터럴로 JSX에 직접 박는다.
  숫자·통화는 `toLocaleString('ko-KR'|'en-US')`로 시장별 분기(`utils.js`의 `fmtPrice`).
- PWA 매니페스트 `lang: 'ko'`(`vite.config.js`).
- 접근성:
  - 장식용 이미지·아이콘은 `alt=""`.
  - ⚠️ **SVG에 `role="img"`를 걸면 자손 `<text>`가 접근성 트리에서 통째로 프루닝된다**
    (ARIA leaf role). 데이터를 SVG로 그리는 컴포넌트는 `role="list"` + 항목 `aria-label`을 쓰거나
    시각적으로 숨긴 `<ul>`을 병행한다.
  - **접기는 네이티브 `<details>`로** — JS 상태로 접으면 닫힌 본문이 DOM에서 사라져
    Ctrl+F·스크린리더가 못 찾는다.
  - 자동 접근성 가드는 없다(axe 등 미도입).

---

## §10 문서 동기 의무 (코드 변경에 딸린 DoD)

| 변경 | 함께 고칠 문서 | 강제 |
|---|---|---|
| 엔드포인트 추가/삭제/개명 | `API_SPEC.md`(전 엔드포인트) | `backend/tests/test_api_doc_sync.py`(존재 drift 자동검출) |
| Cowork enrich/backlog 워크플로우 관련 엔드포인트 | + `CLAUDE_COWORK_API.md` | 부분 자동(stale만) |
| 요청/응답 스키마·인증 게이팅 | 위 문서의 산문 | **수동** — 테스트는 존재만 본다 |
| 기능 표면(화면 구성·env·스택·아키텍처·배치) | `README.md`의 해당 절 | 수동 |
| 비가역 결정 | `.forge/adr/NNNN-*.md` | 수동 |
| 도메인 용어 | `.forge/CONTEXT.md` | 수동 |
| 소스 줄 수 변경 | `.forge/codebase/*.md`의 줄번호 참조 | 수동 (아래 감사 2패턴) |

**"2문서 모두"는 Cowork 관련 엔드포인트에 한한다** — `CLAUDE_COWORK_API.md`는 외부 Cowork
전용 스코프라 사용자 대면 read 엔드포인트는 `API_SPEC.md`에만 넣는다.

**인증 게이팅을 바꾸는 변경은 착수 시 `grep -n '불필요' API_SPEC.md`를 먼저 돌린다.**
⚠️ **패턴을 좁히지 말 것** — `**Auth:** 불필요`(콜론 독립 줄)로 좁히면 문장 중간형
`**Auth 불필요.**`를 원리적으로 볼 수 없고, 그 형태가 같은 섹션 안에서
`**Auth:** Bearer token 필요`와 문자 그대로 모순인 채 생존한 전례가 있다.
남아도 되는 `불필요`는 `routers/auth.py`의 공개 엔드포인트뿐이다(ADR-0029).

**문서 슬라이스에 착수하면 고칠 필드만 보지 말고 그 절 전체를 실응답과 한 번 대조**한다 —
"필드 N개 추가"로 범위를 잡으면 그 절이 *이미* 두 세대 뒤처져 있는지는 안 보이고,
`test_api_doc_sync.py`는 응답 스키마 drift에 원리적으로 블라인드다.

⚠️ **줄번호 참조 보정 시 산술 추정 금지** — 시프트는 부위별로 다르다(같은 파일에서 +2와 +4가
공존). `git show HEAD:<file>`로 옛 줄을 읽어 **의미로** 확정할 것. 그리고 **선재 drift**
(내 변경과 무관하게 이미 어긋난 참조)와 시프트는 별개 축이니, 전자에 시프트를 적용하면
오차가 세탁된다 — 선재 drift는 건수만 보고하고 `fg-map` 재생성으로 처리한다.

**현재 `.forge/codebase/*.md`는 줄번호 포인터를 0건 쓴다**(맵 전체 Refresh 이후 `파일::심볼`과
`§N` 앵커로만 가리킨다 — 심볼·섹션 앵커는 줄 수 변화에 면역이라 이 결함 클래스가 구조적으로
없다). 그러므로 이 감사는 **계속 돌리되 0건이 정상 기대값**이고, 맵을 재생성할 때 줄번호
포인터를 되살리지 않는다. 감사는 **두 패턴을 함께** 돌린다 — 한쪽만 보면 나머지 형태에 블라인드다:

```
grep -n  '<파일명>:[0-9]'                       .forge/codebase/*.md   # 파일명:NNN 형태
grep -oE '[^0-9a-zA-Z_]:[0-9]+'                 .forge/codebase/*.md   # bare :NNN·(:NNN) 형태
```

⚠️ **감사 baseline은 「0이면 통과」가 아니라 「HEAD와 같으면 통과」로 쓴다** — 전자는 *내가 무엇을
늘렸는지*를 드러내지 못한다. 실사례: 문서에 새 행을 쓰며 좁은 형태 7건을 만들어 잡혔는데,
고친 뒤 그 grep은 0을 냈지만 **bare `:NNN` 6건이 남아 있었고 그 형태는 같은 이유로 드리프트하는데
그 패턴이 원리적으로 못 본다**(둘 다 HEAD 기준 0이었음을 `git show`로 재확인해야 판정이 성립했다).

---

## §11 규약을 강제하는 자동 가드 (요약)

| 가드 | 위치 | 무엇을 막나 |
|---|---|---|
| zero-print | `backend/tests/test_no_print.py` | 앱 코드 `print(` (§4.1) |
| bare today | `backend/tests/test_no_bare_today.py` | `date.today()`/`datetime.today()` (§8) |
| 무인증 엔드포인트 | `backend/tests/test_no_public_reads.py` | ADR-0029 위반 (§6) — 양방향 exact-match |
| API 문서 drift | `backend/tests/test_api_doc_sync.py` | 엔드포인트 *존재* 불일치 (§10) |
| 라우트 열거 비공허 | `test_no_public_reads.py::test_route_walk_is_not_silently_empty` | FastAPI 버전차로 0개를 세며 통과 (§3.3) |
| 라우트 평탄화 헬퍼 | `backend/tests/_routes.py` `walk_routes` | 위 두 테스트의 공통 기반 |
| 실 DB 접근 | `backend/tests/conftest.py` `_block_real_db` | 테스트가 prod DB에 쓰는 사고 |
| 배치 레지스트리 | `test_batch_market_split.py` · `test_batches_router.py` · `test_macro_signals_batch.py` · `test_scheduler_seed.py` | 배치 추가/은퇴 시 count·id 집합·시장별 개수 (§8, 4파일 9지점) |
| 메뉴 권한 키 4소스 | `backend/tests/test_all_menus_single_source.py` | `ALL_MENUS`(auth·admin·PermissionPanel)+스키마 시드 드리프트 (§1.6) |
| analytics 이벤트명 | `backend/tests/test_valid_events_matches_frontend.py` | 프론트 발신 ↔ `VALID_EVENTS` 불일치(요청은 200으로 성공) (§1.6) |
| 가드 baseline 무결성 | `backend/tests/test_guard_baseline_integrity.py` | 가드가 baseline 조회 실패로 fail-open되는 것 (§1.3 — 7계열 × 대조군 쌍) |
| 동시성 lost update·락 | `backend/tests/test_concurrency_locks.py` · `test_progress_per_user.py` · `test_user_delete_atomic.py` | 읽기-계산-쓰기 틈·단일 JSONB 행 치환·다문장 트랜잭션 (§7, `threading.Barrier` 강제 인터리빙) |
| nav 활성 매칭 | `frontend/src/test/nav-active-matching.test.jsx` | 3소비처 × 목록·상세 (§9.5) |
| 쌍둥이 사본 동일성 | `frontend/src/test/theme-boot-twin.test.js` · `oauth-splash-twin.test.js` | `index.html` 인라인 사본 ↔ 모듈 정본 drift |
| ADR-0029 감사 스크립트 | `scripts/audit_unauth_endpoints.py` | 라이브 배선 기준 무인증 열거(종료코드 0/1) |
| 라이브 프로브 회귀 래칫 | `scripts/check-uat311-ratchet.sh` + `scripts/uat311-baseline-tags.txt` | 시각 프로브의 FAIL 0 · 단언 총계 하한 · **baseline 축 태그 생존** (`TESTING.md §10 ⑦`) |

**자동 가드가 없는 규약**(리뷰·관례 의존): 로그 마커 스펠링(§4.3) · 프론트 `console.*` 마커(§4.5) ·
`source`/`usage` 갱신(§8) · API 문서의 **스키마·인증 산문**(§10) · README 동기(§10) ·
레이아웃·색·간격·접근성(§9.7·§9.9 — 라이브 프로브가 유일한 계층, `TESTING.md §7`).
