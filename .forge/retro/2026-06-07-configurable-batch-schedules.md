# 2026-06-07 — 모든 배치 자동스케줄 UI 편집 (task #16)

## Plan vs actual

- **계획대로**: S1~S5 5슬라이스 전부 done. 백엔드 TDD(S1~S4) RED→GREEN, 전체 445 passed, npm build OK. 통합 `batch_schedules`(job_id→jsonb spec) + 4패턴(일/주/월/인터벌)→CronTrigger 매핑, 제너릭 GET/PUT `/api/batches/{job_id}/schedule`(admin) + 프론트 `BatchScheduleEditor`, 기존 2종 흡수, 타임존 배치고정(us_rankings=NY)·인터벌 가드레일(≥5분·coalesce), 기동 idempotent 시딩으로 배포 직후 거동 불변, 구 report reload 버그 해소 — WHAT 전부 계획 일치. 비목표 침범 0. 설계(ADR-0007)는 견고했고 그대로 유지.
- **Divergences**:
  - **워크플로우 1차 실패→resume**: 오케스트레이션 JS의 `SUMMARIES` 누산 배열을 스크립트 맨 아래 `var`로 선언 → 호이스팅상 `undefined`라 S1 직후 `SUMMARIES.push` TypeError. S1 에이전트는 이미 실행돼 working tree에 편집이 남아 있었음(폴러 미반응 — origin 불변). 선언을 상단 `const`로 옮겨 `resumeFromRunId`로 재개(S1 캐시 히트, S2~ 라이브). 8에이전트로 완주.
  - **구 컴포넌트의 비-스케줄 기능 분리 보존(긍정적)**: 계획은 `ReportSchedule.jsx`/`GuruCrawlSettings.jsx` "제거"만 명시했으나, 두 파일엔 admin 유일 진입점인 '즉시 리포트 생성·과거 스냅샷 백필'·'즉시 구루 크롤(진행률)'이 섞여 있었음. 통째 삭제 시 기능 손실 → `ReportManualGen.jsx`/`GuruCrawlNow.jsx`로 분리 보존, 카드에 에디터와 함께 노출.
  - **CLAUDE_COWORK_API.md 미갱신(정당한 예외)**: 신규 스케줄 엔드포인트는 Bearer/admin 내부 관리용. Cowork 계약서(X-API-Key 외부 워크플로우)엔 스케줄 엔드포인트가 없어 API_SPEC.md만 갱신. "명세서 2개 동기" 규칙의 예외 케이스 확인.
  - **코드리뷰가 잡아 메인 세션이 직접 수정(리뷰 에이전트는 관찰만)**: critical 1·high 1·low 1 (아래 Learnings). 수정 후 445 재통과.

## Learnings

- **Do differently next time**:
  - **신규 테이블은 `app_schema.sql`만으론 기존 운영 DB에 안 닿는다 — `main._migrate()` 런타임 `CREATE TABLE IF NOT EXISTS`가 정본**. docker initdb 마운트는 빈 pgdata 최초만 실행. 이번엔 시드가 없는 테이블을 SELECT해 lifespan 실패→부팅 불가(critical)로 재현. 이 프로젝트가 반복적으로 겪은 뿌리(과거 task들 "DB 수동 적용 필요")라 ADR-0006에 보강함. **컬럼이든 테이블이든 신규 스키마는 _migrate 런타임 IF NOT EXISTS에 추가**를 기본으로.
  - **writer를 은퇴시키면 그 store의 모든 reader를 감사하라**: 구 PUT `/api/report/schedule` 제거로 레거시 `schedules` writer가 사라졌는데 `_last_scheduled_date`(report list·generate 기본날짜·portfolio·watchlist)는 여전히 그 테이블을 읽어 **stale**(high). 구 report reload 버그(저장돼도 소비처 미반영)의 **read-side 쌍둥이**. → `storage.get_daily_report_schedule()`로 정본(batch_schedules)+레거시 폴백 단일소스화, 소비처 4곳 전환. 교훈: "소스 통합"은 write뿐 아니라 read 경로까지 동시에 옮겨야 완성.
  - **APScheduler `misfire_grace_time=None`은 기본값이 아니라 '무제한 유예'**: `entry.get('misfire_grace_time')`가 10개 잡에서 None을 넘겨 기존 기본 1초→무제한으로 비의도 변경. behavior-preserving 목표였는데 미세 거동이 바뀜. → None이면 인자 자체를 생략(기본 1초 보존). 교훈: dict.get()로 옵션 인자를 넘길 때 None과 '미지정'의 라이브러리 시맨틱 차이를 확인.
  - **'에디터' 페이지에 섞인 비-에디터 기능은 삭제 전 분리**: 페이지명이 ReportSchedule라도 내부엔 무관한 admin 기능이 있을 수 있음. 통합/은퇴 시 grep으로 그 페이지의 다른 진입점을 먼저 확인.
  - **워크플로우 누산 배열은 상단 `const`로 선언**: 스크립트 하단 `var` 선언은 호이스팅상 `undefined`라 첫 push에서 터진다. 다행히 resume(scriptPath+resumeFromRunId)로 S1 캐시 재활용해 비용 없이 복구 — 워크플로우 JS 버그는 fail→fix→resume 루프가 저렴하다.
- **검증 게이트**: repo 관행([[feedback-verification]])대로 라이브 확인은 배포 후. pytest 445·npm build·시드==하드코딩 CronTrigger 동치·리뷰수정이 자동 게이트로 verified:yes. 배포 후 글랜스: 백엔드 부팅 + `GET /api/batches` 11종 spec/next_run + 카드 에디터 렌더·저장.
- **후속 후보(저위험)**: `storage.save_schedule()`이 호출자 0건 데드 함수로 남음(레거시 `schedules` 테이블도 시드 후 미사용). 레거시 테이블+writer 완전 제거는 surgical 범위를 넘어 보류 — 정리하려면 별도 작은 작업.

## Doc updates

- CONTEXT.md promotion: none (스케줄 패턴은 fg-ask 때 등록, 실행 중 신규/변경 용어 없음).
- ADR added: none 신규 — **ADR-0006 Consequences 보강**(신규 테이블도 `main._migrate()` 런타임 CREATE TABLE IF NOT EXISTS가 정본·app_schema.sql은 신규DB 미러; batch_schedules critical 재현 근거 1항목 추가). ADR-0007은 fg-ask 단계에서 이미 생성.
- 코드: commit b61b1ee1 (main push, 자동배포).
