# 2026-06-06 — 수주잔고 전 종목 자동 수집 배치 추가 (task 11)

## Plan vs actual
- What went as planned: 4슬라이스(S1 fetch_all_backlog / S2 scheduler backlog_fetch 주간크론 / S3 admin refresh-all 엔드포인트 / S4 batch_registry) 전부 TDD RED→GREEN으로 계획대로 완료. 검증·리뷰 단계에서 5개 항목(admin게이팅·job_runs id 일관성·manual_endpoint=실제라우트·라우트순서·비목표) 전부 compliant, 수정 0건. backend 전체 352 passed, 프론트 변경 0. commit+push(7874cf7e) 완료.
- Divergences: 실질 분기 없음. 사소한 것 — (1) `fetch_all_backlog` 반환형을 `{total,ok,failed}`로 확정(계획은 "집계 반환"까지만), (2) `test_batches_router.py`의 함수명 `test_lists_eleven_batches_with_required_fields`가 본문은 12를 단언하지만 이름은 "eleven" 잔존(이름 변경은 비목표라 의도적 미수정), (3) `batch_registry` docstring "11개→12개" 동기화.

## Learnings
- Do differently next time:
  - **닮은꼴 미러링 + TDD가 0수정 런을 만든다**: 신규 배치는 leverage/lending(scheduler `_fetch_*` + `job_runs.record(id,"auto")`), 장시간 수동 전체-엔드포인트는 consensus/batch(BackgroundTasks+202, 워커 안 `record(id,"manual")`)를 그대로 미러링 → 패턴 일탈 없이 통과. 새 배치 추가 시 이 두 앵커를 1차 참조.
  - **워크플로우 슬라이스가 같은 테스트 파일을 건드리면 직렬화**: S2·S3가 둘 다 `tests/test_job_runs_instrumentation.py`를 편집 → 병렬이면 인플레이스 편집 충돌. 의존성이 약해도 "공유 편집 대상"이 있으면 순차 웨이브로. (※ 충돌 회피용 별도 테스트파일 분리도 대안이나, 계측 스파이 픽스처 중복을 피하려 직렬 선택.)
  - **fg-ask 선행 그라운딩이 실행 서프라이즈를 0으로**: batch_registry·INTEGRATIONS 맵·settings-batch-hub 회고를 그릴링 때 읽어 통합지점(usage 문자열, manual_endpoint 경로, job_runs id 규칙)을 못 박은 덕에 실행 분기 없음. 배치/허브 영역 작업은 이 3종 선행 읽기를 기본으로.
- 후속 후보(저위험 cosmetic): `test_lists_eleven_batches_with_required_fields` → `_twelve_`(혹은 카운트 무관 이름)로 정리. 배치가 더 늘면 이름이 또 어긋남.
- 관측(액션 불요): KR 전 종목 직렬 DART 스윕은 종목별 ~0.3s sleep 누적으로 느림 — 의도된 설계(주간 새벽 cron + 수동은 BackgroundTasks 백그라운드)라 현 단계 문제 없음. 종목 수가 수백으로 커지면 그때 병렬화/레이트버짓 재검토.

## Doc updates
- CONTEXT.md promotion: 배치 enumeration 갱신 — "자동 배치 10종 → 11종", `backlog_fetch` 추가 (line 13). 새 용어는 없음(기존 "배치" 개념의 인스턴스).
- ADR added: none — "배치=크론 1:1" 패턴은 ADR-0001+settings-batch-hub로 기확립, 주기(주1회)·직렬순회는 가역적이라 ADR 불요.
