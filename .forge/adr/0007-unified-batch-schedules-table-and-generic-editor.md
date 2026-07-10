# 0007 — 배치 스케줄을 통합 batch_schedules 테이블 + 제너릭 에디터로 통일

- 상태: 채택 (Accepted)
- 날짜: 2026-06-07
- 관련: task #16 (configurable-batch-schedules), `.forge/CONTEXT.md` 스케줄 패턴, ADR-0001(job_runs)·ADR-0006(기동 시 idempotent 마이그레이션)

## 맥락 (Context)

자동 배치는 11종인데, 스케줄을 UI에서 편집할 수 있는 건 `daily_report`(`schedules` 테이블, `{enabled,time,days[]}`)와 `guru_crawl`(`guru_schedules` 테이블, `{enabled,day,time}`) 2종뿐이다. 둘은 각자 전용 테이블·전용 엔드포인트(`/api/schedule`, `/api/guru/schedule`)·전용 UI(`ReportSchedule.jsx`, `GuruCrawlSettings.jsx`)를 갖는다. 나머지 9종은 `scheduler.py`에 크론이 하드코딩돼 있어 코드 배포 없이는 못 바꾼다.

"모든 배치의 스케줄을 일/주/월/인터벌 패턴으로 편집 가능하게" 하려면, 배치마다 전용 테이블·엔드포인트·UI를 11벌 만드는 건 비현실적이다. 저장·배선·UI를 한 형태로 통일해야 한다.

## 결정 (Decision)

배치 스케줄을 **단일 `batch_schedules` 테이블**(`job_id` PK → `jsonb` spec)로 통합한다. spec은 모든 패턴을 한 구조로 표현한다:

```
{ enabled, type: "daily"|"weekly"|"monthly"|"interval",
  time: "HH:MM",            // daily/weekly/monthly
  days: ["mon",...],        // weekly
  day_of_month: 1..31,      // monthly
  every_minutes, start_hour, end_hour }  // interval
```

- 4패턴 모두 **하나의 APScheduler `CronTrigger`로 매핑**한다(interval = `hour="{start}-{end}", minute="*/{N}"`).
- **타임존은 spec에 두지 않는다.** `batch_registry`의 배치별 고정 속성으로 두고(편집 불가) 트리거 생성 시 합친다. 기본 `Asia/Seoul`, `us_rankings`만 `America/New_York` 예외.
- 기존 `daily_report`·`guru_crawl`을 이 구조로 흡수한다(전용 테이블·엔드포인트·UI 이관·은퇴).
- 제너릭 엔드포인트 `GET/PUT /api/batches/{job_id}/schedule`(admin) 1쌍 + 제너릭 스케줄러 `_reschedule_job(job_id)`/`reload(job_id)` + 제너릭 프론트 에디터 1개.
- 기동 시 **idempotent 시딩**(ADR-0006 패턴): 행이 없으면 기본 spec을 넣는다. `daily_report`·`guru_crawl`은 기존 테이블 값을 읽어 시드(운영 중 admin 설정 보존), 나머지 9종은 현재 하드코딩 동작과 동일한 spec으로 시드 → 배포 직후 동작 불변, admin이 바꾸기 전까진 그대로.

## 고려한 대안 (Alternatives)

1. **추가만(하이브리드)** — 9종용 새 테이블·에디터·엔드포인트만 추가, 기존 2종은 전용 테이블/엔드포인트/UI 유지.
   - 단점: 저장 구조 3가지·코드 경로 2가지가 영구히 남는다. 제너릭 스케줄러/에디터가 3가지 형태를 분기 처리해야 하고, `daily_report`의 reload 누락 버그도 따로 고쳐야 한다. 부채 영구화.
2. **raw 크론 문자열 편집** — spec 없이 `"*/10 9-15 * * *"` 같은 문자열을 admin이 직접 입력.
   - 단점: 사용자 적대적. "월배치/일배치 패턴" 요구와 안 맞고 입력 실수에 무방비.
3. **통합 테이블 + 제너릭(채택)** — 한 구조·한 경로·한 UI.
   - 단점: 초기 처신(기존 2종 이관 + 마이그레이션)이 크다.

## 결과 (Consequences)

- 11종이 동일 인터페이스로 스케줄을 노출·편집 → 에디터/스케줄러가 단순해진다.
- `daily_report`의 PUT 시 `reload()` 누락 버그가 통일 과정에서 자연 해소된다.
- 기존 `schedules`·`guru_schedules` 테이블은 시딩 때 1회 읽힌 뒤 **사용 중단(데드)** — 스키마엔 남겨 둔다(드롭은 별도, 가역적이므로 비목표).
- 향후 새 패턴 추가 비용은 spec·트리거 빌더·에디터 3곳에 집중된다(되돌리기 어려움).
- **타임존 편집이 필요해지면 모델 확장이 필요**하다(현재는 의도적으로 배치 고정). `us_rankings`의 NY 예외는 registry 고정값으로만 표현.
- 무거운 외부 API 배치(backlog/lending/earnings/monthly)도 인터벌로 바꿀 수 있으므로, 폭주 방지 가드레일(최소 5분 + `coalesce=True`)이 데이터 모델이 아니라 검증·트리거 옵션 레벨에 필요하다.
