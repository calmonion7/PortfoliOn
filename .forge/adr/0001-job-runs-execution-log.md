# 0001 — 배치 실행 이력을 전용 job_runs 테이블로 추적

- 상태: 채택 (Accepted)
- 날짜: 2026-06-06
- 관련: task #6 (settings-batch-hub), `.forge/CONTEXT.md` 배치/실행 이력

## 맥락 (Context)

설정화면 재설계에서 "모든 배치의 현황"을 보여주려면 각 배치의 최근 실행시각·성공/실패를 알아야 한다. 그러나 현재 코드에는 배치 실행을 추적하는 인프라가 없다. 부분적 단서만 존재한다(guru_managers.last_updated, leverage coverage의 최신 날짜 등).

다음 실행시각(next_run)은 APScheduler가 공짜로 제공하지만, **과거 실행 결과**는 어디에도 기록되지 않는다.

## 결정 (Decision)

배치 실행 결과를 **전용 `job_runs` 테이블**에 기록한다. 실행 1회 = 1행(job_id, trigger[auto|manual], started_at, finished_at, status, error). 배치별 **최근 20건**만 보관하고 초과분은 insert 시 삭제한다. 읽기는 방어적으로(테이블 부재시 빈 결과) 처리한다.

## 고려한 대안 (Alternatives)

1. **타겟 테이블 신선도 추론 (경량)** — 각 배치가 만든 데이터의 최신 timestamp를 읽어 "최근 갱신"을 유추. 신규 write 인프라 불필요.
   - 단점: 실행했지만 신규 데이터가 없던 경우/실패를 구분 못 함, 자동/수동 트리거 구분 불가, 배치마다 다른 테이블·컬럼을 알아야 함.
2. **전용 실행 로그 (채택)** — 모든 배치를 동일한 방식으로 추적, 성공/실패·트리거·에러 메시지까지 기록.
   - 단점: 신규 테이블 + 모든 잡 계측 + 보관 관리 필요.

## 결과 (Consequences)

- 모든 배치가 동일 인터페이스로 현황을 노출 → 허브 UI가 단순해진다.
- `scheduler.py` 잡과 수동 엔드포인트에 계측(`record(...)` 래핑)이 추가된다.
- 신규 테이블이므로 자동배포 환경에서 **마이그레이션을 push 전/동시 적용**해야 한다(읽기는 방어적이라 부재시 500은 안 나지만 이력은 비어 보임).
- **계측은 관측 전용 — 측정 대상(배치 본문)을 절대 깨뜨리지 않는다.** `record()`의 write-path(enter INSERT·prune DELETE·exit UPDATE)를 모두 try/except로 감싸, 테이블 부재/DB 오류 시 경고 로그 후 본문은 정상 실행된다(read-path의 graceful degrade와 대칭). 실행 후 보강(task #6 리뷰)으로, 초기 구현은 enter INSERT가 무방비여서 테이블 부재 윈도우에 모든 자동 잡이 깨질 뻔했다.
- 향후 코드/UI가 job_runs에 의존하기 시작하면 모델 변경 비용이 커진다(되돌리기 어려움).
