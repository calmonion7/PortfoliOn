# run — listener-resume-and-enrich-run-check (task#390)

실행: 워크플로 없이 메인 세션 직접 실행(소규모 · 파일 4개).

## 슬라이스
- S1 이어받기 테스트 작성(ⓐ~ⓓ + 대조군) — ✅ 구현 전 8건 FAIL 기록(AttributeError: `_save_state`·`_load_state`·`_load_resume_job`·`_pid_alive` 부재). ⓑⓒ 빨간불 확인.
- S2 상태 파일 기록·갱신·삭제 + 기동 시 이어받기(pid 대기) — ✅ 30 passed(기존 22 + 신규 8)
- S3 B1 스크립트 `scripts/loopcheck-enrich-run.py` + `tests/test_loopcheck_enrich_run.py` — ✅ 6 passed, 라이브 `22/22` exit 0
- S4 docstring 이어받기 단락 + 문서 해당없음 확인 — ✅ README·API_SPEC·CLAUDE_COWORK_API grep 히트 0건(이어받기와 무관)
- S5 PR — ⏸ 커밋·push·PR 은 외부 행위라 loop 종료 후 사람 확인 대기(아래 divergence).

## DoD baseline → after
1. 리스너 테스트: 22 passed → 30 passed (신규 8, 구현 전 8 failed)
2. 전체 스위트: 2558 → 2568 passed (회귀 없음)
3. B1 테스트: 스크립트 없음 → 6 passed (경계: started_at 직전=미갱신, 정확히 started_at=갱신, naive tz 미통과)
4. 라이브 대조: 스크립트 없음 → `22/22 (run 28170, started_at 2026-10-16T13:30:15Z)` exit 0
5. 문서: docstring 이어받기 단락 추가, grep 히트 0건
6. 배포 판정: 머지 후 사람 몫

## Divergence
- 상태 파일 위치는 `RUN_DIR/fullrun-state.json`(계획은 "RUN_DIR 아래 상태 파일 하나"). 상태 파일이 하나라 **큐에서 대기 중인 뒤 회차는 이어받기 대상이 아니다** — docstring에 명시.
- B1 은 `services.db.query` 를 `main(query=...)` 로 주입 가능하게 해 conftest 가드와 충돌 없이 테스트.
- 이 `_run_chunks` 시그니처에 `start`·`wait_pid` 가 추가돼 워커·`_enqueue_chunks` 호출은 무변경.
