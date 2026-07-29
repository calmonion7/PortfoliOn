---
last_mapped_commit: 0822d53d4fd6f23af7fc050fddb2c98064e2d1c3
mapped: 2026-07-29
---

# PortfoliOn — 기술부채 · 알려진 이슈 · 리스크 지도 (CONCERNS)

**무엇이 깨지는가 · 어떻게 드러나는가 · 어디에 있는가**만 구현 사실로 기록합니다. 도메인 용어의 *정의*는 `.forge/CONTEXT.md`, 코딩 규약은 `CONVENTIONS.md` 소관입니다.

## 근거 표기

| 표기 | 뜻 |
|---|---|
| **[코드확인]** | 이번 매핑에서 HEAD(`0822d53`) 소스를 직접 읽어 확인 |
| **[기록]** | 루트 `CLAUDE.md` Gotchas · `.forge/retro/` · `.forge/adr/` · `.forge/bug-report.md`에 남은 과거 사례가 근거 (코드로 재확인하지 못한 부분) |
| **[해결됨]** | 과거 이슈이며 현재 가드가 실재 — 괄호에 가드 위치. **열린 문제로 다시 올리지 말 것** |

성격 태그: **[live-fail]** fixture 통과·라이브 실패 / **[footgun]** 절차·인프라 / **[data]** 캐시·저장 오염 / **[test]** 안전망 결함 / **[sec]** 노출면 / **[doc]** 문서 드리프트.

---

## 0. 지금 열려 있는 것 (요약)

5차 버그 헌트(`.forge/bug-report.md`, task#221) 잔여 12건은 **전건 여전히 미수정**입니다 — 이번 매핑에서 각 파일·줄을 다시 열어 재확인했습니다. 직전 매핑(`4bb49ff`) 이후 실코드 커밋은 2건(task#241 구루 투자금 탭, task#242 빈 결과 가드)뿐이고 이 12건이 참조하는 파일은 `commodities.py`(N2 대상 중 1개, change_pct 라인 무변경)를 빼면 건드리지 않았습니다.

**직전 매핑의 G1은 해결됐습니다**(§2.1). 대신 이번 매핑에서 **새로 5건(G2~G6)**을 올립니다.

| # | 증상 | 위치 | 등급 | 근거 |
|---|---|---|---|---|
| ~~G1~~ | ~~구루 크롤이 부분·빈 결과를 무조건 전체 저장으로 덮는다~~ | — | **해결(task#242, `0822d53`)** | [코드확인] §2.1 |
| **G2** | **KR 수출이 "성공-but-빈 months"를 박제** — 예외만 가드하고 값 수준 가드가 없어, 200-with-no-data 응답이 `market_cache`와 `backend/data/kr_exports.json` **양쪽**의 직전 양호값을 빈 배열로 덮는다(task#242가 놓친 6번째 사이트) | `backend/services/market_indicators/exports.py:105-123` | MED | [코드확인] |
| **G3** | **KR 업종 역인덱스 클로버** — `refresh()`는 sectors의 all-None만 가드하고, `build_sector_index()`가 전량 실패해 `{}`를 반환해도 그대로 저장 → 보유→업종 매핑이 통째 소멸 | `backend/services/kr_sector_service.py:74-86,91-101` | MED | [코드확인] |
| **G4** | **dataroma `cells[6]` 위치의존이 "그럴듯한 오값"을 만든다** — 열이 하나 밀리면 다른 *숫자* 열(예 Reported Price)이 `_parse_portfolio_value`를 통과해 예외·경고 없이 저장되고, 그 값이 투자금 탭 총액의 분모가 된다 | `backend/services/guru_scraper.py:157-163` + `backend/services/guru_stats.py:41,55` | MED | [코드확인] |
| H1 | `change_pct`를 명시적 JSON `null`로 보내면 **발행 요청 전체가 422** — 타입이 `Optional[float]`이 아니라 `float` | `backend/routers/analyst_reports.py:29` | HIGH | [코드확인] |
| N1 | API key 보유자가 **임의 프롬프트 텍스트**를 `claude -p`(`--allowedTools Bash,…,Write`)에 주입 가능 → 로컬 임의 실행 경로 | `backend/routers/admin.py:239-240` → `scripts/cowork-fire-listener.py:35-37,42-47` | HIGH(구조) | [코드확인] |
| N2 | 시장지표 5종 응답이 `sanitize`·`isfinite` 무가드 + `if prev` 진위판정이 NaN을 통과 → NaN 직렬화 500 소지 | `commodities.py:25`·`fx.py:30,39`·`macro.py`·`econ.py`·`exports.py` | MED | [코드확인] |
| N3 | 로그인만 하면 **프로세스 전역** 대시보드 캐시 flush / **전역** 수주잔고 쓰기 가능(admin 게이트 없음) | `backend/routers/stocks.py:405-408`, `backend/routers/report.py:581-582` | MED | [코드확인] |
| M1 | 발행물 상세(`/analyst-report/…` 단수)에서 마스트헤드 서브바 소실 — items는 `/analyst-reports`(복수)뿐 | `frontend/src/components/Masthead.jsx:19,74` | MED | [코드확인] |
| M2 | 같은 초 fire 2회 → workdir 충돌로 실행 중 프로세스의 `run.log` truncate + cwd 공유 | `scripts/cowork-fire-listener.py:38-41` | MED | [코드확인] |
| M3 | 모바일 탭바가 심층 리포트 라우트 2종을 인식 못 함 | `frontend/src/components/MobileNav.jsx:10,14` | MED | [코드확인] |
| M4 | '상승여력' 색이 항상 무채색 — `ui/Stat.css`에 `--up`/`--down` 클래스 없음(`success`/`danger`만) | `frontend/src/pages/AnalystReport.jsx:332` + `frontend/src/components/ui/Stat.css:16-17` | MED | [코드확인] |
| N4 | `_migrate`가 `backlog_history`를 **생성하지 않고** `ALTER … ADD COLUMN segments`만 실행 → 테이블 부재 시 warning만 남고 조용히 통과 | `backend/main.py:60-66` | MED | [코드확인] |
| **G5** | 구루 통계·투자금 탭 fetch에 `.catch` 없음 → 실패가 "데이터 없음 — 크롤링을 먼저 실행하세요"로 **위장**되고 unhandled rejection이 콘솔에만 남는다(전역 핸들러 없음) | `frontend/src/pages/GuruAllocation.jsx:38-43,45-52` · `GuruStats.jsx:88-95` | LOW | [코드확인] |
| **G6** | `GET /api/guru/stats/allocation`이 **전 티커 rows를 무제한** 반환 + 캐시 0 — 구루 단일 jsonb 블롭의 4번째 전량 소비처(§4.4) | `backend/routers/guru.py:54-57` · `frontend/src/pages/GuruAllocation.jsx:56,70-74` | LOW | [코드확인] |
| L1 | 루틴이 호출하는 `GET /api/analyst-reports`가 Cowork 문서에 **전용 절 없음**(워크플로우 언급만, 스키마·인증 미기재) | `CLAUDE_COWORK_API.md:35` | LOW | [코드확인] |
| L2 | `COWORK_API_KEY` 실값이 `claude -p` **argv**로 치환 → 같은 사용자의 `ps -ww`로 관측 | `scripts/cowork-fire-listener.py:34-35,42-44` | LOW | [코드확인] |
| L3 | `size_*.year`가 명시적 `null`이면 `(null)`로 오표시(`Number(null)===0`이 `isFinite` 통과) | `frontend/src/components/reports/MarketOutlookSection.jsx:17` | LOW | [코드확인] |

---

## 1. 기술부채

### 1.1 경로·탭 목록 4중 복제 [코드확인, 현재 실드리프트 있음]

`frontend/src/routes.js`는 **리다이렉트 맵(`REDIRECTS`)만** 갖고 nav IA는 갖지 않습니다. 같은 경로 목록이 다섯 파일에 흩어져 있습니다.

| 파일 | 무엇을 들고 있나 |
|---|---|
| `frontend/src/App.jsx:86-102` | 진실(`<Route path>` 17개) |
| `frontend/src/components/Masthead.jsx:11-45` | PC 마스트헤드 `SECTIONS`(5섹션) |
| `frontend/src/pages/ResearchShell.jsx:10-22` | 모바일 seg nav `RESEARCH_TABS`/`SCHEDULE_TABS` — Masthead의 research·schedule 섹션을 **label·evt까지 라인 단위로 복제** |
| `frontend/src/components/MobileNav.jsx:10-19` | 하단 탭바 `RESEARCH_PATHS`/`SCHEDULE_PATHS`/`ALL_TABS` — 세 번째 사본 |
| `frontend/src/components/MobileTopActions.jsx:14-15` | `/settings`·`/admin-analytics` + 이벤트명 복제 |

현재 드리프트: `MobileNav.jsx:10`의 `RESEARCH_PATHS`에 `/analyst-report`가 없고(**M3**), `Masthead.jsx:74`의 `location.pathname.startsWith(i.to)`는 `i.to='/analyst-reports'`(복수)라 실제 라우트 `/analyst-report/:ticker/:date`(단수, `App.jsx:94`)와 매칭되지 않습니다(**M1**). 탭을 추가·개명·삭제하면 `grep -rn "RESEARCH_TABS\|SECTIONS\|ALL_TABS" frontend/src/`로 **네 목록을 함께** 봐야 합니다. [기록] ResearchShell만 고쳐 PC에서 신규 탭 진입이 불가했던 사례가 실제 있었습니다(task#215).

**반례(따라갈 모범)**: 구루 페이지 탭은 `frontend/src/pages/Guru.jsx:12-17`의 단일 `TABS`를 PC(`:56`)·모바일(`:36`)이 **함께 렌더**하므로 이 복제 함정이 없습니다 — task#241의 '투자금' 탭 추가가 한 곳 수정으로 끝난 이유입니다. 대신 구루 탭은 로컬 state라 **URL이 없어 딥링크·새로고침 복원이 안 됩니다**(설계상 선택, 라우팅 탭과 혼동 금지). [코드확인]

### 1.2 종목명 dual-source [기록 + 코드확인]

`tickers.name`(공유 마스터, 종목관리 목록이 live read) vs `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세가 read). 둘 중 하나만 바꾸면 목록↔상세가 어긋납니다. 동기화 진입점은 `backend/services/storage/names.py`의 `refresh_snapshot_names`(단건, `:21`)·`reconcile_snapshot_names`(전체, `:38`)이며 후자는 `backend/routers/stocks.py:440`에서 호출됩니다. DB만 바꾸면 리포트 목록 캐시(`cache.get_list`)·스냅샷 LRU 때문에 화면 미반영 → `cache.invalidate(ticker)`+`invalidate_list()`가 필요합니다.

**구루 쪽에도 같은 이원화가 있습니다** — 한글명은 `top10` 층에만 채워지고(`guru_scraper.py:383-388`) `holdings` 전 종목 층엔 없어서, `compute_allocation`이 `top10` 층으로 사전을 만들어 메웁니다(`guru_stats.py:29-34`). **top10 밖 티커는 영문명으로만 표시**됩니다(설계상 한계, 코드 주석에 명시). [코드확인]

### 1.3 스키마 삼중 관리 [코드확인]

라이브 DB는 기동 idempotent 마이그레이션(ADR-0006)만 탑니다. `backend/app_schema.sql`은 **빈 pgdata 초기 마운트 전용**입니다.

- `backend/main.py:60-238` `_migrate()` — 17개 독립 try-except, 실패는 **warning 로깅만**. `CREATE TABLE IF NOT EXISTS` 11 + `ADD COLUMN IF NOT EXISTS` 16 + 인덱스 다수.
- **컬럼 쌍 DoD는 지켜지고 있음** — 16개 ALTER 컬럼 전부 `app_schema.sql`에 쌍이 존재.
- **[열림] 테이블은 쌍이 없다** — `app_schema.sql`에만 있고 `_migrate`에 없는 표 5개(=기존 DB에 자동 생성되지 않음, 수동 적용 의존): `market_lending_balance`(`app_schema.sql:190`)·`backlog_history`(`:202`)·`market_rankings`(`:215`)·`market_investor_trend`(`:234`)·`job_runs`(`:364`).
- **[열림, N4] 최악의 조합** — `_migrate`는 `backlog_history`를 만들지 않으면서 그 테이블에 `ADD COLUMN segments`를 실행합니다(`main.py:64`). 테이블 부재 시 ALTER가 실패하고 `:65-66`이 warning만 남겨 **기동은 성공**합니다(무음 미적용).
- **[열림] 세 번째 정본** — `backend/migrations/002_backlog_history.sql`은 `backlog_history`를 **`segments` 없이** 생성하고, `001_user_events.sql`은 `app_schema.sql`의 `user_events`+인덱스를 중복 정의합니다.

### 1.4 구루 크롤 저장 로직 2중 복제 [코드확인 — 위험도는 내려감]

`backend/routers/guru.py:73-89` `_run_crawl`(수동)과 `backend/scheduler/jobs.py:54-68` `_run_guru_crawl`(자동)이 `scrape_all_managers()` → `save_guru_managers({last_updated, managers})`를 **거의 같게** 반복합니다(로그 문구·`job_runs` lane만 다름). 여전히 두 lane이므로 저장 로직을 바꿀 땐 둘 다 봐야 합니다.

단 **task#242가 완결성 판정을 writer(`save_guru_managers`)로 내려** 두 호출부는 반환 bool을 분기·로깅만 하게 됐습니다(§2.1) — "한쪽만 고쳐서 재발"의 표면이 저장 판정에서는 사라졌습니다. [기록] 이 "두 렌더러/두 lane 동시 수정" 푸트건은 과거 액션버튼 중복이 task#97 재발 토양이 됐던 것과 같은 가족이며, 그때는 단일 `StockActions` 컴포넌트 추출로 해소했습니다(task#103).

### 1.5 과도하게 커진 모듈 [코드확인]

`backend/` 비-테스트 최대 파일: `routers/stocks.py` 675줄 · `services/market/kr.py` 664 · `services/report_generator.py` 630 · `routers/report.py` 592 · `scheduler/jobs.py` 514 · `services/recommendation/funnel.py` 475 · `services/batch_registry.py` 473 · `services/backlog.py` 438 · `services/guru_scraper.py` 409. ADR-0017(패키지 re-export 분할)이 선례를 남겼으나 위 파일들은 아직 단일 파일입니다.

### 1.6 프론트 lint 부채 — `npm run lint`가 게이팅하지 않음 [코드확인]

`npx eslint .` 실행 결과 **116 problems (114 errors, 2 warnings)** — 직전 매핑 115에서 +1(신규 `GuruAllocation.jsx:42`). 규칙별 분포:

| 규칙 | 건수 |
|---|---|
| `react-hooks/set-state-in-effect` | 42 |
| `react-refresh/only-export-components` | 38 |
| `react-hooks/static-components` | 20 |
| `no-empty` (빈 catch) | 5 |
| `react-hooks/immutability` | 3 |
| `no-unused-vars` | 3 |
| `react-hooks/exhaustive-deps` | 2 |
| `react-hooks/purity` | 2 |
| `no-sparse-arrays` | 1 |

`frontend/eslint.config.js`는 `js.configs.recommended`(→ `no-empty`, `allowEmptyCatch:false`)를 쓰는데도 빈 catch 5건이 남아 있습니다 — 즉 lint는 설정돼 있으나 **커밋을 막지 않습니다**(신규 위반이 그대로 통과해 이번에도 1건 늘었습니다). 빈 catch 위치: `hooks/useReportGeneration.js:22`·`pages/GuruCrawlNow.jsx:28`·`pages/ReportManualGen.jsx:98,136`·`pages/ConsensusSettings.jsx:28`. `no-sparse-arrays`는 `hooks/useReportFilters.js:15`의 `_isUngenerated([, v])`(=`[undefined, v]`) — 수신자 `useReportList.js:60`이 `([, v])`로 받아 **현재는 동작**하나, 키를 쓰기 시작하면 조용히 `undefined`가 됩니다.

### 1.7 레거시·유휴 잔존물 [코드확인]

- **certbot 컨테이너·마운트가 사실상 유휴** — `nginx/nginx.conf`의 TLS server 블록이 전부 주석 처리돼 있고 실제 TLS는 Cloudflare Tunnel이 종단합니다. `docker-compose.yml:45-50`의 certbot 갱신 루프는 돌지만 소비처가 없습니다.
- **`deploy.sh`와 `docker-compose.yml`의 nginx 정의가 갈림** — compose는 `./certbot/conf`·`./certbot/www`를 마운트(`docker-compose.yml:39-40`)하지만 `deploy.sh:50-57`의 `docker run`은 **두 마운트를 뺐습니다**(`nginx.conf`·`frontend/dist`만). `deploy.sh`가 nginx를 재생성한 뒤에는 ACME 웹루트 경로가 끊깁니다.
- **`supabase/.temp/`** — Docker 전환 이후 무용한 구 Supabase CLI 링크 잔재(untracked, 기능 영향 없음).
- **`backend/reports/`** — 레거시 리포트 디렉터리(read-only JSON 폴백).
- **`backend/data/`의 런타임 잔재** — `guru_managers.json`(2026-05-23, `holdings` 층 이전 구조)·`holdings.json`·`watchlist.json`·`stocks.json`·`schedule.json`·`guru_schedule.json`은 DB 이전 시대의 파일 저장소 잔재입니다. 전부 `.gitignore:16-22`에 있어 커밋 위험은 없고 현재 읽는 코드도 없습니다. 유일하게 살아 있는 파일 write는 `kr_exports.json`입니다(§2.3의 G2).

### 1.8 워킹트리 잡음 [코드확인]

`git status --porcelain` **148건**, `screenshots-uat*` **52디렉터리**, `scripts/` **108파일**. `.gitignore:59`는 `screenshots/`(단수)만 무시하므로 `screenshots-uat*`는 계속 새어나옵니다. 폴러가 tracked 편집을 2분마다 reset하는 환경(§4.8)에서 "무엇이 진짜 수정인가"를 판별하기 어렵게 만드는 2차 리스크입니다.

### 1.9 문서·주석 드리프트 [doc]

- **코드 주석이 풀 크기를 틀리게 적음** — `backend/routers/stocks.py:427`·`backend/scheduler/jobs.py:296,424` 부근이 "DB 풀(maxconn=10)"이라 적고 있으나 실제는 20(`services/db.py:16-27`). [코드확인]
- **`CLAUDE.md`의 doc-sync 서술이 stale** — `backend/tests/test_api_doc_sync.py:50`의 `KNOWN_UNDOCUMENTED = frozenset()`, 즉 라이브 엔드포인트 전건이 `API_SPEC.md`에 문서화된 상태입니다. `CLAUDE.md`의 "미문서화 기존 23개 동결" 서술은 이제 사실이 아닙니다. [코드확인]
- **문서 스코프 분리는 지켜지고 있음** — task#241의 `GET /api/guru/stats/allocation`은 `API_SPEC.md:3166`에만 있고 `CLAUDE_COWORK_API.md`엔 없습니다(사용자 대면 read = API_SPEC 전용 규칙 준수). [코드확인]
- 유지해야 할 DoD(변경 없음): 신규 컬럼은 `main._migrate` + `app_schema.sql` **쌍** / `batch_registry`의 `source`(fetch 출처) ↔ `usage`(소비 UI) 방향 혼동 금지 / 기능 표면 변경 시 `README.md` 해당 절 동시 갱신 / 인증 게이팅을 바꾸는 슬라이스는 착수 시 `grep -n '\*\*Auth:\*\* 불필요' API_SPEC.md` 선행.

---

## 2. 알려진 버그 · 취약 지점

### 2.1 [G1 → 해결됨] 구루 크롤의 부분·빈 결과 무조건 박제

**과거 증상(직전 매핑에서 HIGH로 올렸던 것)**: dataroma HTML 구조가 바뀌거나 rate-limit이 걸리면 셀렉터가 `[]`를 반환하고, 그 빈 리스트가 예외 없이 `guru_managers` 단일 전역 행을 `DO UPDATE SET data=EXCLUDED.data`로 덮어 구루 화면(목록·상세·통계 전부)이 통째 비었습니다. 에러 토스트도 500도 나지 않았습니다.

**현재 가드(task#242, `0822d53`)** [코드확인]:

| 위치 | 가드 |
|---|---|
| `backend/services/storage/schedule.py:23-35` | `save_guru_managers(data) -> bool` — `if not data.get("managers"): return False`로 **`execute`를 아예 호출하지 않고** 직전 양호값 보존. 판정을 writer가 소유해 호출부 가드 중복을 만들지 않습니다 |
| `backend/routers/guru.py:81-85` | 반환 bool이 False면 `logger.warning("[Guru] 빈 결과 — 저장 생략, 직전값 유지 (manual)")` |
| `backend/scheduler/jobs.py:60-66` | 같은 분기 + `[Scheduler] Guru 빈 결과 …` warning |
| `backend/services/market_indicators/commodities.py:53-55,99-101` | `if not prices:` / `if not rates:` → `_mc_save` 생략 + 저장값 반환 |
| `backend/services/market_indicators/earnings.py:208-211,237-240` | `if not quarters:` / `if not all_qs:` → 동일 |
| `backend/tests/test_empty_result_overwrite_guards.py` | 회귀 14건. red 조건을 `call_count`/`assert_not_called`로 못박아 "옛 구현은 저장 함수를 *실제로 호출했다*"를 단언합니다 |

**패키지 전수 재감사 결과 — 0건 아님, 2건 남았습니다** [코드확인]. `backend/services/**`의 `_mc_save`/delete-rewrite 호출 지점을 전수 확인했습니다.

가드 실재(따라갈 모범): `indices.py:143`(`if any(v is not None …)`) · `kospi_futures.py:22`(rt_cd=0 빈 output1 → 미영속) · `kospi_signal.py:243-250`(`changed` 플래그) · `fx.py:81,100`(`if not rates` / `if not history`) · `sentiment.py:67-79`(수동 폴백) · `econ.py:43-45`·`macro.py:75-76`(fetch 예외 시 저장값 반환, 성공 시엔 `_merge_history`가 stored를 포함하므로 빈 응답도 클로버 아님) · `us_sector_service.py:29-32` · `earnings.py:101-113`(티커 캐시) · `ranking_service.py:120-123,144-145,160-177` · `dividends.py:314` · `recommendation/funnel.py:457-459`(`if scored:`) + `store.py:15-27`(단일 트랜잭션).

**[열림, G2] `exports.py:105-123`** — `_fetch_and_save_kr_exports`는 **예외만** 가드합니다. 두 fetcher 모두 200-with-no-data에서 `{"months": []}`를 정상 반환할 수 있습니다(`_fetch_comtrade_exports:94`의 `all_months`는 두 시리즈 교집합, `_fetch_customs_exports:71`은 `total_by_month > 0` 필터). 그 빈 payload가 `_mc_save`(`:118`)와 `backend/data/kr_exports.json`(`:120-122`) **양쪽**을 덮습니다. 부수적으로 12개월 중 일부만 0이면 그 달만 조용히 빠진 **부분 시계열**이 저장됩니다.

**[열림, G3] `kr_sector_service.py:74-86`** — `refresh()`는 sectors의 all-None만 가드하고 `index`는 검사하지 않습니다. `build_sector_index()`(`:91-101`)는 업종별 fetch 실패를 `continue`로 삼켜 **전량 실패 시 `{}`**를 반환하며, `save(sectors, index)`가 그걸 그대로 저장해 보유→업종 역인덱스를 소멸시킵니다. 소비처(`map_holdings_to_sectors:112-113`, `routers/portfolio.py:196`)는 빈 인덱스를 graceful 빈 매핑으로 처리하므로 **에러 없이 섹터 표시만 사라집니다**. (`us_sector_service`엔 인덱스 층이 없어 무관.)

**[의도된 non-goal, 기록해 둘 잔여] 부분 실패는 여전히 무가드입니다** — `guru_scraper.py:371-403`은 매니저별 예외를 `logger.warning(f"[Guru] Failed for …")`로 삼키고 계속하므로 **83명 중 3명만 성공해도 그 3명이 저장**됩니다(`managers`가 비지 않으므로 writer 가드를 통과). 성공률은 오직 `guru_scraper.py:408`의 `logger.info(f"[Guru] 수집 {len(result)}/{total}")`로 **관측**만 됩니다. task#242의 명시적 non-goal이었고 감독 누락이 아닙니다 — 임계값 가드가 필요해지면 이 로그가 근거 데이터입니다.

**관련 파일**: `backend/services/guru_scraper.py`, `backend/routers/guru.py`, `backend/scheduler/jobs.py`, `backend/services/storage/schedule.py`, 대조 모범 `backend/services/ranking_service.py`.

### 2.2 외부 데이터 소스 파싱 취약성 [live-fail]

이 코드베이스의 **최다 재발 버그 클래스**입니다. 단위테스트가 외부 응답을 mock하므로 라벨·봉투·스케일 편차를 못 잡고 라이브에서만 드러납니다. 파싱 슬라이스의 DoD에 **라이브 1종목 추출 대조**가 필요합니다.

| 함정 | 무엇이 깨지는가 | 어디 | 근거 |
|---|---|---|---|
| yfinance 메서드 vs 프로퍼티 라벨 | `get_cashflow()`=무공백(`OperatingCashFlow`) / `.cash_flow`=공백(`Operating Cash Flow`). `_yf_val`이 exact 매칭이라 어긋나면 **예외 없이 None** | `backend/services/market/us.py`, `backend/services/market/format.py` | [기록] task#117 |
| DART `fnlttSinglAcntAll` | `fs_div`가 요청 필수값이고, 요청에 넣으면 응답 행이 `fs_div`를 echo하지 않아 `row.get("fs_div")` 필터가 **전 행 스킵**. 계정은 `account_nm`(회사별 표기 변동) 아닌 `account_id`(XBRL)로 매칭 | `backend/services/market/kr.py` | [기록] task#117 |
| DART `list.json` | `pblntf_ty`를 echo하지 않아 유형별 개별 호출 필요(종목당 4콜). **AGM은 반대로 `pblntf_ty` 미지정 호출로만 발견** | `backend/services/disclosures.py`, `backend/services/agm.py` | [기록] task#120 |
| DART `document.xml` 표 | 회사별 구조 편차(단위 캡션·연결/별도). 단위 캡션 파싱 실패 시 '기본값 억원' 폴백은 **×100 오저장** → 실패는 pending으로(wrong<missing) | `backend/services/backlog.py`, `backend/services/backlog_parser.py` | [기록] ADR-0002·0003 |
| KIS 선물 응답 봉투 | 시세 TR은 단수 `output`이 아니라 `output1/2/3`. `d.get("output")`만 읽으면 `rt_cd=0`인데 늘 빈값 → "코드 오류"로 오진 | `backend/services/kis/futures.py` | [기록] task#156 |
| 퍼센트 소수분수 | `shortPercentOfFloat`·`pctHeld`·`dividendYield` 등은 0~1 분수. 프론트 ×100 누락·fixture를 %로 적는 실수가 반복 | 프론트 표시 계층 전반 | [기록] task#122·123 |
| tz naive ↔ aware | 키움 일봉=naive / yfinance(`^KS11`)=aware → `pd.concat`가 TypeError, broad except가 삼키면 계산이 **조용히 None** | `backend/services/report_generator.py`(현재 `tz_localize(None)` 적용) | [기록→해결] task#116 |
| KST 달력일 | 컨테이너에 TZ env 없어 bare `date.today()`=UTC → 00:00~09:00 KST에 하루 뒤처짐. `_KST`/`today_kst()` 패턴을 쓸 것 | `backend/services/market_indicators/kospi_signal.py`, `backend/scheduler/schedule.py`, `market_indicators/cache.py:90,105` | [코드확인] |
| dataroma 위치 기반 파싱 | 열 인덱스에 하드 의존: `_parse_stock_row`가 `cells[1]`(티커-이름)·`cells[2]`(비중)·`cells[3]`(활동)·**`cells[6]`(신고 금액)**, `_parse_activity_page`가 `tds[i+1]`·`tds[i+2]`·`tds[i+4]`. 헤더/데이터 구분은 **텍스트 패턴**(대시 유무)과 **`class=hist` 앵커**뿐 | `backend/services/guru_scraper.py:131-164,239-286` | [코드확인] |
| **[G4] `cells[6]` 오정렬은 '그럴듯한 오값'을 만든다** | task#241이 추가한 Value 열 파싱은 `if value:`로 0만 걸러(`:160-163`, wrong<missing 의도) **파싱 성공을 진실로 신뢰**합니다. 그런데 dataroma가 열을 하나 삽입하면 `cells[6]`이 다른 *숫자* 열(예 Reported Price `$185.06`)이 되고 `_parse_portfolio_value`(`:42-54`)가 그걸 `185`로 **성공 파싱**합니다 — 예외도 warning도 없이 저장되고, 그 값이 `guru_stats.compute_allocation`(`:41,55`)에서 종목 투자금과 전체 총액(비율 분모)을 동시에 오염시킵니다. 실패는 missing이 되지만 **오정렬은 wrong이 됩니다** | `backend/services/guru_scraper.py:42-54,157-163` · `backend/services/guru_stats.py:41,55` | [코드확인] |
| dataroma 활동 표 `<tr>` 부재 | 이 표의 데이터 행에는 여는 `<tr>`이 없어 `table.select("tr")`로는 **데이터가 한 행도 안 잡힙니다**. colspan=분기헤더 / `class=hist`=행 앵커로 td를 문서 순서 순회하는 관용구에 의존 | `backend/services/guru_scraper.py:221-286` | [코드확인] |
| dataroma 활동 페이지 상한 | `_ACT_MAX_PAGES = 10`. 상한 도달 시 `truncated=True`+warning은 남지만 결과는 잘린 채 저장됩니다(실측 최대 430행=5페이지) | `backend/services/guru_scraper.py:215-218,315-321` | [코드확인] |
| 구루 분기 불일치 graceful | 활동 페이지는 *변동이 있던 분기만* 나열하므로 보유 스냅샷보다 오래될 수 있습니다. 분기가 일치할 때만 보강하고 아니면 **비중 증감·전량매도를 생략**합니다(정상 동작이나, "왜 활동이 안 보이나"의 첫 확인 지점) | `backend/services/guru_scraper.py:338-347` | [코드확인] |
| 투자금 dual-source | `compute_allocation`은 `h.get("value") or (weight_pct/100 × portfolio_value)` — 신고 금액이 정본이고 없으면 추정입니다. `or`가 **0을 falsy로 취급**하므로 진짜 0 신고도 추정으로 넘어가고, 한 총액에 신고분과 추정분이 **섞입니다**(설계상 수용, 주석 명시) | `backend/services/guru_stats.py:19-64` | [코드확인] |

### 2.3 캐시 박제·클로버 [data]

- **[열림] `get_or_refresh`는 이름과 달리 저장값의 "나이"를 보지 않는다** — `backend/services/market_indicators/cache.py:110-120`: `force=False`면 인메모리 캐시가 비었을 때 `_mc_load`로 DB 저장값을 가져와 **`fetched_at`을 검사하지 않고** 반환합니다. 즉 `ttl` 인자는 *DB를 얼마나 자주 재조회하냐*만 통제하고 *그 값이 얼마나 오래됐냐*는 통제하지 못합니다 — 배치가 멈춰도 함수는 계속 "성공"하며 무한정 오래된 값을 돌려줍니다. 실질 신선도는 오직 그 키를 채우는 배치 잡의 실행 여부에 달려 있으므로 **소비처별로 판단**해야 합니다(주기 배치가 있는 `earnings_us`/`earnings_kr` 계열은 영향이 작고, 배치가 없거나 실패가 누적되는 키는 이 함수만 보고 "최근값"으로 오인하기 쉽습니다). 반례로 `earnings.py:61-76`의 티커 캐시는 `_is_fresh(stored)`로 **`fetched_at`을 직접 검사**합니다 — 나이 판정이 필요하면 이 패턴을 복제하세요. [코드확인]
- **[열림] 5배 median 이상치 필터가 광폭 시계열의 진짜 스파이크를 버린다** — `market_indicators/cache.py:75-82` `_filter_outliers(max_ratio=5.0)`이 366일 창(`:105-107`)에 **일괄** 적용됩니다. VIX(`fx.py`가 같은 `_yf_close_history` 사용)는 1년 median ~15 대비 위기 스파이크가 5배를 넘어 **가장 정보량 큰 점이 조용히 탈락**할 수 있습니다. 시리즈별 예외 장치가 없습니다. [코드확인]
- **[열림] 빈 결과 클로버 잔여 2건** — §2.1의 **G2**(`exports.py`)·**G3**(`kr_sector_service.py`). task#242가 5곳을 닫았고 이 둘이 같은 클래스의 미가드 잔여입니다.
- **[해결됨] "성공-but-빈응답" 박제 금지** — 외부 API `rt_cd=0` 빈 output은 예외 가드를 통과하므로 **값 수준** 가드가 필요합니다. 가드: `market_indicators/indices.py:143`의 `if any(v is not None …)` 후에만 `_mc_save`, `kospi_futures.py:22`의 빈 output1/history → 미영속·last-good 반환. [기록] task#157
- **[해결됨] delete-rewrite store의 fetch 실패 파괴** — `backend/services/dividends.py`의 `replace_schedule`이 DELETE+INSERT를 **단일 트랜잭션**으로 묶고, `_dividend_history`가 예외를 **전파**해 호출측이 replace를 통째 스킵합니다(빈 결과로 삼키면 직전 양호값을 DELETE로 파괴). 동형 구현: `recommendation/store.py:15-27`(+ 호출측 `funnel.py:457-459`의 `if scored:`). [기록] task#160
- **[해결됨] 정적 시드 파일이 라이브 스크레이프 결과로 오염되던 경로** — S&P500/KOSPI 티커 7일 캐시가 `backend/data/*.json`을 read+write하던 구조에서 `market_cache` 테이블(키 `sp500_tickers`·`kospi_tickers`)로 이동, 두 파일은 read-only 시드로 격하(`market_indicators/earnings.py:25-31,79-87`). 이번 매핑에서 **전체 스위트 1411건 실행 후 `git status`가 clean**임을 재확인했습니다. **잔존 교훈**: 파일 자체의 mtime을 TTL 판정 기준으로 쓰면 오염이 스스로 다음 TTL 창 동안 증상을 가립니다("간헐 발생"으로 보이면 신선도 판정이 자기 자신을 갱신하는 구조인지 볼 것). [코드확인] task#234
- **[해결됨] `get_or_refresh`는 fetch 실패 시 직전값 폴백을 하지 않는다** — 취약 소스(CNN F&G)는 `market_indicators/sentiment.py:61-79`의 수동 폴백(try→성공 시 `_mc_save`, 실패 시 `_mc_load`)을 씁니다. FRED/yfinance는 `get_or_refresh`로 충분. [기록] task#151

### 2.4 NaN/inf 직렬화 500 [부분 열림]

starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 **500**(`Out of range float values`)입니다. PostgreSQL은 `json` 컬럼에 NaN을 거부하지만 파이썬 `json.dumps`는 기본 통과라 **DB 저장 실패 / 파일 폴백 성공 / 응답 직렬화 실패**로 증상이 엇갈립니다.

- 안전망: `backend/services/utils.py`의 `sanitize`가 재귀적으로 비유한 `float`→None. **`Decimal('NaN')`은 처리하지 않고**(isinstance float만) 튜플도 재귀하지 않습니다. [기록]
- **[열림] `sanitize` 참조가 0인 라우터 15개** [코드확인]: `admin.py`·`analysis.py`·`analytics.py`·`auth.py`·`batches.py`·`calendar.py`·`digest.py`·`events.py`·`guru.py`·`investor.py`·`market_indicators.py`·`rankings.py`·`short_sell.py`·`watchlist.py`(+`__init__.py`). 적용된 곳은 `analyst_reports.py`(5)·`report.py`(4)·`portfolio.py`(4)·`stocks.py`(3)·`recommendations.py`(2)뿐입니다. **인증 게이팅과 NaN 가드는 독립적인 두 축** — task#230·231이 다수 라우터에 `get_current_user`를 추가했지만 sanitize는 그대로 미적용이며, task#241이 `guru.py`에 엔드포인트를 하나 더 얹은 뒤에도 이 라우터의 sanitize는 여전히 0입니다.
- **[열림, N2] 대표 노출 패턴** — `change_pct = round((cur-prev)/prev*100, 2) if prev else 0.0`에서 `if prev`는 **NaN에 대해 참**이라 NaN이 그대로 전파됩니다: `market_indicators/commodities.py:25`·`fx.py:30,39`·`indices.py:24,34`(단 indices는 하류에 `isfinite` 4곳+`sanitize` 2곳 보유). 파일 전체에 `isfinite`·`sanitize`가 **0인** 모듈: `commodities.py`·`fx.py`·`macro.py`·`econ.py`·`exports.py`·`earnings.py`·`cache.py`. [코드확인]
- **[해결됨] 입력 경로 NaN** — raw JSON `NaN` 토큰은 ① `json.loads`가 허용 ② Pydantic float 기본 `allow_inf_nan=True` ③ 범위 검증이 NaN에서 항상 False로 3중 통과합니다. 가드: `analyst_reports.py:29,42-43`이 `allow_inf_nan=False` 명시 + `backend/main.py`의 `RequestValidationError` 커스텀 핸들러가 422 본문을 `sanitize`(NaN echo → 500 연쇄 차단). [코드확인] task#211

### 2.5 NUMERIC(Decimal) ↔ float 산술 [부분 열림]

DB NUMERIC은 `Decimal`, 외부 store(`stock_dividends` 등)는 `float`이라 혼합 산술이 `TypeError` → 대시보드는 `_minimal_card` 폴백으로 **500도 안 내고 enrichment만 통째 blank**(가장 은밀한 실패 형태).

- **[해결됨] 정규화 앵커** — `routers/stocks.py`의 `_f()`·배당 양변 `float()`·`_usdkrw_rate`+`isfinite`, `routers/portfolio.py`의 `_qty()`, `services/rebalance.py`의 `_finite_float()`. [기록] commit d666cdd2
- **[열림] `isfinite` 누락 정규화** — `routers/rankings.py`·`investor.py`·`short_sell.py`의 `_to_float`는 Decimal→float 캐스트만 하고 유한성 검사를 뺐습니다 → PostgreSQL `NUMERIC 'NaN'`이 응답까지 통과합니다(§2.4의 sanitize-0 라우터와 겹칩니다). [기록]
- **[열림] 암묵 의존 지점** — 상류 캐스트에 기대는 무-로컬캐스트 산술: `routers/portfolio.py`(`amt * qty`), `routers/stocks.py`(`inc * fx`), `services/exposure.py`(`beta_map` 값은 호출측 `portfolio.py`가 캐스트). [기록]
- 회귀 테스트는 반드시 **Decimal** fixture로. float만 쓰는 fixture는 이 계열을 원리적으로 못 잡습니다.

### 2.6 시세 정합성 게이트 [해결됨, 유지 필요]

- **KR 다피드 다수결** — `get_quote_kr(regular=False)`가 독립 피드 2-of-N 합의(`_kr_pick_basic`/`_corroborated_pick`, `backend/services/market/kr.py`)로 단일 피드 글리치를 폐기. 합의 불가·outage는 degenerate 자가검증(±30%). ADR-0010. [기록]
- **박제-시 독립피드 게이트(KR)** — `backend/services/report_generator.py`가 저장 직전 Naver retry-once→KIS 폴백 ref로 2x 교차검증, **ref 전무 시 박제 스킵**(직전 스냅샷 유지 + loud warning). [기록] task#118
- **[부분 열림] US는 게이트가 없다** — `report_generator.py`의 `math.isfinite` 단일 가드가 유일이며 코드 주석이 그 사실을 명시합니다. US 스냅샷의 자기일관 글리치는 잡히지 않습니다. [기록]
- **시세 기준 이원화는 버그가 아님** — 리포트 스냅샷=KRX 정규장(`regular=True`), 라이브 대시보드=NXT. 같은 종목이 두 화면에 ~1% 다른 건 **의도된 기준 차**(ADR-0020).
- **[정정]** "005930이 정확히 70000.0으로 박제"의 원인은 피드 글리치가 아니라 **로컬 pytest가 prod DB에 fixture를 쓴 오염**이 유력(task#170, ADR-0020 amendment). 실제로 멈춘 건 `_block_real_db`(task#169)입니다. **라운드 값(70000·정확히 400조)이 보이면 피드보다 테스트 오염을 먼저 의심**하세요.

---

## 3. 보안 [sec]

### 3.1 무인증 공개 read: 없음 [해결됨 + 회귀 게이트 실재]

ADR-0029(task#230·231·232)로 무인증 공개 read가 전량 닫혔고, task#233이 이를 **상시 회귀 게이트**로 승격했습니다. `backend/tests/test_no_public_reads.py`가 라이브 `app` 배선 기준으로 무인증 `/api` 엔드포인트가 `backend/routers/auth.py`의 공개 9개(register·login·refresh·logout·OAuth 4종·`GET /oauth/token`)와 **정확히 일치**하는지 양방향 단언합니다. 라우트 열거는 `backend/tests/_routes.py`의 `walk_routes()`를 씁니다(§6.4의 FastAPI 버전차 함정 우회). 이번 매핑에서 전체 스위트 **1411건 통과**를 확인했으므로 게이트는 살아 있습니다. task#241의 신규 `GET /api/guru/stats/allocation`도 `Depends(get_current_user)`로 게이트됩니다(`routers/guru.py:55`). [코드확인]

인증 의존성 분포(`Depends(...)` grep 실측, `backend/routers/*.py`): `require_admin` **42** / `get_current_user` **72**(+1, allocation) / `get_current_user_or_api_key` **10** / `require_admin_or_api_key` **6**. 게이트는 **엔드포인트별**로만 걸립니다 — `include_router(dependencies=...)`나 미들웨어 수준 인증은 없습니다. [코드확인]

### 3.2 [열림] 인가(authz)가 API 레이어에서 강제되지 않는다

`user_menu_permissions`는 `backend/routers/admin.py`(관리·CRUD)와 `backend/routers/auth.py`/`backend/services/auth_service.py`(로그인 시 프론트로 내려주는 값)에서만 읽고 씁니다. **어떤 라우터도 이 값을 `Depends`나 검사 조건으로 써서 요청을 막지 않습니다** — 로그인만 하면(즉 `get_current_user`를 통과하면) 그 사용자에게 메뉴가 안 보여도 해당 API를 직접 호출할 수 있습니다. 화면 노출은 프론트(`contexts/AuthContext.jsx`가 로드해 `Masthead`·`MobileNav` 필터링)만 통제합니다.

인증(누구인가)과 인가(무엇을 할 수 있는가) 중 인가를 UI 레이어에만 두겠다는 **의도된 설계로 보이나 명시적 ADR은 없습니다**. 사용자층이 넓어지면 이 갭이 실제 권한 우회가 됩니다. [코드확인]

### 3.3 admin 게이트 2종의 차이와 그 결과 [코드확인]

`backend/auth.py`:

| 게이트 | 동작 | 결과 |
|---|---|---|
| `require_admin`(`:61-65`) | `get_current_user`(JWT 전용) → DB에서 `role=='admin'` 확인 | **API 키를 거부**(키로 호출하면 401). 그래서 admin 전용 표면은 비admin 테스트 계정으로도, API 키로도 라이브 UAT가 불가 → §6.3 |
| `require_admin_or_api_key`(`:68-78`) | `get_current_user_or_api_key` → **센티넬 분기**(`:73-74` `if user_id == _API_KEY_USER_ID: return user_id`)로 **DB role 조회 없이 admin 등가** | API 키 하나로 admin 쓰기 권한 |

두 가지 위생 문제:
- `auth.py:45`의 키 비교가 평문 `==`(**상수시간 아님** — `secrets.compare_digest` 미사용).
- `X-API-Key` 헤더가 존재하면 **JWT 경로는 아예 시도되지 않습니다**(`:43-47` short-circuit) — 잘못된 키는 유효한 Bearer가 함께 와도 401.

**API key(`COWORK_API_KEY`)의 권한 반경**: 쓰기 — `PUT /api/stocks/enrich/batch`·`PUT /api/stocks/{ticker}/enrich`·`POST /api/analyst-reports/{ticker}`·`POST /api/report/generate`(전역 포트폴리오 대상)·`PUT /api/admin/analyst-targets/{ticker}`(전역 플래그)·`POST /api/admin/cowork/fire`. read — `GET /api/stocks`·`GET /api/report/list`가 센티넬이면 **전역 교차사용자 포트폴리오**를 반환. 키가 닿지 못하는 것 — `DELETE /api/analyst-reports/{ticker}`는 의도적으로 `require_admin`(루틴에 삭제 권한 미부여, ADR-0027 개정), `GET /api/admin/analyst-targets`도 `require_admin` 전용. [기록 + 코드확인]

**더 약한 게이트 1건 [열림, N3]**: `PUT /api/report/{ticker}/backlog`(`backend/routers/report.py:581-582`)는 `get_current_user_or_api_key`만 요구 — **admin 검사도 소유권 검사도 없이** 전역 수주잔고에 씁니다. [코드확인]

### 3.4 [열림, N1] fire 파이프라인이 만드는 escalation 경로

1. `POST /api/admin/cowork/fire`(`backend/routers/admin.py:239-240`)는 `require_admin_or_api_key`이고 본문 `text`를 그대로 받습니다.
2. `backend/services/cowork_trigger.py`가 그 text를 `127.0.0.1:8787`로 전달.
3. `scripts/cowork-fire-listener.py:36-37`이 `[트리거 지시]`로 프롬프트에 append하고 `:42-47`에서 `claude -p <prompt> --model opus --allowedTools Bash,WebSearch,WebFetch,Read,Write`로 스폰.

→ **API key(=admin 등가) 하나로 로컬 머신에 임의 프롬프트를 주입해 `Bash`/`Write` 도구를 가진 에이전트를 돌릴 수 있습니다.** 리스너는 loopback 바인드(`:83`)이고 자체 bearer 토큰(`COWORK_ROUTINE_FIRE_TOKEN`, `:55-57`, 평문 `!=` 비교·rate limit 없음)이 있으나, 위 경로는 **정상 API 표면을 통과**하므로 이 방어를 우회합니다.

부수 위생 문제: **키가 argv로 노출**(`:34-35,43` — 프롬프트 문자열에 `COWORK_API_KEY` 실값을 치환해 argv로 넘김 → 같은 사용자의 `ps -ww`로 관측, L2), **workdir 충돌**(`:38-40` `ts`가 **초 단위**라 같은 초 fire 2회면 같은 디렉터리 → `:41` `open(…, "w")`가 실행 중 프로세스의 `run.log`를 truncate하고 cwd를 공유, M2), 로그 파일 핸들 미close. [코드확인]

### 3.5 파괴적 admin 엔드포인트 [기록 + 코드확인]

- **전 사용자 대상 단일 삭제** — `DELETE /api/admin/stocks/{ticker}`(`backend/routers/admin.py:126`): `DELETE FROM user_stocks WHERE UPPER(ticker) = %s`에 **user_id 술어가 없습니다**. 한 번 호출로 모든 사용자의 그 종목 행이 사라집니다(스냅샷은 고아로 유지 = 설계).
- 사용자 삭제 캐스케이드 — `DELETE /api/admin/users/{user_id}`(`:118-119`): `user_stocks`·`user_menu_permissions`·`refresh_tokens`·`digests`·`calendar_cache`→`users`. 가드: admin role·OAuth 계정은 403.
- 권한 일괄 변경 — 단일/bulk 다중 사용자/`default_menu_permissions`(이후 전 신규 사용자 영향)/`batches.py` 크론 변경.
- 벌크 refresh·backfill 20+종(`report.py`·`stocks.py`·`digest.py`·`guru.py`·`investor.py`·`short_sell.py`·`rankings.py`·`recommendations.py`·`analysis.py`·`market_indicators.py`) — 전부 `require_admin`이며 전역 테이블에 씁니다.
- **[열림, N3] admin이 아닌데 전역 영향** — `DELETE /api/stocks/dashboard/cache`(`backend/routers/stocks.py:405-408`)는 `get_current_user`만 요구하는데 `cache_svc.invalidate_dashboard()`로 **프로세스 전역** 캐시를 비웁니다(임의 로그인 사용자가 반복 호출 시 콜드 빌드 유발). `DELETE /api/calendar/cache`는 호출자 스코프라 안전(`routers/calendar.py:73`).
- 토큰 위생 **[해결됨]**: refresh 토큰은 사용 시 DELETE되는 one-time 회전(`backend/services/auth_service.py:129,134`), access 1h/refresh 30d, 쿠키 없음(Bearer 전용).

### 3.6 비밀값 관리 [부분 열림]

- 비밀값 정본은 `backend/.env.docker`(gitignored) + 루트 `.env`(compose 보간). 키 **이름**만: `POSTGRES_PASSWORD`·`JWT_SECRET`·`SESSION_SECRET`·OAuth·`FRED_API_KEY`·`KOFIA_API_KEY`·`DART_API_KEY`·`KITA_API_KEY`·`KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`·`KIS_APP_KEY`/`KIS_APP_SECRET`·`COWORK_API_KEY`·`COWORK_ROUTINE_FIRE_TOKEN`. `ANTHROPIC_API_KEY`는 남아 있으나 백엔드 미사용.
- **[열림] UAT 스크립트에 테스트 계정 비밀번호 평문** — `scripts/`의 **91파일**이 비밀번호 리터럴을 포함하고(직전 매핑 89 → task#241 UAT 스크립트 추가로 증가), 그중 **9개는 이미 git에 추적**되어 커밋돼 있습니다. 남은 82개는 untracked라 `git add -A` 한 번이면 함께 커밋됩니다(§1.8의 워킹트리 잡음과 결합된 리스크). 실제 사용자 계정이 아닌 UAT 전용 계정이지만, 라이브 로그인 자격증명이 레포에 들어가는 구조 자체가 열려 있고 **UAT 스크립트를 하나 더 쓸 때마다 늘어납니다**. [코드확인]
- `scripts/cowork-fire-listener.py`가 `backend/.env.docker`를 직접 파싱해 값을 argv·프롬프트로 옮깁니다(§3.4).

### 3.7 테스트가 라이브 DB·디스크를 오염시킬 수 있던 구조 [해결됨, 단 경계 명확히]

로컬 `DATABASE_URL`이 도커 postgres(=라이브 DB, 5432 노출)를 가리킵니다. 가드 이전엔 `generate_report` e2e 테스트의 INSERT가 **prod `snapshots`에 커밋**됐고, admin 삭제 테스트가 prod `calendar_cache`를 전삭제했습니다(task#169). [기록]

**현재 가드**: `backend/tests/conftest.py:26-37` — autouse로 **정확히 한 속성**만 패치(`monkeypatch.setattr(db_svc, "_get_pool", _no_real_db)`). `get_connection`이 `_get_pool`을 모듈 글로벌로 조회하므로 `query`/`execute`/`execute_many`와 `from services.db import query` 형태 호출까지 전이 차단됩니다. [코드확인]

**막지 못하는 것(그대로 라이브로 나감)** [코드확인]:

| 경로 | 근거 |
|---|---|
| 직접 psycopg 연결 | `backend/run_backfill.py:139` `psycopg2.connect(DB_DSN)` — `psycopg2.connect` 자체는 패치되지 않음 |
| 파일 쓰기 | `report_generator.py`·`digest_service.py`의 `write_text`, 임포트 시 `mkdir`(`main.py`, `digest_service.py`), **`market_indicators/exports.py:120-122`의 `kr_exports.json` write**(gitignored라 커밋 위험은 없음) |
| 네트워크 | `requests`/`yfinance`/socket 무패치. `backend/tests/`의 8+ 파일이 `requests.get`/`yf.Ticker` 참조 |
| subprocess | 무가드 |
| **가드의 무음 degrade** | 가드는 예외를 *던질 뿐*이고 다수 호출처가 broad except로 삼켜 warning만 남깁니다(`routers/stocks.py`, `market_indicators/cache.py`, `services/job_runs.py`, `scheduler/jobs.py`, `main._migrate` 전 블록) → **DB를 안 탔다는 착각** |
| reload 무효화 | `importlib.reload` 사용 테스트 3종(`test_report_price_gate.py`·`test_report_generator.py`·`test_market.py`) — 모듈 자체 정의 심볼 patch가 reload로 무효화되므로 **하위 모듈 속성**(`services.db.execute`·`_naver_get`)을 patch할 것 |

가드가 raise하면 그 테스트가 실 DB를 타고 있다는 뜻입니다 — **가드를 풀지 말고 mock을 추가**하세요. 추적 대상 정적 파일 오염(`backend/data/*.json`)은 **write 경로 자체가 제거돼 해결**됐고(task#234, §2.3), 이번 매핑에서 **전체 스위트 1411건 실행 직후 `git status`가 clean**임을 실측 재확인했습니다. 단 가드는 여전히 DB 전용이라 `backend/data/`에 write하는 코드가 새로 생기면 재발합니다 — **전체 스위트 실행 후 `git status`로 부수효과 확인** 습관이 유효한 안전장치입니다.

---

## 4. 성능

### 4.1 커넥션 풀 [열림: 전역 상한 없음 · 재시도 없음]

`backend/services/db.py:16-27` — `ThreadedConnectionPool(minconn=1, maxconn=20, dsn=os.environ["DATABASE_URL"])`. **하드코딩 리터럴이며 풀 크기를 조정하는 env var가 없습니다.** psycopg2 풀은 소진 시 블록이 아니라 **예외(`PoolError`)**를 던지는데, `db.py` 전체에 `PoolError`/`OperationalError`/dead-connection 검사나 재시도가 **없습니다**(`:24` 주석에만 언급). [코드확인]

`ThreadPoolExecutor` 전량(비-테스트) [코드확인]:

| 지점 | 워커 | 워커당 DB |
|---|---|---|
| `routers/stocks.py:669` 대시보드 빌드 | `min(len(holdings), 10)` | 카드당 **최대 5회 순차 query**(스냅샷·컨센서스·배당·수급·내부자) |
| `routers/calendar.py:106` | `min(len(all_stocks), 15)` | DB 무접촉(yfinance) |
| `routers/stocks.py:428` 이름 백필 | `min(len(candidates), 8)` | `set_ticker_name` 2 writes |
| `scheduler/jobs.py:297`, `:425` | `min(len(tickers), 8)` | 최대 3회 |
| `routers/report.py:142` | `parallel_map(…, max_workers=5)` | **중첩 풀**: 내부에 `report_generator.py:186`(8) + `consensus_pipeline.py:107`(5) → 피크 스레드 ≈40 |
| `services/ranking_service.py:112` | 12 | DB 무접촉(Naver 페이지) |
| `market_indicators/earnings.py:202,229` | **20** | DB 무접촉 — 다만 **워커 수가 풀 크기(20)와 같아**, 워커 본문에 DB read가 추가되는 순간 즉시 풀 포화 |
| `market_indicators/exports.py:68` / `commodities.py:43,85` / `fx.py:62` | 6 / 3,4 / 3 | DB 무접촉 |
| `kr_sector_service.py:71` / `us_sector_service.py:28` | `parallel_map` 4 / 11 | DB 무접촉(키움·yfinance) |

**구조적 공백**: 상한이 *엔드포인트별로* 계산되고 **전역 세마포어가 없습니다**. 대시보드(10) + 캘린더(15) + 배치(8) 같은 동시 조합의 합산 상한을 아무도 보장하지 않습니다.

**풀 우회**: `backend/run_backfill.py:139`가 `psycopg2.connect`로 직접 연결합니다(풀 회계 밖·테스트 가드 밖).

### 4.2 대시보드 콜드 스타트 [부분 닫힘]

- 서버 가드 실재 [코드확인]: `routers/stocks.py:661-667`의 per-card `_safe`→`_minimal_card`(카드 하나가 throw해도 500-to-empty 방지, `holdings=N → 항상 N카드`) + `:673` 반환 `sanitize` + `_usdkrw_rate`의 `isfinite` + 배당 양변 `float()`.
- 프론트 가드 실재 [코드확인]: `frontend/src/pages/Portfolio.jsx:54-67`(loading→Skeleton, `hasHoldings`면 빈 상태 대신 Skeleton으로 "헤더 N ↔ 그리드 빈" 모순 제거, 소진 시 복구 CTA) + `:99-112` bounded 재시도 **최대 3**.
- **[열림] `dashboardError`가 소비되지 않는다** — 훅은 노출하지만(`hooks/usePortfolioData.js:13,101`) `Portfolio.jsx:95` 구조분해에서 빠져 있어(주석 `:97`에만 등장), 진짜 에러와 "서버가 정당하게 `holdings:[]`를 반환"이 **동일한 3회 재시도 + 동일한 카드**로 귀결됩니다. 리터럴 `3`도 `:104`·`:110` 두 곳에 중복. [코드확인]
- **[열림] N+1 잔존** — 대시보드는 카드별 단건 query를 쓰는데, 배치 변형(`stocks.py`의 `_latest_snapshots`, `services/consensus.py`의 `get_asof_batch`, `services/insider_trades.py`의 `compute_net_signals_batch`)이 **이미 존재하며 `/compare`만** 사용합니다. [기록]
- **진단 단서**: 헤더/시세는 정상인데 enrichment(RSI·컨센서스·매물대·배당)만 일괄 blank면 `docker logs portfolion-backend-1 | grep '최소카드 폴백'`로 per-card 예외부터 확인하세요 — minimal-card 가드가 근본원인을 마스킹하므로 로그가 유일한 단서입니다. [기록]

### 4.3 요청경로 외부 fetch [열림, 설계상 허용]

fx·vix·commodities·treasury·indices·kospi_futures는 **배치가 없고 요청경로 증분**입니다(TTL캐시→`_mc_load`→라이브 fetch→`_mc_save`+폴백). `batch_registry`에 등록되지 않습니다. 반면 배치-백킹 뷰(랭킹·KR/US 업종 모멘텀 등)는 요청·기동 경로에서 외부 API를 호출하지 **않는** 것이 규약입니다(요청당 N콜 직렬=수초 지연 — task#48·49·50 3-타석으로 확립). 새 지표를 추가할 때 어느 쪽인지 먼저 정하세요. [기록 + 코드확인]

### 4.4 구루 데이터의 단일 jsonb 블롭 [열림, 소비처 4개로 늘어남]

`guru_managers`는 **전역 단일 행**(`id=1`)에 전체 페이로드를 담습니다. task#239·240으로 매니저당 `holdings`(전량, 실측 최대 133행) + `sold_out` + per-row `activity`가 추가됐고, task#241이 거기에 per-row `value`를 더했습니다(`guru_scraper.py:161-163`) — 참고로 `holdings` 층 없이 top10만 담던 구 파일 스냅샷(`backend/data/guru_managers.json`, 매니저 80명)이 이미 **173 KB**였습니다.

**모든** 구루 엔드포인트가 `storage.get_guru_managers()`로 블롭 전체를 매 요청 읽고 역직렬화하며, 캐시 계층이 **없습니다**(`routers/guru.py`에 `cache` import 0):

| 엔드포인트 | 블롭 사용 |
|---|---|
| `GET /managers`(`:21-30`) | 전체 로드 후 `_DETAIL_ONLY_KEYS = ("holdings","sold_out")`를 벗겨 반환(부분 완화) |
| `GET /managers/{id}`(`:33-39`) | 전체 로드 → 선형 스캔으로 1명 |
| `GET /stats/popularity`·`/stats/weighted`(`:42-51`) | 전체 로드하지만 `top10` 층만 사용 |
| **`GET /stats/allocation`(`:54-57`, 신규 G6)** | 전체 로드 + `holdings` **전 층 순회**(83명 × 최대 133행) → **전 티커 rows를 무제한 반환**(limit/페이지네이션 없음) |

프론트도 전량을 받아 클라이언트에서 슬라이스합니다 — `GuruAllocation.jsx:56,70-74`의 `SCOPES`(탑10/20/50/전체)는 **표시 줄 수일 뿐 집계·전송 범위가 아니며**, 검색은 의도적으로 전체 집합을 훑습니다(`:68-70` 주석). 즉 탑10만 보고 있어도 매 진입 시 전 티커 payload를 받습니다. [코드확인]

### 4.5 구루 크롤 소요시간 [열림]

`backend/services/guru_scraper.py:371-409` 완전 직렬입니다: 매니저당 holdings 1콜 + `time.sleep(0.5)`(`:403`), 활동 페이지 1~10콜 + 페이지당 `time.sleep(0.35)`(`:314`), 신규 티커당 한글명 1콜 + `time.sleep(0.1)`(`:387`). 83명 규모에서 수 분~수십 분이며, 진행률은 `ProgressTracker`로만 노출됩니다. 실패는 매니저 단위 graceful — 그래서 §2.1의 **부분 실패 무가드**(전건 실패는 이제 막히지만 일부 성공은 그대로 저장)와 직결됩니다. 성공률 관측점은 `:408`의 `[Guru] 수집 N/total` 로그뿐입니다. [코드확인]

### 4.6 배치 misfire 유예가 사실상 1초 [열림]

`backend/scheduler/schedule.py:30-34`는 `misfire_grace_time` 미지정 시 인자를 빼서 APScheduler 기본값(1초)을 씁니다. `batch_registry.BATCHES` **29종** 중 이 키를 가진 것은 **6종**(2종=82800초, 4종=명시적 `None`)뿐이고 나머지 23종은 키 자체가 없습니다 → **컨테이너 재기동이 크론 순간과 겹치면 그날 배치가 조용히 스킵**됩니다. [코드확인]

### 4.7 프론트 번들 [열림]

현재 `frontend/dist/assets/` 실측(2026-07-29 빌드, task#241 반영) [코드확인]:

| asset | 크기 | 직전 매핑 |
|---|---|---|
| `index-DDmOM8Ui.js` (앱 엔트리) | 479 KB | 476 KB |
| `charts-CtpqJ98B.js` | 415 KB | 415 KB (해시 동일 = 무변경) |
| `vendor-C4GJnovt.js` | 255 KB | 255 KB (해시 동일) |
| `index-BFThVgiD.css` | 54 KB | 53 KB |

- `frontend/vite.config.js`의 `manualChunks`는 **함수 형식**(Vite 8 = rolldown 필수 조건 충족 — 객체형을 쓰면 `Expected Function but received Object`로 빌드가 깨집니다). `recharts`/`/d3-`/`victory-vendor`→`charts`, 나머지 `node_modules`→`vendor`. [기록: task#28]
- **`React.lazy`/`Suspense` 사용 0** [코드확인] — `App.jsx`가 라우트 컴포넌트를 전부 정적 import하므로 `Showcase`·`AdminAnalytics`·`Settings`까지 단일 엔트리에 실립니다. `charts`도 `Portfolio→Analytics→recharts` 정적 엣지 때문에 첫 페인트에 끌려옵니다. **신규 페이지는 곧 엔트리 증가**입니다(GuruAllocation이 `Guru.jsx`에서 정적 import돼 +3 KB).

### 4.8 배포 관련 [footgun]

- **폴러가 로컬 변경을 삭제** — launchd `com.portfolion.auto-deploy-poll`이 2분마다 `scripts/auto-deploy-poll.sh`를 돌려 `LOCAL != origin/main`이면(**양방향**) `git reset --hard origin/main` 후 `deploy.sh`. 메인 체크아웃의 **커밋 안 한 tracked 편집 + push 안 한 로컬 커밋이 ≤2분에 소실**됩니다. `.forge/` 등 untracked는 대상 아님(안전). **코드·문서 변경은 commit과 `git push origin main`을 묶어서.** [기록: task#106]
- **단, 커밋 소실을 `git log -1`로 판정하지 말 것** — `commit && push`를 한 셸 체인으로 묶어도 그 사이 폴이 끼면 폴러가 *자기가 앞서 fetch해 둔 낡은 `origin/main`*으로 reset해 로컬이 잠깐 되돌아갑니다. push는 이미 성공했고 다음 폴이 자기복구하므로 실손실은 0인데, 그 순간 `git log -1`은 이전 커밋을 보여줍니다(2연속 오판 — task#238·#239). 판정은 **`git rev-parse HEAD` vs `origin/main` + `gh run list`**로. [기록]
- **폴러의 무음 스킵** — `git fetch` 실패 시 배포가 조용히 멈춥니다(로그에 연속 스킵 기록). [기록]
- **러너 격리** — 배포 주 경로는 self-hosted 러너(`deploy.yml`), 폴러는 폴백. PortfoliOn 전용 러너는 `~/actions-runner-portfolion`. 이 디렉터리가 타 repo로 재등록되면 잡이 `queued→24h cancelled`가 되고 in-checkout 푸시는 **무음 미배포**(5일 실사례). 백엔드가 옛 코드면 폴러를 단정하기 전에 `gh run list` / `gh api …/actions/runners`로 **러너부터** 확인. [기록: task#105]
- **프론트/백엔드 반영 시점 비대칭** — nginx가 `./frontend/dist`를 `:ro`로 직접 서빙(`docker-compose.yml:37`, `deploy.sh:55`)해 로컬 `npm run build`가 **즉시 라이브**. 반면 **백엔드는 러너·폴러 재배포 후에야** 반영됩니다. 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작합니다(task#241처럼 신규 엔드포인트 + 신규 페이지가 한 커밋에 오면 특히). [코드확인]
- **배포 중 짧은 다운타임** — `deploy.sh`가 backend·nginx를 `stop`+`rm`+`run`으로 교체(무중단 아님). backend는 `docker run`이라 `docker compose ps`에 안 잡힙니다. [코드확인]
- **launchd keychain 무음 실패** — `claude -p`는 keychain OAuth를 쓰므로 plist에 `HOME`/`USER`/`LOGNAME`/`PATH`가 없으면 조용히 죽습니다. `~/Library/LaunchAgents/com.portfolion.cowork-fire-listener.plist`는 4개를 모두 명시(가드 실재). `.credentials.json`이 있어도 stale이면 keychain을 읽으므로 '파일 있음'으로 기각 금지. [기록]

---

## 5. 깨지기 쉬운 영역 (fragile areas)

손대면 **다른 데가 조용히** 깨지는 자리입니다. 각 행의 "함께 볼 곳"을 착수 전에 열어보세요.

| 건드리는 것 | 왜 조용히 깨지나 | 함께 볼 곳 |
|---|---|---|
| **nav 탭 추가·개명·삭제** | 목록이 4곳에 복제돼 있고 vitest·빌드는 통과합니다. ResearchShell만 고치면 PC에서 진입 불가. (구루 내부 탭은 예외 — `Guru.jsx` 단일 `TABS`) | `frontend/src/App.jsx` · `components/Masthead.jsx` · `pages/ResearchShell.jsx` · `components/MobileNav.jsx` · `components/MobileTopActions.jsx` |
| **신규 DB 컬럼 추가** | `app_schema.sql`은 신규 설치용이라 라이브 DB에 반영되지 않습니다 → 그 컬럼을 쓰는 INSERT/SELECT가 배포 직후 깨짐 | `backend/app_schema.sql` **+** `backend/main.py:_migrate`(쌍 필수) |
| **신규 DB 테이블 추가** | 위와 같은데 **컬럼과 달리 현재 5개 테이블이 이미 쌍이 없습니다**(§1.3) — 선례를 따라가면 안 됩니다 | 같음 + `backend/migrations/*.sql`(세 번째 정본) |
| **엔드포인트 응답을 비-additive로 변경**(배열→객체 등) | 훅과 별개로 직접 fetch하는 소비처가 있어 한 곳만 고치면 다른 화면이 옛 형태로 조용히 깨집니다 | `grep -rn '<엔드포인트 경로>' frontend/src/` 전수 |
| **엔드포인트에 auth `Depends` 추가** | 다수 테스트가 conftest가 아니라 자체 `FastAPI()`를 만들어 override하므로 401/403으로 깨집니다. **단 선제적 전수 수정은 과함** — 형제 read가 이미 인증돼 있으면 override가 선재 등록된 경우가 많습니다(계획이 지목한 4·5·14파일 중 실제 필요는 3·0·0) | 붙인 뒤 **전체 스위트를 먼저 돌리고 깨지는 것만** 수정. 무인증 거부는 override 없는 fresh app으로(`backend/tests/test_security_auth_gaps.py` 패턴) |
| **엔드포인트에 read/외부호출을 additive로 추가** | 응답 shape뿐 아니라 *호출 시퀀스*가 늘어 `mock.call_args`(마지막 호출)를 단언하는 기존 테스트가 거짓통과·오류 | `call_args_list[i].kwargs`로 마이그레이션 + `call_count`로 못박기 |
| **모듈에서 심볼 제거·개명** | mock 타깃은 "그 기능의 주 테스트 파일"에만 있지 않습니다(`digest_service`의 `yf` 제거 시 **다른 파일**이 patch 중이라 `ModuleNotFoundError`) | `grep -rn "모듈경로.심볼" backend/tests/` |
| **`batch_registry.BATCHES` id 추가·제거** | exact-count/set 하드코딩 단언이 4파일에 흩어져 있고, 은퇴한 id로 `job_runs.record`하면 배치 현황에서 조용히 증발합니다(3회 재발) | `grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/` + `job_runs.record` **모든 lane**(auto·manual·backfill) |
| **배치의 fetch 소스 변경** | `batch_registry`의 `source`를 안 고치면 배치 현황이 틀린 출처를 표시합니다(`source`=fetch 출처 ↔ `usage`=소비 UI, 방향 반대) | `backend/services/batch_registry.py` |
| **구루 크롤 저장 로직 수정** | 수동·자동 두 lane에 같은 코드가 복제돼 한쪽만 고치면 다른 lane으로 재발(§1.4). **저장 완결성 판정은 이제 writer 소유** — 새 가드도 거기 넣어 두 lane 중복을 만들지 마세요 | `backend/services/storage/schedule.py:23-35`(판정) + `backend/routers/guru.py:73-89` + `backend/scheduler/jobs.py:54-68`(분기·로깅) |
| **외부 fetch 결과를 저장(`_mc_save`/replace)** | 예외 가드만으론 부족합니다 — 외부 API는 200/`rt_cd=0`으로 **빈 payload**를 주고, 그게 직전 양호값을 덮습니다(같은 클래스가 6회 재발, task#48·50·157·160·242). 특히 delete-rewrite면 박제가 아니라 **소멸** | 모범: `commodities.py:53-55,99-101` · `earnings.py:208-211,237-240` · `indices.py:143` · `ranking_service.py:144-145` / 반례(미가드): `exports.py:105-123`(G2) · `kr_sector_service.py:84-85`(G3) |
| **dataroma 열 인덱스·`_ACT_ROW_TDS`** | 위치 기반 파싱이라 열이 하나 늘면 전 필드가 밀립니다. 활동 표에는 여는 `<tr>`이 없어 `select("tr")` 관용구가 **0행**을 냅니다. 그리고 `cells[6]`(금액)은 오정렬 시 **다른 숫자 열을 성공 파싱**해 경고 없이 wrong 값을 저장합니다(G4) | `backend/services/guru_scraper.py:42-54,131-164,215-286` — 검증엔 라이브 1매니저 값을 dataroma 화면과 대조 |
| **공용 배지 variant의 색 의미 변경** | vitest·빌드가 색 의미에 블라인드합니다. "규칙 위반처럼 보이는 배선"이 의도된 소비일 수 있어(과거 success/danger 교체가 ChangeBadge 가격색을 서구식으로 반전시킨 차단급 회귀) | 소비처 전수 grep 선행 + 스팟 시각 재캡처. 가격 방향=`.badge--up`/`--down`, 의미 상태=`--success`/`--danger`/`--warning`, **교차 사용 금지** |
| **`ui/Stat.css`의 색 클래스** | Stat은 `success`→`var(--up)`·`danger`→`var(--down)`로 매핑돼 있어(`:16-17`) **같은 단어가 Badge와 다른 색**을 뜻합니다. 게다가 `--up`/`--down` 클래스는 아예 없는데 `AnalystReport.jsx:332`가 그걸 넘겨 무스타일(M4) | `frontend/src/components/ui/Stat.css` · `ui/Stat.jsx` · `pages/AnalystReport.jsx` · `styles/tokens.css` |
| **레이아웃 수치·그리드 열수 변경** | 가용폭을 "카드 폭 − 패딩"으로 추정하면 flex 형제가 먹는 폭을 놓칩니다(295 추정 vs 237 실측). **열을 늘리면 압축된다는 직관에 역전 지점**이 있고(트랙이 좁아져 label 2줄 → 카드가 오히려 커짐), **반대 방향도 대칭으로 터집니다**(모바일 열수를 줄이면 PC에서 카드가 넓어져 밀도 하락) | 배포 전 `getBoundingClientRect()` 실측 1회 + **양쪽 뷰포트 캡처**. 완료기준을 대리지표(열 수)가 아니라 목표 자체(카드 높이·label 줄수)로 |
| **한 상자에 이름+수치를 같이 넣기** | `text-overflow: ellipsis`는 문자열 **끝**을 먹으므로 `이름 · 6.25% · 24명`은 잘림이 반드시 수치부터 먹습니다(라이브 PC 50행 중 38행 발생). 그리고 이 잘림은 `getBoundingClientRect` 넘침 검사에 **원리적으로 안 잡힙니다**(§6.2) | 모범: `frontend/src/styles/guru.css:114-116` — 줄어도 되는 것만 ellipsis 상자(`.guru-alloc-nm`)에, 줄면 안 되는 것은 `flex-shrink: 0` 형제(`.guru-alloc-num`)로 |
| **도넛/차트 크기 변경** | recharts `maxRadius = min(폭,높이)/2`라 **폭만 늘리면 높이가 반지름을 캡**합니다. 그리고 크기를 키우면 라벨 자동 임계값이 내려가 **라벨 수가 늘어**(130→164에서 370→497개, +34%) 새로 등장한 라벨이 밴드를 뚫습니다 | `frontend/src/pages/GuruDetail.jsx` + 전수 재검증(감소만이 아니라 **증가도 원인 확인**) |
| **`market_indicators`에 새 지표 추가** | 요청경로 증분 vs 배치-백킹 중 어느 쪽인지 정하지 않으면 요청당 N콜이 끼거나 배치 등록이 누락됩니다. `sanitize`/`isfinite`도 이 패키지 대부분에 없습니다(§2.4) | `backend/services/market_indicators/` · `backend/services/batch_registry.py` · `backend/routers/market_indicators.py`(**prefix는 `/api/market` 하나뿐** — `/api/market-indicators`는 존재하지 않음) |
| **`get_or_refresh`를 새 키에 사용** | 저장값의 나이를 검사하지 않으므로(§2.3) 배치가 없는 키에 쓰면 무한정 오래된 값을 "성공"으로 반환합니다. 나이 판정이 필요하면 `earnings.py:61-76` `_is_fresh` 패턴 | `backend/services/market_indicators/cache.py:110-120` + 그 키의 배치 존재 여부 |
| **DB NUMERIC 값을 외부 float과 산술** | `Decimal`/`float` 혼합이 `TypeError` → 대시보드는 500도 안 내고 enrichment만 blank | 양변 `float()` 정규화 + **Decimal fixture로** 회귀 테스트 |
| **PEP604 어노테이션 사용** | 로컬 `.venv`는 Python 3.9.6, 컨테이너는 3.12. 런타임 평가 자리(Pydantic·FastAPI 시그니처)에 `X \| None`을 쓰면 **로컬 pytest가 TypeError**. 문자열 주석은 평가 안 돼 통과하므로 더 헷갈립니다 | `Optional[X]` 사용 |
| **HTML 파싱 파서 선택** | `lxml`은 `requirements.txt`·컨테이너엔 있지만 **로컬 `.venv`엔 없습니다** | `BeautifulSoup(html, "html.parser")`(로컬·프로덕션 모두 동작) |
| **`app.routes` 순회 코드 신설** | 배포 이미지 FastAPI(0.138.1)는 `include_router` 라우트를 `_IncludedRouter`로 감싸 `.routes`를 숨기고 `original_router`만 노출합니다. 로컬 구버전은 평탄 노출 → **로컬 138개 / 컨테이너 0개**를 세며 "위반 0건"으로 거짓 통과 | `backend/tests/_routes.py`의 `walk_routes()` 재사용(양쪽 재귀 하강) + "0/빈 결과를 성공으로 읽지 않는" 별도 단언 |
| **API 엔드포인트 추가·변경** | 존재 drift는 `test_api_doc_sync.py`가 잡지만 **요청/응답 스키마·인증 게이팅 산문은 수동 DoD**입니다. `CLAUDE_COWORK_API.md`는 Cowork 워크플로우 전용 스코프이니 사용자 대면 read는 `API_SPEC.md`에만(task#241이 이 분리를 지킨 최신 선례) | `API_SPEC.md` (+Cowork 소비 대상이면 `CLAUDE_COWORK_API.md`) · `README.md` 해당 절 |

---

## 6. 검증 사각지대

단위테스트가 **원리적으로** 못 잡는 표면과 현재의 대체 수단입니다.

### 6.1 jsdom에서 recharts는 렌더되지 않는다 [기록: task#212·217·219·220·235 5회 반복]

`ResponsiveContainer`가 jsdom에서 0크기라 축·틱·마커·막대가 전혀 렌더되지 않습니다 → `"2026(E)"` 같은 **틱 텍스트 단언은 구조적으로 불가능**합니다.

- **vitest에서 단언할 것**: 범례 텍스트·캡션·데이터 유무 분기·표 부재. 표를 차트로 바꾸면 같은 텍스트가 지표당 1회씩 반복되므로 `getByText`가 다중 매치로 깨집니다 → `getAllByText(...).length`.
- **라이브 Playwright로 옮길 것**: 라벨 겹침·정렬 등 시각 속성은 `getBoundingClientRect()` 교차 검사.
- **프로브 셀렉터 함정**: 커스텀 `label`이 반환한 `<text>`는 `.recharts-pie-labels` **밖**(`recharts-zIndex-layer_2000` 안 무클래스 `g.recharts-layer`)에 있고, recharts는 별도로 **내용 없는 `.recharts-pie-label-text`**(rect 0)를 남깁니다. `.recharts-pie-labels text`로 잡으면 진짜 라벨 0개·빈 노드만 걸려 헛수치가 나옵니다 → 안전한 관용구는 **`.recharts-surface text` + 내용 있는 것만 필터**.
- **축 붕괴**: `XAxis type="number"`에 `domain`만 주고 실제 data 포인트가 없으면 축이 한 점으로 뭉쳐 ReferenceArea/Line이 전부 중앙에 겹칩니다 → 축 양끝을 실제 data 포인트로 주고 `domain=['dataMin','dataMax']`.
- **`getComputedTextLength` 부재**: jsdom엔 없습니다 → 문자폭 실측 코드는 **추정 폴백을 반드시 남길 것**(안 남기면 기존 단위테스트가 통째 깨짐). `GuruDetail.jsx:19,24,30-32,143-153`이 그 형태입니다.

### 6.2 시각·레이아웃은 라이브 실측이 유일한 게이트 [기록: task#225·228·235·237·241]

vitest·빌드는 레이아웃 수치와 색 의미에 블라인드합니다(jsdom 무레이아웃). 그런데 **라이브 프로브도 5가지 방식으로 거짓 판정**을 냈습니다:

1. **기준 상자를 추정** — 토스트 영역을 "중앙 ±130px"로 가정해 21px 교차=FAIL을 냈으나 실측은 교차 0(여유 10px)이었습니다. 비교 *상대*의 좌표도 `getBoundingClientRect()`로 얻거나 실제 스타일을 재현해 측정하세요. **규약을 프로덕션 코드에만 적용하고 검증 도구에서 어기면 거짓 FAIL로 정상 구현을 되돌립니다.**
2. **판정 축 부족** — 라벨 **중심** 반지름만 재서 접선(가로) 방향 넘침이 판정에 없었고, **ALL PASS 30건인데 화면은 깨져** 있었습니다. 박스가 곡면/사선 영역 안에 있는지 볼 때는 중심이 아니라 **네 모서리**를 재세요.
3. **CJK를 라틴 문자폭으로 측정** — `6.2px/자`로 재 한글 전각(~10px)을 14% 과소평가했습니다. **[해결됨]** `GuruDetail.jsx`가 숨은 SVG `<text>`(0×0·`aria-hidden`)에 라벨을 넣고 `getComputedTextLength()`로 마운트당 1회 실측·캐시합니다. [코드확인]
4. **리터럴 단언** — `cols === 3` 같은 리터럴은 정당한 변경에 거짓 실패합니다 → **불변식**(`cols === (chips <= 3 ? chips : 2)`)을 단언하세요. 완료기준이 "값이 **행마다** 동일"처럼 **단열을 전제한 표현**이면 `auto-fill` 다열에서 정상 구현이 FAIL합니다.
5. **계측기 자체가 틀린 축** — `text-overflow: ellipsis`(·`line-clamp`)는 박스를 넘는 게 아니라 **박스 안에서 내용을 지우므로** `getBoundingClientRect` 넘침 판정이 **전부 정상 통과**합니다. 구루 투자금 탭에서 프로브 26단언 ALL PASS인데 PC 메타줄이 잘려 **상위50 중 38행(76%)의 비율·보유 구루 수가 통째 사라져** 있었습니다(가용폭 110px vs 필요 232px). → **`scrollWidth > clientWidth`**(세로면 `scrollHeight > clientHeight`)를 **별도 축**으로 잴 것. 현재 `scripts/uat241-guru-allocation.mjs:45-48`이 그 축을 갖고 있습니다. [코드확인]

**프로브 신뢰성 4규칙** [기록: task#238·239·240] — 실패만 기록하는 프로브의 `ALL PASS`는 "아무것도 안 본 것"과 구별되지 않습니다: ⓐ **커버리지를 출력**(계열별 검사 수 카운터 — `ALL PASS — 단언 1건`을 찍은 적이 있습니다) ⓑ **총계가 재실행 간 조용히 줄면 통과가 아니라 측정 실패**(1179→1159 = 매니저 1명분 무음 스킵) → 표본 스킵은 id 명시 + 1회 재시도 후 FAIL ⓒ **판정 범위를 좁혀라** — `document.querySelectorAll`로 문서 전체를 세면 전역 내비가 섞여 정상 구현이 거짓 FAIL합니다(`main.page-wrap` 본문으로 한정, FAIL 시 완화 전에 부모 체인 덤프) ⓓ **육안 확인은 거짓 *경보*도 낸다** — bbox 교차 ≠ 클릭 차단(둥근 모서리·`pointerEvents:none`), `elementFromPoint`로 기각하고 형제 표면(`.fab` 등)과 대조해 "앱의 기존 성질"인지 가르세요.

**실천 3가지**: ⓐ 시각 변경은 프로브 PASS 후에도 **스크린샷 1장 육안 확인**을 완료기준에 넣을 것(#235·#241 두 번 모두 그게 유일한 포착 수단이었습니다) — 대상이 프레임 밖이면 무의미하니 캡처 전 `scrollIntoView` ⓑ 완료기준을 쓸 때 "이 단언이 통과하면서도 깨질 수 있는 방식"을 한 줄 적어보면 빠진 축이 드러납니다 ⓒ 양쪽 뷰포트(PC·모바일)를 함께 캡처.

프로브 자산은 `scripts/uat*.mjs`(예: `uat225-polish.mjs`·`uat237-guru-donut.mjs`·`uat240-guru-activity.mjs`·`uat241-guru-allocation.mjs`)에 축적돼 있습니다.

### 6.3 admin 전용 표면은 라이브 UAT가 원리적으로 불가 [기록: task#214·215·222·224 4회 반복]

라이브 UAT 계정은 **비admin**이라 admin 화면(대상 관리 섹션·토글·삭제 버튼)과 `require_admin` 엔드포인트를 Playwright로 열 수 없습니다. `require_admin`은 **API 키를 거부**하는 설계(§3.3)라 키로도 안 됩니다. **UAT 단계에서 막혀 계획을 되돌리지 않으려면 착수 전에 셋 중 하나를 고르고 DoD에 적으세요**: ① 게이트를 `require_admin_or_api_key`로 열어 API 키로 positive 검증(Cowork-facing 쓰기 컨벤션과 맞을 때만) ② vitest + 기능경로 API로 닫고 **버튼 렌더는 사용자 화면 확인으로 이월**(`run.md`에 남길 것) ③ admin 크레덴셜을 사용자에게서 받음.

부수: **이 앱은 Service Worker가 `/api/*`를 가로채므로 Playwright `page.route` 응답 인터셉트가 안 먹습니다** — 응답 주입 기반 UAT는 컨텍스트를 `serviceWorkers: 'block'`으로 만들어야 합니다. 그리고 **폴백 경로만 UAT하고 실데이터 경로를 이월하면** 두 경로의 필드 집합 차이가 결함을 숨깁니다(구루 `top10`엔 한글명 있고 `holdings`엔 없음 — 이 차이가 §1.2에 지금도 남아 있습니다). [기록: task#226·227]

### 6.4 외부 실데이터 [기록: task#111·117·122·123·126·135·156]

fixture는 통과하고 라이브만 실패하는 계열(§2.2)입니다. 단위테스트는 응답을 mock하므로 라벨 불일치·봉투 형태·퍼센트 스케일을 **원리적으로** 못 잡습니다.

- **DoD에 라이브 1종목 추출 대조**를 넣으세요. 위치 의존 파싱(dataroma `cells[6]` 등)은 **화면과 값 1건을 눈으로 대조**하는 것이 유일한 오정렬 탐지 수단입니다(G4).
- **라이브 프로브는 fetch 200뿐 아니라 응답 봉투 파싱까지** 확인해야 완성입니다(KIS 선물 `output` vs `output1/2/3`을 놓쳐 "코드 오류"로 오진한 사례).
- **신규·배치화 SQL은 라이브 스모크 필수** — query-mock은 `uuid = ANY(%s)`(→`::uuid[]` 캐스트 필요)·`VALUES ((a,b),(c,d))` 바깥괄호 같은 배포-즉사 버그를 통과시킵니다.
- **"다 나오는데 하나만 빈" 증상을 fetch 실패로 성급히 귀속하지 마세요** — RSI(14봉)는 상장 <14거래일 신규 종목에서 자연히 NaN입니다. 진단은 `docker exec -i portfolion-backend-1 python -`로 히스토리 행수를 찍어 히스토리 부족 vs fetch 실패를 가릅니다.
- **"라이브 게이트"를 자칭하는 스크립트는 배포 환경에서도 돌려 숫자가 실제로 나오는지** 확인해야 완성입니다 — **0/빈 결과를 성공으로 읽는 게이트는 게이트가 아닙니다**(§5의 `app.routes` 행).

### 6.5 자체-app 테스트가 우회하는 실제 배선 [열림]

`backend/tests/` 다수(총 **129파일 · 1411건 통과**, 이번 매핑 실측 14.3초)가 모듈 상단에서 `FastAPI()`를 직접 만들고 `app.dependency_overrides`로 auth를 우회합니다. 이들이 **관측하지 못하는 것** [기록 + 코드확인]:

- `backend/main.py`의 실제 배선 — `SessionMiddleware`·`EventTrackerMiddleware`·`CORSMiddleware`, 그리고 **`sanitize`가 422 본문에 적용되는 유일한 지점인 `RequestValidationError` 핸들러** → 422-NaN 회귀는 이 앱들로는 관측 불가.
- `backend/tests/conftest.py:13-15`의 `client`는 TestClient를 **컨텍스트 매니저로 쓰지 않아 lifespan이 안 돕니다** → `_migrate()`·스케줄러·`_warm_market_cache`가 테스트에서 전혀 실행되지 않습니다(§1.3의 마이그레이션 결함이 스위트로 안 잡히는 이유).
- `conftest.py:10`의 `app.dependency_overrides[get_current_user]`는 **모듈 레벨 변형이며 아무 fixture도 되돌리지 않습니다**.
- 401/403 단언 커버리지는 read 쪽만 채워졌습니다 — `/api/admin/*` 쓰기 대부분·`report.py` 벌크 refresh 전부·`PUT /api/report/{ticker}/backlog`·`stocks.py` 백필 4종·`market_indicators.py` 갱신 4종·`portfolio.py`/`watchlist.py` 전 라우트는 여전히 어디서도 401/403이 명시적으로 단언되지 않습니다.
- `backend/pytest.ini`는 `testpaths`·`pythonpath` 2줄뿐 — 마커도, 플러그인 수준 network/DB 차단도 없습니다.

### 6.6 프론트 silent catch — 실패가 "데이터 없음"으로 위장 [열림]

`frontend/src/`(테스트 제외) `catch` **120곳**, `console.warn` 12·`console.error` 7·`console.log` 0. **`no-console` lint 규칙 없음**, 그리고 `frontend/src/api.js:15-25`의 axios 인터셉터는 **로깅 없이 401만 하드 리다이렉트**하고 나머지는 그대로 `Promise.reject`하므로 **삼켜진 요청 실패가 드러나는 중앙 지점이 없습니다**. `unhandledrejection`/`window.onerror` 전역 핸들러도 **0건**입니다. [코드확인]

최악군(로그·토스트·UI 없음) [기록 + 코드확인]:

| 위치 | 삼켜지는 것 |
|---|---|
| `hooks/usePortfolioData.js:41` | 대시보드 캐시 무효화 실패(`.catch(() => {})`) → 직후 GET이 **stale 캐시**로 수행. §4.2 재시도 경로가 바로 이 호출 |
| `hooks/usePortfolioData.js:71` | 라이브 시세 폴(KR 15s/US 60s) 전 실패(bare `catch {`) → `lastUpdated`가 조용히 정지, staleness 신호 없음 |
| `hooks/useReportGeneration.js:22`, `pages/ReportManualGen.jsx:98,136`, `pages/ConsensusSettings.jsx:28`, `pages/GuruCrawlNow.jsx:28` | 진행률 폴 실패(빈 catch 5건 전부) → **스피너 영구 stuck**, 토스트 없음 |
| **[G5] `pages/GuruAllocation.jsx:38-43,45-52` · `GuruStats.jsx:88-95`** | `.catch`가 아예 없음 — `.then().finally()`는 rejection을 잡지 않으므로 ① `loading=false`+`data=null`이 되어 **"데이터 없음 — 크롤링을 먼저 실행하세요"**라는 *잘못된 행동 지시*가 뜨고 ② unhandled rejection이 콘솔에만 남습니다. `handleToggle`(관심 토글)도 try/catch 없어 실패 시 무반응. **형제 두 화면이 같은 형태라 신규 회귀가 아니라 이 페이지 계열의 패턴**입니다 |
| `components/GlobalSearch.jsx` | `/api/stocks` 실패 → 모든 티커가 '미보유'로 보여 검색 선택이 리포트 대신 **관심추가 프리필**로 라우팅 |
| `contexts/AuthContext.jsx` | `auth/me` 실패 → `menuPermissions=[]` → Masthead·MobileNav가 필터링해 **빈 앱 셸**이 에러 대신 표시 |
| `pages/Ranking.jsx`, `Calendar.jsx`, `Settings.jsx`, `components/reports/ReportDetailTabs.jsx` | 관심 별표 미표시·500을 404와 동일 취급·프리페치·FOMC 경고 미발화·뉴스 폴백 |
| 섹션 blank 계열 | `reports/DetailTab.jsx`, `reports/SupplySection.jsx`, `reports/HistoryTab.jsx`, `StockSearchBox.jsx`, `pages/Recommendations.jsx` — 실패 시 `[]`/`null` → 상위 가드가 섹션을 통째 미렌더 |

**규약**(`CONVENTIONS.md` §4): `console.warn`=graceful / `console.error`=예상외, 마커는 소스 모듈·훅명 실명(`[usePortfolioData]` 등). **자동 가드 없음**(lint 미연결).

### 6.7 테스트가 소유하지 않은 파일 [열림]

- **`frontend/src/pages/Portfolio.jsx`에 테스트가 없습니다** — 스켈레톤/빈상태 분기와 재시도 캡(§4.2)을 소유한 파일이 미테스트입니다. `hooks/usePortfolioData.test.js`는 4케이스(list reject·dashboardError set/clear)만 보고 캡·`retriesExhausted`·폴 루프 silent catch를 단언하지 않습니다. [기록]
- 프론트 테스트 파일 **25개** [코드확인] — task#241이 `GuruAllocation.test.jsx`를 신설했습니다(스코프 필·검색·잘림 관련 DOM 구조). 단 **에러 분기는 그 테스트도 커버하지 않습니다**(G5).

---

## 7. 미구현·보류 (의도적 non-goal)

버그가 아니라 기록된 트레이드오프입니다. 재발견해서 결함으로 올리지 않도록 명시합니다. [기록]

| 항목 | 상태·근거 |
|---|---|
| 구루 크롤 **부분 실패** 임계값 가드 | 없음 — task#242의 명시적 non-goal. 전건 빈 결과만 막고, 83명 중 3명 성공도 저장합니다. 성공률은 `guru_scraper.py:408` `[Guru] 수집 N/total` 로그로 **관측만** (§2.1) |
| 구루 탭의 URL 라우팅 | 없음 — `Guru.jsx`는 로컬 state 탭이라 딥링크·새로고침 복원 불가(§1.1) |
| 투자금 총액의 신고/추정 분리 표시 | 없음 — `compute_allocation`이 신고 금액과 `비중%×포트가치` 추정을 한 총액에 섞습니다(§2.2 주석 명시) |
| 루틴 실행 결과 실시간 콜백·**재시도 큐** | 없음(fire-and-forget). ADR-0028 YAGNI. `cowork_trigger.fire`의 "성공" 로그는 **HTTP 전달 성공**만 의미 |
| 발행물 **판 단위** 삭제 | 만들지 않음 — 잘못된 판은 새 판 발행으로 덮습니다. 종목 단위 삭제만(ADR-0027 개정) |
| KR 지수 밸류에이션(KOSPI/KOSDAQ PER) | 무료 공식 소스 부재로 미구현. `market_indicators/indices.py`는 `valuation.sp500_cape`만 |
| 실시간 WS 시세 | 키움 `wss://…/websocket`·KIS `H0STCNT0` 모두 후속 Phase 미착수 |
| 키움 KR 호가·공매도·수급 TR 대체 | `KIWOOM_API.md` "계획(Phase 2/3)" |
| KIS 주문·계좌 | 경계 밖(읽기전용 시세만, ADR-0009/0011/0022) |
| 백엔드 LLM 호출 | 없음. AI 텍스트는 외부 Cowork가 enrich API로 작성(`ANTHROPIC_API_KEY`는 남아 있으나 미사용) |
| US 시세 실시간 | KIS US는 기본 15분 지연·주요지수 구성종목 중심 → 백업 용도로만 수용 |
| 인가(authz)의 API 레이어 강제 | §3.2 — 의도된 현재 설계로 보이나 명시적 ADR은 없습니다 |
| FOMC 날짜 자동 크롤 | 없음 — `backend/routers/calendar.py:30-38` `_FOMC_DATES` 하드코딩(2027-12-08까지). 소진 임박 시 `fomc_coverage_status`가 배치 허브에 '갱신 필요' 경고를 띄웁니다(무음 미표시 방지). [코드확인] |

---

## 8. 이미 닫힌 항목 — 가드 위치

"열린 문제"로 다시 올리지 않기 위한 목록입니다.

| 과거 이슈 | 현재 상태 · 가드 |
|---|---|
| **G1: 구루 크롤 빈 결과 전면 덮어쓰기** | **해소(task#242, `0822d53`)** — `storage/schedule.py:23-35`이 판정을 소유(`-> bool`, 빈 `managers`면 `execute` 미호출), 두 lane은 분기·warning만. 회귀 `backend/tests/test_empty_result_overwrite_guards.py` 14건. 같은 커밋이 `commodities.py`(원자재·국채)·`earnings.py`(M7·KR Top2)도 닫음. **부분 실패는 의도적 non-goal**(§7) |
| **무인증 공개 read** (구루·랭킹·수급·공매도·시장지표·리포트·검색·뉴스 등 다수 GET) | **해소(ADR-0029, task#230·231·232)** + **상시 회귀 게이트(task#233)** — `backend/tests/test_no_public_reads.py`. 단 **인가(메뉴 권한)의 API 강제는 범위 밖**으로 남음(§3.2) |
| **FastAPI 버전차 라우트 열거 실패**("0건 무인증"으로 거짓 통과) | **해소(task#233)** — `backend/tests/_routes.py:walk_routes()`가 `routes`·`original_router` 재귀 하강 + "라우트 100개 초과" 별도 단언. **근본원인(핀 없는 `fastapi>=0.104.0`)은 살아 있어 신규 열거 코드는 여전히 노출**(§5) |
| **`backend/data/*.json` 정적 시드 오염** | **해소(task#234)** — 7일 캐시를 `market_cache`로 이동, 두 파일은 read-only 시드로 격하, TTL 판정을 `fetched_at`으로. 이번 매핑에서 **스위트 1411건 실행 후 `git status` clean** 재확인 |
| **테스트가 prod DB에 커밋** | **해소(task#169)** — `backend/tests/conftest.py:26-37` `_block_real_db`. **경계는 DB 전용**(파일·네트워크·subprocess는 무방비 — §3.7) |
| 대시보드 500-to-empty | `routers/stocks.py` per-card `_safe`→`_minimal_card` + 반환 `sanitize` + `_usdkrw_rate` `isfinite` + 배당 양변 `float()` (task#102·104·d666cdd2) |
| 입력 경로 NaN이 불변 문서에 저장 | `analyst_reports.py`의 `allow_inf_nan=False` + `main.py`의 `RequestValidationError` 핸들러(+`sanitize`) (task#211) |
| consensus backfill `force` DELETE 비원자 | `backend/services/consensus_pipeline.py`가 DELETE+재적재를 단일 `get_connection()` 트랜잭션으로 묶음 |
| 앱 코드 `print` 방출 | `backend/tests/test_no_print.py`가 ast로 `main.py`·`routers`·`services`·`scheduler`·`middleware`를 단언(현재 0건). `scripts/`·`tests/`는 대상 외 |
| 컬럼 추가 시 마이그레이션 쌍 누락 | 16개 ALTER 컬럼 전부 `app_schema.sql` 쌍 존재. **테이블 쪽은 여전히 열림 — §1.3** |
| 스냅샷 delete-rewrite·빈 결과 박제 | §2.1·§2.3의 가드들(구루·원자재·국채·M7/KR Top2·indices·kospi_futures·kospi_signal·fx·sentiment·dividends·ranking_service·recommendation). **`exports.py`(G2)·`kr_sector_service.py`(G3) 2건은 여전히 미가드** |
| 액션버튼 블록 두 렌더러 중복 | `frontend/src/components/reports/StockActions.jsx` 단일 컴포넌트로 통합(task#103). 액션버튼·게이트 변경은 거기 한 곳만 |
| 라우트 리다이렉트 테스트 수기 복제 | `frontend/src/routes.js` `REDIRECTS`를 `App.jsx`와 테스트가 함께 import. **nav IA 목록은 여전히 4중 복제 — §1.1** |
| tz naive↔aware 조용한 None | `report_generator.py`에 `tz_localize(None)` 적용(task#116) |
| 도넛 라벨 CJK 폭 과소평가 | `GuruDetail.jsx`가 `getComputedTextLength()` 실측 + 추정 폴백(task#237, §6.2) |
| 투자금 메타줄 ellipsis 잘림(수치 소실) | `frontend/src/styles/guru.css:114-116` — 이름만 shrink, 수치는 `flex-shrink: 0`. 프로브에 `scrollWidth` 축 추가(`scripts/uat241-guru-allocation.mjs:45-48`) (task#241) |
| "005930 정확히 70000.0" 원인 귀속 | **정정** — 피드 글리치가 아니라 테스트→prod DB 오염(task#170). 라운드 값이 보이면 **테스트 오염을 먼저 의심** |

### 최근 버그 헌트 이력 [기록]

| 사이클 | 결과 |
|---|---|
| 5차 (task#221) | 8건 CONFIRMED(HIGH 1·MED 4·LOW 3) + 1건 refuted. **8건 전부 미수정 — §0(이번 매핑 `0822d53`에서 재확인)** |
| 4차 (task#207) | 5건(MED 4·LOW 1) → task#208·#209로 5/5 수정·배포 |
| 3차 (task#168) | 원시 1건 → 적대 검증 refuted → confirmed 0 |
| 2차 (task#164) | 15건(HIGH 1·MED 11·LOW 3) → task#165·#166으로 15/15 수정 |
| 1차 (task#107) | 42건 → 41건 해소. 잔존 1건도 이후 해소(§8) |

이번 매핑 구간(`4bb49ff`~`0822d53`)에는 **별도 버그 헌트 사이클이 없었습니다** — 실코드 커밋은 task#241(구루 투자금 탭)·task#242(빈 결과 가드 5곳) 2건이라 5차 헌트 리포트가 여전히 최신 헌트 결과입니다. 직전 매핑이 올린 G1은 task#242로 닫혔고, 이번 매핑이 새로 올린 결함은 **G2~G6 5건**(빈 결과 클로버 잔여 2 · dataroma 위치의존 오값 1 · 프론트 에러 위장 1 · 무제한 응답 1)입니다.
