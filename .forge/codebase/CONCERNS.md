---
last_mapped_commit: 20dd46eb829b05025af793b010dfe4efe2925a7d
mapped: 2026-08-10
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
| **미확인** | 이번 패스에서 코드로 확정하지 못했다. 근거 부족인지 도구 범위 밖인지 함께 적었다. |

이 판은 **HEAD `20dd46e` 시점의 코드에서 전면 재작성**했다. 직전 판(`4752112`, 07-31)을 베이스라인으로 쓰지 않았고, `CLAUDE.md`의 Gotchas 산문은 *리드 목록*으로만 썼다 — 각 항목을 코드로 재확인해 확인된 것만 실었고, 확인되지 않은 것은 §13에 "미확인"으로 분리했다.

> ⚠️ **섹션 번호를 함부로 바꾸지 말 것.** 코드 주석 8곳과 `API_SPEC.md`가 `CONCERNS §N`을 직접 인용한다. 이번 판은 대분류(§0~§14) 번호를 직전 판과 **동일하게 유지**했다. 인용 중 어느 것이 이미 stale한지는 §12.6에 실측으로 정리했다. 항목 추가는 하위번호(§N.M)로.

> 🔒 **이 문서는 git 추적 대상이다** — 실제 키·토큰·비밀번호 **값**은 쓰지 않는다. 환경변수 *이름*만 적는다.

**이번 판에서 반증된 전제 3건** (지시문·직전 판이 참으로 놓았으나 코드가 다르게 말한다):
1. `services/db.py::get_connection`은 **롤백 경로가 있다**(`except Exception: conn.rollback(); raise`). "정상 종료 시 커밋한다"는 맞지만 "롤백 전제 코드가 성립하지 않는다"는 **틀렸다** — §4.3.
2. `short_sell_service`·`investor_service`·`lending_service`·`leverage_service`는 **delete-rewrite가 아니다**(전부 append-only upsert). 빈 fetch가 이미 안전한 no-op이다 — §1.4.
3. 무인증 엔드포인트는 여전히 **정확히 9개**이고 전부 `routers/auth.py` 소속이며, `tests/test_no_public_reads.py`의 allowlist와 **양방향으로 일치**한다(드리프트 0) — §5.1.

---

## 0. 지금 열려 있는 확인된 버그

번호는 지난 매핑과 **연속**이다(해소된 것의 번호는 재사용하지 않는다). 이번 판은 아래 표의 전 항목을 `20dd46e` 코드로 **직접 재확인**했다. 직전 판에 있었으나 이번에 재검증하지 못한 항목은 §13.2에 "미확인"으로 분리했다 — 표에서 사라졌다고 해소된 것이 아니다.

> **재검증: 2026-08-11 (task#292) — 이 절과 §13.2만 갱신됨.** 9차 버그 헌트(`4325d8d..b93afce`, 56커밋/179파일, 7렌즈 + LC 판정 레인)가 확정한 **B51~B59**를 추가하고, `§13.2` 미확인 8건을 판정해 **열림으로 확정된 6건을 이 절로 이동**했다(기존 번호 복귀 `B8`·`B30` + 무번호였던 4건에 신규 번호 `B60`~`B63`). `last_mapped_commit` 프론트매터는 건드리지 않았다(재매핑이 아니다). 근거·검증방법·제안수정은 `.forge/bug-report.md`(9차) 참조.

### 데이터 손실·오염

| # | 결함 | 위치 (심볼) | 도달 조건 |
|---|---|---|---|
| **B1** | KR 랭킹 빈응답이 전 KR 행을 DELETE 후 0행 삽입 | `services/ranking_service.py::_fetch_naver_market` → `::replace_market_rankings` | Naver 200 + `totalCount:0` |
| **B40** | `_mc_load` 실패를 "저장값 없음"으로 읽어 365일 시계열을 1건으로 덮어씀 | `market_indicators/kospi_signal.py::refresh_kospi_signal` | 배치 중 DB read 1회 실패(PoolError 포함) |
| **B41** | `market_cache` 키 `fx`에 **배치가 없다** — 포트폴리오 KRW 환산 전체가 무기한 stale | `market_indicators/fx.py::get_fx` (소비: `routers/stocks.py::_usdkrw_rate`) | 아무도 시장지표 탭을 안 열면 항상 |
| B5 | 사용자 삭제가 6개 독립 트랜잭션 — 중간 실패 시 반쯤 삭제된 사용자 | `routers/admin.py::delete_user` | 루프 중 DB 오류 |
| **B60** | `_filter_outliers`가 저장 시계열을 **영구 손상** | `_filter_outliers` (§13.2에서 열림 확정, task#292) | 이상치 판정에 걸리는 입력 |
| **B61** | Naver 재무를 **위치 인덱스**로 읽는다 — 상류 표 구조가 바뀌면 조용히 다른 계정을 읽는다 | `services/market/kr.py` 재무 파싱부 (§13.2에서 열림 확정, task#292) | 상류 표 열 순서 변경 |
| B52 | `run_daily`의 KR `AVG_PRC` override가 같은 파일의 `math.isfinite` 초크포인트를 우회해 mart에 **NaN을 UPDATE** — `bool(float('nan'))==True`라 진리값 가드를 통과하고, `float("nan")`은 ValueError를 던지지 않아 `except (ValueError, KeyError)`도 못 잡는다 | `services/consensus_pipeline.py::run_daily` ← `services/market/kr.py::get_analyst_data_kr` | `TARGET_PRC`/`AVG_PRC`에 `nan`·`inf` 토큰 |
| B62 | `_table_unit`의 억원 기본값 폴백 — ×100 오저장 클래스 | `services/backlog_parser.py::_table_unit` (§13.2에서 열림 확정, task#292) | 단위 캡션 파싱 실패 |

### 무음 미동작 / 오값

| # | 결함 | 위치 (심볼) | 도달 조건 |
|---|---|---|---|
| B6 | 키 미설정 배치가 "성공"으로 기록 — `_refresh_monthly_us`는 "refreshed" 로그까지 남긴다 | `market_indicators/econ.py::_fetch_and_save_econ_indicators`, `macro.py::_fetch_and_save_macro_signals`, `scheduler/jobs.py::_refresh_monthly_us` | `FRED_API_KEY` 미설정 |
| B7 | KR 배당 기준연도가 1년 어긋남 | `services/dividends.py::_recent_business_year` | 4월 1일 00:00–09:00 KST |
| B9 | 프론트에 access token 갱신 경로가 없다 — 백엔드 `/api/auth/refresh`는 **존재하는데** 아무도 안 부른다 | `frontend/src/api.js` 응답 인터셉터 | 1시간 경과(항상) |
| B24 | `nav_analytics`가 백엔드 화이트리스트에 없어 **200 OK로 무음 폐기** | `routers/events.py::VALID_EVENTS` ← `components/Masthead.jsx`·`MobileTopActions.jsx` | admin이 '행동 분석' 진입 시 항상 |
| **B42** | `insider_trades`·`disclosures`의 DART 조회 창이 UTC 기준 — 하루 밀림 | `services/insider_trades.py::fetch_insider_trades`, `services/disclosures.py::fetch_disclosures` | 00:00–09:00 KST 실행 |
| **B43** | US 섹터 모멘텀에 부분 페이로드 백필이 없다(KR에는 있다) | `services/us_sector_service.py::refresh` | 11개 ETF 중 일부만 실패 |
| B8 | 컨센서스 `report_date`가 UTC 변환으로 하루 밀림 | `services/consensus_pipeline.py` tz 경로 (§13.2에서 열림 확정, task#292) | 00:00–09:00 KST 실행 |
| **B30** | 티커 유니버스 캐시가 **축소된** 스크레이프를 무검증 저장 | `market_indicators/earnings.py::_tickers_with_cache` ← `_scrape_kospi` (§13.2에서 열림 확정, task#292) | 스크레이프 조기종료로 부분 축소 |
| B53 | 루틴 프롬프트의 `market_outlook` 예시가 **문자열 템플릿**이라 AI가 산문으로 채우면 `segments[]`가 `None`이 되어 「사업부문 시장 분석」 섹션이 **크래시 없이 조용히 사라진다**(정본 `CLAUDE_COWORK_API.md`는 객체로 못박고, `routers/stocks.py`엔 스키마 검증이 없어 422 피드백도 없다) | `scripts/cowork-routine-prompt.md` → `services/analyst_reports.py::_market_outlook_segments` | 루틴이 프롬프트 예시 형태를 따를 때 |
| B56 | `DiagLog` 복사 폴백이 `execCommand` 반환값을 확인하지 않아 **실패해도 '복사됨'** 이 뜨고, 이중 실패는 빈 `.catch(() => {})`가 완전히 삼킨다 — 이 컴포넌트의 목적(폰에서 로그 채취)이 정확히 그 조합에서 무너진다 | `components/DiagLog.jsx::legacyCopy · copyText · handleCopy` | `execCommand`가 예외 없이 false / writeText 거절 + legacyCopy throw |
| B58 | `useTrackedStocks`의 티커별 뮤텍스가 **같은 훅 인스턴스를 공유하는 화면**에서 다른 카드의 동일 티커 2번째 클릭을 무음으로 삼킨다(`GuruStats`·`GuruAllocation`·`GuruManagers`·`GuruDetail`은 `pending`을 쓰지 않아 배지 비활성화도 없고, `onClick`이 반환값을 버려 호출부도 감지 못 한다) | `hooks/useTrackedStocks.js::toggle` ← `pages/GuruManagers.jsx` | 같은 티커가 여러 매니저 top10에 동시 등장 + 연속 클릭 |

### 계약·보안

| # | 결함 | 위치 (심볼) | 도달 조건 |
|---|---|---|---|
| B19 | `SESSION_SECRET` 하드코딩 폴백 (모듈 import 시점에 고정) | `routers/auth.py` `_HMAC_SECRET` | `main.py` 밖 진입점(스크립트·테스트·워커) |
| B20 | 레이트리밋 전무 — bcrypt 로그인이 곧 CPU 고갈 DoS | `routers/auth.py::login` | 무인증·무계정 |
| B21 | Postgres가 tracked 폴백 비밀번호로 호스트 5432에 발행 | `docker-compose.yml` (`POSTGRES_PASSWORD`) | 호스트 접근 가능한 누구나 |
| **B51** | `?diag=1`이 인증 분기보다 **앞서 렌더**되고, 진단 로그가 OAuth 인가코드를 **소비 전 원문으로** `localStorage['diag_log']`에 영구 기록한다 — `logDiag('doc', {url: pathname+search})`가 이펙트 최상단이라 `replaceState` 스트립·코드교환 `fetch`보다 먼저 캡처한다. ⚠️ 같은 파일에서 같은 형태(URL 크리덴셜→localStorage)를 **이미 세션 고정 취약점으로 판정해 제거한 전례**가 있다(B44/task#290, `ARCHITECTURE.md`) — 반복 맹점 | `App.jsx::App`(diag 분기) · `hooks/useAuthBootstrap.js`(최상단 `logDiag`) · `utils/diag.js::logDiag` · `components/DiagLog.jsx` | 코드 미소비(네트워크 실패) ∧ 같은 브라우저 접근 제3자 ∧ TTL 120초 내 |

### 표시 오류 / 크래시

| # | 결함 | 위치 (심볼) |
|---|---|---|
| B34 | `fmtSharesUs`가 음수에서 축약 없이 전액 표기(형제 `fmtSharesKr`은 부호 보존) | `frontend/src/utils.js` ← `components/reports/UsInsiderSection.jsx` |
| **B48** | **에러 바운더리가 트리 어디에도 없다** — 렌더 throw 1건이 전체 백지 | `frontend/src/` 전역 (grep 결과 0건) |
| **B49** | 리포트 상세 fetch에 staleness 가드가 없어 **A 종목 수치가 B 종목 화면에 렌더** | `frontend/src/pages/Reports.jsx` 상세 fetch 이펙트 |
| **B54** | 선도기술 **목록** 카드가 결론 문장인 `title`을 ellipsis로 자른다 — **상세 페이지가 같은 필드에 "ellipsis·line-clamp 금지(가토 ⑦)"를 명시**하는데 목록만 위반(서로 다른 커밋 간 회귀성 드리프트: 목록 task#276 / 상세 금지 task#280). 라이브 실측 4발행물 × 3뷰포트 **12표본 전부 잘림**(PC1440 가시비율 15.2% ≈ 23자), `title` hover 속성도 없어 복구는 클릭뿐. 한국어는 술어가 끝이라 잘림이 **결론부터 먹는다**(가토 ⑬) | `pages/TechReports.jsx` (대조: `pages/TechReport.jsx` 리드 문단 주석) |
| **B55** | `ShareChart` 점유율 막대가 값 칸 폭을 예약하지 않아 **트랙(`flex:1`) 기준이 행마다 달라지고 더 작은 값이 더 긴 막대**가 된다(가토 ⑮). 형제 `MarketEstimates.jsx`가 **이미 실측 확인해 `width:${valueCh}ch`로 고친 결함과 동형**인데 이 컴포넌트는 그 수정을 받지 않았다. 라이브 주입 실측: `100.0%` vs `99.9%` → 막대 `592.64` vs `599.25px`(Δ −6.61px, 육안 확인), 모바일 390에서 Δ **−7.05px**로 악화. ⚠️ 실데이터 노출은 4발행물 중 **2건 미측정**(측정한 2건은 0행·1행으로 자극 불가) | `components/tech/ShareChart.jsx` (처방 원본: `components/tech/MarketEstimates.jsx`) |
| B57 | `TechGraph` 섹션 게이트가 **컴포넌트 자신의 채택 조건과 다른 식**이라(페이지는 배열 길이만, 컴포넌트는 `validLabels` trim 필터) related가 실질 비어도 target 단독 빈 그래프가 열린다. 같은 파일이 `milestones`·`categories`엔 "게이트가 각 컴포넌트의 순수함수와 같은 식이어야 한다"는 규율을 준수하는데 `related`만 예외 | `pages/TechReport.jsx`(`hasRelated`) ↔ `components/tech/TechGraph.jsx`(`techGraphLayout`·`hasGraph`) |
| B63 | 프론트 포매터 중복 — 재계수 완료(§13.2에서 열림 확정, task#292) | `frontend/src/utils.js` 및 산발 포매터 (§7.7·§7.9) |

### 검증장치·문서

| # | 결함 | 위치 (심볼) |
|---|---|---|
| B59 | fg-map 산출물의 카운트 3곳이 실측과 어긋난다 — **원인이 두 클래스다**: ⓐ `pages/ (24 jsx)`는 `last_mapped_commit`과 무관한 **작성 시점 오기**(문서 자신의 하위 나열 합 33과도 모순 → 매핑 시 셀프체크로 잡을 수 있었다. 재실행으로는 재발을 막지 못한다) ⓑ ADR `0001~0035`(실제 0037)·프론트 테스트 63(실제 64)은 **진짜 post-mapping drift**(task#290·#291이 CONCERNS만 수동 패치하고 이 두 문서는 빠뜨렸다) | `.forge/codebase/STRUCTURE.md` §3 `pages/` · §5 `adr/` · `.forge/codebase/TESTING.md` §1·§2 |

---

## 1. 데이터 무결성 — 빈/실패 fetch가 양호값을 덮어씀

이 저장소에서 가장 잘 이해된 결함 가족이고, **정답 형태가 코드 안에 이미 존재한다**(§1.7). 남은 위험은 그 형태를 안 쓴 자리들이다.

### 1.1 `get_kr_rankings` wipe-on-empty — **확인된 버그** (B1)

`services/ranking_service.py::_fetch_naver_market`의 docstring은 *"한 페이지라도 실패하면 RuntimeError를 던진다 — 잘린 데이터가 정상 스냅샷을 DELETE-덮어쓰는 것을 막기 위함"* 이라고 의도를 명시하지만, **0페이지 케이스에 구멍이 있다**:

```python
total = int(body.get("totalCount", 0))
stocks = list(body.get("stocks", []))
pages = math.ceil(total / _PAGE_SIZE)
if pages <= 1:
    return stocks          # totalCount==0 → pages==0 → 예외 없이 [] 반환
```

형제 경로 `get_us_rankings`는 같은 자리에 가드가 있다 — `raise RuntimeError("ranking: US fetch returned empty quotes — skipping replace")`. **비대칭이 결함이다.**

도달: Naver `marketvalue`가 200 + `totalCount:0`(스키마 변경·소프트 레이트리밋)을 KOSPI·KOSDAQ 양쪽에 반환 → `replace_market_rankings("KR", …)`가 `DELETE FROM market_rankings WHERE market='KR'` 후 0행 삽입, 트랜잭션은 정상 커밋. 파장은 랭킹 탭 공백에 그치지 않는다 — `investor_trend_fetch`의 유니버스 쿼리가 `market_rankings`를 읽으므로 **수급 배치의 대상 집합까지 함께 사라진다**. 복구는 프로세스 재기동 시 `_seed_rankings_if_empty`뿐.

### 1.2 `_mc_load` 실패가 "저장값 없음"과 구별되지 않는다 — **확인된 버그** (B40)

`market_indicators/cache.py::_mc_load`는 예외를 경고 로그 후 `None`으로 삼킨다:

```python
except Exception as e:
    logger.warning(f"[Cache] _mc_load key={key} 실패: {e}")
return None            # DB 오류와 "한 번도 저장 안 됨"이 같은 값
```

이 모호성이 실제 데이터 손실이 되는 자리가 `market_indicators/kospi_signal.py::refresh_kospi_signal`이다:

```python
stored = _mc_load("kospi_signal")
stored_data = (stored["data"] if stored else None) or {}
series: list[dict] = list(stored_data.get("series", []))     # DB 오류 → []
...
if changed:
    _mc_save("kospi_signal", data)                            # 누적 이력을 1건으로 덮어씀
```

도달: 07:30 `kospi_signal_fetch` 중 그 `SELECT` 한 번이 실패(§4.5의 `PoolError` 포함)하면서 yfinance 드라이버는 성공(`fetch_ok=True` ⇒ `changed=True`) → `_MAX_DAYS` 누적 신호·적중률 이력이 소멸한다. **재구성 불가**(같은 날 갭·종가 대사로 파생되는 값이다). `job_runs`는 success로 기록한다.

같은 클래스·낮은 폭발반경: `macro.py`·`econ.py`는 `today_kst().year - 3`부터 시계열을 다시 시작하고, `kr_sector_service.refresh`는 부분 백필을 조용히 건너뛴다.

### 1.3 부분 페이로드가 완전한 값을 대체 — **잠재 위험**

전 `_mc_save` 호출자(17개)를 실패 클래스 3종 — (a) 예외 (b) 성공-but-빈응답 (c) 부분 페이로드 — 으로 감사한 결과, **(c)를 안 막는 곳이 4개** 남아 있다.

| 심볼 | (a) | (b) | (c) |
|---|---|---|---|
| `us_sector_service.py::refresh` | ✅ | ✅ | ❌ **B43** |
| `market_indicators/econ.py::_fetch_and_save_econ_indicators` | ✅ | ❌ | ❌ |
| `market_indicators/macro.py::_fetch_and_save_macro_signals` | ✅ | ❌ | ❌ |
| `market_indicators/sentiment.py::get_fear_greed` | ✅ | ✅ | ❌ |
| `market_indicators/exports.py::_fetch_customs_exports` | ✅ | ✅(월 목록) | ❌(월별 0 드롭) |

- **B43 `us_sector_service::refresh`** — all-None만 막고 부분은 안 막는다. 형제 `kr_sector_service::refresh`는 per-sector 백필 + `index` 보존까지 한다. 11개 `SECTOR_ETFS` 중 10개가 실패하면 "좋은 1개 + all-None 10개"가 직전 양호값을 덮고 다음 07:20 배치까지 서빙된다. `tests/test_us_sector_batch.py`는 has-data와 all-None 두 케이스만 덮는다.
- **`econ`/`macro`** — 예외 경로는 `return stored_data`로 막혀 있으나 FRED가 200 + `observations: []`를 주면 통과한다. `econ`의 `_is_valid_econ_data`는 빈 배열을 **유효로 판정**한다(`unemp[-1] > 50`만 거부).
- **`sentiment::get_fear_greed`** — `score`만 파싱되면 dict를 반환하므로 `fear_and_greed_historical`이 빠진 응답에서 `history: []`가 저장돼 60일 이력을 덮는다.
- **`exports`** — `all_months = sorted(m for m in months if total_by_month.get(m, 0) > 0)`가 총계 0인 달을 드롭한다. 호출부 가드는 `if not data.get("months")`뿐이라 12개월 중 2개월만 살아남아도 통과한다.

### 1.4 delete-rewrite 인벤토리 — **대부분 이미 가드됨**

delete-then-insert 5곳은 전부 **단일 `get_connection()` 트랜잭션**이라 원자적이다(§4.3의 롤백이 창을 덮는다): `dividends.py::replace_schedule`, `recommendation/store.py::replace_recommendations`, `ranking_service.py::replace_market_rankings`, `consensus_pipeline.py::backfill`(`force=True` 분기), `storage/portfolio.py::save_watchlist_tickers`.

`replace_market_rankings`의 트랜잭션 자체는 정상이다 — **입력이 버그다**(§1.1).

> ⚠️ **지시문·직전 판이 delete-rewrite로 지목한 4개 서비스는 실제로 append-only다.** `short_sell_service.py::upsert_trend`·`investor_service.py::upsert_trend`·`lending_service.py::_upsert`·`leverage_service.py::_upsert_rows`에 `DELETE`는 없고, `db.execute_many`가 빈 리스트에 no-op이라 **빈 fetch가 이미 안전하다**. 이 오귀속을 근거로 가드를 추가하지 말 것.

### 1.5 `_mc_save` 자체엔 가드가 없다 — **설계상 트레이드오프**

`market_indicators/cache.py::_mc_save`는 무조건 `INSERT … ON CONFLICT DO UPDATE`다. 모든 판단이 호출자에 산다. 이 배치가 §1.3의 비대칭을 구조적으로 허용한다 — 새 저장 지점을 추가하는 사람은 3종 실패 클래스를 스스로 다시 발명해야 한다.

### 1.6 소스-폴백이 정답 형태다 — **이미 가드됨(참조 패턴)**

가드가 **저장 직전 한 지점**이 아니라 **fetch 계층**에 있는 구현은 구조적으로 안전하다. 신규 증분 저장을 짤 때 베낄 대상:

- `market_indicators/fx.py::_fetch_fx` — 실패 시 `stored_history`를 담아 *반환*한다(빈 값이 필드에 도달하지 않는다).
- `market_indicators/cache.py::_merge_history` — `_merge_history(prev, [])`가 `prev`를 그대로 돌려준다.
- `services/dividends.py` — `fetch_dividend_schedule(...)`를 `replace_schedule` **진입 전에** 평가한다.
- `market_indicators/exports.py` — KITA → UN Comtrade → last-good + `stale: True` 마커의 3단 폴백. **이 저장소에서 가장 완성된 형태이고, 나머지 12개 소스가 베껴야 할 템플릿이다.**
- `storage/schedule.py::save_guru_managers` — per-manager 백필 + `_ROSTER_MIN_COVERAGE` 커버리지 임계.
- `market_indicators/earnings.py::_fetch_and_save_m7_earnings` — 고정 명명 집합엔 완전성(`m7_ok < len(M7)`), 유동 대규모 집합엔 커버리지 임계(`_REST_MIN_COVERAGE`).

### 1.7 `commodities.get_treasury`의 판정 순서 — **이미 가드됨(단, 형제와 순서가 다르다)**

`get_treasury`는 **백필 → 전량실패 판정** 순서라 저장값이 있으면 전 심볼이 백필돼 `if not rates:`가 사실상 발동하지 않는다. 형제 `get_commodities`는 판정이 백필 *앞*에 있어 옳다. `get_treasury`를 "동형 이식" 참조 구현으로 지목하지 말 것 — 그 순서를 베끼면 가드가 원리적으로 죽는다.

---

## 2. 외부 소스 파싱 취약성

40여 개 `requests.*` 호출 전부에 **명시적 `timeout=`이 있다**(무타임아웃 `requests` 호출 0건 — 이 저장소의 강점). 취약성은 다른 축에 있다: **HTML 스크레이프에 재시도가 하나도 없고**, 실패가 일률적으로 빈 값/last-good으로 변환돼 배치 계층에 안 보인다.

### 2.1 소스별 취약성 인벤토리

| 소스 | fetch 심볼 | 타임아웃 | 재시도 | 폴백 | 실패 시 | 스크레이프? |
|---|---|---|---|---|---|---|
| multpl.com CAPE | `market_indicators/indices.py::_fetch_cape` | 10s | ❌ | last-good | `None` → 저장 CAPE | **HTML — 최고 취약** |
| dataroma 구루 | `guru_scraper.py::scrape_manager_ids`/`scrape_holdings`/`scrape_activity` | 15s | ❌ | ❌ | 명부는 전파, per-manager는 스킵 | **HTML** |
| Finviz 컨센서스 | `scraper.py::scrape_finviz_consensus` | 10s | ❌ | ❌ | `{}` 무음 | **HTML** |
| DART 원문 | `backlog.py::_get_document_text` + `backlog_parser` | 20s | ❌ | ❌ | `""` 무음 | **HTML(XML을 html.parser로)** |
| FnGuide | `market/kr.py` | 8s | ❌ | Naver/DART | per-source except | **HTML** |
| Naver KR | `market/kr.py`, `scraper.py::get_news_kr`, `ranking_service.py` | 8–15s | ref price만 1회 | KIS(ref price만) | `[]`/`{}` | JSON |
| CNN F&G | `market_indicators/sentiment.py::_fetch_fear_greed` | 15s | ❌ | last-good | `None` | 비공식 JSON |
| FRED | `econ.py::_fetch_series`, `macro.py::_fetch_series` | 10s | ❌ | last-good | `stored_data` | JSON |
| KOFIA | `leverage_service.py::_kofia_get`, `lending_service.py::_api_get` | 30s | ❌ | ❌ | raise → 잡이 삼킴 → **success** | JSON |
| 관세청 KITA | `exports.py::_fetch_customs_exports` | 15/30s | ❌ | **UN Comtrade → last-good+stale** | 3단 폴백 | JSON/XML |
| 키움 | `kiwoom/client.py::_request` | 8s | 401/403 → 토큰 재발급 1회 | `configured()` 게이트 | `KiwoomError` | REST |
| KIS | `kis/client.py::_request` | 8s | 401/403 → 1회(60s 재발급 가드) | `configured()` 게이트 | `KisError` | REST |
| yfinance | `cache.py::_yf_close_history`, `beta.py`, `scraper.py`, `consensus_pipeline.py` | **명시 없음** | ❌ | 일부 last-good | 다양 | 라이브러리 |

### 2.2 `scrape_manager_ids`의 무음 절단 — **확인된 버그**(관측 불가 클래스)

`guru_scraper.py::scrape_manager_ids`의 `r.raise_for_status()`는 HTTP 오류만 잡는다. **HTTP 200 + 마크업 변경이면 예외 없이 짧은 명부가 내려온다** — 코드 자신의 docstring(`scrape_all_managers`)이 이 성질을 명시한다. 하류 `storage/schedule.py::save_guru_managers`의 `_ROSTER_MIN_COVERAGE`가 완화하지만 **제거하지는 않는다**. 도달: dataroma가 `a[href*='holdings.php?m=']` 마크업을 바꾸는 순간.

### 2.3 `_fetch_cape`에 stale 마커가 없다 — **잠재 위험**

`indices.py::_fetch_cape`가 markup 변경으로 `None`을 반환하면 `get_indices`가 저장 CAPE로 대체하는데, 응답이 **fresh와 구별되지 않는다**. 형제 `exports.py`는 같은 상황에 `{**stored["data"], "stale": True}`를 싣는다. 몇 달째 얼어붙은 CAPE가 정상값으로 표시될 수 있다.

### 2.4 완전 무음 fetch 실패 — **확인된 버그**(진단 불가)

`services/` 전체에 bare `except:`는 **0건**이고, 대부분의 `except Exception … pass`는 앞에 `logger.warning`이 있다(`pass`는 죽은 코드). 로그가 **전혀 없는** 곳은 3군데:

- **`guru_scraper.py`의 종목명 조회** (MED) — 두 코드(`ticker`, `{ticker}.O`) 시도를 `except Exception: pass`로 삼키고 `""`를 반환한다. 스크레이프 파손과 "Naver에 이름이 없음"이 구별되지 않고, 그 `""`가 구루 보유 종목에 저장된다. `save_guru_managers`의 가드는 *매니저* 단위라 **빈 종목명은 보지 못한다**.
- **`middleware/event_tracker.py::_save_event`** (LOW) — `user_events` INSERT를 완전 무음으로 삼킨다. 추적 사이드채널이라 방어 가능하나 DB 장애 시 신호가 0이다.
- **`main.py::_warm_market_cache`** (LOW) — `get_econ_indicators()`·`get_kr_exports()` 양쪽을 무음으로 감싼다. §3의 TTL 성질과 겹쳐, warm-up 실패는 월배치까지 콜드로 남는다.

좁지만 손실이 있는 것: `earnings.py::_get_naver_quarterly_net_income`의 `except (ValueError, IndexError): pass` — 분기 하나가 무음으로 빠지고 `_merge_quarters`가 짧은 시계열을 합산한다. `_REST_MIN_COVERAGE`는 *데이터가 있는 티커 수*를 세므로 8분기 중 3분기를 잃은 티커도 성공으로 계수된다.

### 2.5 yfinance에 애플리케이션 레벨 타임아웃이 없다 — **잠재 위험**

`cache.py::_yf_close_history`, `beta.py`의 `yf.Ticker(...).info`/`.history(...)` 어느 호출에도 명시 타임아웃이 없다. yfinance 내부 기본값(30s)에 의존하며 `requirements.txt`가 `yfinance>=0.2.40`으로 **상한 없이** 열려 있어(§10.7) 그 기본값이 바뀌면 애플리케이션 쪽 상한이 0이 된다. §6.4의 "잡 타임아웃 없음"과 결합하면 한 번의 hang이 배치 전체를 무기한 잡는다.

---

## 3. NaN/Inf·수치 타입

> 코드 주석 4곳(`main.py`, `routers/stocks.py`×2, `tests/test_stocks_router.py`)이 이 절을 `CONCERNS §3`으로 인용한다 — **번호 유지 필수**.

### 3.1 입력 경로 — **이미 가드됨**

- `main.py::_validation_error_handler`가 422 본문을 `sanitize`한다 → 입력 NaN이 echo돼 직렬화 500이 되는 연쇄가 앱 전역에서 닫혔다.
- Pydantic 스윕: `= Field(None` / `= Field(default=None` **19건 전부 이미 `Optional[...]`** — `x: float = Field(None)` 오선언은 **0건**이다(명시적 `null`만 422가 되는 비대칭 함정 없음).
- 외부 NaN 토큰을 받을 수 있는 float 필드에 `allow_inf_nan=False`가 붙어 있다(`routers/tech_reports.py`, `routers/analyst_reports.py`).

### 3.2 `sanitize`는 `Decimal('NaN')`을 처리한다 — **이미 가드됨**

`services/utils.py::sanitize`가 float뿐 아니라 PostgreSQL `NUMERIC`에서 오는 `Decimal('NaN')`도 잡는다. `NUMERIC` 컬럼이 NaN을 저장할 수 있고 psycopg2가 그대로 왕복시키므로 이 처리가 옳다.

### 3.3 sanitize가 없는 응답 경로 — **잠재 위험**

| 라우터 | 상태 |
|---|---|
| `routers/portfolio.py` | ✅ 전 응답 경로 sanitize + `ConfigDict(allow_inf_nan=False)` |
| `routers/stocks.py` | ✅ `compare_stocks`·대시보드 sanitize, `_usdkrw_rate`에 `math.isfinite` |
| `routers/analysis.py` | ⚠️ `sector`·`macro_correlation`이 sanitize 없음(내부 `isfinite` 가드에 의존) |
| `routers/market_indicators.py` | ⚠️ **14개 GET 중 어느 것도 sanitize 안 함** — 내부 가드가 있는 것(`indices`·`fear_greed`·`kospi_futures`·`kospi_signal`·`leverage`·`lending`)과 없는 것(`treasury`·`commodities`·`fx`·`vix`·`econ`·`macro`·`m7`·`kr_top2`·`kr_exports`)이 섞여 있다 |
| `routers/rankings.py`·`investor.py`·`short_sell.py` | ⚠️ `_serialize`가 bare `_to_float`, sanitize 없음 |

### 3.4 NaN이 `market_rankings`에 저장돼 랭킹 500을 낼 수 있다 — **잠재 위험**

`services/ranking_service.py::_us_row`:

```python
"change_pct": _parse_float(quote.get("regularMarketChangePercent")),
```

`_parse_float`는 `float(str(val).strip())`이라 **`float("nan")`이 성공한다**. `price`/`trading_value`는 `int()`를 거쳐 NaN이면 배치가 죽지만 `change_pct`는 통과한다 → `market_rankings.change_pct`(`NUMERIC`) → `Decimal('NaN')` → `routers/rankings.py::_serialize`의 sanitize 없는 `_to_float` → starlette `allow_nan=False` → **랭킹 페이지 전체 500**. 미확인 부분은 yfinance `most_actives`가 실제로 그 필드에 NaN을 내는지 여부다.

### 3.5 최소카드 폴백이 근본원인을 마스킹한다 — **설계상 트레이드오프**

`routers/stocks.py`의 대시보드 빌드는 per-card `_safe`로 throw를 `_minimal_card`로 흡수한다 — 500-to-empty를 막는 올바른 설계지만, **enrichment가 조용히 사라지는 형태**로 실패한다(에러 토스트 없음). 헤더·시세는 정상인데 RSI·컨센서스·매물대·배당만 일괄 blank면 `docker logs portfolion-backend-1 | grep '최소카드 폴백'`이 유일한 단서다.

---

## 4. DB·스키마·트랜잭션·커넥션 풀

### 4.1 `app_schema.sql` ↔ `main._migrate` 미짝 — **잠재 위험**(프로세스 부채)

`app_schema.sql`은 **빈 `pgdata` 초기화 시에만** 적용된다(`docker-compose.yml`의 `/docker-entrypoint-initdb.d/02-app.sql`). `backend/migrations/001_user_events.sql`·`002_backlog_history.sql`은 **어떤 스크립트·compose·모듈도 참조하지 않는다**(죽은 수동 파일). 따라서 `_migrate()`가 유일한 자동 경로다(ADR-0006).

**`_migrate`에 `CREATE TABLE IF NOT EXISTS`가 없는 후발 테이블** — 라이브 DB엔 수동 `psql`로만 존재한다:

| 테이블 | 근거 |
|---|---|
| `market_rankings` | 랭킹 Phase 3에서 추가, `_migrate` 무등록 |
| `market_investor_trend` | 수급 Phase 4에서 추가, `_migrate` 무등록 |
| `market_leverage_indicators` | `_migrate` 무등록 |
| `job_runs` | `app_schema.sql` 자신이 수동 단계임을 주석으로 명시 |
| `raw_reports`·`daily_consensus_mart`·`user_events`·`backlog_history` | `_migrate`에 `ALTER`만 있고 `CREATE`는 없음(`backlog_history.segments`) |

`market_lending_balance`는 안전하다 — `lending_service.py::_ensure_table`이 매 호출 자가 생성한다.

**`tickers` 컬럼 중 `_migrate`에 짝이 없는 것**: `_migrate`가 덮는 것은 `key_resource`·`competitor_edge`·`market_outlook`·`analyst_target` 4개뿐. 누락: **`enriched_at`**(`routers/stocks.py::_enriched_at_map`가 읽음), **`is_etf`**(`storage/portfolio.py::get_full_portfolio`), **`insights`**(`storage/portfolio.get_stocks`) — 셋 다 초기 스키마 이후 추가분이다. 나머지(`exchange`·`competitors`·`moat`·`growth_plan`·`risks`·`recent_disclosures`)는 초기 스키마 소속이라 위험이 낮다.

`user_stocks`(`target_price`·`stop_price`·`target_weight`·`pinned`)는 **올바르게 짝지어져 있다**.

심각도 주석: 앱이 지금 돌고 있으므로 라이브 DB엔 이미 수동 반영돼 있을 가능성이 높다. 노출은 **옛 덤프에서의 재구축**이나 **두 번째 환경**이고, 위반되는 것은 명시된 DoD다.

### 4.2 커넥션 풀 vs ThreadPool 적층 — **잠재 위험**

> `services/db.py`의 주석이 이 항목을 `CONCERNS §4.2`로 인용한다.

`_get_pool()`은 `ThreadedConnectionPool(minconn=1, maxconn=20)`이고, **psycopg2 풀은 소진 시 블록하지 않고 `PoolError`를 던진다**(코드 주석이 이 성질을 명시).

| 사이트(심볼) | 워커 | DB 접근 |
|---|---|---|
| `routers/calendar.py::get_calendar_events` (`_fetch_stock`) | 15 | ❌ yfinance만 |
| `services/ranking_service.py::_fetch_naver_market` | 12 | ❌ HTTP만 |
| `routers/stocks.py` 대시보드 (`_build_all`→`_build_card`) | 10 | ✅ 카드당 `dividends.get_dividend` |
| `services/analysis_service.py::get_macro_correlation` | 10 | 혼합 |
| `scheduler/jobs.py::_investor_trend_work` / `_short_sell_work` | 8 | ✅ `upsert_trend` |
| `routers/stocks.py::backfill_names` (`_one`) | 8 | ✅ 쓰기 2회 |
| `services/report_generator.py` | 8 | ✅ |
| `market_indicators/earnings.py` | 20 | ❌ |
| `services/consensus_pipeline.py` | 5 | ✅ |

도달: 동시 대시보드 요청 2건(10+10=20=`maxconn`) + 스케줄러 배치 1개 → `PoolError`. 부하 실증은 없어 **미확정**이지만, 이 위험이 데이터 손실로 승격되는 경로가 §1.2다 — `_mc_load` 안의 `PoolError`가 "저장값 없음"으로 변환된다.

**스테일 주석 3곳**(LOW, 확인): `scheduler/jobs.py`(2곳)·`routers/stocks.py`가 풀을 `maxconn=10`으로 서술한다(실제 20). 다음 사람이 읽을 사이징 근거이므로 정정 대상.

### 4.3 트랜잭션 원자성 — **이미 가드됨**(지시문의 전제가 틀렸다)

`services/db.py::get_connection`은 **커밋과 롤백을 모두** 한다:

```python
conn = _get_pool().getconn()
try:
    yield conn
    conn.commit()
except Exception:
    conn.rollback()
    raise
finally:
    _get_pool().putconn(conn)
```

따라서 "정상 종료 시 커밋한다 → 롤백 전제 코드가 성립하지 않는다"는 **반증됐다**. §1.4의 delete-rewrite 5곳은 이 롤백에 정당하게 의존한다.

**진짜 잔여 위험은 다른 곳이다** — `query()`/`execute()`는 **각각 자기 커넥션·자기 트랜잭션**을 연다. 따라서 `execute()` 루프에는 문장 간 원자성이 없다: `leverage_service.py::_upsert_rows`, `lending_service.py::_upsert`. 멱등 `ON CONFLICT` upsert라 실무상 무해하지만 루프 중 크래시는 부분 날짜 범위를 남긴다.

### 4.4 SQL 인젝션 — **이미 가드됨(클린)**

동적 SQL 3곳 전부 안전하다:
- `routers/admin.py::delete_user` — `f"DELETE FROM {table} WHERE {col} = %s"`의 `table`/`col`은 **하드코딩 리터럴 리스트** 순회, `user_id`는 파라미터화.
- `storage/portfolio.py::enrich_stock` — `set_clause`를 키에서 만들지만 그 앞에 `if not fields.keys() <= _ENRICH_KEYS: raise ValueError`(frozenset allowlist). 올바른 allowlist-then-interpolate.
- `services/analyst_reports.py` — `_COLS`가 모듈 상수.

나머지 전 DB 호출은 `%s` 파라미터화. `.format()`이 SQL에 닿는 곳은 없다(4건 전부 DART 뷰어 URL 템플릿).

### 4.5 N+1 — **설계상 트레이드오프**

대시보드가 카드당 개별 read(`dividends.get_dividend` 등)를 한다. 10워커 병렬로 완화하지만 그 병렬성이 §4.2의 풀 압력을 만든다 — 두 문제가 서로의 완화책이다.

---

## 5. 인증·보안 노출

### 5.1 무인증 엔드포인트 — **이미 가드됨(드리프트 0)**

전 22개 라우터의 route 데코레이터를 파싱해 4종 auth 의존성(`get_current_user`·`get_current_user_or_api_key`·`require_admin`·`require_admin_or_api_key`)과 대조한 결과 — **무인증 `/api` 엔드포인트는 정확히 9개, 전부 `routers/auth.py` 소속**이다:

`POST /api/auth/register`·`login`·`refresh`·`logout`, `GET /api/auth/oauth/google`·`google/callback`·`github`·`github/callback`·`token`. (+ `/api` 밖의 `GET|HEAD /health`.)

**사용자·포트폴리오 데이터를 노출하는 무인증 엔드포인트는 0건이다.**

`tests/test_no_public_reads.py`의 `ALLOWED_PUBLIC` frozenset이 정확히 이 9개이고, **양방향으로 강제한다**(신규 공개 라우트 금지 + stale 엔트리 금지). 게다가 `test_route_walk_is_not_silently_empty`가 `len(api_routes) > 100`을 단언해 **FastAPI 버전차로 route walk가 0건이 되며 게이트가 거짓 통과하는 실패 모드**(§9)까지 막는다. `tests/test_security_auth_gaps.py`가 override 없는 fresh app으로 실제 401을 확인한다(API 키 positive/negative 포함). ADR-0029.

**이 절은 재제기 금지 대상이다.** 아래 5.2~5.10은 게이팅이 아닌 축의 문제다.

### 5.2 프론트가 URL 쿼리의 토큰을 신뢰한다 — **닫혔다**(구 B44)

`frontend/src/hooks/useAuthBootstrap.js::useAuthBootstrap`가 URL 쿼리의 `token`·`refresh`를 그대로 `localStorage`에 심던 레거시 분기(어떤 백엔드 경로도 만들지 않는 형태 — 콜백은 `?oauth=<code>`만 낸다)를 **분기 자체를 삭제**해 닫았다(task#290 S1). 분기는 `oauthCode`(정상 교환)·`oauthError`·그 외(`resolveStored` 고정) 3갈래만 남는다. 세션 고정 경로 자체가 없어졌으므로 잔여 위험 없음.

### 5.3 OAuth `state`가 세션 바인딩·일회용이 아니다 — **잠재 위험**

`routers/auth.py::_make_state`/`_verify_state`는 순수 HMAC이다 — `_make_state`가 `nonce.hmac_sha256(nonce)[:20]`을 만들고 `_verify_state`는 HMAC을 재계산할 뿐이다.

- **서버측 저장소 없음, 재사용 방지 없음, 만료 없음**(state TTL = 무한).
- **세션 바인딩 없음** — `SessionMiddleware`가 설치돼 있지만 `oauth_google`/`oauth_github`가 nonce를 `request.session`에 쓰지 않는다.
- **PKCE 미사용**(`code_challenge`/`code_verifier` 없음).

서명 검사가 증명하는 것은 "이 서버가 언젠가 어떤 state를 발행했다"이지 "이 브라우저가 이 플로우를 시작했다"가 아니다. 도달: 공격자가 `/api/auth/oauth/google`을 한 번 눌러 만료되지 않는 state를 확보한 뒤, 자기 `code` + 그 state로 만든 콜백 URL을 피해자에게 먹인다(로그인-CSRF). HMAC 20 hex(80비트) 절단 자체는 약점이 아니다 — **nonce 저장소 부재가 약점이다**. B19(§5.5)와 겹치면 서명 자체가 위조 가능해진다.

### 5.4 OAuth 코드가 URL 쿼리로 전달된다 — **설계상 트레이드오프**(완화 있음)

콜백이 `f"{frontend}/?oauth={code}"`로 리다이렉트하고 프론트가 `GET /api/auth/oauth/token?code=…`로 교환한다. 완화는 실재한다: 120초 TTL + `_pop_oauth_tokens`의 단일 사용 `pop`, `_no_cache_redirect`의 `Cache-Control: no-store`, 프론트의 즉시 `history.replaceState`. 그럼에도 코드는 브라우저 히스토리·서드파티 서브리소스의 `Referer`·중간 접근 로그에 남는다. 120초 안에 그것을 읽는 자는 1시간 access token + 30일 refresh token을 얻는다.

부수(LOW): `_oauth_codes`는 프로세스 로컬 dict라 uvicorn 워커가 2개 이상이면 콜백과 교환이 다른 프로세스에 떨어져 로그인이 간헐 실패한다(현재는 단일 워커라 미발현 — §6.6).

### 5.5 하드코딩 폴백 시크릿 — **확인된 버그**(현 배포에선 우연히 fail-closed) (B19)

`routers/auth.py`: `_HMAC_SECRET = os.environ.get("SESSION_SECRET", "<리터럴 기본값>").encode()`.

백엔드에서 **유일한** 하드코딩 시크릿 기본값이다(`JWT_SECRET`은 `os.environ[...]` fail-fast를 3곳 모두 지킨다). 회의적으로 볼 것: `main.py`가 `os.environ["SESSION_SECRET"]`으로 import 시 KeyError를 내므로 `main.py`를 거친 서버는 기본값으로 뜨지 못한다. **그러나 import 순서상 `routers.auth`가 먼저 평가되고 `_HMAC_SECRET`은 import 시점에 고정된다** — `main`을 거치지 않는 진입점(테스트 하니스·스크립트·향후 워커)은 공개적으로 알려진 키로 OAuth state를 서명한다. §5.3과 결합하면 state 위조가 성립한다.

### 5.6 레이트리밋 전무 — **확인된 버그**(ADR 근거 없는 순수 공백) (B20)

`backend/`에 `slowapi|ratelimit|rate_limit|limiter|throttle` 계열 애플리케이션 레이트리밋이 **하나도 없다**(발견되는 것은 외부 제공자 보호용 아웃바운드 스로틀뿐: `agm.py::_DART_THROTTLE`, KIS/키움 sleep). `login`·`register`·`refresh`·`oauth_token_exchange` 어디에도 없다.

- **`POST /api/auth/login`** — 무제한 크리덴셜 스터핑(락아웃·백오프·CAPTCHA 없음). 더 나쁜 것은 `verify_password`가 **의도적으로 비싼 bcrypt**라는 점이다: 같은 무제한 엔드포인트가 CPU 고갈 DoS가 된다. FastAPI가 sync 핸들러를 유계 스레드풀에서 돌리므로 수백 건 동시 위조 로그인이면 API 전체가 정지한다. **계정 없이 가능한, 이 저장소에서 가장 싼 가용성 공격이다.**
- `POST /api/auth/refresh`·`GET /api/auth/oauth/token` — 토큰이 `secrets.token_urlsafe(64)`/`(24)`라 추측은 비현실적. 노출은 DB 부하다.

### 5.7 admin 게이팅 공백 — **3건 닫힘(구 B45·B46·B50), 1건 잔존(`days` 상한) + 알려진 UI 비일관 1건**

전역 상태를 바꾸는데 게이팅이 약했던 자리:

- **닫힘(구 B45) `routers/report.py::put_backlog`** — `PUT /report/{ticker}/backlog`의 게이트를 `get_current_user_or_api_key`→**`require_admin_or_api_key`**로 좁혔다(task#290 S2). `save_llm_backlog(ticker, entries)`가 ticker 스코프(전역 공유)라는 사실은 그대로지만, 이제 admin 로그인 또는 API 키만 도달한다. 형제 `refresh_backlog`(`require_admin`)와 정합됨. `entries: list = Body(...)`에 `max_length` 상한이 없는 것은 그대로 남는다 — task#290의 비목표.
- **닫힘(구 B46) `routers/stocks.py::clear_dashboard_cache`** — 게이트(`get_current_user`)는 유지하되 `cache_svc.invalidate_dashboard(user_id)`로 **호출자 자신의 캐시만** 무효화하도록 스코프를 좁혔다(task#290 S3, `_dashboard_cache.invalidate`는 이미 `user_id` 인자를 받고 있었다 — 호출부만 무인자였다). 대조군 `routers/calendar.py::delete_calendar_cache`와 이제 동형.
- **닫힘(구 B50) `routers/report.py::refresh_analyst`·`::backfill_consensus`** (task#291) — 둘 다 `user_id: str = Depends(get_current_user)`를 받아놓고 본문에서 안 쓰던 것이 결함이었다(형제 `::generate_one`은 `find_ticker(storage.get_all_stocks(user_id), ticker)`로 소유권 검사가 있었는데 이 둘엔 없었다). **두 엔드포인트는 이제 같은 가드를 공유한다** — `routers/report.py::_require_owner_or_admin`(소유권 OR admin, caller 조회 실패는 fail-closed)를 본문 선두, 스냅샷 `query`보다 **먼저** 호출한다. 거부는 둘 다 403이고 DB에 닿지 않으므로 무쓰기다. admin이 소유권을 우회해야 하는 이유는 리포트 목록 `scope=all`("그외" 탭)로 남의 종목 상세를 열기 때문이다(`list_reports`의 role 판정과 같은 패턴).
  - ⚠️ **`require_admin`으로 좁히지 말 것 — 실제로 그렇게 구현했다가 배포 전에 되돌렸다.** 두 엔드포인트 모두 프론트 소비처가 있고(`components/reports/DetailTab.jsx`의 「데이터 갱신」 · `components/reports/ConsensusChart.jsx`의 「백필」) **둘 다 role 게이팅이 없다**(grep 0). admin 전용으로 좁히면 전 비admin 사용자가 **자기 보유 종목에서도** 403을 받는 **기능 회귀**다. task#291 계획은 `backfill_consensus`에 대해 "프론트 소비처 없음(grep 0)"이라는 **틀린 전제**로 `require_admin`을 채택했고(같은 계획이 `refresh_analyst`에는 정확히 반대 논리를 적었다), 적대적 리뷰가 배포 전에 잡았다. **게이트를 조이는 변경은 그 엔드포인트의 프론트 소비처를 직접 grep해 role 게이팅 유무를 대조할 것** — pytest·vitest·빌드 어느 것도 이 경로를 원리적으로 못 본다.
- **알려진 UI 비일관(닫지 않음 — task#291 결정)** — 비admin이 **랭킹**(`pages/Ranking.jsx::onRowClick` → 모달 → `ReportDetailTabs`)에서 **비소유** 종목 상세를 여는 것은 지원되는 내비게이션인데, 그 화면의 「데이터 갱신」·「백필」 버튼은 소유권·role을 보지 않으므로 누르면 403이 뜬다. 실패는 `refreshError`로 graceful하고 공유 데이터는 보호되므로 **게이트 결함이 아니라 버튼 가시성 문제**다. 프론트에서 숨기려면 `GET /report/{ticker}/{date}` 응답(현재 소유권 필드 없음)에 `is_mine`을 additive로 추가하고 admin 판정까지 내려야 해서 계약이 늘어난다 → 별도 태스크로 남긴다. task#97/#103의 "버튼은 보이는데 핸들러가 거부"와 같은 가족.
- **잔존 `routers/report.py::backfill_consensus`의 `days` 상한** (LOW) — `days: int = 180`은 여전히 **`Query(..., le=…)` 상한 없는 bare int**다(형제 `short_sell.py`·`investor.py`는 `Query(252, ge=1, le=1000)`으로 규율돼 있다). 소유권 게이트가 붙어 **남의 종목으로는 못 부르지만, 자기 보유·관심 종목에는 임의 인증 사용자가 큰 `days`로 외부 제공자를 호출시킬 수 있다** — 도달성은 **좁아졌을 뿐 닫히지 않았다**(옛 판의 "도달성만 닫힘" 서술은 `require_admin`을 전제한 것이라 무효). 상한 추가는 task#290·#291 둘 다 비목표.

반대로 **비싼 배치 엔드포인트 다수는 올바르게 `require_admin`이다** — 게이팅 규율 자체는 좋고, 위 잔존 1건(days 상한 코드 자체)만 예외다. ⚠️ 이 절 이전 판의 "28/31" 분모·분자는 산출 방법이 문서에 남아 있지 않아 `backfill_consensus`의 게이트 교체를 반영해 그대로 갱신하지 않았다(task#291 S3 — 추정 대신 재감사가 필요한 수치로 남겨둔다). `POST /api/admin/cowork/fire`는 고정 env URL(`COWORK_ROUTINE_FIRE_URL`)로만 POST하므로 **SSRF 없음**.

### 5.8 API 키 비교가 상수시간이 아니다 — **잠재 위험**(낮음)

`backend/auth.py::get_current_user_or_api_key`: `if expected and api_key == expected:` — 평문 `==`(첫 불일치 바이트에서 단락). 같은 저장소의 `routers/auth.py::_verify_state`는 `hmac.compare_digest`를 올바르게 쓰므로 프리미티브를 모르는 게 아니라 여기 적용을 빠뜨린 것이다. HTTP 상의 원격 타이밍 오라클은 지터에 묻혀 실 exploit이 어려워 MED가 아닌 LOW-MED. 수정은 한 줄.

**fail-closed는 올바르다** — `expected and …` 가드 덕에 `COWORK_API_KEY` 미설정 시 모든 키 시도가 401이지 `""` 매치가 아니다.

**`require_admin`은 API 키를 거부한다** — `Depends(get_current_user)`만 선언하고 `get_current_user`는 `X-API-Key`를 보지 않는다(CLAUDE.md의 서술이 맞다). 분리는 의도적이고 깨끗하다.

### 5.9 가입이 열려 있고 비밀번호 정책이 없다 — **잠재 위험**

`routers/auth.py::RegisterRequest`는 `email: str` / `password: str` — **`EmailStr`이 아니고 `min_length`도 `Field` 제약도 없다**. 이메일 검증·초대 게이트·레이트리밋 없음. 빈 문자열 비밀번호가 통과한다. 신규 계정은 즉시 `apply_default_permissions`를 받는다. §5.6(로그인 레이트리밋 부재)과 결합하면 약한 비밀번호가 직접 브루트포스 가능하고, §5.7의 두 전역 표면이 계정 하나당 지렛대가 된다.

### 5.10 토큰 수명·저장 — **설계상 트레이드오프 + 잔여**

- **해싱은 올바르다** — `auth_service.py::hash_password`/`verify_password`가 bcrypt + per-hash `gensalt()`. 커스텀 암호 없음.
- **JWT는 깨끗하다** — `algorithms=["HS256"]`이 **4개 decode 지점 전부**에 고정, `verify=False`·options override 없음. alg=none/혼동 클래스는 닫혀 있다.
- **리프레시 회전은 있다** — `auth_service.py::consume_refresh_token`이 반환 전 `DELETE`하고 테스트가 못박는다. 만료도 강제한다(naive→UTC 보정 포함).
- **잔여 1: 재사용 탐지 없음** — 회전된 토큰이 재생되면 `None`을 반환할 뿐 그 사용자의 토큰 패밀리를 무효화하지 않는다(RFC 6819의 표준 대응은 전량 폐기).
- **잔여 2: access token 폐기 불가** — `jti` 없음·denylist 없음이라 `logout` 후에도 탈취된 access token이 최대 1시간 산다.
- **잔여 3: `localStorage` 저장** — access/refresh 둘 다. HttpOnly 쿠키 미사용(콜백이 `Set-Cookie`를 아예 안 낸다). XSS 1건이 세션이 아니라 **30일 지속 계정 탈취**가 된다.
- 로그인 사용자 열거(LOW): 미존재 사용자 분기가 bcrypt를 **돌리지 않고** 반환해 응답 시간이 갈린다(메시지는 동일).

### 5.11 CORS — **이미 가드됨**

`main.py`가 명시 origin 리스트를 쓰고 wildcard가 없으며 falsy 필터가 빈 `FRONTEND_URL` 주입을 막는다. **`allow_credentials`를 설정하지 않아 기본 `False`** — wildcard+credentials 문제 없음. 인증이 `localStorage`의 `Authorization` 헤더로 타므로 credentialed CORS가 불필요하다는 점에서 아키텍처적으로도 일관된다. (사소: 두 `localhost` 개발 origin이 프로덕션 allowlist에 실려 있다.)

### 5.12 Google `id_token`을 서명 검증 없이 파싱 — **잠재 위험**(현재 미도달)

`routers/auth.py::oauth_google_callback`가 `id_token`을 `.split(".")[1]` + base64 디코드로 읽는다 — `jwt.decode` 없음, `aud`/`iss`/`exp` 검증 없음. **지금은 exploit 불가**다: 토큰이 `GOOGLE_CLIENT_SECRET`로 인증된 서버-대-서버 POST(TLS)로 오므로 전송 자체가 신뢰 앵커다. 누군가 이것을 클라이언트가 준 `id_token`을 받도록 리팩터하는 순간 실 취약점이 된다 — 불변식을 주석으로 못박을 자리다.

### 5.13 이벤트 화이트리스트 — **잔여 2건**

`routers/events.py::VALID_EVENTS`(19개)는 `Depends(get_current_user)`로 게이트되고 비화이트리스트 이름은 **200 OK + 무음 폐기**다(fail-silent 설계).

- **B24**: 프론트가 보내는데 화이트리스트에 없는 이벤트는 **정확히 1개 — `nav_analytics`**(`components/Masthead.jsx`, `components/MobileTopActions.jsx`). 결과는 텔레메트리 무음 손실. 200을 돌려주므로 **이 교차 대조 없이는 관측 불가**하다.
- 스테일 엔트리(LOW): `tab_holdings`·`tab_watch`·`stock_search`는 `pages/AdminAnalytics.jsx`의 표시 라벨로만 등장하고 emit 하는 `trackEvent` 호출부가 없다.
- 동적 emit은 안전하다 — `MobileNav.jsx`의 `trackEvent('nav_' + section.perm)`이 내는 5개 perm 값이 전부 화이트리스트에 있다(§7.4의 "필드 역할 겸직" 함정을 `perm`으로 파생해 피한 자리).
- **화이트리스트가 `user_events`의 완전한 인벤토리가 아니다**: `middleware/event_tracker.py::EventTrackerMiddleware`가 `stock_add`·`stock_delete`·`stock_promote`·`report_generate`·`guru_crawl`을 `_save_event`로 직접 INSERT하며 화이트리스트를 우회한다(이름이 `_TRACKED`에 하드코딩이라 취약점은 아니다).

---

## 6. 배치·스케줄러·관측성

### 6.1 키 미설정·실패가 "성공"으로 기록된다 — **확인된 버그** (B6)

`_JOB_FUNCS`(28개)를 `Run.set_status` 사용과 대조한 결과 — **`set_status`를 부르는 잡은 `_run_guru_crawl` 하나뿐이다.** 나머지 27개는 본문을 `try/except Exception: logger.warning(...)`로 감싼 채 `with job_runs.record(...)` 안에 있어 **항상 `_finish("success")`가 돈다**. `services/job_runs.py`의 docstring이 이 성질을 스스로 명시한다.

가장 나쁜 형태는 예외조차 안 나는 경우다 — `scheduler/jobs.py::_refresh_monthly_us`:

```python
with job_runs.record("monthly_us", "auto"):
    try:
        _fetch_and_save_econ_indicators()
        logger.info("[Scheduler] Econ indicators refreshed")     # ← 실패해도 이 줄이 찍힌다
    except Exception as e:
        logger.warning(...)
```

`_fetch_and_save_econ_indicators`는 키가 없으면 **예외 없이 `{"error": ...}` dict를 반환**하므로 `warning` 분기조차 타지 않는다. 반환값은 아무도 검사하지 않는다.

키 미설정 → 초록 배치 + 데이터 0의 조합(전수):

| 환경변수 | fetch 심볼 | 잡 |
|---|---|---|
| `FRED_API_KEY` | `econ.py::_fetch_and_save_econ_indicators`, `macro.py::_fetch_and_save_macro_signals` | `_refresh_monthly_us`, `_refresh_macro_signals` |
| `DART_API_KEY` | `disclosures.py`, `backlog.py::_get_corp_code_map`, `agm.py`, `dividends.py`, `insider_trades.py` | `_fetch_disclosures`·`_fetch_backlog`·`_fetch_agm`·`_fetch_dividends`·`_fetch_insider` |
| `KOFIA_API_KEY` | `leverage_service.py::_kofia_get`, `lending_service.py::_api_get` | `_fetch_leverage`·`_fetch_lending` |
| `TELEGRAM_BOT_TOKEN`/`_CHAT_ID` | `digest_service.py::send_telegram`(bare `return`) | `_run_digest` — 다이제스트는 생성·저장되고 **발송만 안 된다** |

도달: `backend/.env.docker`가 재생성·절단되는 모든 배포. `.env.docker`가 gitignored이므로 **새 클론 + `deploy.sh`가 정확히 이 상태를 만든다** — 전 배치 초록, 데이터 0. 이번 판에서 가장 가치 높은 운영 발견이다.

### 6.2 `job_runs`에 "스킵" 상태가 없다 — **설계상 트레이드오프**(관측 공백)

§1의 가드들이 발동하면 저장을 건너뛰는데, 잡 본문이 예외를 전파하지 않으므로 `job_runs`는 **success로 기록한다**. 즉 "갱신됨"과 "생략·직전값 유지"가 관측상 구별되지 않는다. `_run_guru_crawl`만 `partial`/`skipped`/`failed`를 쓰는 올바른 형태이고, 나머지 27개가 채택해야 할 패턴이다.

### 6.3 `get_or_refresh`의 `ttl`은 저장값에 안 걸린다 — **설계상 트레이드오프**(오해 유발 시그니처)

```python
def get_or_refresh(key, fetch_fn, ttl, force=False):
    if not force:
        cached = _get_cache(key)
        if cached: return cached
        stored = _mc_load(key)
        if stored:
            _set_cache(key, stored["data"], ttl)   # ttl → 인메모리 만료 전용
            return stored["data"]
    return fetch_fn()
```

`stored["fetched_at"]`은 로드되고 **어디와도 비교되지 않는다**. 어떤 나이의 DB 행이든 이긴다.

**그리고 `force=True` 탈출구는 사실상 존재하지 않는다** — 비테스트 `backend/` 전체에서 `force=True`는 `kis/client.py`·`kiwoom/client.py`의 OAuth 토큰 재발급 2건뿐이다. **어떤 배치·라우터·스케줄러도 `get_or_refresh`에 `force=True`를 넘기지 않는다.** 배치들은 `_fetch_and_save_*`를 직접 불러 우회하므로 동작은 하지만, 결과적으로 `get_or_refresh`의 실사용 소비자는 read 경로 2개(`get_m7_earnings`·`get_kr_top2_earnings`)뿐이다.

### 6.4 `market_cache` 16개 키의 신선도 경계 — **§6.3의 실측 귀결**

| 키 | 신선도를 실제로 묶는 것 |
|---|---|
| `commodities`·`treasury`·`indices`·`vix`·`fear_greed`·`kospi_futures` | 인메모리 3600s 만료 후 **요청 경로 재fetch**(소비자가 곧 갱신자라 자가치유) |
| `econ_indicators`·`kr_exports`·`macro_signals`·`kospi_signal`·`m7_earnings`·`kr_top2_earnings`·`kr_sector_momentum`·`us_sector_momentum` | 스케줄러 배치 |
| `sp500_tickers`·`kospi_tickers` | 자체 `_is_fresh()` — **이 모듈의 유일한 나이 검사**이고 파일 mtime이 아닌 `fetched_at`을 올바르게 쓴다 |
| **`fx`** | **아무것도 없다** ← B41 |

**B41 — 키 `fx`에 배치도 나이 검사도 없다.** 작성자 `market_indicators/fx.py::get_fx`는 `routers/market_indicators.py`의 `GET /api/market/fx`와 admin refresh에서만 도달한다(`_JOB_FUNCS`에 fx 잡 없음, `main._warm_market_cache`는 econ·exports만 warm). 그런데 소비자는 나이 검사 없는 raw `_mc_load("fx")` 3곳이다:

- `routers/stocks.py::_usdkrw_rate` → 대시보드 `totals`
- `routers/portfolio.py` — `get_dividends`·`get_rebalance`·`get_exposure` 전부 `_usdkrw_rate()` 경유
- `services/digest_service.py` — 일일 텔레그램 다이제스트
- (+ `routers/recommendations.py`)

도달: 일주일간 아무도 시장지표 탭을 안 열면 포트폴리오 KRW 환산 총액·리밸런싱 비중·익스포저·배당 추정·일일 다이제스트가 전부 **일주일 된 환율**로 계산되고, 응답 어디에도 stale 마커가 없다. `_usdkrw_rate` 자체는 잘 짜여 있다(`math.isfinite` 가드 보유) — 결함은 순수하게 신선도다.

부수(§12.5): 그 함수의 docstring이 **존재하지 않는 배치를 단언한다** — *"FX 배치(get_fx)가 채운 영구 캐시를 읽는다."*

### 6.5 FX 저장 payload가 `usdkrw` history만 담는다 — **잠재 위험** (B25)

`fx.py::get_fx`:

```python
history = {"usdkrw": results["usdkrw"]["history"]} if results.get("usdkrw") else {}
```

`usdjpy`/`eurusd`의 history는 **한 번도 저장되지 않는다**. 결과: (a) `_fetch_fx`가 그 두 키에 대해 항상 `stored_history=[]`로 호출돼 **매 실행 1년치를 전량 재조회**하고, (b) `_fetch_fx` 안의 `stored_history` 기반 폴백 경로가 그 둘에겐 **원리적으로 발동 불가**하다. `rates` 수준 폴백(`failed` 리스트 ← `stored_rates`)은 정상 동작하므로 값이 사라지지는 않는다 — 비용과 죽은 폴백 경로가 문제다.

### 6.6 기동이 이벤트 루프를 블록한다 — **잠재 위험**

`main.py::lifespan`은 `_migrate()` → `sched.start()`를 **동기로** 부르고, `scheduler/__init__.py::start`는 `_scheduler.start()` **이전에** 다음을 순차 실행한다:

```python
_check_missed_report()      # 누락 티커마다 generate_report_with_retry (라이브 yfinance/Naver/KIS/DART)
_seed_rankings_if_empty()   # KR·US 라이브 Naver 랭킹 fetch
_seed_kr_sector_if_empty()  # 라이브 키움
_seed_us_sector_if_empty()  # 라이브 yfinance
_scheduler.start()
```

전부 이벤트 루프 스레드에서 돈다 → 그동안 `/health`가 응답하지 못한다. `deploy.sh`의 배포 후 `curl -s http://localhost/health`(고정 `sleep 2` 뒤)는 리포트 백필이 밀려 있는 배포마다 **"WARNING: health check failed"**를 찍지만, 그 curl이 `|| echo`라 배포는 그대로 완료로 보고된다(§10.5).

⚠️ **원인 귀속 주의**: CLAUDE.md에 기록된 "배포 후 API 5분+ 무응답"의 정확한 메커니즘은 **미확정**으로 남아 있다(lifespan 자체는 0.6초로 실측됐고 배치는 스케줄러 스레드다). 위 `sched.start()` 블로킹은 **코드로 확인된 별개 경로**이며, 그 5분 현상의 확정 원인이라고 단정하지 말 것.

### 6.7 잡 타임아웃·중복·종료 — **잠재 위험**

- **중복 실행은 불가능하나 스킵이 안 보인다**: `schedule.py`가 `coalesce=True, replace_existing=True`를 주고 `max_instances`를 생략해 APScheduler 기본 `max_instances=1`이 적용된다. 초과 실행은 *거부*되는데 APScheduler 내부 WARNING만 남고 **`job_runs` 행이 아예 안 생긴다** — 운영자는 직전 success만 보고 다음 발화가 드롭된 증거를 못 본다.
- **잡 타임아웃 없음**: `_investor_trend_work`·`_short_sell_work`가 `ThreadPoolExecutor(max_workers=8)`의 `future.result()`를 **`timeout=` 없이** 부른다. §2.5(yfinance 무타임아웃)와 겹치면 멈춘 HTTP 하나가 잡 전체를 무기한 잡는다. `AsyncIOScheduler`가 sync 잡을 `run_in_executor(None, …)`로 던지므로 기본 스레드풀을 점유한다.
- **종료**: `_scheduler.shutdown(wait=False)`. 진행 중 배치가 쓰기 도중 버려지고, `deploy.sh`의 `docker stop`(SIGTERM 10s)과 겹치면 `job_runs`에 **영구 `running` 행**이 남는다(`_finish`가 영영 안 돈다).
- **다중 스케줄러**: uvicorn 워커에서 오는 위험은 없다(`Dockerfile` CMD에 `--workers` 없음, compose에도 `command` 없음 → 단일 프로세스). 진짜 위험은 **컨테이너 이름 충돌**이다 — §10.3.

### 6.8 KST vs 컨테이너 UTC — **부분 가드**

`services/utils.py::today_kst`가 하우스 규칙이고 `tests/test_no_bare_today.py`가 강제한다. 하지만 그 가드는 AST에서 **`node.func.attr == "today"`만** 매칭하므로 **`datetime.now()`/`utcnow()`는 못 잡는다**. 시장 날짜 판정에 흘러드는 잔존 UTC 호출:

- **B42 `services/insider_trades.py::fetch_insider_trades`** (MED) — `bgn_de`/`end_de`를 `datetime.now()`로 만든다. `insider_fetch`는 KST 스케줄이라 00:00–09:00 KST엔 컨테이너 UTC가 전일이고, `end_de`가 **당일 DART 공시를 통째로 배제**한다.
- **B42 `services/disclosures.py::fetch_disclosures`** (MED) — `bgn_de` 시작점 동일 드리프트. 공시 피드와 AGM `meeting_date` 추출의 DART `list.json` 범위를 먹인다.
- **B7 `services/dividends.py::_recent_business_year`** (MED) — `now = datetime.now()` → `year - (2 if now.month < 4 else 1)`. **월 경계 판정**이라 4월 1일 00:00–09:00 KST(UTC 3월 31일)엔 `month==3`이 되어 `year-2`를 반환, 그 창의 모든 KR 배당이 틀린 사업연도로 조회된다. 아이러니하게 같은 파일이 올바른 `_today_kst()`를 따로 정의한다.
- LOW: `backlog.py`·`market/kr.py`의 `utcnow() - timedelta(days=730)`은 2년 룩백이라 하루 시프트가 무의미. `backlog.py::_get_corp_code_map`의 `utcnow()`는 *상대* TTL 비교라 올바름.
- LOW(사용자 노출): `scheduler/jobs.py::_run_guru_crawl`·`routers/guru.py`가 `datetime.now().isoformat()`으로 `last_updated`를 쓴다 — naive 로컬(=UTC)이라 한국 사용자에게 크롤 시각이 **9시간 과거로** 표시된다.

### 6.9 배치 레지스트리 정합 — **이미 가드됨 + 테스트 취약**

`batch_registry.BATCHES`는 29개, `_JOB_FUNCS`는 28개로 **의도적으로 하나 어긋나 있다**(`consensus`가 레지스트리에만 있다). 이 둘을 순진하게 동기화하려는 수정은 실패한다. 테스트 쪽 취약성은 §9.4.

---

## 7. 프론트엔드

### 7.1 access token 갱신 경로가 없다 — **확인된 버그** (B9)

`frontend/src/api.js`의 응답 인터셉터가 전부다:

```js
if (err.response?.status === 401) {
  localStorage.removeItem('access_token'); localStorage.removeItem('refresh_token')
  window.location.replace('/')
}
```

`refresh_token`은 **4곳에서 쓰이고 정확히 1곳에서 읽힌다** — `App.jsx`가 `/api/auth/logout`에 POST할 때뿐. `/api/auth/refresh` 호출은 **프론트 전체에 0건**인데 **백엔드 엔드포인트는 존재한다**(`routers/auth.py::refresh`). 즉 회전·만료가 제대로 구현된 서버측 리프레시가 통째로 미사용이고, 30일 refresh token은 `localStorage`에 순수 공격 표면으로 앉아 있다.

**부작용이 더 아프다**: 이 401 핸들러는 **전역 하드 내비게이션**이라 백그라운드 폴러에도 발동한다 — `usePortfolioData`(KR 장중 15초마다 `/api/portfolio/prices`)·`useReportGeneration`(1.5초마다 `/api/report/progress`). 도달: `StockModal`을 반쯤 채운 상태에서 토큰이 만료 → 폴러가 401 → **입력 중에 로그인 화면으로 순간이동**, 만료 안내 토스트도 복귀 경로도 없다(`location.replace`가 딥링크를 의도적으로 버린다).

### 7.2 에러 바운더리가 없다 — **확인된 버그** (B48)

`grep -rn "ErrorBoundary|componentDidCatch|getDerivedStateFromError" frontend/src/` → **0건**. 렌더 중 throw가 루트까지 전파되면 React 19가 트리 전체를 언마운트하고 `#root`가 비며, 내비게이션도 새로고침 유도도 없다(`useSwUpdateReload`도 함께 언마운트된다). `index.html`의 테마 부팅 CSS 때문에 사용자는 단색 사각형을 본다.

이 부재가 아래 크래시 사이트들을 전부 **백지**로 증폭한다:

| 심각도 | 파일 · 심볼 | 던지는 조건 |
|---|---|---|
| HIGH | `pages/GuruDetail.jsx::GuruDetail` — `splitManagerName(manager.name)` | `setManager(data)`가 null/빈 200 본문을 받으면 `loading=false`·`error=null`로 통과해 `manager.name` 접근 |
| HIGH | `pages/AnalystReport.jsx::AnalystReport` — `report.data \|\| {}` | `setReport(data)`에 null 가드 없음 |
| HIGH | `pages/Calendar.jsx` → `MonthGrid` — `setEvents(r.data.events)` 후 `for (const e of events)` | `events` 키 없는 응답 → not iterable |
| HIGH | `pages/Analytics.jsx::CorrelationHeatmap` — `!data.tickers.length`, `matrix.map(row => row.map(...))` | `tickers` 없는 200, 또는 비정형 matrix |
| MED | `pages/GuruManagers.jsx::GuruManagers` — `data.managers.filter(...)` | `setData(data)`가 기본값을 통째 교체(형제 `GuruHoldersSection`은 `data.managers \|\| []`로 올바름) |
| MED | `pages/GuruStats.jsx::StatRow` — `row.score.toFixed(3)` | 같은 파일의 다른 필드는 전부 `?? '-'`인데 여기만 무가드 |
| MED | `pages/Settings.jsx::BatchHub` — `batches.filter(...)` | `batches.length === 0` 검사가 객체에선 false라 `.filter`까지 도달 |

### 7.3 비동기 레이스 — **일부 가드됨, 7곳 미가드**

**참조 구현(그대로 둘 것)** — 세대 카운터를 `.then`·`.catch`·**`.finally`까지** 검사하는 올바른 형태:

- `pages/Ranking.jsx::fetchPage` — `genRef`를 세 핸들러 전부에서 비교하고, `if (!reset && loadingRef.current) return` 뮤텍스는 무한스크롤 재진입에만 걸며 `reset`이 뮤텍스를 우회해 세대를 올린다. **B27은 여기서 닫혔다.**
- `hooks/useTrackedStocks.js::reload` — `reloadGenRef` 3핸들러 검사.
- `pages/GuruAllocation.jsx` 스코프 이펙트 · `Compare.jsx` · `Recommendations.jsx` 마운트 이펙트 · `components/market/*Section.jsx` — `cancelled` 플래그 + cleanup.

**미가드(확인)**:

| 심각도 | 파일 · 심볼 | 증상 |
|---|---|---|
| **HIGH (B49)** | `pages/Reports.jsx` 상세 fetch 이펙트 | 티커 A → B를 빠르게 누르면 A 응답이 나중에 착지해 **헤더는 B, 수치는 A**. `.catch`가 없어 실패 시 `detail`이 이전 티커 값을 유지 → B 화면에 A의 목표가·RSI·컨센서스가 렌더된다 |
| HIGH | `pages/Ranking.jsx::onRowClick` | 세대 카운터 없음. (a) 모달을 닫아도 나중 착지한 응답이 **닫은 모달을 다시 연다**, (b) A→B 연속 클릭 시 B 모달 안에 A 리포트. 60줄 위에 올바른 패턴이 있는데 여기 적용만 빠졌다 |
| HIGH | `pages/Calendar.jsx` 월 이펙트 | `›`를 두 번 빠르게 → 헤더는 새 달, 셀은 옛 달의 실적·배당일 |
| MED | `pages/Recommendations.jsx::handleChip` | 마운트 이펙트엔 `cancelled` 가드가 있는데 칩 토글 재fetch엔 없다 |
| MED | `components/StockSearchBox.jsx` 검색 이펙트 | 디바운스(350ms)는 레이스 가드가 아니다 — 느린 1차 응답이 나중 착지해 `삼성전자` 텍스트 아래 `삼성` 결과가 뜨고, 행을 고르면 **틀린 티커**가 관심종목에 들어간다 |
| MED | `components/reports/HistoryTab.jsx` `snapshotA`/`snapshotB` 이펙트 | 비교 날짜를 빠르게 두 번 바꾸면 한 날짜의 값이 다른 날짜 헤더 아래 표시 |
| MED | `hooks/usePortfolioData.js::fetchAll`/`fetchDashboard` | 5개 호출 지점(마운트·bounded heal 루프·탭 클릭 2곳·↺ 버튼)이 경쟁하고 `finally`가 무조건 스피너를 끈다 |
| MED | `hooks/useReportList.js::fetchList` | 가드도 `.catch`도 없다 |

### 7.4 삼켜진 fetch가 "데이터 없음"으로 위장한다 — **확인된 버그**

**`.catch`가 아예 없는 곳**(미처리 rejection + 오류를 빈 상태로 렌더):

- **HIGH `pages/GuruManagers.jsx`** — `api.get('/api/guru/managers').then(...).finally(...)`. 실패 시 `데이터 없음 — 설정 > 구루 탭의 "즉시 크롤링"에서 데이터를 가져오세요.`가 뜬다. **fetch 실패가 사용자에게 크롤을 실행하라고 지시한다.** 형제 `GuruStats.jsx`·`GuruAllocation.jsx`는 둘 다 *"실패를 '크롤링을 먼저'로 위장하지 않는다"* 주석과 함께 올바르게 처리한다 — 이 파일만 놓쳤다.
- **HIGH `hooks/useReportList.js::fetchList`** — 실패 시 `reportList`가 `{}`로 남아 `리포트가 없습니다. 설정 페이지에서 '지금 생성' 버튼을…`이 뜬다. **앱의 주 화면이 백엔드 blip을 "리포트가 없다"로 표시한다.**
- **HIGH `hooks/useReportGeneration.js::_startPoll`** — 1.5초 `setInterval` 안의 bare `catch {}`. `/api/report/progress`가 계속 실패하면 인터벌이 영원히 안 걷히고 `generating`이 non-null로 남아 **진행률이 얼어붙은 "생성 중"**이 지속된다. 탈출은 언마운트뿐.
- MED: `pages/Reports.jsx`의 `?scope=all`(admin '그외' 탭 공백), `components/PermissionManager.jsx`(권한 관리 화면에 빈 사용자 표).

**삼키는 `.catch`**(오류와 "없음"이 구별 불가): `Ranking.jsx`의 리포트 모달 `.catch(() => {})`(500이 "아직 리포트 없음"으로 보여 사용자가 이미 있는 종목을 또 추가한다)·뉴스 `.catch(() => setNews([]))`, `StockSearchBox`의 `.catch(() => setResults([]))`. 의도적이고 문서화된 것: `ReportDetailTabs`·`DetailTab`(backlog)·`SupplySection`·`GuruHoldersSection`(`// eco: silent`)·`utils/analytics.js`·`utils/pwa.js`·`App.jsx` 로그아웃 비콘·`Calendar.jsx` 인접월 프리페치.

**MED `contexts/AuthContext.jsx`** — `/api/auth/me` 실패 시 `.catch(() => { setRole('user'); setMenuPermissions([]) })`. 재시도도 사용자 피드백도 없어 **admin이 blip 한 번에 일반 사용자로 조용히 강등**되고, admin 버튼·'그외' 탭·권한 화면이 사라진 것이 실제 권한 변경과 구별되지 않는다.

### 7.5 `authLoading` 데드엔드 — **잠재 위험**

`hooks/useAuthBootstrap.js`의 OAuth 분기가 쓰는 bare `fetch`에 **`AbortSignal`도 타임아웃도 없다**(`api.js`에도 axios `timeout` 설정이 없어 기본 0=무한). 모든 *정착* 경로는 `resolveStored()`로 `authLoading`을 내리므로 rejection은 덮여 있다 — 그러나 **영영 정착하지 않는 연결**(캡티브 포털, 조용히 끊긴 TCP)은 `authLoading=true`에 머물고 `App.jsx`가 스플래시를 무한 렌더한다. 수동 새로고침 외 탈출 없음. 같은 파일의 주석이 형제 실패 모드("새로고침 전까지 빠져나올 수 없는 백지")를 이미 문서화하고 있는데, **이것이 그 미덮인 변종**이다.

### 7.6 Service Worker가 `/api/*`를 가로챈다 — **닫혔다**(구 B47) + 설계 잔여

`vite.config.js`의 VitePWA `runtimeCaching`에서 `/api/*` 항목이 **통째로 제거**됐다(task#290 S4, ADR-0036) — 남는 `runtimeCaching`은 `google-fonts`·`cdn-fonts` 2건뿐이고 인증된 API 응답은 더는 캐시되지 않는다. 이미 기기에 남아있는 `api-cache` 저장소는 **삭제 지점 2곳**이 정리한다: 부팅 1회(`frontend/src/main.jsx`)와 `App.jsx::doLogout` — 둘 다 `apiCachePurge.js::purgeApiCache`(`caches.delete('api-cache')`)를 부른다.

- **닫힘(구 B47) — `api-cache`가 사용자별로 분리되지 않고 로그아웃에도 안 지워지는 문제.** 캐싱 자체가 없어졌으므로 교차사용자 데이터 서빙 경로가 사라졌다.
- ⚠️ **단, "닫혔다"는 새 SW가 활성화된 뒤의 이야기다.** 옛 SW가 아직 살아 있는 전환 창에서는 옛 SW가 계속 캐시하므로 위 삭제 2지점이 그 창의 방어선이다. `doLogout`이 SPA 전용(리로드 없음)이라 부팅 퍼지만으로는 **B47의 주 도달 경로("A 로그아웃 → 5분 내 같은 브라우저에서 B 로그인")가 같은 문서 안에서 일어나 안 덮인다** — 그래서 `doLogout`에도 퍼지를 넣었다(ADR-0036 결정절 보정). 그 창에 남는 잔여는 **로그아웃을 거치지 않는 계정 전환** 하나이고, 근본 처방은 삭제 지점 추가가 아니라 **SW 활성화를 앞당기는 것**이다(`injectRegister: 'auto'`가 만드는 `registerSW.js`가 등록을 `window.load`에 게이팅한다 — ADR-0036 후속 후보, 창 길이 미측정).
- **함께 닫힘 — 무표시 stale 금융 데이터(MED).** 10초 `networkTimeoutSeconds` 폴백이 최대 5분 된 캐시를 "방금"으로 보이게 하던 경로도 캐싱 제거로 동시에 사라졌다(`PriceFreshness`가 읽는 `lastUpdated` 자체의 계산 방식은 무변경 — 캐시가 없으니 그 오차가 발동할 입력이 없다).
- **앱 셸 stale 위험은 없다(확인, 무변경)** — `globPatterns`가 `.html`을 제외하고 `navigateFallback: null`, 프리캐시 목록에 `index.html`이 없다. 내비게이션은 항상 네트워크를 탄다.
- ⚠️ **다시 넣지 말 것** — API 캐싱을 되살리려면 캐시 키에 신원이 들어가야 한다(ADR-0036이 기각한 대안 2). 그 배선 없이 규칙만 되돌리면 이 항목이 그대로 재발한다.
- **업데이트 리로드 루프는 유계**(`hadControllerRef`가 최초 설치를 억제, `attemptReload`가 `pendingRef`를 리로드 *전에* 내린다). LOW 잔여: `isBusy()`가 `document.body.style.overflow === 'hidden'`을 바쁜 것으로 보므로, 어떤 경로가 스크롤 락을 남기면 탭이 옛 번들에 **무기한 고정**된다(폴백 타이머 없음).

### 7.7 동일 엔드포인트 다중 소비처 — **잠재 위험**(이미 드리프트 발생)

| 엔드포인트 | 소비처 | 실제 드리프트 |
|---|---|---|
| `/api/guru/managers` | `GuruManagers.jsx`·`GuruHoldersSection.jsx`·`Recommendations.jsx`·`GuruCrawlNow.jsx` | **있음** — `setData(data)`(무가드) vs `data.managers \|\| []` vs `guru.data?.managers` vs `.catch(() => ({data:{managers:[]}}))`. 한 엔드포인트에 **4개의 서로 다른 형태 계약** |
| `/api/stocks/dashboard` | `usePortfolioData.js`·`Analytics.jsx` | **있음** — `res.data?.holdings \|\| []`(객체 전용) vs `r.data?.holdings ?? r.data ?? []`(객체 *또는* 배열). 둘 중 하나는 계약을 잘못 알고 있다 |
| `/api/report/{ticker}/history` | `HistoryTab.jsx`·`useStockManagement.js`·`Ranking.jsx` | **있음** — `data.filter(...)`(무가드) vs `(data \|\| []).filter(...)` |
| `/api/report/list` | `useReportList.js`·`Reports.jsx`·`ReportManualGen.jsx`·`useReportGeneration.js` | `data.stocks ?? data` 이중 형태가 4곳 중 2곳에만 |
| `/api/stocks` | `useTrackedStocks.js`·`GlobalSearch.jsx`·`TechReport.jsx`·`AnalystReports.jsx` | `ticker→type` 맵 빌드가 3곳에서 독립 재구현(2곳은 바이트 동일) |
| `/api/market/fx` | `usePortfolioData.js`·`Analytics.jsx`·`FxSection.jsx` | `data?.rates?.usdkrw?.current` 경로 + 하드코딩 폴백값이 2곳에 복제 |
| `/api/consensus/{ticker}` | `ConsensusChart.jsx`·`AnalystReport.jsx` | `AnalystReport`는 `Array.isArray(data)` 가드, `ConsensusChart`는 없음 |

`components/reports/LatestDisclosuresSection.jsx`의 `Array.isArray(data) ? data : []`가 **저장소에서 유일하게 올바른 형태**다.

### 7.8 죽은 코드 — **잠재 위험**(낮음)

- **`components/Glossary.jsx` + `glossary/terms.js` + `glossary/match.js` + `Glossary.css`** — importer 0건. `terms.js`/`match.js`는 `Glossary.jsx`만 import하고 `Glossary.jsx`는 아무도 import하지 않는다. 용어집 기능 전체가 도달 불가이며, `glossary/match.test.js`가 초록을 유지해 생존했다.
- **`hooks/useAuth.js`** — `export { useAuth } from '../contexts/AuthContext'` 한 줄. 9개 소비처가 전부 `contexts/AuthContext`를 직접 import한다. importer 0건.
- **`hooks/usePortfolioData.js`가 만들고 아무도 안 읽는 값 3개** — `dashboardError`·`events7d`·`refreshLivePrices`. 3개 소비처(`Portfolio.jsx`·`Reports.jsx`·`Compare.jsx`) 중 어느 것도 구조분해하지 않는다. 특히 `events7d`는 **세 페이지 마운트마다 `GET /api/digest/latest`를 비용으로 치르고 결과를 버린다**. `dashboardError`가 안 읽히는 탓에 `Portfolio.jsx`는 재시도 *횟수*로 실패를 추정해, 진짜 0-보유 응답과 하드 실패가 같은 카드로 렌더된다.
- `hooks/useSwUpdateReload.js`의 `if (window.location.search.includes('oauth=')) return true` — 파일 자신의 주석이 현 배선에서 도달 불가임을 명시.

### 7.9 중복 렌더러 — **잠재 위험**(이미 드리프트)

- **`pages/GuruManagers.jsx`** 모바일 블록 vs 데스크톱 블록 — 정규화 64줄 중 **60줄 동일**. 이미 갈라졌다: 데스크톱 배지 툴팁만 `'\n[클릭하여 관심종목 추가]'`를 덧붙여 **같은 컨트롤이 뷰포트마다 다른 어포던스를 광고한다**.
- **`buildGuruCounts`** — `pages/GuruManagers.jsx`와 `pages/Recommendations.jsx`에 바이트 동일 정의(후자에 "앞의 것과 같다"는 주석까지 있다).
- `pages/Portfolio.jsx` 모바일/데스크톱이 5버튼 `analysisTab` 바를 그대로 복제.

`components/reports/StockActions.jsx`는 반대 사례다 — 과거 두 렌더러의 중복이었던 액션 버튼을 단일 컴포넌트로 통합했다.

### 7.10 접근성 — **일부 확인, `role="img"`는 클린**

**`role="img"` 3개 사이트는 전부 올바르다 — 고치지 말 것**: `components/sketches/*.jsx`(장식 라인아트 + `<title>`), `components/tech/TechLevelBand.jsx`(빈 장식 `<span>` 격자, 데이터는 `aria-label`과 형제 노드가 운반 — 자손 프루닝이 의도), `components/tech/TechGraph.jsx`(SVG가 `aria-hidden="true"`이고 같은 라벨을 `<ul className="sr-only">`로 재노출, 주석이 leaf-role 근거를 명시).

**MED — DOM에 없는 접기 3곳**(Ctrl+F·스크린리더 브라우즈·인쇄가 놓친다): `pages/GuruDetail.jsx`의 `expanded ? listRows : listRows.slice(0, DEFAULT_ROWS)`(21번째 이후 보유종목이 DOM에 없음), `pages/Recommendations.jsx::ExpandableGrid`의 `items.slice(0, count)`, `pages/AnalystReport.jsx::ConsensusSection`의 `brokerages.slice(0, 10)`. 저장소는 이미 반대로 판정한 바 있다 — `components/tech/ProseSections.jsx`의 주석: *"접기는 네이티브 `<details>`/`<summary>`다 — JS 상태 0, 키보드·스크린리더·Ctrl+F 검색이 전부 공짜"*.

**MED — 복구 수단 없는 한국어 절단**: `overflow:hidden; textOverflow:ellipsis; whiteSpace:nowrap`을 한국어 종목명에 걸면서 **`title` 속성이 없어** 전체 문자열에 어떤 경로로도 닿을 수 없다 — `pages/GuruDetail.jsx`(보유 행·전량매도 칩), `pages/Ranking.jsx` 데스크톱 분기(모바일 분기는 `WebkitLineClamp: 2`로 올바르다), `components/StockSearchBox.jsx`(이름이 유사 티커 간 주 판별자인 자리). `pages/GuruAllocation.jsx`가 올바른 대조군이다(수치를 별도 `<span>`으로 분리).

**MED — `guru-badge`가 클릭 전용이고 `role="button"` 안에 중첩**: `pages/GuruManagers.jsx`의 `<span onClick={…}>`에 `role`·`tabIndex`·`onKeyDown`이 없어 키보드·스위치 사용자가 토글할 수 없고, 그 span이 카드 `<div role="button" tabIndex={0}>` 안에 있어 인터랙티브 중첩이다. `GuruStats.jsx::WatchlistBtn`이 저장소 표준(진짜 `<button>`)이며 이 두 블록만 이례다.

### 7.11 거대 컴포넌트 — **잠재 위험**(낮음)

`components/reports/DetailTab.jsx`(690줄)·`pages/Ranking.jsx`(550)·`pages/AnalystReport.jsx`(547)·`components/reports/Sections.jsx`(516)·`ConsensusChart.jsx`(447)·`FinancialsChart.jsx`(434).

---

## 8. 캐시·무효화

### 8.1 인메모리 캐시 6종 — **잠재 위험**(스레드 안전성)

`services/cache.py`: snapshot(LRU 200)·list(TTL 5s)·dashboard(300s)·correlation(300s)·sector(300s)·macro(300s). 종목 추가·수정·삭제 시 dashboard·correlation·sector·macro가 자동 무효화된다. 이 dict들이 ThreadPool 워커(§4.2의 8~20 워커)에서 동시 접근되지만 락이 없다 — CPython GIL 덕에 개별 dict 연산은 원자적이라 실사고는 관측되지 않았다.

### 8.2 `market_cache` 신선도 — §6.3·§6.4 참조

키별 경계와 `fx`의 무배치 문제는 배치 절에 모았다(작성자가 스케줄러이므로).

### 8.3 캐시 무효화 대칭성 — **이미 가드됨**

캘린더는 종목 추가·삭제·승격 시 `invalidate_portfolio_caches(user_id)` → `calendar.clear_cache(user_id)`로 DB 행까지 지운다(과거 파일만 지워 DB가 stale이던 문제는 닫혔다).

---

## 9. 테스트·검증 게이트의 사각

**규모**: 백엔드 테스트 141개 파일, 프론트 63개.

### 9.1 실 DB 차단 — **이미 가드됨(잔여만)**

`tests/conftest.py`의 autouse `_block_real_db`가 `db_svc._get_pool`을 raise로 교체한다. 기원은 주석에 있다 — 라이브 DB `generate_report` 테스트가 실 `005930` 스냅샷을 덮은 사고.

**잔여(LOW-MED)**: 가드가 **DSN이 아니라 초크포인트를 막는다**. `backend/run_backfill.py`의 `psycopg2.connect(DB_DSN)`은 `_get_pool`을 거치지 않아 원리적으로 우회다(현재 그 경로를 부르는 테스트는 없다). 또 테스트가 autouse 이후 `_get_pool`을 되돌리는 것을 막는 장치는 없다. 완화: `pytest.ini`의 `testpaths = tests`가 `backend/scripts/`·`run_backfill.py` 수집을 막는다.

**파일시스템·네트워크는 클린(확인)**: 파일을 쓰는 테스트는 전부 `tmp_path` + 대상 상수 patch를 쓴다(`test_digest_service.py`의 `patch.object(ds, "DIGEST_DIR", tmp_path)` 등) — **tracked 경로에 쓰는 테스트 0건**. `backend/tests/` 어느 파일도 최상위 `import requests`/`import yfinance`를 하지 않으며, mock이 전혀 없는 21개 파일은 전부 순수 함수·메타 테스트라 소켓을 열지 않는다.

### 9.2 recharts는 jsdom에서 SVG 자체가 없다 — **설계상 트레이드오프**

> `scripts/uat271-formatter.mjs`가 이 항목을 `CONCERNS §9.3`으로 인용한다 — 하위번호 유지.

`ResponsiveContainer`가 jsdom에서 0크기라 축·틱·마커·막대가 전혀 렌더되지 않는다. vitest에서는 범례 텍스트·캡션·데이터 유무 분기·표 부재만 단언 가능하고, 라벨 겹침·정렬 같은 시각 속성은 **라이브 Playwright의 `getBoundingClientRect()`**가 유일한 관측 수단이다.

### 9.3 존재하는 자동 게이트(재발 방지 자산)

| 게이트 | 무엇을 막나 |
|---|---|
| `tests/test_no_public_reads.py` | 무인증 라우트 신설·stale allowlist **양방향** + route walk가 0건이 되는 거짓 통과 |
| `tests/test_security_auth_gaps.py` | override 없는 fresh app으로 실제 401(API 키 positive/negative 포함) |
| `tests/test_api_doc_sync.py` | 라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 엔드포인트 **존재** |
| `tests/test_no_print.py` | 앱 코드의 `print()` |
| `tests/test_no_bare_today.py` | bare `date.today()` (⚠️ `datetime.now()`는 못 잡는다 — §6.8) |
| `conftest._block_real_db` | 테스트의 prod DB 오염 |

### 9.4 정확한 개수 단언이 다음 배치 추가에서 깨진다 — **확인된 버그**(개발 마찰)

`batch_registry.BATCHES`에 **항목 하나를 더하면 3개 파일의 단언 3건이 동시에 깨진다**:

- `tests/test_batch_market_split.py` — `assert len(batch_registry.BATCHES) == 29`
- `tests/test_macro_signals_batch.py` — `assert len(batch_registry.BATCHES) == 29`
- `tests/test_batches_router.py` — `assert len(data) == 29` **그리고** `assert {b["id"] for b in data} == EXPECTED_IDS`(29원소 하드코딩 집합)

그 테스트 함수 이름이 아직 `test_lists_sixteen_batches_with_required_fields`인 채 29를 단언한다 — 이름이 배치 13개만큼 뒤처져 있고, **이 함정이 이미 반복적으로 발동했다는 직접 증거**다. 주의: `EXPECTED_IDS`엔 `consensus`가 들어 있는데 이는 `_JOB_FUNCS`(28개)엔 없다(§6.9) — 둘을 순진하게 동기화하는 수정은 실패한다.

### 9.5 게이트가 **못** 보는 것

- **레이아웃 수치·잘림·접힘·요소 간 간격·색 적용** — jsdom에 레이아웃이 없다. 라이브 프로브가 유일한 게이트다.
- **응답 스키마·인증 산문 드리프트** — `test_api_doc_sync.py`는 엔드포인트 *존재*만 본다.
- **줄번호 참조 드리프트** — 아무도 단언하지 않는다(§12.6).
- **판정축을 바꿔 통과하면서 거짓이 된 주석·docstring** — 스위트가 원리적으로 초록이다.
- **bfcache 복원** — Playwright 3엔진 전부 `pageshow.persisted`를 못 만든다(대조군으로 확정). chromium은 CDP로 물으면 `BackForwardCacheDisabledForDelegate`를 답한다 — 플래그 제거로 뚫리지 않는다.

### 9.6 admin 표면은 라이브 UAT가 원리적으로 불가 — **설계상 트레이드오프**

라이브 UAT 계정이 비admin이라 admin 화면·`require_admin` 엔드포인트를 Playwright로 열 수 없다. 대안 4축(게이트를 `require_admin_or_api_key`로 열기 / vitest+기능경로로 닫고 버튼 렌더는 이월 / admin 크레덴셜 수령 / **in-container 자체 호출**)을 착수 전에 골라야 한다.

### 9.7 프로브 자산 자체가 부채 — **잠재 위험**(낮음)

`scripts/`에 143개 항목이 쌓였고 루트에 `screenshots-uat*` 디렉터리가 90여 개 있다(전부 untracked). 어느 프로브가 현재 계약을 단언하고 어느 것이 스테일인지 구분하는 인덱스가 없다.

---

## 10. 배포·인프라·운영

### 10.1 두 개의 비동기화된 `git reset --hard origin/main` — **설계상 트레이드오프**(운영 위험 큼)

- `scripts/auto-deploy-poll.sh` — launchd 2분 주기
- `.github/workflows/deploy.yml` — self-hosted 러너

**둘 다 개발자의 라이브 작업 디렉터리에서 돈다**(이 감사가 도는 바로 그 경로). `/tmp/portfolion-deploy.lock`은 *동시 배포*는 막지만 작업트리를 보호하지 않는다 — 폴러는 lock 이후에 reset하는 반면 **Actions 워크플로우는 lock을 아예 확인하지 않고** `deploy.sh` 호출 전에 reset한다.

부수: 락이 PID도 staleness 검사도 없는 bare `/tmp` 파일이라 **크래시한 배포가 락을 남기면 이후 모든 배포가 영구 정지**한다(`deploy.sh`는 `exit 1`, 폴러는 `exit 0`).

### 10.2 컨테이너가 compose 밖에서 돈다 — **잠재 위험**

`deploy.sh`는 `docker compose`를 전혀 쓰지 않고 `portfolion-backend-1`·`portfolion-nginx-1`을 손으로 `docker run`한다 — **compose가 생성할 이름과 정확히 같다**(프로젝트 `portfolion` + 서비스 `backend`). 결과:

- **`postgres`는 `deploy.sh`가 기동·재기동하지 않는다** — 사전 `docker compose up`으로 이미 떠 있어야 한다.
- compose의 `depends_on: postgres: condition: service_healthy` 게이트가 **배포 경로에서 통째로 우회**된다(백엔드가 DB 없는 상태로 뜰 수 있다).
- 배포된 nginx가 compose의 **certbot 볼륨 마운트를 누락**한다. 현재는 `nginx/nginx.conf`의 `listen 443 ssl` 블록이 전부 주석이라 치명적이지 않으나, `location /.well-known/acme-challenge/ { root /var/www/certbot; }`는 **살아 있고 마운트 안 된 경로를 가리킨다** → deploy.sh가 띄운 nginx로는 ACME 갱신이 불가하다. 443 블록의 주석을 풀면 그 nginx는 아예 기동에 실패한다.
- 이후 누군가 `docker compose up -d`를 돌리면 자기가 만들지 않은 컨테이너를 보고 재생성하며, 손으로 띄운 컨테이너가 살아 있는 동안 그것을 돌리면 **같은 network-alias에 스케줄러 프로세스가 2개** 생길 수 있다(§6.7).

### 10.3 헬스체크·재시작 정책 — **잠재 위험**

- `docker-compose.yml`에 healthcheck가 있는 서비스는 **`postgres`뿐**(`pg_isready`).
- **`backend`엔 healthcheck가 없다** — compose에도 `deploy.sh`의 `docker run`에도. `--restart unless-stopped`는 *프로세스 종료*에만 반응하므로 **hang한 uvicorn은 영영 재시작되지 않는다**(§6.6·§6.7의 무타임아웃과 결합).
- **`certbot`엔 재시작 정책이 없다** — `while :; do certbot renew; sleep 12h; done` 루프가 호스트 재시작·컨테이너 크래시 시 영구 종료되고 인증서 갱신이 조용히 멈춘다.

### 10.4 배포 검증이 비차단이고 롤백이 없다 — **잠재 위험**

유일한 검증이 고정 `sleep 2` 뒤의 `curl -s http://localhost/health && echo " <- /health OK" || echo "WARNING: health check failed"`다 — **구조적으로 비차단**이다. 롤백 경로 없음. §6.6과 겹쳐 기동 백필이 있는 배포마다 이 경고가 뜨지만 배포는 성공으로 보고된다.

### 10.5 시크릿 폴백 — **확인된 버그** (B21·B19)

| 환경변수 | 파일 | 형태 |
|---|---|---|
| `POSTGRES_PASSWORD` | `docker-compose.yml` | `${POSTGRES_PASSWORD:-<리터럴 기본값>}` — 호스트 env가 없으면 tracked 파일에 박힌 약한 비밀번호로 조용히 뜬다 |
| `SESSION_SECRET` | `backend/routers/auth.py` | 모듈 레벨 `os.environ.get(..., "<리터럴 기본값>")` (§5.5) |

둘 다 저장소에 커밋돼 있다. 그 외 리터럴 시크릿 폴백은 없다. `backend/.env.docker`(실 시크릿 저장소)와 루트 `.env`는 올바르게 gitignored.

추가 노출: `docker-compose.yml`이 postgres를 `"5432:5432"`로 **호스트에 발행**한다. self-hosted 러너 머신에서 이는 호스트 인터페이스에 닿는 DB다.

### 10.6 볼륨 권한 — **잠재 위험**(낮음)

compose의 postgres 서비스가 `./backend/auth_schema.sql`·`./backend/app_schema.sql`을 **`:ro` 없이** `/docker-entrypoint-initdb.d/`에 마운트한다. 엔트리포인트는 읽기만 하지만 컨테이너가 tracked 소스 파일 2개에 쓰기 권한을 갖는다(그 파일들은 §10.1의 폴러가 `reset --hard`하는 대상이기도 하다). nginx 마운트는 compose·`deploy.sh` 양쪽에서 올바르게 `:ro`다.

부수(LOW): `deploy.sh`가 `TMP_DOCKER_CONFIG=$(mktemp -d)`를 만들고 지우지 않는다(`trap`은 락만 정리) — 배포마다 `/tmp` 디렉터리 누수.

### 10.7 의존성이 고정되지 않았다 — **잠재 위험**

`backend/requirements.txt` 18줄 전부 `>=` 또는 제약 없음(`python-dotenv`는 무제약), **락파일 없음**. `Dockerfile`이 `pip install -r requirements.txt`를 매 빌드 실행하고 `deploy.sh`가 매 배포 재빌드한다 → **같은 커밋의 두 배포가 서로 다른 `yfinance`·`pandas`·`fastapi`를 설치할 수 있다**. `yfinance>=0.2.40`은 `.info`/`.history` 형태 변경과 Yahoo 엔드포인트 이동 이력이 있는 라이브러리라, "어제는 됐는데" 클래스 장애의 가장 유력한 출처다.

프론트: `package.json`은 caret이지만 `package-lock.json`이 tracked다. 다만 `deploy.sh`가 `npm ci`가 아니라 **`npm install`**을 돌려 배포 중 락파일이 재작성될 수 있다.

### 10.8 로컬 `.venv`(3.9.6) ≠ Docker(3.12) — **설계상 트레이드오프**(사실상 하드 제약)

`backend/.venv/pyvenv.cfg`가 `version = 3.9.6`(macOS 시스템 파이썬), `backend/Dockerfile`이 `FROM python:3.12-slim`. **마이너 3개 차이**다. 코드는 3.10+ 문법(`str | None`)을 쓰면서 모듈마다 `from __future__ import annotations`로만 3.9에서 버틴다 — 그 import를 빠뜨리거나 어노테이션이 *런타임 평가*되는 자리(Pydantic 모델·FastAPI 시그니처)에 `X | Y`를 쓰면 컨테이너는 통과하고 로컬 pytest가 `TypeError`를 낸다. 로컬 pytest가 게이트이므로 실질적 하드 제약이다.

**`lxml`은 이미지엔 있고 로컬엔 없다** — `requirements.txt`에 `lxml>=4.9.0`이 있지만 `.venv`(228 패키지)에 없다. 코드는 이 괴리를 **손으로 견뎌 왔다**: 모든 `BeautifulSoup` 호출이 `"html.parser"`를 명시적으로 넘기고, `backlog_parser.py`가 `XMLParsedAsHTMLWarning`을 그 이유와 함께 억제한다. 즉 오늘의 일치는 **구조가 아니라 관례**다 — 누군가 두 번째 인자 없이 `BeautifulSoup(html)`을 쓰는 순간 컨테이너는 `lxml`, 로컬은 `html.parser`를 자동 선택해 파스 트리가 갈린다(특히 비정형 DART HTML에서).

**같은 패키지의 버전차도 형태를 바꾼다**: 배포 이미지의 FastAPI는 `include_router`로 들어온 라우트를 감싸 `.routes`를 평탄하게 노출하지 않을 수 있다. `app.routes`를 순회하는 코드는 로컬에서 100+개를 세고 컨테이너에서 0개를 셀 수 있다 — `tests/test_no_public_reads.py`가 이 실패 모드를 `len(api_routes) > 100` 단언으로 막고 있는 이유다(§5.1).

### 10.9 규모·복잡도 핫스팟

**백엔드 최대 파일**: `services/report_generator.py`(757)·`routers/stocks.py`(675)·`services/market/kr.py`(664)·`routers/report.py`(592)·`scheduler/jobs.py`(534)·`services/recommendation/funnel.py`(475)·`services/batch_registry.py`(473, 선언형 표)·`services/backlog.py`(438)·`services/consensus_pipeline.py`(424)·`services/guru_scraper.py`(421).

**150줄 초과 함수 2개**:
- **`report_generator.py::generate_report` — 322줄.** 동시에 (a) 최대 함수 (b) 가장 뜨거운 외부 I/O 경로 (c) §6.6에 따라 **기동 시 이벤트 루프에서 동기 실행**되는 함수다.
- **`routers/stocks.py::get_dashboard` — 173줄.** 단일 요청 경로 핸들러.

**프론트 최대 파일**은 §7.11. 백엔드 비테스트 19,287줄 / `frontend/src` 비테스트 19,709줄.

부수(LOW): `frontend/src/api.js`의 공유 axios 인스턴스가 `baseURL`만 설정하고 **`timeout`이 없다**(axios 기본 0=무한) — §6.6·§2.5의 hang이 UI를 무기한 스피너로 묶는다.

---

## 11. Cowork fire 파이프라인 (ADR-0028)

### 11.1 게이팅·SSRF — **이미 가드됨**

`POST /api/admin/cowork/fire`는 `require_admin_or_api_key`다. `services/cowork_trigger.py`는 **고정 env URL**(`COWORK_ROUTINE_FIRE_URL`)로만 POST하고 목적지가 사용자 입력을 받지 않는다 — **SSRF 없음**. `enabled()`가 `COWORK_ROUTINE_FIRE_URL`+`COWORK_ROUTINE_FIRE_TOKEN` 양쪽을 요구하는 both-required 게이트라 키 미설정 시 휴면이다.

### 11.2 best-effort 성격 — **설계상 트레이드오프**

fire 훅은 실패해도 본 요청을 막지 않는다(의도). 잔여는 §6.2와 같다 — 실패가 관측면에 안 나타난다.

---

## 12. 문서·설정 드리프트

### 12.1 부채 마커는 사실상 없다 — **관찰**

`TODO`/`FIXME`/`HACK` **0건**. 전 저장소(테스트 포함, `node_modules`·`.venv`·`dist` 제외)에서 10건이 걸리는데 그중 진짜 표시된 지름길은 **`components/PermissionManager.jsx` 1건뿐**("임시로 `selectedIds.length`를 `pendingPerms`에 붙인다")이고 나머지는 서술·환경 주석·`\uXXXX` 오탐이다.

**함의**: 이 저장소의 설계 의도는 마커가 아니라 **매우 긴 한국어 docstring**에 실린다. 따라서 실제 부채는 *주석되지 않은 구조적 부채*이며, 그것이 이 문서 §1~§11의 내용이다. 마커 grep으로 부채를 찾으려 하지 말 것.

### 12.2 `deploy.sh` 안의 죽은 TLS 설정 — **잠재 위험**(오판 유발)

`nginx/nginx.conf`의 `listen 443 ssl` 블록이 전부 주석 상태인데 ACME challenge location은 살아 있다(§10.2). "HTTPS가 설정돼 있다"는 오독을 유발한다 — 실제 TLS 종단은 Cloudflare Tunnel이다.

### 12.3 스테일 주석 — **잠재 위험**(틀린 불변식을 심는다)

| 위치(심볼) | 주장 | 실제 |
|---|---|---|
| `routers/stocks.py::_usdkrw_rate` docstring | "FX 배치(get_fx)가 채운 영구 캐시를 읽는다" | **그 배치는 존재하지 않는다**(§6.4) |
| `scheduler/jobs.py`(2곳)·`routers/stocks.py` | 풀이 `maxconn=10` | 실제 20(§4.2) |
| `tests/test_batches_router.py` 함수명 | `test_lists_sixteen_batches...` | 29를 단언(§9.4) |
| `services/ranking_service.py::_fetch_naver_market` docstring | "한 페이지라도 실패하면 RuntimeError" | 0페이지 케이스엔 안 던진다(§1.1) |

### 12.4 리포지토리 위생 — **잠재 위험**(악화 중)

루트에 `screenshots-uat*` 디렉터리 90여 개 + `screenshots-*` 변형이 전부 untracked로 쌓여 있다. `.forge/` 산출물, `.planning/`, `.superpowers/`, `.worktrees/`, `supabase/`(제거된 인프라의 잔재)도 공존한다. `git status`가 사실상 판독 불가라 **§10.1의 폴러가 무엇을 날릴지 눈으로 확인하기 어렵다**.

### 12.5 `backend/migrations/`가 죽었다 — **확인된 버그**(문서·구조)

`001_user_events.sql`·`002_backlog_history.sql`을 참조하는 스크립트·compose·모듈이 **하나도 없다**. 마이그레이션 디렉터리의 존재가 "마이그레이션 체계가 있다"는 오해를 만들지만 실제 자동 경로는 `main._migrate()`뿐이다(ADR-0006).

### 12.6 코드 주석이 이 문서의 섹션 번호를 인용하고 **절반이 stale** — **잠재 위험**(신규 실측)

`CONCERNS §N` 인용은 코드 8곳 + `API_SPEC.md` 1곳 = **9건**이다. 이번 판에서 각각이 실제로 가리키는 절과 대조한 결과:

| 인용 위치 | 인용 번호 | 이번 판의 실제 절 | 상태 |
|---|---|---|---|
| `backend/main.py` (`_validation_error_handler`) | §3 | §3 NaN/Inf | ✅ |
| `backend/routers/stocks.py` (`_usdkrw_rate`) | §3 | §3 | ✅ |
| `backend/routers/stocks.py` (`_build_all` sanitize) | §3 | §3 | ✅ |
| `backend/tests/test_stocks_router.py` | §3 | §3 | ✅ |
| `scripts/uat271-formatter.mjs` | §9.3 | §9.2(recharts/jsdom) | ⚠️ 하위번호 이동 |
| `backend/services/db.py` (`_get_pool`) | §4.2 | §4.2 커넥션 풀 | ✅ (이번 판에서 §4.5→§4.2로 **정렬시킴**) |
| `backend/routers/recommendations.py` | §1 | §3 NaN/Inf | ❌ stale |
| `backend/routers/calendar.py` | §7 | §6.9/§12(FOMC 정적 목록) | ❌ stale |
| `backend/routers/batches.py` | §7 | §6.9 | ❌ stale |
| `API_SPEC.md` (FOMC 커버리지) | §7 | §6.9 | ❌ stale |

**대분류(§0~§14) 번호는 이번 판에서 바꾸지 않았다.** 커넥션 풀은 직전 판의 §4.5에 있었는데 `db.py`가 §4.2로 인용하고 있어, **문서 쪽을 인용에 맞춰 §4.2로 옮겼다**(코드를 건드리지 않고 참조 1건을 복구). 남은 stale 4건은 코드·문서 수정이 필요하며 이 문서 단독으로는 닫을 수 없다.

⚠️ **줄번호 참조는 이 문서에서 가장 드리프트가 심한 축이다.** 이번 판은 그 위험을 낮추기 위해 **줄번호를 거의 쓰지 않고 심볼명으로만 지목**했다. 백엔드 코드에 줄을 넣고 빼는 슬라이스는 시프트가 부위별로 달라 산술 추정이 틀리므로, 참조를 갱신할 땐 `git show HEAD:<file>`로 옛 줄을 읽어 **의미로** 재확정할 것.

---

## 13. `CLAUDE.md`·직전 판의 서술 중 지금과 다른 것

### 13.1 이번 패스에서 **반증**된 것

| 서술 | 실제 |
|---|---|
| "`get_connection()`이 정상 종료 시 커밋한다 — 롤백 전제 코드가 성립하지 않는다" | **롤백 경로가 있다**(`except Exception: conn.rollback(); raise`). 진짜 잔여는 `execute()` 루프의 문장 간 원자성 부재다 — §4.3 |
| `short_sell_service`·`investor_service`·`lending_service`·`leverage_service`가 delete-rewrite | 전부 **append-only upsert**, `DELETE` 없음. 빈 fetch가 이미 안전한 no-op — §1.4 |
| `services/guru_scraper.py::save_guru_managers` | 그 심볼은 **존재하지 않는다**. 실제 writer는 `services/storage/schedule.py::save_guru_managers`이고 저장소에서 가드가 가장 촘촘한 함수다 |
| `market_cache`는 `force=True` 배치 전까지 영구 서빙 | 전제는 맞으나 **어떤 배치도 `get_or_refresh`에 `force=True`를 넘기지 않는다** — 배치는 `_fetch_and_save_*`를 직접 부른다 — §6.3 |
| "B27 랭킹 마켓 토글 레이스" | **닫혔다** — `Ranking.jsx::fetchPage`가 `genRef`를 `.then`·`.catch`·`.finally` 전부에서 검사한다 — §7.3 |
| 무인증 엔드포인트가 리스크 표면 | 정확히 9개, 전부 `auth.py`, 사용자 데이터 노출 0건, allowlist 테스트와 드리프트 0 — §5.1 |
| `services/analysis_service.py`가 NaN을 흘린다 | 내부에 `math.isfinite` 가드가 있다. 잔여는 sanitize 안전망 부재뿐(낮음) — §3.3 |

### 13.2 이번 패스에서 **재검증하지 못한 것** — 미확인

직전 판의 §0에 있었으나 `20dd46e` 코드로 확정하지 못한 항목. **해소된 것이 아니라 확인하지 않은 것**이다.

> **판정 완료: 2026-08-11 (task#292, 9차 버그 헌트 LC 판정 레인).** 아래 8건을 **현재 코드 직독**으로 판정했다(추정 금지 — 각 판정에 코드 인용 첨부). **8건 중 7건이 판정됐고 1건만 이월**로 남는다. 열림으로 확정된 6건은 **§0으로 이동**했고(기존 번호 복귀 `B8`·`B30` + 무번호였던 4건에 신규 번호 `B60`~`B63`), 닫힘 1건은 아래 「해소」로 옮겼다.
>
> **판정축은 2축이다** — **생존**(열림/닫힘/부분/판정불가) × **위치**(제자리/이동/소멸). 한 축에 섞으면 "이동하며 닫힘"이 표현 불가라 판정기가 임의로 하나를 고르게 되고, **그 선택은 판정기 탓이 아니라 축 설계 탓**이다(8차에 실제로 그 일이 났다 — 8차 회고 학습 3).
>
> **판정기의 이빨을 대조군으로 검증했다** — 답이 알려진 2건(`B1` = 열림 / 구 `B50` = 닫힘)을 **어느 것이 대조군인지 알리지 않고(블라인드)** 8건에 섞어 투입해 **2/2 기대대로** 나왔다. 대조군 없이는 "대상이 안 그렇다"와 "판정기가 못 본다"가 구별되지 않는다(가토 ⑧ⓔ).

| # | 항목 | 생존 | 위치 | 판정 근거 | 이동 |
|---|---|---|---|---|---|
| B8 | 컨센서스 `report_date`가 UTC 변환으로 하루 밀림 | **열림** | 제자리 | 현재 코드 인용 확인 | → §0 (LOW) |
| B30 | 티커 유니버스 캐시가 **축소된** 스크레이프를 무검증 저장 | **열림** | 제자리 | 현재 코드 인용 확인 | → §0 (MEDIUM) |
| B33 | `any(snap_dist.values())`가 진짜 0/0/0을 결측으로 오판 | **닫힘** | 제자리 | **구조적 배제** — `market/kr.py::get_analyst_data_kr`의 세 버킷(`c>=3.5` / `2.5<=c<3.5` / `c<2.5`)이 실수선을 **완전 분할**하고, `market/__init__.py::get_analyst_data`도 yfinance 5열을 3버킷으로 완전 분할한다. 따라서 `buy+hold+sell==0 ⟺ 파싱된 평가 0건`이 참이고, 그 상태에서 mart 보충은 주석이 명시한 **의도된 폴백**이다 | → 해소 (아래 주의) |
| — | `_filter_outliers`가 저장 시계열을 영구 손상 | **열림** | 제자리 | 현재 코드 인용 확인 | → §0 **B60 (HIGH)** |
| — | Naver 재무를 **위치 인덱스**로 읽는다 | **열림** | 제자리 | 현재 코드 인용 확인. 직전 판이 "다음 매핑의 우선 대상"으로 지목한 그 항목 | → §0 **B61 (HIGH)** |
| — | `_table_unit`의 억원 기본값 폴백(×100 오저장 클래스) | **열림** | 제자리 | 현재 코드 인용 확인 | → §0 **B62 (MEDIUM)** |
| — | 프론트 포매터 중복 15종 | **열림** | 제자리 | 재계수 수행 | → §0 **B63 (LOW)** |
| — | 인메모리 캐시 스레드 안전성의 실제 사고 가능성 | **판정불가** | 판정불가 | **도구 범위 밖 — 동시성 재현이 필요하다.** 억지 판정하지 않고 사유와 함께 잔류시킨다. 2사이클 연속 이월이므로 다음 결정은 "계속 미룰지 vs 동시성 하니스를 만들지"다 | **잔류(이 절)** |

⚠️ **B33 닫힘은 8차 판정의 정정이다.** 8차 리포트의 「판정 뒤집기」 절이 이 줄을 **CONFIRMED**로 확정했는데, 9차 메인 세션이 직독해 **닫힘이 옳음을 확정**했다. 8차의 논증(기각자가 쓴 불변식 `합==0 ⟺ 커버리지 0`이 거짓임을 반례로 증명)은 **사실이지만 결론이 과하다** — 판정에 필요한 불변식은 `합==0 ⟺ 파싱된 평가 0건`이고 그것은 버킷 완전분할에 의해 참이다. **기각 논리를 깨면 그 건은 *확정*이 아니라 *미판정*으로 돌아간다**(일반 교훈: 기각을 무너뜨린 뒤 "이 도달 가능한 상태에서 코드의 실제 동작이 틀렸는가"를 독립으로 다시 물어야 한다).

### 13.3 원인 귀속을 **단정하지 말 것**으로 남는 것

- **"배포 후 백엔드가 `Up`인데 API가 5분+ 무응답"** — lifespan 자체는 0.6초로 실측됐고 배치는 스케줄러 스레드라 비블로킹이다. 정확한 메커니즘(GIL/이벤트 루프 기아 등)은 **미확정**이다. §6.6의 `sched.start()` 블로킹은 코드로 확인된 *별개* 경로이며 그 현상의 확정 원인으로 귀속하지 말 것.
- **"005930이 정확히 70000.0으로 박제"** — 피드 글리치가 아니라 **로컬 pytest가 prod DB에 쓴 오염**이 유력하고, 실제로 멈춘 것은 `conftest._block_real_db`(§9.1)였다. 박제-시 독립피드 게이트와 2-of-N 다수결은 **미래 글리치 보험으로 유효**하나, 관측된 70k에 발동한 적은 없다. 라운드 70k가 또 보이면 피드보다 **테스트 오염을 먼저 의심**할 것.

---

## 14. 계획됐지만 미실행인 것

`.forge/backlog/`는 **비어 있다** — 대기 중인 계획 0건.

`.forge/adr/`엔 ADR 35건이 활성(`0001`~`0035`)이고 `retired/`는 없다.

이 문서가 식별한 **후속 후보**(계획으로 승격되지 않은 것):

| 우선순위 | 항목 | 절 |
|---|---|---|
| 1 | 에러 바운더리 신설 — §7.2의 크래시 7곳이 현재 전부 백지다 | §7.2 |
| 2 | `_fetch_naver_market`의 0페이지 가드(형제 US 경로와 대칭화) | §1.1 |
| 3 | `fx` 배치 신설 또는 `_usdkrw_rate`에 나이 검사 | §6.4 |
| 4 | 로그인 레이트리밋(bcrypt CPU 고갈 DoS) | §5.6 |
| 5 | `Reports.jsx`·`Ranking.jsx::onRowClick` 세대 가드(잘못된 종목 수치 렌더) | §7.3 |
| 6 | 27개 잡을 `Run.set_status` 패턴으로(키 미설정이 success로 기록되는 문제) | §6.1 |
| 7 | `_migrate`에 후발 테이블 4개 + `tickers` 컬럼 3개 추가 | §4.1 |
| 8 | `test_no_bare_today.py`를 `datetime.now()`까지 확장 | §6.8 |
| 9 | `BATCHES` 개수 단언 3곳을 구조 단언으로 교체 | §9.4 |
| 10 | §13.2의 미확인 7건 재검증(특히 Naver 재무 위치 인덱스 파싱) | §13.2 |
