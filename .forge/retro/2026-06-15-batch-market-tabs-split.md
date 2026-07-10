# 2026-06-15 — 배치 현황 허브 국내/해외/공통 탭 분리 + earnings·monthly 시장별 배치 분리 (task #46)

## Plan vs actual

- **계획대로**: S1~S7 전부 done, 적대적 리뷰 PASS. 배치 14→16종 — `earnings_refresh`→`earnings_kr`(KR Top2)/`earnings_us`(M7), `monthly_refresh`→`monthly_kr`(KR수출)/`monthly_us`(FRED econ). 전 배치 `market` 분류 KR 9/US 4/공통 3(합의표·ADR-0013 정확히 일치, FRED econ=출처국 기준 해외 포함). scheduler 시장별 4함수(각 기존 단일 시장 함수 1개만 호출)·`_JOB_FUNCS`/`_reschedule_job`/`start()` 자동 등록. 수동 lane `?market=KR|US` 재배선(각 시장 자기 id로 manual record, market∉{KR,US}→400). 기동 시드 `_seed_spec_for`가 옛 행 enabled·spec을 신규 4 id에 시각 override 없이 idempotent 승계. 프론트 배치 탭에 국내/해외/공통 서브탭(b.market 1차 필터 + 기존 category 섹션 유지, 최상위 탭 스타일 미러링). API_SPEC.md 갱신(CLAUDE_COWORK는 배치 id 미참조→무변경). TDD `test_batch_market_split.py`(22테스트) S1~S4 RED→GREEN, backend pytest 589 passed, npm build OK. WHAT 전부 일치, 비목표 침범 0. Dynamic Workflow 4에이전트(백엔드 TDD 직렬→프론트∥문서→적대적 리뷰)가 [[daily-report-market-split-schedule]]의 좁은 파이프라인 권고대로 파일충돌·contract drift 없이 완주.

- **Divergences (경미, 전부 run.md 기록·계획 위반 0)**:
  - **수동 엔드포인트 기본 market 비대칭**: refresh-earnings 기본 KR, refresh-monthly 기본 US(=monthly_us=FRED econ). 레지스트리 버튼은 항상 `?market` 명시라 기본값은 옛 무인자 호출 폴백일 뿐. 옛 `/refresh-monthly`(무인자)→monthly_us로 가도록 `test_refresh_monthly_admin_records` 갱신.
  - **고아 `/refresh-econ`은 은퇴가 아니라 흡수**: 엔드포인트·시그니처 유지, record id만 `monthly_refresh`→`monthly_us`로 교체(econ 단독).
  - **(리뷰 LOW, 메인 세션이 수정)** `job_runs.py:26` docstring이 은퇴 함수명(`_refresh_monthly`/`_refresh_earnings`) 예시로 잔존 — 내 rename이 만든 stale(4표면 밖). 신규 4함수명으로 갱신(CLAUDE.md §3 orphan 정리).
  - **(범위 외·커밋 제외)** `kospi_tickers.json`·`sp500_tickers.json` working tree 변경분은 task와 무관한 런타임 데이터 — surgical하게 커밋에서 제외(리뷰가 LOW로 포착).

## Learnings

- **Do differently next time**:
  - **"4표면 grep 잔존 0"엔 정당한 예외 — 시드 마이그레이션의 *옛 id read***. 은퇴 id가 scheduler에 남은 건 stale consumption이 아니라 옛 batch_schedules 행을 *읽어* 신규 4 id에 승계하는 의도된 read였다. [[batch-schedule-display-refresh]]·[[configurable-batch-schedules]]·[[daily-report-market-split-schedule]]이 쌓아온 "옛 id 잔존=회귀" gotcha를 **그대로 받으면 미래 개발자가 (a) 0 아닌 grep에 당황하거나 (b) 마이그레이션 read를 청소해 스케줄 승계를 깨뜨린다**. → CLAUDE.md line 201 gotcha에 "옛 store를 읽어 신규 id로 옮기는 마이그레이션 read는 정당한 잔존, 잔존 0은 *consumption* 기준" 한 줄 정련(승격).
  - **배치 변경이라고 다 외부 계약을 같은 강도로 건드리지 않는다 — additive vs 파괴적 형태교체 구분**. `/api/batches`에 `market` 필드 추가·배치 2종 증가는 기존 소비처를 안 깨는 **additive**라, [[daily-report-market-split-schedule]]의 `last_scheduled_date` 문자열→객체 **파괴적 형태교체**와 달리 Cowork 무영향 → "명세서 2개 동기"가 API_SPEC 단독 갱신으로 충분(COWORK는 배치 id 미참조). 분리 작업이라고 반사적으로 양쪽 명세를 다 손대지 말고, 실제 소비처 영향(grep)으로 판정.
  - **"한 잡이 시장별 독립 함수를 순차 호출"하는 구조는 분리가 거의 기계적**. earnings/monthly는 daily_report와 달리 `_in_market` 파티션 헬퍼 없이 각 신규 잡이 기존 함수 하나만 가리키면 끝이라 분리 위험이 데이터 로직이 아니라 **플밍(registry·scheduler·수동lane·시드)에 한정**됐다. 분리 가치 판정 시 "데이터가 이미 시장별 함수로 갈라져 있나"를 먼저 보면 비용 예측이 정확.
  - **좁은 파이프라인 3번째 유효**: contract가 백엔드→프론트로 관통하고 storage/scheduler/registry 공유하는 결합 작업엔 백엔드 1에이전트 직렬(배리어)→[프론트∥문서]→적대적 리뷰가 거대 팬아웃보다 안전. 적대적 리뷰가 docstring orphan·범위 외 tickers json을 LOW로 포착해 surgical 커밋을 지켰다.
- **검증 게이트**: repo 관행([[feedback-verification]])대로 라이브는 배포 후. 자동 게이트 pytest 589(TDD 완료기준 커버, passing=yes 증거)+npm build+적대적 리뷰 PASS+메인 세션 grep/pytest 교차검증으로 `verified: yes`. 커밋 eca28bf3 main push(자동배포 폴러 반영). 잔여 사용자 글랜스: 배포 후 배치 탭 3 서브탭·신규 4카드·수동실행 실행이력 기록.

## Doc updates

- CONTEXT.md promotion: none (배치 시장 분류 용어는 fg-ask 때 등록 완료, 실행 중 신규/변경 용어 없음).
- ADR added: none 신규 (ADR-0013은 fg-ask 때 생성, 실행 결정은 그 범위 내; 수동 기본 market·refresh-econ 흡수는 가역적 경미 결정이라 ADR 3조건 미충족).
- CLAUDE.md: line 201 4표면 grep gotcha에 **"시드 마이그레이션의 옛 id read는 정당한 잔존" 한 줄 정련**(이 retro 학습 #1 승격). + line 200 배치 시장 분류 gotcha는 실행 중 docs 에이전트가 추가.
- 코드: commit eca28bf3(기능, main push·자동배포) + 회고 CLAUDE.md 정련(별도 커밋 예정).
