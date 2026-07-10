# 2026-06-07 — 배치 스케줄 저장 후 '제목 밑 시간' 즉시 갱신 (task #17)

## Plan vs actual
- **계획대로**: S1~S3 전부 done. S1(TDD) `describe_schedule(spec)` 순수함수 RED→GREEN, S2 라우터 schedule_desc 파생, S3 프론트 `/api/batches` 재조회 배선. 백엔드 pytest 452 passed, npm build OK. 비목표 침범 0(레이아웃·에디터 입력 UX·비편집 정적문자열·타임존 꼬리표 미변경). 설계(fg-ask 그릴링)대로 유지.
- **Divergences (경미)**:
  - TDD 합의 범위는 "describe만"이었으나 S2도 라우터 테스트(`test_schedule_desc_derived_from_saved_spec_for_editable`)로 저비용 고정 — 범위 확대가 아니라 완료기준을 회귀방지로 못 박은 긍정적 보강.
  - interval 설명에서 타임존 꼬리표("(NY)")는 의도적으로 생략(describe는 spec-only 순수함수). us_rankings는 "장중 09–16시 10분마다"로 표기, 타임존은 펼친 에디터에 그대로 노출.

## Learnings
- **Do differently next time**:
  - **편집 가능한 source-of-truth를 도입하면 그 source의 *모든* read 표면을 감사하라 — 데이터 소비처뿐 아니라 사람이 보는 표시 문자열까지.** 이 버그는 직전 [[configurable-batch-schedules]] retro가 이미 적은 *"소스 통합은 write뿐 아니라 read 경로까지 동시에 옮겨야 완성"* 교훈의 **display read-side 쌍둥이**였다. 그때 데이터 read-side(`_last_scheduled_date`)는 batch_schedules 정본으로 전환했지만, 허브에 보이는 `schedule_desc`는 `batch_registry`의 **정적 하드코딩 문자열**로 남겨 spec과 끊겨 있었다 → 시간 바꿔도 영원히 안 바뀜(새로고침해도 동일). 같은 함정이 한 단계 다른 표면(표시)에서 재발. 교훈: "저장값을 보여주는 곳"을 grep으로 전수조사(데이터 파생 + UI 라벨/요약 둘 다)할 것.
  - **저장 후 갱신은 write 성공 != UI 반영.** 단일 화면에서 mount-1회 fetch만 하는 리스트는 저장 후 재조회(또는 in-place 갱신) 배선이 없으면 무조건 stale. 저장 콜백(`onSaved`)을 선언만 하고 부모에서 연결을 빼먹으면(=this case, `Settings.jsx:132`) 조용히 죽은 콜백이 된다. 신규 저장 플로우엔 "저장→갱신 경로"가 한 줄이라도 실제로 연결됐는지 확인.
- **검증 게이트**: repo 관행([[feedback-verification]])대로 라이브는 배포 후. 자동 게이트 pytest 452 + npm build로 S1/S2 동작 단위검증, S3는 build. `verified: skipped`(라이브 글랜스 사용자 재량). 커밋 e43fdc1c main push(자동배포).
- **후속 후보**: 없음(소규모 버그픽스로 종결). 직전 retro가 남긴 데드함수 `storage.save_schedule()` 정리는 여전히 별건으로 보류 중.

## Doc updates
- CONTEXT.md promotion: none (신규/변경 도메인 용어 없음 — schedule_desc·spec은 기존 구현 개념).
- ADR added: none (describe-from-spec은 ADR-0007 단일소스 철학의 당연한 read-side 연장으로 가역적·비-의외; interval "(NY)" 생략은 소규모 표시 결정 — 둘 다 ADR 3조건 미충족).
- 코드: commit e43fdc1c (main push, 자동배포).
