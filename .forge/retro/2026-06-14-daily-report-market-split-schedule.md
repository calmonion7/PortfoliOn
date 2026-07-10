# 2026-06-14 — 일일 리포트 시장별(KR/US) 배치 분리 (task #45)

## Plan vs actual

- **계획대로**: S1~S7 전부 done, 리뷰 PASS. 단일 `daily_report` → `daily_report_kr`(20:30 KST·NXT 마감)·`daily_report_us`(07:00 KST·겨울 DST 안전) 두 형제 배치. 시장 파티션 KR=`=='KR'`·US=`!='KR'`(비-KR 흡수, 누락 0), 시드 마이그레이션(enabled·days 승계+time override→배포 즉시 KR 오후 이동), `_check_missed_report` 시장별 일반화, 시각인지 `expected_report_date`/`expected_report_dates`, `last_scheduled_date` 객체 형태교체, 프론트 미생성판정 시장별, 명세서 2종+CLAUDE.md 동기. pytest 565·npm build OK. ADR-0012는 fg-ask 때 생성. WHAT 전부 일치, 비목표 침범 0. Dynamic Workflow 4에이전트(백엔드 TDD→프론트∥문서→적대적 검증·리뷰), 결합도에 맞춘 좁은 파이프라인이 파일충돌·contract drift 없이 완주.

- **Divergences**:
  - **(HIGH, 리뷰가 포착·수정) 수동생성·백필 job_runs id 회귀**: 백엔드 에이전트가 `daily_report`를 BATCHES에서 뺐지만 `report.py`의 `_run_generation`/`_run_backfill`이 `job_runs.record("daily_report","manual")`를 그대로 둠 → `list_batches`가 kr/us만 조회하니 수동 생성/백필 실행이 **배치 현황 실행이력에서 증발**(고아 run 누적). 리뷰가 `daily_report_us`로 교정(수동은 KR+US 혼합이라 시장분할 부적절, US가 항상 존재하는 기본 버킷)+테스트 단언 갱신, pytest 재통과.
  - **기존 테스트가 깨진 동작을 단언**: `test_job_runs_instrumentation`이 옛 `daily_report` manual을 단언 → TDD green이 위 회귀를 못 잡았고 적대적 리뷰가 잡음.
  - `_check_missed_report`를 진입점+`_check_missed_report_for(job_id, market)`로 분리(기존 시그니처 보존). `generate_all`은 명시 date 없으면 market별 그룹핑해 그룹마다 `expected_report_date(market)`로 생성. 프론트 `lastScheduledDate→lastScheduledDates`(객체), `useReportGeneration` date prop 제거(date 생략→백엔드 by-market 위임), ReportManualGen 3분류→2분류('수집기간아님' 자연소멸).
  - **(info/미수정) Cowork 외부 클라이언트 계약 파괴** — 형태교체는 repo 밖 Cowork 동시수정 필요(plan/ADR-0012 명시 Non-goal). 비기능 주석/예시의 stale 단일 'daily_report' 잔존(`app_schema.sql:261`·`test_schedule_spec.py:201`·`test_scheduler_rankings.py:58`·`scheduler.py:304`) — surgical 원칙상 미수정.

## Learnings

- **Do differently next time**:
  - **배치 id를 BATCHES에서 은퇴시키면 그 id를 쓰는 4표면을 전수 grep**: ① 데이터 read, ② 표시 문자열, ③ **`job_runs.record(id,...)` 모든 lane(auto+manual+backfill)**, ④ 그 id를 단언하는 테스트. 이번은 ③의 manual/backfill 누락이 회귀를 냈다. 이는 [[configurable-batch-schedules]]의 "source 은퇴→read 표면 전수 감사"·[[batch-schedule-display-refresh]]의 "표시 read-side 쌍둥이"에 이은 **write/계측 쌍둥이**로, 같은 함정의 3번째 재발 → CLAUDE.md Gotcha로 승격.
  - **곧 은퇴할 식별자를 단언하는 테스트는 회귀를 가린다**: 옛 id를 단언하던 테스트가 green이라 TDD가 회귀를 통과시킴 → 적대적 리뷰가 안전망. id 은퇴 시 테스트도 grep 대상. 워크플로우에 적대적 리뷰 단계를 둔 게 결정적으로 유효(리뷰 자동수정 임계=critical/high∨계획위반 적용).
  - **결합도 높은 작업엔 좁은 파이프라인이 거대 팬아웃보다 안전**: contract가 백엔드→프론트로 관통하고 storage/scheduler를 공유하는 작업이라, 백엔드 1에이전트(배리어)→[프론트∥문서]→리뷰로 좁혀 파일충돌·contract drift를 원천 차단. 분리 효용(병렬)보다 결합 안전이 우선인 케이스.
- **검증 게이트**: repo 관행([[feedback-verification]])대로 라이브는 배포 후. 자동 게이트 pytest 565+npm build로 단위검증, TDD 모드라 통과 테스트가 yes 증거. 라이브 백엔드 재배포 후 부팅 헬스 401 안정(5분 폴링, 502 0건)=기동 시드 마이그레이션 안전(과거 시드 부팅실패 전례 회피). `verified: yes`. 잔여 사용자 글랜스: `GET /api/batches` 2종 노출(admin)·KR 오후생성은 다음 평일 20:30 발현.

## Doc updates

- CONTEXT.md promotion: none (장마감·기대 리포트 날짜는 fg-ask 때 등록 완료, 실행 중 신규/변경 용어 없음).
- ADR added: none 신규 (ADR-0012는 fg-ask 때 생성, 실행 결정은 그 범위 내).
- CLAUDE.md: Gotcha 1건 추가 — "배치 id 은퇴 시 4표면(read·표시·job_runs record 전 lane·테스트) 전수 grep"(이 retro 학습 #1 승격).
- 코드: commit a1f6e628(기능, main push·자동배포) + CLAUDE.md gotcha 후속 커밋.
