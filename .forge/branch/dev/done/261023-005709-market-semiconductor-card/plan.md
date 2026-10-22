<!-- forge-slug: market-semiconductor-card -->
<!-- task: 403 -->
<!-- tdd: on -->
<!-- repaired-by: fg-loop -->
# 시장지표 「반도체」 카드 — SOX + 메모리 현물가(이력 백필 포함)

## 목표 / 비목표
- 목표: MarketHub 시장지표 탭 「주요 지수」 바로 아래에 새 「반도체」 카드를 둔다 — ① 필라델피아 반도체지수 SOX 타일 + 1년 차트 ② DRAMeXchange 메모리 현물가 표(6분류 23종, 분류별 소스 갱신일) + 행 탭으로 전환되는 품목 추이 차트. 이력은 인터넷 아카이브 1년치 1회 백필 + 이후 일 배치 누적.
- 비목표:
  - 「주요 지수」 카드 변경(타일·차트 토글 없음 — SOX는 반도체 카드에만).
  - 가격이 비어 있는 유료 영역(LPDDR·eMMC 현물, 모바일 DRAM·eMMC 계약가), 소스에 없는 구형 품목(DDR3 2Gb·1Gb 등 증권사 앱 품목).
  - DRAMeXchange 회원 전용 이력 차트(`chart.php`) — 로그인 우회 금지.
  - 2~3년 백필(1년만). 한국 반도체 지수(KRX 반도체 등).
  - yfinance 일봉 10-21 결측(전 심볼 공통, 저장 이력엔 이미 있음 — 신규 SOX의 첫날 1점 구멍·첫날 등락률만 영향, 자연 해소).
  - prod 백필 실행 — main 머지(사람) 후 별도로 admin이 실행.

## 근거(Source of truth)
- 용어: `.forge/branch/dev/CONTEXT.md` [[메모리 현물가]](이번 그릴링 신설) · `.forge/CONTEXT.md` [[시장지수 밸류에이션]](시장지수 레벨).
- 관련 ADR: 없음(데이터소스·저장은 기존 market_cache·배치 패턴 범위).
- 그릴링에서 라이브로 확인한 사실(2026-10-22):
  - `^SOX` yfinance: 11,044.97 / 전일 11,504.12 — 증권사 스크린샷(11,039.87, 전일 11,505.56)과 일치.
  - `https://www.dramexchange.com/` keyless 200, `html.parser`로 표 파싱 가능. 가격 있는 분류 = DRAM 현물 7 · 모듈 3 · Flash 4 · GDDR 2 · 웨이퍼 3 · 메모리카드 4 = **23종**. DRAM 현물만 매일 갱신(10-22), 나머지는 `Last Update: Oct.12`.
  - 품목 키 = History 셀 `OpenChart('…chart.php?class=spot&item=<item>&type=<id>…')`의 **`<item>:<type>` 복합키**(예 `dram:475` · `wafer:1` · `GDDR:1` — type 단독은 분류 간 충돌). 이름은 시기마다 다르다(`DDR5 16G` ↔ `DDR5 16Gb`, `(2Gx8)3200` ↔ `(2Gx8) 3200`).
  - 이력: `chart.php`는 「Only for MI members」. Wayback CDX(`/cdx/search/cdx?url=dramexchange.com/&from=…&collapse=timestamp:8&filter=statuscode:200`)가 최근 1년 **138일치**, 스냅샷 `…/web/<ts>id_/https://www.dramexchange.com/`(리다이렉트 follow 필요)가 같은 파서로 읽힘(2026-01-16 DRAM 7종 확인).
  - robots.txt 없음(404).
- 따를 규약: `backend/services/CLAUDE.md` 빈 결과 가드 3종(예외·성공-but-빈응답·부분 페이로드 → 분류별 직전값 보존) · `job_runs` `set_status` 배선(템플릿은 `formation.py`·`labor.py`·`inflation.py` + 각 `jobs.py`·라우터 짝) · 배치-백킹 뷰는 요청경로 외부호출 0 · `_mc_load` 봉투(`["data"]`) · 프로세스 전역 가변 상태는 락. 화면 작업은 착수 전 `~/.claude/design/UIUX.md`, 차트는 `dataviz` 스킬.

## 완료 정의(DoD)
1. `cd backend && .venv/bin/python -m pytest -q` 전체 green — **사전 상태 2591 passed**(회귀 가드라 지금도 통과가 정상), 신규 테스트 포함 증가.
2. `cd backend && .venv/bin/python -m pytest -q tests/test_semiconductor.py` green — **사전 상태: 파일 없음**(전방 검사).
3. `grep -c '"sox"' backend/services/market_indicators/indices.py` → ≥1 — **사전 상태 0**.
4. `cd backend && .venv/bin/python -m pytest -q tests/test_api_doc_sync.py` green(신규 엔드포인트가 API_SPEC.md에 문서화) — 사전 green(회귀 가드).
5. 프론트 vitest(신규 `SemiconductorSection` 테스트 포함) green + `npm run build` 성공.
6. dev 스택(127.0.0.1:8084, `dev` push 배포 — Deploy run `headSha`=푸시 커밋 + `conclusion=success`) 라이브: uat-admin으로 수동 갱신·백필 실행 후
   - `GET /api/market/semiconductor` → 분류 6 · 품목 23 · 각 분류 `updated_at` 존재(실값 대조: DRAMeXchange 홈 DDR5 16Gb 세션 평균과 동일)
   - `dram:475` 이력 점 수 ≥ 100(백필 결과), 날짜 중복 0
   - `GET /api/market/indices` 에 `sox`(current·history ≥ 200점)
   - 백필 재실행 시 이력 점 수 불변(멱등)
7. 육안 스크린샷(m360·m390·pc1440): 반도체 카드가 「주요 지수」 바로 아래, 페이지 가로 넘침 0, 품목명 낱자 적층·잘림 없음, 행 탭 시 차트 품목 전환 + 선택 행 강조, 분류별 갱신일 표시. **이 단언이 통과하면서도 깨질 수 있는 방식**: 프로브가 표 행 수·차트 존재만 세면 품목명이 낱자로 쪼개지거나 행마다 줄바꿈 위치가 달라도 PASS → 스크린샷 육안 필수.
8. 문서: `API_SPEC.md`(신규 3 엔드포인트 + indices `sox` 필드) · `README.md`(화면·배치·외부연동 DRAMeXchange/Wayback) · `backend/CLAUDE.md` 인벤토리 1항목 · `batch_registry` 항목(`source`=`["DRAMeXchange"]`, `usage`=`["시장지표 탭"]`). `CLAUDE_COWORK_API.md`는 market read 엔드포인트라 대상 아님(task#113 선례) — 확인 방법: `grep -n "/api/market/" CLAUDE_COWORK_API.md`가 시장지표 read를 싣지 않음을 확인.

## 작업 슬라이스
- [ ] S1. **파서(TDD)** — `services/market_indicators/semiconductor.py::parse_dramexchange(html)` → `{categories: [{key, label, updated_at, items: [{id, name, avg, high, low, change_pct}]}]}`. 가격 없는 분류 제외, `id`=`<item>:<type>`, 수치 `math.isfinite` 가드. 픽스처 2벌(오늘 홈 · 2026-01-16 Wayback 스냅샷)을 `backend/tests/fixtures/`에 저장. — 완료기준: 오늘 픽스처 6분류 23종, 1월 픽스처 DRAM 7종이 **같은 id 집합**으로 매핑, 빈/깨진 HTML → 빈 결과(예외 아님) 테스트 green.
- [ ] S2. **저장·일 배치·조회** — `fetch_and_save_memory_spot()`: 이력은 `id`별 `[{date: 소스 updated_at 날짜, value: avg}]`로 병합(같은 날짜 덮어쓰기·중복 없음), 분류 단위 직전값 보존(예외·빈응답·부분 페이로드), 병합-저장 구간 `threading.Lock`, `_status` 반환(저장 뒤 새 dict). 배치 `memory_spot_fetch` 매일 19:40 KST(`scheduler`·`_JOB_FUNCS`·`batch_registry`, `market="공통"`) + 수동 `POST /api/market/refresh-memory-spot`(admin, 갱신됨/생략 구분 응답) + `GET /api/market/semiconductor`(저장값만, 외부호출 0). — 완료기준: 저장 시드 후 빈응답·예외·한 분류 누락 각각에서 직전값 보존 + `set_status` 비-success 기록 테스트 green(값 None 반환을 모킹). (depends: S1)
- [ ] S3. **아카이브 백필** — `POST /api/market/backfill-memory-spot`(admin, `BackgroundTasks` — `guru.start_crawl` 패턴, Cloudflare 100s 회피): Wayback CDX 최근 1년 일 단위 스냅샷 → 요청 간 ≥1초 → S1 파서 → S2와 같은 병합 경로(락 공유). 스냅샷 단위 실패는 건너뛰고 카운트, `job_runs` 기록(성공/부분/실패 구분). — 완료기준: CDX·스냅샷 응답을 모킹한 테스트에서 병합 결과 날짜 정렬·중복 0·재실행 멱등 green. (depends: S2)
- [ ] S4. **SOX** — `_INDEX_SYMBOLS`에 `"sox": "^SOX"` 추가(기존 요청경로 증분·가드 재사용; `IndexSection`은 고정 키 목록이라 화면 무변화). — 완료기준: `test_indices`가 `sox` 키를 단언하고 green, DoD 3 충족.
- [ ] S5. **프론트 `SemiconductorSection.jsx`** — 착수 전 `~/.claude/design/UIUX.md`·`dataviz` 읽기. SOX 타일(현재·등락, KR 색 관례 `--up`/`--down`) + SOX 1년 라인차트 · 메모리 표(분류 묶음 헤더 + 갱신일, 품목·평균가·등락률) · 표 아래 단일 차트(기본 `dram:475`, 행 탭 전환, 선택 행 강조) · 3상태(미조회/0건/실패 구분 — 실패를 「데이터 없음」으로 말하지 않기) · 품목명 `wordBreak: keep-all` + `overflowWrap: break-word`. `Market.jsx`에서 `IndexSection` 바로 아래 배치. 데이터: `/api/market/indices`(sox) + `/api/market/semiconductor`. — 완료기준: vitest — 행 탭 시 차트 품목 전환, 실패 시 「없음」 문구 미렌더, 기본 선택 `dram:475` green. (depends: S2, S4 — API 형태)
- [ ] S6. **문서** — DoD 8 목록. 코드·리뷰 뒤 직렬. — 완료기준: DoD 4·8 충족. (depends: S2, S3, S4, S5)
- [ ] S7. **dev 라이브 UAT** — `dev` push → dev 스택 배포 판정(DoD 6 기준) → uat-admin(`uat-admin@portfolion.dev`)으로 refresh·backfill 실행(백필 완료 대기) → DoD 6 API 대조 → DoD 7 스크린샷(`live-uat-probes` 스킬 호출). 라이브 계측 중엔 추가 push 금지. — 완료기준: DoD 6·7 충족. (depends: S6)
