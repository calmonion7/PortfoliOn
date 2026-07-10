# 2026-06-06 — 설정화면 재설계: 배치 현황 허브 (task #6)

## Plan vs actual

- **What went as planned**: 6슬라이스 전부 done. 백엔드 TDD 335 테스트 통과, 프론트 빌드 OK. IA(2탭·카테고리·컴팩트카드+펼치기), 권한모델(열람=모두/액션=admin), 배치 레지스트리(크론잡 1:1), job_runs 실행로그(20건/잡), 자동/수동 계측, 신규 수동 트리거 4종, 미게이트 엔드포인트 admin 통일 — 모두 WHAT 일치. 결과=계획.
- **Divergences**:
  - **엔드포인트 prefix 오기**: 계획 메모는 `/api/market-indicators/...`였으나 실제 라우터 prefix는 `/api/market`. 에이전트가 신규/게이팅을 `/api/market/...`로 구현하고 batch_registry의 manual_endpoint 문자열까지 일치 정정(프론트=레지스트리=라우트 일관).
  - **리뷰 자동수정 임계 누락**: 워크플로우 fix 단계가 critical/high만 반영 → 임베드 ReportSchedule 저장·LeverageBackfillSettings 백필이 비-admin에 노출되는 **medium 2건(결정 #7 위반)**이 누락. 오케스트레이터 교차검증에서 Settings.jsx 단일 수정(`Embed && isAdmin`)으로 보정·커밋(61716412).
  - **계측 write-path 무방비**: `record()`의 enter INSERT가 read-path와 달리 try/except 없음 → job_runs 테이블 부재 윈도우에 모든 자동 잡/동기 수동 엔드포인트가 깨질 뻔. 리뷰 high로 잡혀 enter/prune/exit 전부 graceful 처리 + 회귀 테스트 4건 추가(15ec6986).
  - **계측 위치 적응**: leverage 수동은 라우터 워커가 없어 `leverage_service.backfill_with_progress` 본문을 감쌈; investor는 이중기록 방지 위해 `_investor_trend_work()`로 워커 분리.
  - **배포 폴러 × 동시 세션 혼선**: push 후 2분 폴러가 `git reset --hard origin/main` 실행. 동시에 **다른 forge 세션**이 fg-map 커밋(e823a886)·새 task #7 promote를 같은 repo에서 진행 → main 분기(rebase로 해소), 내 task가 `executed/`로 park되고 active-슬롯 STATUS의 `verified: yes`가 pending으로 되돌려짐(executed/ 사본에 재기록).

## Learnings

- **Do differently next time**:
  - **워크플로우 리뷰 자동수정 임계 = "계획의 명시 결정 위반은 severity 무관 포함"**. 이번엔 결정 #7 위반이 medium이라 자동수정에서 빠져 수동 보정 필요했음. 오케스트레이션 스크립트의 fix 필터를 `critical/high || violates_plan_decision`로.
  - **워크트리 워크플로우 실행 전 환경 심링크 필수**: `.venv`·`.env(.docker)`·`node_modules`는 gitignore라 새 워크트리에 없음 → pytest/npm 전에 메인에서 심링크(이번에 사전 대응해 통과). 재사용 가능한 셋업 단계로 굳힐 것.
  - **한 repo 동시 forge 세션 경합 인지**: 장기 워크플로우 실행 중 다른 세션이 공유 `.forge/`·main을 건드릴 수 있음(fg-map/fg-ask/fg-run). 코드는 commit+push 묶고(폴러 reset 대비), forge 상태 충돌은 사후 reconcile. → [[project-deploy-poller-wipes-local-edits]] 참고.
  - **계측은 관측 전용**: 로깅/계측 write-path는 측정 대상을 절대 깨뜨리지 않게 read-path와 대칭으로 graceful 처리(ADR-0001 보강).
- **보류(후속 후보, low)**: 내부예외 삼키는 잡은 전체 실패해도 `success`로 기록(docstring 경고만, 잡별 실패 시맨틱 일괄 변경은 별도 슬라이스) · `refresh-market` 미게이트(범위 밖) · `recent_map` 미사용(/api/batches N+1) · `KEEP=20` 상수 미사용 · 레지스트리 trigger_kinds 메타 미세 불일치(consensus/leverage).

## Doc updates

- CONTEXT.md promotion: none (배치/배치 현황/사용처/실행 이력/액션·열람은 fg-ask 때 등록 완료; 실행 중 신규/변경 용어 없음)
- ADR added: none 신규 — 대신 **ADR-0001 Consequences 보강**(계측 관측 전용·write-path graceful degrade 1항목 추가)
- 배포 폴러 hard-reset 교훈은 사용자가 이미 CLAUDE.md(배포 섹션)+메모리([[project-deploy-poller-wipes-local-edits]])에 반영 → 중복 promotion 안 함
